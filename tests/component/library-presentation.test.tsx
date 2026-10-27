// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { LibraryCatalog } from '../../src/features/library/LibraryCatalog'

it('keeps results, page and author identity when changing modes or collapsing filters without writing data', async () => {
 const repositories = createInMemoryRepositories(), service = new BookService(repositories), books = []
 for (let i = 1; i <= 35; i++) books.push(await service.create({ title: `模式書目 ${i}`, authorNames: ['作者甲', '作者乙'], mediaTypeId: 'ebook' }))
 const dictionaries = await repositories.dictionaries.getAll(), before = await repositories.books.getAll(), onOpen = vi.fn()
 render(<LibraryCatalog books={books} dictionaries={dictionaries} onOpen={onOpen} />)
 const trigger = screen.getByRole('button', { name: '書庫篩選' })
 expect(trigger.getAttribute('aria-expanded')).toBe('false')
 expect(screen.queryByRole('status', { name: '書庫符合筆數' })).toBeNull()
 expect(screen.queryByRole('button', { name: '清單模式' })).toBeNull()
 fireEvent.click(screen.getAllByRole('button', { name: '下一頁' })[0])
 expect(document.querySelectorAll('.book-row')).toHaveLength(5)
 fireEvent.click(trigger)
 expect(screen.getByRole('status', { name: '書庫符合筆數' }).textContent).toBe('35／35 本')
 fireEvent.click(screen.getByRole('button', { name: '清單模式' }))
 expect(document.querySelectorAll('.book-cover, .book-progress')).toHaveLength(0)
 expect(document.querySelectorAll('.library-list-entry')).toHaveLength(5)
 expect(document.querySelector('.library-list-authors')?.textContent).toBe('作者甲、作者乙')
 fireEvent.click(trigger)
 expect(screen.queryByRole('status', { name: '書庫符合筆數' })).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: '開啟《模式書目 31》' }))
 expect(onOpen).toHaveBeenCalledWith(books[30])
 fireEvent.click(trigger)
 expect(screen.getByRole('button', { name: '清單模式' }).getAttribute('aria-pressed')).toBe('true')
 fireEvent.change(screen.getByRole('searchbox'), { target: { value: '模式書目 1' } })
 expect(document.querySelectorAll('.book-row')).toHaveLength(11)
 expect(screen.getByRole('status', { name: '書庫符合筆數' }).textContent).toBe('11／35 本')
 fireEvent.click(screen.getByRole('button', { name: '封面模式' }))
 expect(document.querySelectorAll('.book-cover')).toHaveLength(11)
 expect(screen.queryAllByLabelText('選擇書庫頁碼')).toHaveLength(0)
 expect(await repositories.books.getAll()).toEqual(before)
 expect(await repositories.readingRecords.getAll()).toHaveLength(0)
 expect(await repositories.readingCycles.getAll()).toHaveLength(0)
})

it('closes the panel with Escape, restores focus and retains selected filters', async () => {
 const service = new BookService(createInMemoryRepositories())
 const book = await service.create({ title: '保留條件', mediaTypeId: 'ebook' })
 render(<LibraryCatalog books={[book]} dictionaries={[]} onOpen={vi.fn()} />)
 const trigger = screen.getByRole('button', { name: '書庫篩選' })
 fireEvent.click(trigger)
 const panel = screen.getByRole('group', { name: '書庫篩選選項' })
 fireEvent.change(within(panel).getByLabelText('依資料完整度篩選'), { target: { value: '封面' } })
 fireEvent.keyDown(within(panel).getByLabelText('依資料完整度篩選'), { key: 'Escape' })
 expect(document.activeElement).toBe(trigger)
 expect(trigger.getAttribute('aria-expanded')).toBe('false')
 expect(screen.queryByRole('group', { name: '書庫篩選選項' })).toBeNull()
 fireEvent.click(trigger)
 expect(screen.getByLabelText('依資料完整度篩選')).toHaveProperty('value', '封面')
 expect(screen.getByRole('status', { name: '書庫符合筆數' }).textContent).toBe('1／1 本')
})
