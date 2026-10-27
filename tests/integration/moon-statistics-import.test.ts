import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createSyncingIndexedDbRepositories, type SyncingLocalRepositoryContext } from '../../src/data'
import { importMoonStatistics } from '../../src/import/moon-statistics-import'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'

const locals: SyncingLocalRepositoryContext[] = []
const local = () => { const context = createSyncingIndexedDbRepositories(`moon-test-${crypto.randomUUID()}`); locals.push(context); return context }
afterEach(async () => { for (const context of locals.splice(0)) await context.deleteDatabase() })
const snapshot = (deviceId = 'one', durationMs = 60001, path = '/unmatched/book.txt', dayCode = 20697) => ({ deviceId, name: 'backup.mrpro', statistics: [{ path, durationMs, readWords: 20, days: [{ dayCode, durationMs, readWords: 20, progressPercent: 100 }] }] })

it('persists unmatched daily evidence, deduplicates repeated backups and independently adds devices and paths', async () => {
  const context = local()
  const input = [snapshot(), snapshot('two'), snapshot('one', 60001, '/other/book.txt')]
  await expect(importMoonStatistics(context.repositories, input)).resolves.toEqual({ imported: 3, skipped: 0 })
  await expect(importMoonStatistics(context.repositories, input)).resolves.toEqual({ imported: 0, skipped: 3 })
  const rows = await context.repositories.sourceReadingDays.getAll()
  expect(rows).toHaveLength(3)
  expect(rows[0]).toMatchObject({ bookId: null, date: '2026-09-02', dayCode: 20697, durationMs: 60001, progressPercent: 100 })
  expect(rows[0]).not.toHaveProperty('startedAt')
  expect(await context.repositories.books.getAll()).toEqual([])
  expect(await context.repositories.readingCycles.getAll()).toEqual([])
  expect(await context.outbox.getAll()).toHaveLength(3)
  const overview = await new ReadingOverviewService(context.repositories).getOverview()
  expect(overview.sourceTotals).toEqual({ rows: 3, durationMs: 180003, readWords: 60 })
  expect(overview.statistics?.days).toEqual([]) // Brief openings stay in raw storage, not reading statistics.
  context.close()
  const reopened = createSyncingIndexedDbRepositories(context.database.name)
  expect(await reopened.repositories.sourceReadingDays.getAll()).toHaveLength(3)
  reopened.close()
})

it('rejects a differing daily value before saving any part of a batch', async () => {
  const context = local()
  await importMoonStatistics(context.repositories, [snapshot()])
  await expect(importMoonStatistics(context.repositories, [snapshot('two'), snapshot('one', 99999)])).rejects.toThrow('未覆寫')
  expect(await context.repositories.sourceReadingDays.getAll()).toHaveLength(1)
  expect(await context.outbox.getAll()).toHaveLength(1)
})

it('rolls back source rows and outbox together when a write fails and permits a safe retry', async () => {
  const context = local(), realSave = context.repositories.sourceReadingDays.save.bind(context.repositories.sourceReadingDays)
  const mock = vi.spyOn(context.repositories.sourceReadingDays, 'save').mockImplementationOnce(realSave).mockRejectedValueOnce(new Error('write failed'))
  await expect(importMoonStatistics(context.repositories, [snapshot(), snapshot('two')])).rejects.toThrow('write failed')
  expect(await context.repositories.sourceReadingDays.getAll()).toEqual([])
  expect(await context.outbox.getAll()).toEqual([])
  mock.mockRestore()
  await expect(importMoonStatistics(context.repositories, [snapshot(), snapshot('two')])).resolves.toEqual({ imported: 2, skipped: 0 })
})

it('retains a disputed completion marker and refuses impossible source dates', async () => {
  const context = local()
  await importMoonStatistics(context.repositories, [snapshot()], new Set([JSON.stringify(['one', '/unmatched/book.txt'])]))
  expect((await context.repositories.sourceReadingDays.getAll())[0].completionDisputed).toBe(true)
  await expect(importMoonStatistics(context.repositories, [snapshot('two', 60001, '/book', Number.MAX_SAFE_INTEGER)])).rejects.toThrow()
  expect(await context.repositories.sourceReadingDays.getAll()).toHaveLength(1)
})
