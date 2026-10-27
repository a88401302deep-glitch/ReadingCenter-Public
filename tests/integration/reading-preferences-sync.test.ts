import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createSyncingIndexedDbRepositories } from '../../src/data'
import { handleEntityApi } from '../../src/server/entity-api'
import { CloudflareEntityClient } from '../../src/sync/cloudflare'
import { CloudflareSyncSession } from '../../src/sync/cloudflare/sync-session'
import { saveMonthColors } from '../../src/features/reading-overview/reading-preferences-service'
import { defaultMonthColors } from '../../src/domain'
import worker from '../../worker/index'
import { BookService } from '../../src/features/books/book-service'
import type { D1Database, D1PreparedStatement } from '../../worker/cloudflare-types'
import { D1EntityStore } from '../../worker/d1-entity-store'
import { createReadingGoalStore } from '../../worker/reading-goal-store'
import { createReadingPreferencesStore } from '../../worker/reading-preferences-store'
const now = '2026-10-04T00:00:00.000Z'

it('persists month colors in additive D1 storage, syncs two devices, retains offline changes and concurrent edits', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const first = createSyncingIndexedDbRepositories('palette-first-' + crypto.randomUUID())
  const second = createSyncingIndexedDbRepositories('palette-second-' + crypto.randomUUID())
  try {
    sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
    sqlite.exec(readFileSync(new URL('../../migrations/0003_work_activity_kinds.sql', import.meta.url), 'utf8'))
    const database: D1Database = { prepare(sql) {
      const statement = sqlite.prepare(sql)
      let values: SQLInputValue[] = []
      const prepared: D1PreparedStatement = {
        bind(...input) { values = input as SQLInputValue[]; return prepared },
        async first<T>() { return (statement.get(...values) as T) ?? null },
        async all<T>() { return { success: true, results: statement.all(...values) as T[], meta: {} } },
        async run() { const result = statement.run(...values); return { success: true, meta: { changes: Number(result.changes) } } }
      }
      return prepared
    } }
    const books = new D1EntityStore(database)
    let offline = false
    const client = new CloudflareEntityClient('https://palette.test', async (input, init) => {
      if (offline) throw new TypeError('offline')
      const request = new Request(String(input), init)
      const store = request.url.includes('/entities/readingPreferences') ? await createReadingPreferencesStore(database) : request.url.includes('/entities/readingGoal') ? await createReadingGoalStore(database) : books
      return handleEntityApi(request, store)
    })
    const a = new CloudflareSyncSession(first, client), b = new CloudflareSyncSession(second, client)
    const book = await new BookService(first.repositories, () => 'kept-book', () => now).create({ title: '原有書籍', mediaTypeId: 'ebook' })
    await a.sync()
    const bookBefore = await books.get('book', book.id)
    const colors: string[] = [...defaultMonthColors]; colors[1] = '#123456'
    const goal = await saveMonthColors(first.repositories, colors, 0, now)
    const entry = (await first.outbox.getAll())[0]
    offline = true
    expect(await a.sync()).toMatchObject({ status: 'stopped', pending: 1 })
    expect(await first.repositories.readingPreferences.getById(goal.id)).toEqual(goal)
    offline = false
    expect(await a.sync()).toMatchObject({ status: 'completed', pending: 0 })
    await b.sync()
    expect(await second.repositories.readingPreferences.getById(goal.id)).toEqual(goal)
    expect(await second.outbox.getAll()).toEqual([])
    // A repeated mutation uses the shared receipts without another revision.
    const replay = await client.apply(entry)
    expect(replay.revision).toBe(1)
    await saveMonthColors(first.repositories, Array(12).fill('#000000'), 1, now)
    await saveMonthColors(second.repositories, Array(12).fill('#ffffff'), 1, now)
    await a.sync()
    expect(await b.sync()).toMatchObject({ status: 'stopped', conflicts: 1 })
    expect((await second.outbox.getAll())[0]).toMatchObject({ kind: 'readingPreferences', entity: { monthColors: Array(12).fill('#ffffff') } })
    expect((await second.conflicts.getAll())[0]).toMatchObject({ kind: 'readingPreferences' })
    await saveMonthColors(first.repositories, [...defaultMonthColors], 2, now)
    await a.sync()
    const fresh = await createReadingPreferencesStore(database)
    expect((await fresh.get('readingPreferences', goal.id))?.payload).toMatchObject({ monthColors: [...defaultMonthColors], revision: 3 })
    expect(await books.get('book', book.id)).toEqual(bookBefore)
    // Explicit schema initialization remains idempotent on a fresh binding wrapper.
    await createReadingPreferencesStore({ prepare: sql => database.prepare(sql) })
    expect((await fresh.list('readingPreferences', true))).toHaveLength(1)
  } finally { await first.deleteDatabase(); await second.deleteDatabase(); sqlite.close() }
})


it('does not initialize preference storage before authentication', async () => {
  let queries = 0
  const response = await worker.fetch(new Request('https://palette.test/api/v1/entities/readingPreferences'), {
    API_ENABLED: 'true', AUTH_PASSWORD: 'test', AUTH_SESSION_SECRET: 'test-secret',
    READING_CENTER_DB: { prepare() { queries++; throw new Error('must not query before authentication') } }
  })
  expect(response.status).toBe(401)
  expect(queries).toBe(0)
})

it('upgrades an existing v11 database without changing books, goals or queued mutations', async () => {
  const { default: Dexie } = await import('dexie')
  const { createMetadata } = await import('../../src/domain')
  const { createPutOutboxEntry, createInMemoryRepositories } = await import('../../src/data')
  const name = 'palette-upgrade-' + crypto.randomUUID()
  const old = new Dexie(name)
  old.version(11).stores({
    books: 'id, title, updatedAt', readingCycles: 'id, bookId, status, updatedAt',
    readingRecords: 'id, bookId, cycleId, startedAt, updatedAt', readingContents: 'id, bookId, cycleId, readingRecordId, type, updatedAt',
    dictionaries: 'id, kind, name, updatedAt', collections: 'id, kind, name, updatedAt',
    works: 'id, title, mediaType, updatedAt', activityLogs: 'id, workId, cycleId, activityType, startedAt, updatedAt',
    syncOutbox: '++sequence, &mutationId, [kind+entityId], queuedAt', syncConflicts: '&mutationId, [kind+entityId], detectedAt',
    syncCache: '&key', syncReviewArchive: '&id, resolvedAt', readingGoals: '&id, period, updatedAt'
  })
  const book = await new BookService(createInMemoryRepositories(), () => 'upgrade-book', () => now).create({ title: '保留舊資料', mediaTypeId: 'ebook' })
  const goal = { ...createMetadata({ id: 'reading-goal:2026', now }), period: '2026', targetMinutes: 60 }
  const pending = createPutOutboxEntry('readingGoal', goal, 'upgrade-goal-mutation', now)
  await old.table('books').put(book)
  await old.table('readingGoals').put(goal)
  await old.table('syncOutbox').add(pending)
  old.close()
  const upgraded = createSyncingIndexedDbRepositories(name)
  try {
    expect(await upgraded.repositories.books.getById(book.id)).toEqual(book)
    expect(await upgraded.repositories.readingGoals.getById(goal.id)).toEqual(goal)
    expect((await upgraded.outbox.getAll())[0]).toMatchObject(pending)
    expect(await upgraded.repositories.readingPreferences.getAll()).toEqual([])
    await saveMonthColors(upgraded.repositories, [...defaultMonthColors], 0, now)
    expect(await upgraded.outbox.getAll()).toHaveLength(2)
  } finally { old.close(); await upgraded.deleteDatabase() }
})
