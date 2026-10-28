import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { cycleReportedMinutes } from '../../src/features/reading-overview/cycle-reported-minutes'
import { statisticsForPeriod } from '../../src/features/reading-overview/reading-statistics'

async function fixture() {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories).create({ title: '跨次閱讀', mediaTypeId: 'ebook' })
  const service = new ReadingCycleService(repositories)
  const first = await service.create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-10-02' }, reportedDurationMinutes: 100 })
  const second = await service.create(book.id, { status: 'reading', startedAt: '2026-10-02T00:00:00Z', reportedDurationMinutes: 200 })
  return { repositories, book, first, second, service, records: new ReadingRecordService(repositories), overview: new ReadingOverviewService(repositories, () => new Date('2026-10-05T00:00:00Z')) }
}
for (const minutes of [0, 20]) it('adds manual minutes without replacing either cycle total: ' + minutes, async () => {
  const f = await fixture()
  await f.records.create(f.book.id, { cycleId: f.second.id, startedAt: '2026-10-02T01:00:00Z', durationMinutes: minutes })
  const before = { cycles: await f.repositories.readingCycles.getAll(), records: await f.records.listForBook(f.book.id) }
  for (let query = 0; query < 2; query++) {
    const result = await f.overview.getOverview()
    expect(result.byBook[f.book.id].totalMinutes).toBe(300 + minutes)
    expect(result.recentBooks[0].totalMinutes).toBe(300 + minutes)
    expect(result.metrics.totalMinutes).toBe(minutes)
    expect(statisticsForPeriod(result.statistics!, '2026-10').minutes).toBe(minutes)
  }
  expect(await f.repositories.readingCycles.getAll()).toEqual(before.cycles)
  expect(await f.records.listForBook(f.book.id)).toEqual(before.records)
})
it('updates cycle membership without losing the other total and restores it on deletion', async () => {
  const f = await fixture()
  const record = await f.records.create(f.book.id, { cycleId: f.second.id, startedAt: '2026-10-02T01:00:00Z', endedAt: '2026-10-02T01:15:00Z' })
  expect((await f.overview.getOverview()).byBook[f.book.id].totalMinutes).toBe(315)
  await f.records.update(record.id, { cycleId: f.first.id, startedAt: record.startedAt, endedAt: record.endedAt }, record.revision)
  const moved = await f.overview.getOverview()
  expect(moved.byBook[f.book.id].totalMinutes).toBe(315)
  expect(moved.recentBooks[0].totalMinutes).toBe(315)
  await f.records.delete(record.id)
  const restored = await f.overview.getOverview()
  expect(restored.byBook[f.book.id].totalMinutes).toBe(300)
  expect(restored.recentBooks[0].totalMinutes).toBe(300)
})
it('does not treat progress-only evidence as duration in either cycle', async () => {
  const f = await fixture()
  for (const cycle of [f.first, f.second]) await f.records.create(f.book.id, { cycleId: cycle.id, startedAt: '2026-10-02T01:00:00Z', progress: { unit: 'percent', value: 70 } })
  const result = await f.overview.getOverview()
  expect(result.byBook[f.book.id].totalMinutes).toBe(300)
  expect(result.recentBooks[0].totalMinutes).toBe(300)
})
it('keeps unassigned, dangling and cross-book references conservative without changing other books', async () => {
  const f = await fixture()
  const other = await new BookService(f.repositories).create({ title: '另一本', mediaTypeId: 'ebook' })
  const otherCycle = await f.service.create(other.id, { status: 'reading', reportedDurationMinutes: 50 })
  const record = await f.records.create(f.book.id, { startedAt: '2026-10-02T01:00:00Z', durationMinutes: 20 })
  const cycles = await f.service.listForBook(f.book.id)
  for (const cycleId of [null, 'missing', otherCycle.id]) {
    const result = cycleReportedMinutes([...cycles, otherCycle], [{ ...record, cycleId, provenance: { kind: 'import', sourceId: 'fixture', externalId: record.id, importedAt: record.createdAt } }], [])
    expect(result.has(f.book.id)).toBe(false)
    expect(result.get(other.id)).toBe(50)
  }
  const overview = await f.overview.getOverview()
  expect(overview.byBook[f.book.id].totalMinutes).toBe(320)
  expect(overview.recentBooks[0].totalMinutes).toBe(320)
})
it('does not assign daily sources to a cycle just because dates overlap', async () => {
  const f = await fixture()
  const record = await f.records.create(f.book.id, { cycleId: f.second.id, startedAt: '2026-10-02T01:00:00Z', durationMinutes: 20 })
  const source = { ...record, source: 'moon' as const, deviceId: 'device', sourcePath: '/book', sourceTitle: '跨次閱讀', backupName: 'backup', dayCode: Math.floor(Date.parse('2026-10-02T00:00:00Z') / 86400000) - 1, date: '2026-10-02', durationMs: 60000, readWords: 0, progressPercent: 0, completionDisputed: false }
  expect(cycleReportedMinutes([f.first, f.second], [record], [source]).has(f.book.id)).toBe(false)
})

it('keeps imported and source-linked duration conservative while manual sessions remain additive', async () => {
  const f = await fixture()
  const manual = await f.records.create(f.book.id, { cycleId: f.second.id, startedAt: '2026-10-02T01:00:00Z', durationMinutes: 20 })
  const imported = { ...manual, id: 'imported-duration', durationMinutes: 15, provenance: { kind: 'import' as const, sourceId: 'fixture', externalId: 'session', importedAt: manual.createdAt } }
  await f.repositories.readingRecords.save(imported)
  const result = await f.overview.getOverview()
  expect(result.byBook[f.book.id].totalMinutes).toBe(135)
  expect(result.recentBooks[0].totalMinutes).toBe(135)
  expect(result.metrics.totalMinutes).toBe(35)
  for (const linked of [{ ...manual, sourceId: 'source' }, { ...manual, deviceId: 'device' }]) {
    expect(cycleReportedMinutes([f.first, f.second], [linked], []).get(f.book.id)).toBe(100)
  }
})
