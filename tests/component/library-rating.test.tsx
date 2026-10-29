// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { LibraryRating } from '../../src/features/library/LibraryRating'

it('shows five dark stars for an unrated book and fractional existing ten-point scores', async () => {
  const book = await new BookService(createInMemoryRepositories()).create({ title: '星星測試', mediaTypeId: 'ebook' })
  const { container, rerender } = render(<LibraryRating book={book} onRate={vi.fn()} />)
  expect(screen.getAllByRole('button')).toHaveLength(5)
  expect(screen.getByRole('group').getAttribute('aria-label')).toContain('尚未評分')
  expect([...container.querySelectorAll<HTMLElement>('.rating-star-fill')].map(el => el.style.width)).toEqual(['0%', '0%', '0%', '0%', '0%'])
  rerender(<LibraryRating book={{ ...book, rating: { value: 7, scale: 10 } }} onRate={vi.fn()} />)
  expect(screen.getByRole('group').getAttribute('aria-label')).toContain('3.5 星')
  expect([...container.querySelectorAll<HTMLElement>('.rating-star-fill')].map(el => el.style.width)).toEqual(['100%', '100%', '100%', '50%', '0%'])
})

it('prevents duplicate saves, reports failure and permits retry without pretending it saved', async () => {
  const book = await new BookService(createInMemoryRepositories()).create({ title: '評分重試', mediaTypeId: 'ebook' })
  let reject!: (reason: Error) => void
  const onRate = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail })).mockResolvedValue(undefined)
  render(<LibraryRating book={book} onRate={onRate} />)
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
