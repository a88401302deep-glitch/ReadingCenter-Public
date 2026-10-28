import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { confirmPhotoReading } from '../../src/import/photo-reading'
import { cycleProgress } from '../../src/features/reading-overview/cycle-progress'
async function fixture() {
 const repositories = createInMemoryRepositories()
 const book = await new BookService(repositories).create({ title: '截圖進度', mediaTypeId: 'ebook' })
 return { repositories, book, draft: { status: 'reading' as const, completedOn: '', totalMinutes: '200', lastReadOn: '2026-10-04', allowReread: false }, hash: 'd'.repeat(64) }
}
for (const value of ['0', '65.5', '100']) it('saves confirmed percentage without inferring completion or time: ' + value, async () => {
 const f = await fixture(), draft = { ...f.draft, progressPercent: value }
 const cycle = await confirmPhotoReading(f.repositories, f.book.id, f.hash, draft)
 expect(cycle).toMatchObject({ status: 'reading', reportedProgressPercent: Number(value), reportedDurationMinutes: 200, completionDate: null, startedAt: null, finishedAt: null })
 expect(await confirmPhotoReading(f.repositories, f.book.id, f.hash, draft)).toEqual(cycle)
 expect(await f.repositories.readingCycles.getAll()).toHaveLength(1)
 const result = await new ReadingOverviewService(f.repositories, () => new Date('2026-10-05T00:00:00Z')).getOverview()
 expect(result.recentBooks[0]).toMatchObject({ progress: { unit: 'percent', value: Number(value) }, status: 'reading', totalMinutes: 200 })
 expect(result.metrics).toMatchObject({ completedBookCount: 0, readingDays: 0, totalMinutes: 0, recordCount: 0 })
 expect(await f.repositories.readingRecords.getAll()).toEqual([])
 const updated = await new ReadingCycleService(f.repositories).update(cycle.id, { status: 'paused' }, cycle.revision)
 expect(updated.reportedProgressPercent).toBe(Number(value))
})
it('rejects invalid percentages and changed repeats without overwriting stored data', async () => {
 const f = await fixture()
 for (const progressPercent of ['-1', '101', 'NaN', 'Infinity', '50%', '1e1']) await expect(confirmPhotoReading(f.repositories, f.book.id, f.hash, { ...f.draft, progressPercent })).rejects.toThrow('進度')
 expect(await f.repositories.readingCycles.getAll()).toEqual([])
 const cycle = await confirmPhotoReading(f.repositories, f.book.id, f.hash, { ...f.draft, progressPercent: '50' })
 await expect(confirmPhotoReading(f.repositories, f.book.id, f.hash, { ...f.draft, progressPercent: '51' })).rejects.toThrow('內容不同')
 expect(await f.repositories.readingCycles.getAll()).toEqual([cycle])
})
it('stores progress-only screenshots without inventing a reading date or timestamp', async () => {
 const f = await fixture()
 const cycle = await confirmPhotoReading(f.repositories, f.book.id, f.hash, { ...f.draft, totalMinutes: '', lastReadOn: '', progressPercent: '0' })
 expect(cycle).toMatchObject({ reportedProgressPercent: 0, reportedDurationMinutes: null, completionDate: null, startedAt: null })
 expect(cycle.lastReadOn).toBeUndefined()
 expect((await new ReadingOverviewService(f.repositories).getOverview()).recentBooks).toEqual([])
})
it('selects dated progress without replacing newer or same-local-day manual records', async () => {
 const f = await fixture()
 const cycle = await confirmPhotoReading(f.repositories, f.book.id, f.hash, { ...f.draft, progressPercent: '65' })
 const record = await new ReadingRecordService(f.repositories).create(f.book.id, { cycleId: cycle.id, startedAt: '2026-10-03T01:00:00Z', progress: { unit: 'percent', value: 40 } })
 expect(cycleProgress(cycle, [record])?.value).toBe(65)
 for (const startedAt of ['2026-10-03T23:00:00Z', '2026-10-05T01:00:00Z']) expect(cycleProgress(cycle, [{ ...record, startedAt }])?.value).toBe(40)
 expect(cycleProgress(cycle, [{ ...record, cycleId: 'other' }])?.value).toBe(65)
 expect(cycleProgress({ ...cycle, lastReadOn: null }, [record])?.value).toBe(40)
})
