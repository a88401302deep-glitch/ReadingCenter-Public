// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { ReadingStatistics } from '../../src/features/reading-overview/ReadingStatistics'
afterEach(cleanup)
it('navigates months, renders leap days, shows source ranges and opens unique daily books', async () => {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories, () => 'book').create({ title: '月曆測試', mediaTypeId: 'ebook' })
  let id = 0
  const cycles = new ReadingCycleService(repositories, () => `cycle-${++id}`)
  await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'range', startedOn: '2024-02-20', completedOn: '2024-02-29' } })
  await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2024-02-29' } })
  const data = (await new ReadingOverviewService(repositories, () => new Date('2024-02-15T00:00:00Z')).getOverview()).statistics!
  const open = vi.fn()
  render(<ReadingStatistics data={data} onOpenBook={open} />)
  const calendar = screen.getByLabelText('2024-02 閱讀月曆')
  expect(within(calendar).getAllByRole('button')).toHaveLength(29)
  fireEvent.click(within(calendar).getByRole('button', { name: '2024-02-29，完讀 1 本' }))
  const selected = screen.getByRole('region', { name: '所選日期書目' })
  expect(within(selected).getAllByRole('listitem')).toHaveLength(1)
  expect(within(selected).getByText('完讀區間：2024-02-20～2024-02-29')).not.toBeNull()
  fireEvent.click(within(selected).getByRole('button'))
  expect(open).toHaveBeenCalledWith(book)
  fireEvent.click(screen.getByRole('button', { name: '下個月' }))
  expect(within(screen.getByLabelText('2024-03 閱讀月曆')).getAllByRole('button')).toHaveLength(31)
  expect(screen.queryByRole('region', { name: '所選日期書目' })).toBeNull()
  expect(screen.getByRole('group', { name: '2024 年每月完讀本數' })).not.toBeNull()
  expect(screen.getByRole('button', { name: '2024-02，完讀 1 本' })).not.toBeNull()
})
