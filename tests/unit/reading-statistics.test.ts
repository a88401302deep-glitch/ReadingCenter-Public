import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { categoryStatistics, statisticsForPeriod } from '../../src/features/reading-overview/reading-statistics'

it('keeps source completion precision, unique books, missing durations and cross-month attribution distinct', async () => {
  const repositories = createInMemoryRepositories()
  let id = 0
  const books = new BookService(repositories, () => `book-${++id}`)
  const records = new ReadingRecordService(repositories, () => `record-${++id}`)
  const cycles = new ReadingCycleService(repositories, () => `cycle-${++id}`)
  const book = await books.create({ title: '跨月', mediaTypeId: 'ebook' })
  const historical = await books.create({ title: '歷史完讀', mediaTypeId: 'ebook' })
  const undated = await books.create({ title: '未知日期', mediaTypeId: 'ebook' })
  await cycles.create(historical.id, { status: 'completed', completionDate: { precision: 'range', startedOn: '2026-08-01', completedOn: '2026-09-15' }, reportedReadingDays: 7 })
  await cycles.create(historical.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-09-20' } })
  await cycles.create(undated.id, { status: 'completed', reportedReadingDays: 4 })
  await records.create(book.id, { startedAt: '2026-09-30T15:50:00Z', durationMinutes: 20 })
  await records.create(book.id, { startedAt: '2026-10-02T00:00:00Z' })
  const service = new ReadingOverviewService(repositories, () => new Date('2026-10-04T00:00:00Z'))
  const overview = await service.getOverview()
  const data = overview.statistics!
  const september = statisticsForPeriod(data, '2026-09')
  const october = statisticsForPeriod(data, '2026-10')
  expect(september).toMatchObject({ minutes: 20, completedBooks: 1, readingDays: 1, readBooks: 2 })
  expect(october).toMatchObject({ minutes: 0, knownRecords: 0, unknownRecords: 1, completedBooks: 0, readingDays: 2, readBooks: 1 })
  expect(october.readingDays).toBe(overview.metrics.readingDays)
  expect(october.minutes).toBe(overview.metrics.totalMinutes)
  expect(data.undatedCompletions).toBe(1)
  expect(data.days.some(day => day.date.startsWith('2026-08'))).toBe(false)
  expect(statisticsForPeriod(data, '2026').completedBooks).toBe(1)
  expect(categoryStatistics(data, september)).toEqual([{ id: 'uncategorized', name: '未分類', count: 2, percentage: 100 }])
  await records.delete((await repositories.readingRecords.getAll())[0].id)
  const refreshed = (await service.getOverview()).statistics!
  expect(statisticsForPeriod(refreshed, '2026-09').minutes).toBe(0)
  expect(statisticsForPeriod(refreshed, '2026-10').readingDays).toBe(1)
})
