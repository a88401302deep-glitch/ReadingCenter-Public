// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { BookForm } from '../../src/features/books/BookForm'

describe('BookForm rating', () => {
  it('submits an explicit rating scale and treats the blank option as unrated', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<BookForm onCancel={() => {}} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('出版書名'), { target: { value: '書名' } })
    fireEvent.change(screen.getByLabelText('評分刻度'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('評分', { exact: true }), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ rating: { value: 8, scale: 10 } }))
    await waitFor(() => expect(screen.getByRole('button', { name: '儲存' })).toHaveProperty('disabled', false))
    fireEvent.change(screen.getByLabelText('評分', { exact: true }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ rating: null }))
  })
  it('keeps import history out of the editor and preserves it while saving a book note', async () => {
    const service = new BookService(createInMemoryRepositories(), () => 'legacy-book', () => '2026-10-02T00:00:00.000Z')
    const original = 'Notion 歷史搬遷｜原始資料保留\n【來源第 2 列】\n書名：來源書名'
    const book = await service.create({ title: '來源書名', mediaTypeId: 'ebook', bookNote: original })
    book.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: 'snapshot:2', importedAt: book.createdAt }
    const onSubmit = vi.fn(async () => {})
    const onDirtyChange = vi.fn()
    const { container } = render(<BookForm book={book} onCancel={() => {}} onSubmit={onSubmit} onDirtyChange={onDirtyChange} />)
    expect((screen.getByLabelText('書籍備註') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByText('匯入來源資料')).toBeNull()
    expect(container.querySelector('pre')).toBeNull()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    fireEvent.change(screen.getByLabelText('書籍備註'), { target: { value: '自己的備註' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ bookNote: '自己的備註' }))
    expect(book.bookNote).toBe(original)
  })

})

it('submits book text count and leaves unknown values empty rather than zero', async () => {
  const onSubmit = vi.fn(async () => {})
  const onDirtyChange = vi.fn()
  render(<BookForm onCancel={() => {}} onSubmit={onSubmit} onDirtyChange={onDirtyChange} />)
  fireEvent.change(screen.getByLabelText('出版書名'), { target: { value: '字數測試' } })
  fireEvent.change(screen.getByLabelText('書籍字數'), { target: { value: '120000' } })
  fireEvent.click(screen.getByRole('button', { name: '儲存' }))
  expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ wordCount: 120000 }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await waitFor(() => expect(screen.getByRole('button', { name: '儲存' })).toHaveProperty('disabled', false))
  fireEvent.change(screen.getByLabelText('書籍字數'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '儲存' }))
  expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ wordCount: null }))
})
