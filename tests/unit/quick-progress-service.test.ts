import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import type { ReadingProgress } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { QuickProgressService } from '../../src/features/reading-overview/quick-progress-service'
async function setup() {
  const repos = createInMemoryRepositories()
  const book = await new BookService(repos).create({ title: '進度測試', mediaTypeId: 'ebook' })
  const cycles = new ReadingCycleService(repos)
  const cycle = await cycles.create(book.id, { status: 'reading', startedAt: '2026-10-01T00:00:00.000Z' })
  const record = await new ReadingRecordService(repos).create(book.id, { cycleId: cycle.id, startedAt: '2026-10-02T00:00:00.000Z', durationMinutes: 20, progress: { unit: 'percent', value: 25 } })
  return { repos, book, cycle, cycles, record, service: new QuickProgressService(repos) }
}
it('records 100% without adding time, completing a cycle or modifying old evidence', async () => {
  const { repos, book, cycle, record, service } = await setup()
  const context = await service.load(book.id)
  await service.save(book.id, 'snapshot', context.token, '2026-10-03T03:00:00.000Z', { unit: 'percent', value: 100 })
  expect(await repos.books.getById(book.id)).toEqual(book)
  expect(await repos.readingCycles.getById(cycle.id)).toEqual(cycle)
  expect(await repos.readingRecords.getById(record.id)).toEqual(record)
  expect(await repos.readingRecords.getById('snapshot')).toMatchObject({ cycleId: cycle.id, durationMinutes: null, endedAt: null, sourceId: null })
  const overview = await new ReadingOverviewService(repos).getOverview()
  expect(overview.byBook[book.id]).toMatchObject({ completedBookCount: 0, totalMinutes: 20 })
  expect(overview.recentBooks[0]).toMatchObject({ status: 'reading', progress: { unit: 'percent', value: 100 } })
})
it.each<ReadingProgress>([
  { unit: 'page', value: 45, total: null },
  { unit: 'chapter', value: 12, total: 20, label: '第十二章' },
  { unit: 'position', value: 120, total: 200, label: '既有位置' }
])('preserves supported progress: $unit', async progress => {
  const { repos, book, service } = await setup()
  const context = await service.load(book.id)
  await service.save(book.id, 'snapshot', context.token, '2026-10-03T03:00:00.000Z', progress)
  expect((await repos.readingRecords.getById('snapshot'))?.progress).toEqual(progress)
})
it('returns the same operation after retry and rejects reuse with changed data', async () => {
  const { repos, book, service } = await setup()
  const context = await service.load(book.id)
  const args = [book.id, 'snapshot', context.token, '2026-10-03T03:00:00.000Z', { unit: 'percent', value: 40 }] as const
  const record = await service.save(...args)
  expect(await service.save(...args)).toEqual(record)
  await expect(service.save(book.id, 'snapshot', context.token, args[3], { unit: 'percent', value: 50 })).rejects.toThrow('不同資料')
  expect(await repos.readingRecords.getAll()).toHaveLength(2)
})
it('rejects stale drafts after a new reading cycle', async () => {
  const { repos, book, cycle, cycles, service } = await setup()
  const context = await service.load(book.id)
  const reread = await cycles.create(book.id, { status: 'reading' })
  await expect(service.save(book.id, 'snapshot', context.token, '2026-10-03T03:00:00.000Z', { unit: 'percent', value: 40 })).rejects.toThrow('已有變更')
  expect(await repos.readingRecords.getAll()).toHaveLength(1)
  expect(await repos.readingCycles.getById(cycle.id)).toEqual(cycle)
  expect(await repos.readingCycles.getById(reread.id)).toEqual(reread)
})
it.each<ReadingProgress>([
  { unit: 'percent', value: 101 }, { unit: 'percent', value: -1 },
  { unit: 'page', value: 5, total: 0 }, { unit: 'chapter', value: 21, total: 20, label: null }
])('rejects invalid progress without writing', async progress => {
  const { repos, book, service } = await setup()
  const context = await service.load(book.id)
  await expect(service.save(book.id, 'snapshot', context.token, '2026-10-03T03:00:00.000Z', progress)).rejects.toThrow()
  expect(await repos.readingRecords.getAll()).toHaveLength(1)
})
it('rejects completed or deleted books', async () => {
  const { repos, book, cycle, cycles, service } = await setup()
  await cycles.update(cycle.id, { status: 'completed' }, cycle.revision)
  await expect(service.load(book.id)).rejects.toThrow('不是閱讀中')
  await repos.books.delete(book.id)
  await expect(service.load(book.id)).rejects.toThrow('找不到')
})
