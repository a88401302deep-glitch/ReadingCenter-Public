import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { createMetadata } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { confirmPhotoReading } from '../../src/import/photo-reading'
import { statisticsForPeriod } from '../../src/features/reading-overview/reading-statistics'

async function fixture() {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories).create({ title: '累計與進度', mediaTypeId: 'ebook' })
  const hash = 'c'.repeat(64)
  const draft = { completedOn: '2026-10-02', totalMinutes: '262', allowReread: false }
  await confirmPhotoReading(repositories, book.id, hash, draft)
  return { repositories, book, hash, draft, records: new ReadingRecordService(repositories), overview: new ReadingOverviewService(repositories, () => new Date('2026-10-05T00:00:00Z')) }
}
it('preserves cumulative time with progress-only records and repeated screenshot confirmation without dating that time', async () => {
  const f = await fixture()
  await f.records.create(f.book.id, { startedAt: '2026-10-03T01:00:00Z', progress: { unit: 'percent', value: 60 } })
  await confirmPhotoReading(f.repositories, f.book.id, f.hash, f.draft)
  const before = { cycles: await f.repositories.readingCycles.getAll(), records: await f.records.listForBook(f.book.id) }
  for (let query = 0; query < 2; query++) {
    const result = await f.overview.getOverview()
    expect(result.byBook[f.book.id]).toMatchObject({ totalMinutes: 262, recordCount: 1 })
    expect(result.recentBooks[0]).toMatchObject({ totalMinutes: 262, hasRecordedDuration: true })
    expect(result.metrics.totalMinutes).toBe(0)
    expect(statisticsForPeriod(result.statistics!, '2026-10').minutes).toBe(0)
    expect(result.timeline!.entries.filter(entry => entry.kind === 'record')).toHaveLength(1)
  }
  expect(await f.repositories.readingCycles.getAll()).toEqual(before.cycles)
  expect(await f.records.listForBook(f.book.id)).toEqual(before.records)
})
for (const durationMinutes of [0, 20]) it('adds explicit manual minutes while retaining cumulative time: ' + durationMinutes, async () => {
  const f = await fixture()
  const record = await f.records.create(f.book.id, { startedAt: '2026-10-03T01:00:00Z', progress: { unit: 'percent', value: 60 } })
  await f.records.update(record.id, { startedAt: record.startedAt, durationMinutes }, record.revision)
  await confirmPhotoReading(f.repositories, f.book.id, f.hash, f.draft)
  expect(await f.repositories.readingCycles.getAll()).toHaveLength(1)
  const result = await f.overview.getOverview()
  expect(result.byBook[f.book.id].totalMinutes).toBe(262 + durationMinutes)
  expect(result.recentBooks[0].totalMinutes).toBe(262 + durationMinutes)
  expect(result.metrics.totalMinutes).toBe(durationMinutes)
  await f.records.delete(record.id)
  expect((await f.overview.getOverview()).byBook[f.book.id].totalMinutes).toBe(262)
})
it('adds a manual start/end session when minutes are null', async () => {
  const f = await fixture()
  await f.records.create(f.book.id, { startedAt: '2026-10-03T01:00:00Z', endedAt: '2026-10-03T01:15:00Z' })
  const result = await f.overview.getOverview()
  expect(result.byBook[f.book.id].totalMinutes).toBe(277)
  expect(result.recentBooks[0].totalMinutes).toBe(277)
  expect(result.metrics.totalMinutes).toBe(15)
})
it('keeps actual source daily duration ahead of cumulative time and queries without rewriting sources', async () => {
  const f = await fixture()
  await f.records.create(f.book.id, { startedAt: '2026-10-03T01:00:00Z', progress: { unit: 'percent', value: 60 } })
  const source = { ...createMetadata({ id: 'duration-day', now: '2026-10-03T02:00:00Z' }), source: 'moon' as const, deviceId: 'device', sourcePath: '/book', sourceTitle: f.book.title, backupName: 'backup', dayCode: Math.floor(Date.parse('2026-10-03T00:00:00Z') / 86400000) - 1, date: '2026-10-03', durationMs: 20 * 60000, readWords: 100, progressPercent: 60, bookId: f.book.id, completionDisputed: false }
  await f.repositories.sourceReadingDays.save(source)
  for (let query = 0; query < 2; query++) {
    const result = await f.overview.getOverview()
    expect(result.byBook[f.book.id].totalMinutes).toBe(20)
    expect(result.recentBooks[0].totalMinutes).toBe(20)
    expect(result.metrics.totalMinutes).toBe(20)
    expect(statisticsForPeriod(result.statistics!, '2026-10').minutes).toBe(20)
  }
  expect(await f.repositories.sourceReadingDays.getAll()).toEqual([source])
})
