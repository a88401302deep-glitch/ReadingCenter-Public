// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { defaultMonthColors } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { ReadingStatistics } from '../../src/features/reading-overview/ReadingStatistics'
import { ReadingYearHeatmap } from '../../src/features/reading-overview/ReadingYearHeatmap'
afterEach(cleanup)
it('opens shared unique book details from an annual date and retains source ranges without invented time', async () => {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories, () => 'book').create({ title: '熱力圖書目', mediaTypeId: 'ebook' })
  await new ReadingRecordService(repositories, () => 'record').create(book.id, { startedAt: '2024-02-29T10:00:00Z', durationMinutes: 120 })
  await new ReadingCycleService(repositories, () => 'cycle').create(book.id, { status: 'completed', completionDate: { precision: 'range', startedOn: '2024-03-01', completedOn: '2024-03-03' } })
  const data = (await new ReadingOverviewService(repositories, () => new Date('2024-02-01T00:00:00Z')).getOverview()).statistics!
  render(<ReadingStatistics data={data} onOpenBook={vi.fn()} />)
  const annual = screen.getByRole('region', { name: '2024 年閱讀熱力圖' })
  const grid = within(annual).getByRole('group', { name: '2024 年全年日期格' })
  expect(within(grid).getAllByRole('button')).toHaveLength(366)
  fireEvent.click(within(grid).getByRole('button', { name: '2024-02-29，完讀 0 本，有閱讀紀錄' }))
  expect(within(screen.getByRole('region', { name: '所選日期書目' })).getAllByRole('listitem')).toHaveLength(1)
  fireEvent.click(within(grid).getByRole('button', { name: '2024-03-03，完讀 1 本' }))
  expect((screen.getByLabelText('統計月份') as HTMLInputElement).value).toBe('2024-03')
  expect(within(screen.getByRole('region', { name: '所選日期書目' })).getByText('完讀區間：2024-03-01～2024-03-03')).not.toBeNull()
  expect(within(grid).getByRole('button', { name: '2024-03-01，完讀 0 本' })).not.toBeNull()
})
it('supports keyboard movement and a single annual grid on all viewports', () => {
  render(<ReadingYearHeatmap data={{ currentMonth: '2024-01', days: [], undatedCompletions: 0, categoryNames: {} }} year={2024} month="2024-01" colors={defaultMonthColors} selectedDate={null} onSelectDate={vi.fn()} onSelectMonth={vi.fn()} />)
  const grid = screen.getByRole('group', { name: '2024 年全年日期格' })
  const first = within(grid).getByRole('button', { name: '2024-01-01，完讀 0 本' })
  first.focus()
  fireEvent.keyDown(first, { key: 'ArrowRight' })
  expect(document.activeElement?.getAttribute('data-date')).toBe('2024-01-08')
  expect(within(grid).getAllByRole('button')).toHaveLength(366)
  expect(screen.getByLabelText('熱力圖日期')).not.toBeNull()
})
