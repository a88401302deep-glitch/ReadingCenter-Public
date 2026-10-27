// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BookForm } from '../../src/features/books/BookForm'
import { createInMemoryRepositories } from '../../src/data/in-memory-repositories'
import { BookService } from '../../src/features/books/book-service'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('organizes pasted facts locally, fills blanks only and does not save books, history or covers before submission', async () => {
 const fetcher = vi.fn(), submit = vi.fn()
 vi.stubGlobal('fetch', fetcher)
 const repo = createInMemoryRepositories(), book = await new BookService(repo).create({ title: '既有書名', mediaTypeId: 'ebook', authorNames: ['既有人工作者'], wordCount: 123 })
 render(<BookForm book={book} dictionaries={await repo.dictionaries.getAll()} onCancel={vi.fn()} onSubmit={submit} />)
 fireEvent.click(screen.getByText('搜尋並補全書籍資料'))
 fireEvent.change(screen.getByLabelText('書目來源'), { target: { value: 'readmoo-text' } })
 fireEvent.change(screen.getByLabelText('讀墨書頁網址'), { target: { value: 'https://readmoo.com/book/210304417000101' } })
 fireEvent.change(screen.getByLabelText('讀墨書籍資料文字'), { target: { value: '作者：候選作者\n譯者：譯者甲\n插畫：繪者乙\n出版社：候選出版社\n字數：66,554\neISBN: 9786267367063' } })
 fireEvent.click(screen.getByRole('button', { name: '整理成候選資料' }))
 expect(fetcher).not.toHaveBeenCalled()
 expect(submit).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: '帶入下列表單' }))
 expect(screen.getByLabelText('作者（每行一位）')).toHaveProperty('value', '既有人工作者')
 expect(screen.getByLabelText('譯者（每行一位）')).toHaveProperty('value', '譯者甲')
 expect(screen.getByLabelText('繪者／插畫者（每行一位）')).toHaveProperty('value', '繪者乙')
 expect(screen.getByLabelText('ISBN', { exact: true })).toHaveProperty('value', '')
 expect(screen.getByLabelText('書籍字數')).toHaveProperty('value', '123')
 expect((await repo.books.getAll())[0]).toEqual(book)
 expect(fetcher).not.toHaveBeenCalled()
 expect(submit).not.toHaveBeenCalled()
 fireEvent.click(screen.getByLabelText('已核對版本，允許候選取代目前欄位'))
 fireEvent.click(screen.getByRole('button', { name: '帶入下列表單' }))
 expect(screen.getByLabelText('作者（每行一位）')).toHaveProperty('value', '候選作者')
 expect(screen.getByLabelText('書籍字數')).toHaveProperty('value', '66554')
 expect(screen.getByRole('link', { name: '核對字數來源' }).getAttribute('href')).toBe('https://readmoo.com/book/210304417000101')
 expect(submit).not.toHaveBeenCalled()
})
