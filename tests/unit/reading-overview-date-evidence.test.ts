import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'

it('includes date-only reading evidence in recent ordering without creating completion or daily totals', async () => {
  const repositories = createInMemoryRepositories()
  const books = new BookService(repositories)
  const cycles = new ReadingCycleService(repositories)
  const older = await books.create({ title: '只有開始日', mediaTypeId: 'ebook' })
  const latest = await books.create({ title: '最後閱讀日', mediaTypeId: 'ebook' })
  const timed = await books.create({ title: '同日有時間', mediaTypeId: 'ebook' })
  const planned = await books.create({ title: '尚未開始', mediaTypeId: 'ebook' })
  await cycles.create(older.id, { status: 'reading', startedOn: '2026-10-01' })
  await cycles.create(latest.id, { status: 'reading', startedOn: '2026-09-01', lastReadOn: '2026-10-04', reportedDurationMinutes: 200 })
  await cycles.create(timed.id, { status: 'reading', startedAt: '2026-10-03T23:00:00Z' })
  await cycles.create(planned.id, { status: 'planned', startedOn: '2026-10-05' })
  const before = await repositories.readingCycles.getAll()
  const service = new ReadingOverviewService(repositories, () => new Date('2026-10-05T00:00:00Z'))
  for (let query = 0; query < 2; query++) {
    const overview = await service.getOverview()
    expect(overview.recentBooks.map(row => row.book.id)).toEqual([timed.id, latest.id, older.id])
    expect(overview.recentBooks[1]).toMatchObject({ lastReadAt: '2026-10-04', totalMinutes: 200, status: 'reading', progress: null })
    expect(overview.metrics).toMatchObject({ completedBookCount: 0, readingDays: 0, totalMinutes: 0, recordCount: 0 })
    expect(overview.byBook[latest.id]).toMatchObject({ completedBookCount: 0, readingDays: 0, totalMinutes: 200, recordCount: 0 })
    expect(overview.activities).toEqual([])
  }
  expect(await repositories.readingCycles.getAll()).toEqual(before)
  expect(await repositories.readingRecords.getAll()).toEqual([])
})
it('keeps newer manual reading and explicit completion evidence ahead of older date-only values', async () => {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories).create({ title: '混合日期', mediaTypeId: 'ebook' })
  const cycles = new ReadingCycleService(repositories)
  const cycle = await cycles.create(book.id, { status: 'reading', startedOn: '2026-10-01', lastReadOn: '2026-10-02' })
  await new ReadingRecordService(repositories).create(book.id, { cycleId: cycle.id, startedAt: '2026-10-03T01:00:00Z', progress: { unit: 'percent', value: 40 } })
  const service = new ReadingOverviewService(repositories)
  expect((await service.getOverview()).recentBooks[0]).toMatchObject({ lastReadAt: '2026-10-03T01:00:00Z', progress: { unit: 'percent', value: 40 }, status: 'reading' })
  await cycles.update(cycle.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-10-04' } }, cycle.revision)
  expect((await service.getOverview()).recentBooks[0]).toMatchObject({ lastReadAt: '2026-10-04', status: 'completed' })
})
