// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LibraryCatalog } from '../../src/features/library/LibraryCatalog'
import { BookService } from '../../src/features/books/book-service'
import { createInMemoryRepositories } from '../../src/data'
import type { ReadingCycle } from '../../src/domain'

it('shows every book by default and independently filters status and missing data', async () => {
  const service = new BookService(createInMemoryRepositories(), () => crypto.randomUUID())
  const waiting = await service.create({ title: '待讀測試', mediaTypeId: 'ebook', bookForm: 'novel' })
  const unknown = await service.create({ title: '狀態不明', mediaTypeId: 'ebook' })
  const cycle = { bookId: waiting.id, status: 'planned', sequence: 1, startedAt: null, finishedAt: null } as ReadingCycle
  const onOpen = vi.fn()
  render(<LibraryCatalog books={[waiting, unknown]} dictionaries={[]} cycles={[cycle]} onOpen={onOpen} />)
  expect(screen.getByRole('heading', { name: '待讀測試' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '狀態不明' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '清單模式' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '書庫篩選' }))
  fireEvent.change(screen.getByLabelText('依閱讀狀態篩選'), { target: { value: 'planned' } })
  expect(screen.queryByRole('heading', { name: '狀態不明' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '開啟《待讀測試》' }))
  expect(onOpen).toHaveBeenCalledWith(waiting)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在' } })
  expect(screen.queryByRole('heading', { name: '待讀測試' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '清除條件' }))
  fireEvent.change(screen.getByLabelText('依資料完整度篩選'), { target: { value: '類型' } })
  expect(screen.getByRole('heading', { name: '狀態不明' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '待讀測試' })).toBeNull()
  fireEvent.change(screen.getByLabelText('依資料完整度篩選'), { target: { value: 'complete' } })
  expect(screen.getByText('沒有符合條件的書籍')).toBeTruthy()
})
