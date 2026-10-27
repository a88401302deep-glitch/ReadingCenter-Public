import { describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'

describe('ReadingOverviewService', () => {
  it('combines cycles and actual records, preserves minute offsets, and excludes planned or undated cycles', async () => {
    const repositories = createInMemoryRepositories()
    let id = 0
    const books = new BookService(repositories, () => `mixed-book-${++id}`)
    const cycles = new ReadingCycleService(repositories, () => `mixed-cycle-${++id}`)
    const records = new ReadingRecordService(repositories, () => `mixed-record-${++id}`)
    const started = await books.create({ title: '閱讀中的書', mediaTypeId: 'ebook' })
    const completed = await books.create({ title: '有時分的完讀', mediaTypeId: 'ebook' })
    const planned = await books.create({ title: '待讀', mediaTypeId: 'ebook' })
    const undated = await books.create({ title: '無日期', mediaTypeId: 'ebook' })
    await cycles.create(started.id, { status: 'reading', startedAt: '2026-10-04T03:00:00Z' })
    await cycles.create(completed.id, { status: 'completed', completionDate: { precision: 'minute', completedOn: '2026-10-04', localTime: '10:30', offsetMinutes: 480 } })
    await cycles.create(completed.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-10-01' } })
    await records.create(completed.id, { startedAt: '2026-10-03T02:00:00Z', durationMinutes: 20 })
    await cycles.create(planned.id, { status: 'planned', startedAt: '2026-10-05T03:00:00Z' })
    await cycles.create(undated.id, { status: 'paused', reportedReadingDays: 7 })
    const overview = await new ReadingOverviewService(repositories).getOverview()
    expect(overview.recentBooks.map(item => item.book.id)).toEqual([started.id, completed.id])
    expect(overview.recentBooks[1]).toMatchObject({ lastReadAt: '2026-10-04T02:30:00.000Z', totalMinutes: 20, hasRecordedDuration: true })
    expect(overview.activities).toHaveLength(1)
    expect(overview.byBook[started.id]).toMatchObject({ recordCount: 0, totalMinutes: 0, readingDays: 0 })
    expect(await repositories.readingRecords.getAll()).toHaveLength(1)
  })
  it('counts confirmed source completion dates without inventing reading events or using edit dates', async () => {
    const repositories = createInMemoryRepositories()
    const bookIds = ['dated', 'undated', 'older']
    const books = new BookService(repositories, () => bookIds.shift()!)
    const dated = await books.create({ title: '有日期的完讀', mediaTypeId: 'ebook' })
    const undated = await books.create({ title: '沒有日期的完讀', mediaTypeId: 'ebook' })
    const older = await books.create({ title: '先前月份完讀', mediaTypeId: 'ebook' })
    const ids = ['cycle-dated', 'cycle-undated', 'cycle-older']
    const cycles = new ReadingCycleService(repositories, () => ids.shift()!, () => '2026-10-01T02:00:00.000Z')
    await cycles.create(dated.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-10-01' }, reportedReadingDays: 7 })
    await cycles.create(undated.id, { status: 'completed', reportedReadingDays: 4 })
    await cycles.create(older.id, { status: 'completed', completionDate: { precision: 'range', startedOn: '2026-09-01', completedOn: '2026-09-30' } })
    const overview = await new ReadingOverviewService(repositories, () => new Date('2026-10-01T04:00:00.000Z')).getOverview()
    expect(overview.metrics).toMatchObject({ completedBookCount: 1, readingDays: 0, totalMinutes: 0, recordCount: 0 })
    expect(overview.activities).toEqual([])
    expect(overview.recentBooks.map(item => [item.book.id, item.lastReadAt, item.hasRecordedDuration])).toEqual([
      [dated.id, '2026-10-01', false], [older.id, '2026-09-30', false]
    ])
    expect(await repositories.readingRecords.getAll()).toEqual([])
    expect(overview.byBook[dated.id]).toMatchObject({ completedBookCount: 1, readingDays: 0, totalMinutes: 0 })
  })

  it('uses the configured timezone and counts a reading span across local midnight', async () => {
    const repositories = createInMemoryRepositories()
    const book = await new BookService(repositories, () => 'book-1').create({ title: '跨午夜測試', mediaTypeId: 'ebook' })
    await new ReadingCycleService(repositories, () => 'cycle-1', () => '2026-09-14T03:00:00.000Z').create(book.id, {
      status: 'completed',
      startedAt: '2026-09-13T15:50:00.000Z',
      finishedAt: '2026-09-14T03:00:00.000Z'
    })
    const ids = ['record-1', 'record-2']
    const recordService = new ReadingRecordService(repositories, () => ids.shift()!)
    await recordService.create(book.id, { startedAt: '2026-09-13T15:50:00.000Z', durationMinutes: 20, progress: { unit: 'percent', value: 10 } })
    await recordService.create(book.id, { startedAt: '2026-09-14T02:00:00.000Z', durationMinutes: 30, progress: { unit: 'percent', value: 20 } })
    const overview = await new ReadingOverviewService(repositories, () => new Date('2026-09-14T04:00:00.000Z'), 'Asia/Taipei').getOverview()
    expect(overview.metrics).toMatchObject({ bookCount: 1, completedBookCount: 1, readingDays: 2, totalMinutes: 50, recordCount: 2 })
    expect(overview.byBook[book.id]).toMatchObject({ readingDays: 2, totalMinutes: 50, recordCount: 2, completedBookCount: 1 })
    expect(overview.recentBooks[0]).toMatchObject({ book: { id: book.id }, lastReadAt: '2026-09-14T03:00:00.000Z', totalMinutes: 50 })
    expect(overview.activities.map((item) => item.id)).toEqual(['record-2', 'record-1'])
  })

  it('reflects record edit and deletion from the same query source', async () => {
    const repositories = createInMemoryRepositories()
    const book = await new BookService(repositories, () => 'book-1').create({ title: '一致性測試', mediaTypeId: 'ebook' })
    const records = new ReadingRecordService(repositories, () => 'record-1')
    const record = await records.create(book.id, { startedAt: '2026-09-14T01:00:00.000Z', durationMinutes: 10 })
    const overview = new ReadingOverviewService(repositories, () => new Date('2026-09-14T04:00:00.000Z'), 'Asia/Taipei')
    expect((await overview.getOverview()).metrics.totalMinutes).toBe(10)
    await records.update(record.id, { startedAt: record.startedAt, durationMinutes: 25 })
    expect((await overview.getOverview()).metrics.totalMinutes).toBe(25)
    await records.delete(record.id)
    const afterDelete = await overview.getOverview()
    expect(afterDelete.metrics).toMatchObject({ totalMinutes: 0, recordCount: 0 })
    expect(afterDelete.activities).toEqual([])
    expect(afterDelete.recentBooks).toEqual([])
  })
})

it('sums unique completed books while separating unknown word counts and undated completions', async () => {
  const repositories = createInMemoryRepositories()
  let id = 0
  const books = new BookService(repositories, () => `words-${++id}`)
  const dated = await books.create({ title: '本月完讀', mediaTypeId: 'novel', wordCount: 100000 })
  const undated = await books.create({ title: '無日期完讀', mediaTypeId: 'book', wordCount: 200000 })
  const unknown = await books.create({ title: '字數未知', mediaTypeId: 'book' })
  await books.create({ title: '未讀', mediaTypeId: 'novel', wordCount: 999999 })
  const cycles = new ReadingCycleService(repositories, () => `words-cycle-${++id}`)
  for (let repeat = 0; repeat < 2; repeat++) await cycles.create(dated.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-10-04' } })
  await cycles.create(undated.id, { status: 'completed' })
  await cycles.create(unknown.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-10-04' } })
  const service = new ReadingOverviewService(repositories, () => new Date('2026-10-04T00:00:00Z'))
  expect((await service.getOverview()).wordCounts).toEqual({ allTime: { totalWords: '300000', knownBooks: 2, unknownBooks: 1 }, month: { totalWords: '100000', knownBooks: 1, unknownBooks: 1 } })
  await books.update(dated.id, { title: dated.title, mediaTypeId: 'novel', wordCount: null })
  expect((await service.getOverview()).wordCounts?.allTime).toEqual({ totalWords: '200000', knownBooks: 1, unknownBooks: 2 })
})
