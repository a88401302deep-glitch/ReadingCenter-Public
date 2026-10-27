import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { createMetadata, type SourceReadingDay } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { statisticsForPeriod } from '../../src/features/reading-overview/reading-statistics'
import { completedOnDay } from '../../src/features/reading-overview/reading-heatmap'

it('includes source completions in overall, month, year, calendar and latest completions once per book while preserving confirmed dates', async () => {
  const repo = createInMemoryRepositories()
  const books = new BookService(repo)
  const source = await books.create({ title: '来源完讀', mediaTypeId: 'ebook', wordCount: 1000 })
  const confirmed = await books.create({ title: '既有完讀', mediaTypeId: 'ebook', wordCount: 2000 })
  const disputed = await books.create({ title: '待核對', mediaTypeId: 'ebook' })
  const brief = await books.create({ title: '試開', mediaTypeId: 'ebook' })
  await new ReadingCycleService(repo).create(confirmed.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-08-02' } })
  const row = (id: string, bookId: string | null, date: string, durationMs = 600000, completionDisputed = false): SourceReadingDay => ({ ...createMetadata({ id, now: '2026-10-12T00:00:00Z' }), source: 'moon', deviceId: id, sourcePath: '/book.txt', sourceTitle: '來源', backupName: 'backup.mrpro', dayCode: 0, date, bookId, durationMs, readWords: 100, progressPercent: 100, completionDisputed })
  for (const item of [row('first', source.id, '2026-09-02'), row('other-device', source.id, '2026-09-02'), row('later', source.id, '2026-10-04'), row('confirmed-source', confirmed.id, '2026-09-03'), row('disputed', disputed.id, '2026-09-05', 600000, true), row('brief', brief.id, '2026-09-06', 300000), row('unmatched', null, '2026-09-07')]) await repo.sourceReadingDays.save(item)
  const result = await new ReadingOverviewService(repo, () => new Date('2026-09-20T00:00:00Z')).getOverview()
  expect(Object.values(result.byBook).filter(item => item.completedBookCount > 0)).toHaveLength(2)
  expect(result.metrics.completedBookCount).toBe(1)
  expect(statisticsForPeriod(result.statistics!, '2026').completedBooks).toBe(2)
  expect(statisticsForPeriod(result.statistics!, '2026-09').completedBooks).toBe(1)
  expect(statisticsForPeriod(result.statistics!, '2026-10').completedBooks).toBe(0)
  expect(completedOnDay(result.statistics!.days.find(day => day.date === '2026-09-02'))).toBe(1)
  expect(result.summaries!.completed.map(item => [item.book.id, item.date])).toEqual([[source.id, '2026-09-02'], [confirmed.id, '2026-08-02']])
  expect(result.wordCounts!.allTime).toMatchObject({ totalWords: '3000', knownBooks: 2 })
  expect(result.timeline!.entries.filter(item => item.kind === 'source-completion')).toHaveLength(1)
  expect((await repo.readingCycles.getAll())).toHaveLength(1)
  expect(await repo.readingRecords.getAll()).toEqual([])
  expect(await repo.sourceReadingDays.getAll()).toHaveLength(7)
})
