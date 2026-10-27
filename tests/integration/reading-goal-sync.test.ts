import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createSyncingIndexedDbRepositories } from '../../src/data'
import { handleEntityApi } from '../../src/server/entity-api'
import { CloudflareEntityClient } from '../../src/sync/cloudflare'
import { CloudflareSyncSession } from '../../src/sync/cloudflare/sync-session'
import { saveAnnualBookGoal, saveReadingGoal } from '../../src/features/reading-overview/reading-goal-service'
import { BookService } from '../../src/features/books/book-service'
import type { D1Database, D1PreparedStatement } from '../../worker/cloudflare-types'
import { D1EntityStore } from '../../worker/d1-entity-store'
import { createReadingGoalStore } from '../../worker/reading-goal-store'
const now = '2026-10-04T00:00:00.000Z'

it('persists goals in additive D1 storage, syncs two devices, retains offline changes and concurrent edits', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const first = createSyncingIndexedDbRepositories('goal-first-' + crypto.randomUUID())
  const second = createSyncingIndexedDbRepositories('goal-second-' + crypto.randomUUID())
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
    const client = new CloudflareEntityClient('https://goals.test', async (input, init) => {
      if (offline) throw new TypeError('offline')
      const request = new Request(String(input), init)
      const store = request.url.includes('/entities/readingGoal') ? await createReadingGoalStore(database) : books
      return handleEntityApi(request, store)
    })
    const a = new CloudflareSyncSession(first, client), b = new CloudflareSyncSession(second, client)
    const book = await new BookService(first.repositories, () => 'kept-book', () => now).create({ title: '原有書籍', mediaTypeId: 'ebook' })
    await a.sync()
    const bookBefore = await books.get('book', book.id)
    const goal = await saveReadingGoal(first.repositories, '2026-10', 1500, 0, now)
    const entry = (await first.outbox.getAll())[0]
    offline = true
    expect(await a.sync()).toMatchObject({ status: 'stopped', pending: 1 })
    expect(await first.repositories.readingGoals.getById(goal.id)).toEqual(goal)
    offline = false
    expect(await a.sync()).toMatchObject({ status: 'completed', pending: 0 })
    await b.sync()
    expect(await second.repositories.readingGoals.getById(goal.id)).toEqual(goal)
    expect(await second.outbox.getAll()).toEqual([])
    // A repeated mutation uses the shared receipts without another revision.
    const replay = await client.apply(entry)
    expect(replay.revision).toBe(1)
    await saveReadingGoal(first.repositories, '2026-10', 1800, 1, now)
    await saveReadingGoal(second.repositories, '2026-10', 2400, 1, now)
    await a.sync()
    expect(await b.sync()).toMatchObject({ status: 'stopped', conflicts: 1 })
    expect((await second.outbox.getAll())[0]).toMatchObject({ kind: 'readingGoal', entity: { targetMinutes: 2400 } })
    expect((await second.conflicts.getAll())[0]).toMatchObject({ kind: 'readingGoal' })
    await saveReadingGoal(first.repositories, '2026-10', null, 2, now)
    await a.sync()
    const fresh = await createReadingGoalStore(database)
    expect((await fresh.get('readingGoal', goal.id))?.payload).toMatchObject({ targetMinutes: null, revision: 3 })
    expect(await books.get('book', book.id)).toEqual(bookBefore)
    // Explicit schema initialization remains idempotent on a fresh binding wrapper.
    await createReadingGoalStore({ prepare: sql => database.prepare(sql) })
    expect((await fresh.list('readingGoal', true))).toHaveLength(1)
    const annual = await saveAnnualBookGoal(first.repositories, '2026', 70, 0, now)
    await a.sync()
    const third = createSyncingIndexedDbRepositories('goal-third-' + crypto.randomUUID())
    try {
      await new CloudflareSyncSession(third, client).sync()
      expect(await third.repositories.readingGoals.getById(annual.id)).toMatchObject({ targetBooks: 70, targetMinutes: null })
    } finally { await third.deleteDatabase() }
    expect((await fresh.get('readingGoal', annual.id))?.payload).toMatchObject({ targetBooks: 70 })
    expect(await books.get('book', book.id)).toEqual(bookBefore)
  } finally { await first.deleteDatabase(); await second.deleteDatabase(); sqlite.close() }
})
