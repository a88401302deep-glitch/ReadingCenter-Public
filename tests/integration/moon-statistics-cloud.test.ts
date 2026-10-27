import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createSyncingIndexedDbRepositories } from '../../src/data'
import { handleEntityApi } from '../../src/server/entity-api'
import { CloudflareEntityClient } from '../../src/sync/cloudflare'
import { CloudflareSyncSession } from '../../src/sync/cloudflare/sync-session'
import { createSourceReadingDayStore } from '../../worker/source-reading-day-store'
import { createReadingGoalStore } from '../../worker/reading-goal-store'
import { createReadingPreferencesStore } from '../../worker/reading-preferences-store'
import { D1EntityStore } from '../../worker/d1-entity-store'
import type { D1Database, D1PreparedStatement } from '../../worker/cloudflare-types'
import { importMoonStatistics } from '../../src/import/moon-statistics-import'
import { BookService } from '../../src/features/books/book-service'
import worker from '../../worker/index'

it('syncs source totals through D1, retaining offline writes and skipping repeated imports on another device', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const first = createSyncingIndexedDbRepositories('source-a-' + crypto.randomUUID())
  const second = createSyncingIndexedDbRepositories('source-b-' + crypto.randomUUID())
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
    const client = new CloudflareEntityClient('https://source.test', async (input, init) => {
      if (offline) throw new TypeError('offline')
      const request = new Request(String(input), init)
      const store = request.url.includes('/entities/sourceReadingDay') ? await createSourceReadingDayStore(database) : request.url.includes('/entities/readingPreferences') ? await createReadingPreferencesStore(database) : request.url.includes('/entities/readingGoal') ? await createReadingGoalStore(database) : books
      return handleEntityApi(request, store)
    })
    const a = new CloudflareSyncSession(first, client), b = new CloudflareSyncSession(second, client)
    const book = await new BookService(first.repositories, () => 'kept-book').create({ title: '既有書籍', mediaTypeId: 'ebook' })
    expect(await a.sync()).toMatchObject({ status: 'completed' })
    const before = await books.get('book', book.id)
    const input = [{ deviceId: 'reader', name: 'backup.mrpro', statistics: [{ path: '/unmatched.txt', durationMs: 12345, readWords: 100, days: [{ dayCode: 20697, durationMs: 12345, readWords: 100, progressPercent: 100 }] }] }]
    await importMoonStatistics(first.repositories, input)
    const entry = (await first.outbox.getAll())[0]
    offline = true
    expect(await a.sync()).toMatchObject({ status: 'stopped', pending: 1 })
    offline = false
    expect(await a.sync()).toMatchObject({ status: 'completed', pending: 0 })
    expect(await b.sync()).toMatchObject({ status: 'completed', pending: 0 })
    expect(await second.repositories.sourceReadingDays.getAll()).toEqual(await first.repositories.sourceReadingDays.getAll())
    expect(await importMoonStatistics(second.repositories, input)).toEqual({ imported: 0, skipped: 1 })
    expect(await second.outbox.getAll()).toEqual([])
    expect((await client.apply(entry)).revision).toBe(1)
    await createSourceReadingDayStore({ prepare: sql => database.prepare(sql) })
    expect(await (await createSourceReadingDayStore(database)).list('sourceReadingDay', true)).toHaveLength(1)
    expect(await books.get('book', book.id)).toEqual(before)
    expect(await second.repositories.readingCycles.getAll()).toEqual([])
  } finally { await first.deleteDatabase(); await second.deleteDatabase(); sqlite.close() }
})

it('does not initialize source storage before authentication', async () => {
  let queries = 0
  const response = await worker.fetch(new Request('https://source.test/api/v1/entities/sourceReadingDay'), {
    API_ENABLED: 'true', AUTH_PASSWORD: 'test', AUTH_SESSION_SECRET: 'test-secret',
    READING_CENTER_DB: { prepare() { queries++; throw new Error('must not query before authentication') } }
  })
  expect(response.status).toBe(401)
  expect(queries).toBe(0)
})
