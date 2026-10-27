// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { BookForm } from '../../src/features/books/BookForm'
afterEach(cleanup)
it('does not ask for language or display alias and allows missing optional metadata', async () => {
 const save = vi.fn()
 render(<BookForm onCancel={vi.fn()} onSubmit={save} />)
 expect(screen.queryByRole('combobox', { name: '書籍內容語言' })).toBeNull()
 expect(screen.queryByLabelText('我的顯示名稱（選填）')).toBeNull()
 expect(screen.getByLabelText('出版書名')).toHaveProperty('required', true)
 fireEvent.change(screen.getByLabelText('出版書名'), { target: { value: '原始書名' } })
 fireEvent.click(screen.getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '原始書名', languageTag: 'und', mediaTypeId: 'ebook' })))
})
it('preserves hidden language and display alias while editing another field', async () => {
 const book = await new BookService(createInMemoryRepositories()).create({ title: '來源書名', preferredTitle: '既有顯示名稱', languageTag: 'EN-us', mediaTypeId: 'ebook' })
 const save = vi.fn()
 render(<BookForm book={book} onCancel={vi.fn()} onSubmit={save} />)
 expect(screen.queryByRole('combobox', { name: '書籍內容語言' })).toBeNull()
 fireEvent.change(screen.getByLabelText('出版社'), { target: { value: '出版社' } })
 fireEvent.click(screen.getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '來源書名', preferredTitle: '既有顯示名稱', languageTag: 'EN-us', publisherName: '出版社' })))
})
