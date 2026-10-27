// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { ReadingTimeline } from '../../src/features/reading-overview/ReadingTimeline'

it('preserves separate records and completions, unknown dates, ranges, minute offsets and rereads without inventing duration', async () => {
  const repos = createInMemoryRepositories()
  let id = 0
  const books = new BookService(repos, () => `book-${++id}`)
  const cycles = new ReadingCycleService(repos, () => `cycle-${++id}`)
  const records = new ReadingRecordService(repos, () => `record-${++id}`)
  const book = await books.create({ title: '歷史書', mediaTypeId: 'ebook' })
  await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2025-01-01' } })
  await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'minute', completedOn: '2025-01-02', localTime: '00:10', offsetMinutes: 480 } })
  await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'range', startedOn: '2025-01-03', completedOn: '2025-01-05' } })
  await cycles.create(book.id, { status: 'completed' })
  await cycles.create(book.id, { status: 'planned', startedAt: '2026-01-01T00:00:00.000Z' })
  await records.create(book.id, { startedAt: '2025-01-01T16:05:00.000Z' })
  await records.create(book.id, { startedAt: '2025-01-01T15:00:00.000Z', durationMinutes: 20 })
  const overview = await new ReadingOverviewService(repos).getOverview()
  const timeline = overview.timeline!
  expect(timeline.entries).toHaveLength(5)
  expect(timeline.undatedCompletions).toBe(1)
  expect(timeline.entries.map(entry => entry.date)).toEqual(['2025-01-05', '2025-01-01T16:10:00.000Z', '2025-01-01T16:05:00.000Z', '2025-01-01T15:00:00.000Z', '2025-01-01'])
  expect(overview.activities).toHaveLength(2)
  expect(overview.byBook[book.id].totalMinutes).toBe(20)
  const open = vi.fn()
  render(<ReadingTimeline data={timeline} onOpenBook={open} />)
  const region = within(screen.getByRole('region', { name: '閱讀紀錄時間軸' }))
  expect(region.getByText('另有 1 筆完讀日期未確定，未排入時間軸。')).toBeTruthy()
  expect(region.getByText('完讀區間：2025-01-03－2025-01-05（依區間末日排列）')).toBeTruthy()
  expect(region.getByText('完讀日已知，時間未記錄')).toBeTruthy()
  expect(region.getByText('閱讀時間未記錄')).toBeTruthy()
  expect(region.getByText('完讀時間 00:10')).toBeTruthy()
  fireEvent.click(region.getAllByRole('button')[0])
  expect(open).toHaveBeenCalledWith(book)
})

it('loads older entries in batches without hiding later entries on the same day', async () => {
  const repos = createInMemoryRepositories()
  const book = await new BookService(repos, () => 'book').create({ title: '同日閱讀', mediaTypeId: 'ebook' })
  let id = 0
  const records = new ReadingRecordService(repos, () => `record-${++id}`)
  for (let minute = 0; minute < 25; minute++) await records.create(book.id, { startedAt: `2025-01-01T01:${String(minute).padStart(2, '0')}:00.000Z`, durationMinutes: 0 })
  const overview = await new ReadingOverviewService(repos).getOverview()
  render(<ReadingTimeline data={overview.timeline!} onOpenBook={vi.fn()} />)
  const region = within(screen.getByRole('region', { name: '閱讀紀錄時間軸' }))
  expect(region.getAllByRole('listitem')).toHaveLength(20)
  fireEvent.click(region.getByRole('button', { name: '載入較早的紀錄' }))
  expect(region.getAllByRole('listitem')).toHaveLength(25)
  expect(region.queryByRole('button', { name: '載入較早的紀錄' })).toBeNull()
})
