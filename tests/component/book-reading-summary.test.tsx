// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { BookReadingSummary } from '../../src/features/reading-overview/ReadingDashboard'
import { bookReadingDays } from '../../src/features/reading-overview/book-reading-days'

afterEach(cleanup)

it('combines devices and manual entries by day, without counting completion evidence twice or changing originals', async () => {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories, () => 'unified').create({ title: '整合閱讀', mediaTypeId: 'ebook' })
  await new ReadingRecordService(repositories, () => 'manual').create(book.id, { startedAt: '2026-10-01T12:00:00Z', durationMinutes: 20, progress: { unit: 'percent', value: 70 } })
  for (const [deviceId, minutes] of [['phone', 10], ['reader', 15]] as const) {
    await repositories.sourceReadingDays.save({
      id: deviceId, source: 'moon', deviceId, sourcePath: '/book.epub', sourceTitle: '整合閱讀', backupName: 'backup',
      dayCode: 1, date: '2026-10-01', durationMs: minutes * 60000, readWords: 1000, progressPercent: 60, bookId: book.id, completionDisputed: false,
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', revision: 1, schemaVersion: 1,
      provenance: { kind: 'import', sourceId: 'moon-reader', externalId: deviceId, importedAt: '2026-10-01T00:00:00Z' },
    })
  }
  await new ReadingCycleService(repositories, () => 'completion').create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-10-01' }, reportedDurationMinutes: 999 })
  const before = await repositories.sourceReadingDays.getAll()
  const service = new ReadingOverviewService(repositories)
  const overview = await service.getOverview()
  expect(bookReadingDays(overview, book.id)).toEqual([{ date: '2026-10-01', minutes: 45, words: 2000, progress: { unit: 'percent', value: 70 }, completed: true }])
  expect(overview.byBook[book.id].totalMinutes).toBe(45)
  render(<BookReadingSummary bookId={book.id} revision={0} service={service} />)
  await screen.findByText('100%')
  expect(screen.getByText('閱讀明細').closest('details')!.textContent).toContain('70%')
  expect(screen.queryByText('來源每日紀錄')).toBeNull()
  expect(screen.queryByText('閱讀紀錄')).toBeNull()
  const details = screen.getByText('閱讀明細').closest('details')!
  expect(details.open).toBe(false)
  expect(within(details).getAllByRole('listitem', { hidden: true })).toHaveLength(1)
  expect(details.textContent).toContain('45 分鐘')
  expect(await repositories.sourceReadingDays.getAll()).toEqual(before)
})

it('does not display zero or stale data before load, and does not invent time for date-only completions', async () => {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories, () => 'date-only').create({ title: '只知完讀日期', mediaTypeId: 'ebook' })
  await new ReadingCycleService(repositories, () => 'dated').create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-10-02' } })
  const service = new ReadingOverviewService(repositories)
  const data = await service.getOverview()
  let resolve!: (value: typeof data) => void
  vi.spyOn(service, 'getOverview').mockImplementationOnce(() => new Promise(done => { resolve = done }))
  render(<BookReadingSummary bookId={book.id} revision={0} service={service} />)
  expect(screen.getByRole('status').textContent).toContain('載入')
  expect(screen.queryByText('0 分鐘')).toBeNull()
  await act(async () => resolve(data))
  expect(screen.getByText('2026-10-02', { selector: 'strong' })).toBeTruthy()
  expect(screen.getByText(/閱讀時間：未記錄/)).toBeTruthy()
  expect(await repositories.readingRecords.getAll()).toHaveLength(0)
})

