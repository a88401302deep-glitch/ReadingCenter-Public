import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data/in-memory-repositories'
import { confirmPhotoBook } from '../../src/import/photo-book'
import { confirmPhotoReading } from '../../src/import/photo-reading'
import { buildReadingStatistics, statisticsForPeriod } from '../../src/features/reading-overview/reading-statistics'
import { cycleReportedMinutes } from '../../src/features/reading-overview/cycle-reported-minutes'
const draft = { title: '京都怪奇談 3', author: '', publisher: '', isbn: '', visibleText: '完讀日期：2026/09/30 閱讀時間：4小時22分鐘' }
const options = { bookId: null, hash: 'a'.repeat(64), source: '讀墨', mediaType: 'ebook', allowSameTitle: false }
const reading = { completedOn: '2026-09-30', totalMinutes: '262', allowReread: false }
it('supplements an already imported book with date precision and a cumulative total, without creating a timed session or another book', async () => {
 const repo = createInMemoryRepositories(), book = await confirmPhotoBook(repo, draft, options)
 expect(await repo.readingCycles.getAll()).toEqual([])
 const cycle = await confirmPhotoReading(repo, book.id, options.hash, reading)
 expect(cycle).toMatchObject({ bookId: book.id, startedAt: null, finishedAt: null, completionDate: { precision: 'date', completedOn: '2026-09-30' }, reportedDurationMinutes: 262 })
 expect(await repo.books.getAll()).toEqual([book])
 expect(await repo.readingRecords.getAll()).toEqual([])
 expect(await confirmPhotoReading(repo, book.id, options.hash, reading)).toEqual(cycle)
 expect(await repo.readingCycles.getAll()).toHaveLength(1)
 await expect(confirmPhotoReading(repo, book.id, 'b'.repeat(64), reading)).rejects.toThrow('同一天')
 await expect(confirmPhotoReading(repo, book.id, options.hash, { ...reading, totalMinutes: '263' })).rejects.toThrow('內容不同')
})
it('validates before writing, preserves unknown duration and requires explicit reread confirmation', async () => {
 const repo = createInMemoryRepositories(), book = await confirmPhotoBook(repo, draft, options)
 for (const bad of [{ ...reading, completedOn: '2026-02-30' }, { ...reading, completedOn: '' }, { ...reading, totalMinutes: '-1' }, { ...reading, totalMinutes: '2.5' }]) await expect(confirmPhotoReading(repo, book.id, options.hash, bad)).rejects.toThrow()
 expect(await repo.readingCycles.getAll()).toEqual([])
 const cycle = await confirmPhotoReading(repo, book.id, options.hash, { ...reading, totalMinutes: '' })
 expect(cycle.reportedDurationMinutes).toBeNull()
 const reread = { ...reading, completedOn: '2026-10-04' }
 await expect(confirmPhotoReading(repo, book.id, 'b'.repeat(64), reread)).rejects.toThrow('重讀')
 const second = await confirmPhotoReading(repo, book.id, 'b'.repeat(64), { ...reread, allowReread: true })
 expect(second.sequence).toBe(2)
})
it('keeps cumulative time out of daily totals and suppresses it when detailed time already exists', async () => {
 const repo = createInMemoryRepositories(), book = await confirmPhotoBook(repo, draft, options)
 const cycle = await confirmPhotoReading(repo, book.id, options.hash, reading)
 expect(cycleReportedMinutes([cycle], [], []).get(book.id)).toBe(262)
 const statistics = buildReadingStatistics({ entries: [{ id: cycle.id, kind: 'completion', book, date: '2026-09-30', cycle }], undatedCompletions: 0 }, [], '2026-09')
 expect(statisticsForPeriod(statistics, '2026-09')).toMatchObject({ completedBooks: 1, minutes: 0, readingDays: 0 })
 const record = { ...cycle, startedAt: '2026-09-29T00:00:00Z', endedAt: null, durationMinutes: 20, cycleId: cycle.id, progress: null, deviceId: null, sourceId: null }
 expect(cycleReportedMinutes([cycle], [record], []).has(book.id)).toBe(false)
})
