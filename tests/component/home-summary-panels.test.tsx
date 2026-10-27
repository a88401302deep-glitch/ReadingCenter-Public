// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingDashboard } from '../../src/features/reading-overview/ReadingDashboard'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'

it('shows six cover-only completions with a tap-to-close viewer and keeps note access', async () => {
  const repos = createInMemoryRepositories()
  let id = 0
  const books = new BookService(repos, () => `book-${++id}`)
  const cycles = new ReadingCycleService(repos, () => `cycle-${++id}`)
  const contents = new ReadingContentService(repos, () => `content-${++id}`)
  for (let day = 1; day <= 12; day++) {
    const book = await books.create({ title: `完讀 ${day}`, mediaTypeId: 'ebook', rating: { value: 4, scale: 5 } })
    await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: `2025-01-${String(day).padStart(2, '0')}` } })
    await contents.create(book.id, { type: 'shortReview', text: `心得 ${day}`, recordedForAt: `2025-01-${String(day).padStart(2, '0')}T10:00:00Z` })
  }
  const open = vi.fn()
  render(<ReadingDashboard service={new ReadingOverviewService(repos)} revision={0} onOpenBook={open} />)
  const completed = within(await screen.findByRole('region', { name: '最近讀完' }))
  expect(screen.queryByRole('region', { name: '近期高分' })).toBeNull()
  expect(completed.getAllByRole('listitem')).toHaveLength(6)
  expect(within(screen.getByRole('region', { name: '閱讀心得' })).getAllByRole('listitem')).toHaveLength(6)
  expect(completed.queryByRole('button', { name: /展開/ })).toBeNull()
  expect(completed.queryByText('完讀 12', { selector: 'strong' })).toBeNull()
  expect(document.querySelector('.finished-cards time')).toBeNull()
  fireEvent.click(completed.getByRole('button', { name: '放大《完讀 12》封面' }))
  expect(screen.getByRole('dialog', { name: '《完讀 12》封面預覽' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '關閉封面預覽' }))
  expect(open).not.toHaveBeenCalled()
  const notes = within(screen.getByRole('region', { name: '閱讀心得' }))
  fireEvent.click(notes.getByText('完讀 12', { selector: 'strong' }).closest('button')!)
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ title: '完讀 12' }))
})
