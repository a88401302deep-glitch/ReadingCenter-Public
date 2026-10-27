// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { LibraryCatalog } from '../../src/features/library/LibraryCatalog'
it('pages the filtered results and resets the page when searching or changing filters', async () => {
 const service = new BookService(createInMemoryRepositories()), books = []
 for(let i=1;i<=65;i++)books.push(await service.create({title:`分頁書目 ${i}`,mediaTypeId:'ebook'}))
 render(<LibraryCatalog books={books} dictionaries={[]} onOpen={vi.fn()} />)
 expect(document.querySelectorAll('.book-row')).toHaveLength(30)
 fireEvent.click(screen.getAllByRole('button',{name:'下一頁'})[0])
 expect(screen.getByRole('heading',{name:'分頁書目 31'})).toBeTruthy()
 fireEvent.click(screen.getAllByRole('button',{name:'下一頁'})[0])
 expect(document.querySelectorAll('.book-row')).toHaveLength(5)
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'分頁書目 1'}})
 expect(document.querySelectorAll('.book-row')).toHaveLength(11)
 fireEvent.click(screen.getByRole('button',{name:'書庫篩選'}))
 fireEvent.change(screen.getByLabelText('依資料完整度篩選'),{target:{value:'complete'}})
 expect(document.querySelectorAll('.book-row')).toHaveLength(0)
})
