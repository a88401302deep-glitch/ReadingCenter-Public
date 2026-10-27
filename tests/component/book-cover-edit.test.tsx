// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { BookForm } from '../../src/features/books/BookForm'
import { uploadBookCover } from '../../src/features/books/book-cover-upload'
vi.mock('../../src/features/books/book-cover-upload', async importOriginal => ({ ...await importOriginal<typeof import('../../src/features/books/book-cover-upload')>(), uploadBookCover: vi.fn() }))
beforeEach(() => { URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn(); vi.mocked(uploadBookCover).mockReset() })
afterEach(() => vi.restoreAllMocks())
async function fixture() { const book = await new BookService(createInMemoryRepositories()).create({ title: '測試書', mediaTypeId: 'ebook', cover: { path: '/old.webp', mimeType: 'image/webp' } }); return book }
it('previews a pasted cover and uploads only when the book is saved', async () => {
 const book = await fixture(), save = vi.fn()
 vi.mocked(uploadBookCover).mockResolvedValue({ path: '/pasted.jpg', mimeType: 'image/jpeg' })
 render(<BookForm book={book} onSubmit={save} onCancel={vi.fn()} />)
 fireEvent.paste(screen.getByLabelText('圖片貼上區'), { clipboardData: { files: [new File(['image'], 'test.png', { type: 'image/png' })] } })
 expect(screen.getByAltText('封面預覽').getAttribute('src')).toBe('blob:preview')
 expect(uploadBookCover).not.toHaveBeenCalled()
 expect(save).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ cover: expect.objectContaining({ path: '/pasted.jpg' }) })))
})
it('previews locally and uploads only when saved, preserving the returned MIME and avoiding another upload on retry', async () => {
 const book = await fixture(), save = vi.fn()
 const cover = { path: '/api/v1/covers/covers/new.jpg', mimeType: 'image/jpeg' as const, width: 700, height: 1000 }
 vi.mocked(uploadBookCover).mockResolvedValue(cover)
 render(<BookForm book={book} onSubmit={save} onCancel={vi.fn()} />)
 fireEvent.change(screen.getByLabelText('選擇封面'), { target: { files: [new File(['image'], '中文封面.png', { type: 'image/png' })] } })
 expect(screen.getByAltText('封面預覽').getAttribute('src')).toBe('blob:preview')
 expect(uploadBookCover).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ cover })))
 fireEvent.click(screen.getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
 expect(uploadBookCover).toHaveBeenCalledTimes(1)
})
it('keeps the existing cover and avoids saving on upload failure, then allows a successful retry', async () => {
 const book = await fixture(), save = vi.fn()
 vi.mocked(uploadBookCover).mockRejectedValueOnce(new Error('上傳失敗')).mockResolvedValueOnce({ path: '/new.jpg', mimeType: 'image/jpeg' })
 render(<BookForm book={book} onSubmit={save} onCancel={vi.fn()} />)
 fireEvent.change(screen.getByLabelText('選擇封面'), { target: { files: [new File(['image'], 'test.png', { type: 'image/png' })] } })
 fireEvent.click(screen.getByRole('button', { name: '儲存' }))
 await screen.findByText('上傳失敗'); expect(save).not.toHaveBeenCalled(); expect(screen.getByLabelText('封面檔案路徑')).toHaveProperty('value', '/old.webp')
 fireEvent.click(screen.getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
})
it('preserves existing non-JPEG metadata and allows removal without uploading', async () => {
 const book = await fixture(), save = vi.fn()
 render(<BookForm book={book} onSubmit={save} onCancel={vi.fn()} />)
 fireEvent.click(screen.getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ cover: book.cover })))
 fireEvent.click(screen.getByRole('button', { name: '移除封面' })); fireEvent.click(screen.getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ cover: null })))
 expect(uploadBookCover).not.toHaveBeenCalled()
})
