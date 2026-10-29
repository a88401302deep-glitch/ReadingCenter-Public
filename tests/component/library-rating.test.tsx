// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { LibraryRating } from '../../src/features/library/LibraryRating'

it('shows a single pending star, then a numeric half-star score and restores focus on dismissal', async () => {
  const book = await new BookService(createInMemoryRepositories()).create({ title: '星星測試', mediaTypeId: 'ebook' })
  const { container, rerender } = render(<LibraryRating book={book} onRate={vi.fn()} />)
  const trigger = screen.getByRole('button', { name: '《星星測試》待評分' })
  expect(container.querySelectorAll('svg')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '評為 3.5 星' })).toBeNull()
  trigger.focus(); fireEvent.click(trigger)
  expect(screen.getByRole('group', { name: '選擇評分' }).querySelectorAll('button')).toHaveLength(10)
  fireEvent.click(screen.getByRole('button', { name: '關閉' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  rerender(<LibraryRating book={{ ...book, rating: { value: 7, scale: 10 } }} onRate={vi.fn()} />)
  expect(screen.getByRole('button', { name: '《星星測試》3.5 星，修改評分' }).textContent).toBe('3.5')
  expect(container.querySelectorAll('svg')).toHaveLength(1)
})

it('prevents duplicate saves, reports failure and permits retry without pretending it saved', async () => {
  const book = await new BookService(createInMemoryRepositories()).create({ title: '評分重試', mediaTypeId: 'ebook' })
  let reject!: (reason: Error) => void
  const onRate = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail })).mockResolvedValue(undefined)
  render(<LibraryRating book={book} onRate={onRate} />)
  fireEvent.click(screen.getByRole('button', { name: '《評分重試》待評分' }))
  const four = screen.getByRole('button', { name: '評為 4 星' })
  fireEvent.click(four); fireEvent.click(four)
  expect(onRate).toHaveBeenCalledTimes(1)
  expect(onRate).toHaveBeenCalledWith(book, 4)
  reject(new Error('版本衝突'))
  await screen.findByRole('alert')
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.click(four)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已儲存 4 星'))
  expect(onRate).toHaveBeenCalledTimes(2)
})
