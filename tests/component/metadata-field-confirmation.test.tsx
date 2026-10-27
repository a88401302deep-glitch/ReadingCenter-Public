// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BookForm } from '../../src/features/books/BookForm'
import { BookMetadataSearch } from '../../src/features/books/BookMetadataSearch'
import { BookService } from '../../src/features/books/book-service'
import { createInMemoryRepositories } from '../../src/data/in-memory-repositories'
import type { BookMetadataCandidate } from '../../src/domain/book-metadata'

afterEach(() => { vi.unstubAllGlobals() })
const candidate: BookMetadataCandidate = { id: 'ol:OL1M', source: 'Open Library', title: '候選書名', authors: ['候選作者'], publisher: '候選出版社', isbn: '9781234567890', publishedOn: '2026', sourceUrl: 'https://openlibrary.org/books/OL1M', coverUrl: null, originalTitle: 'Candidate Original', authorOriginalNames: ['Original Author'], translators: ['候選譯者'], illustrators: ['候選繪者'], wordCount: 200, seriesName: '候選系列', sequenceLabel: '第 2 集' }
function mockSearch(row = candidate) { const fetcher = vi.fn(async () => Response.json({ data: [row] })); vi.stubGlobal('fetch', fetcher); return fetcher }
async function search() { fireEvent.click(screen.getByText('搜尋並補全書籍資料')); fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' })); fireEvent.click(await screen.findByRole('button', { name: '核對《候選書名》' })); fireEvent.click(screen.getByText('調整帶入欄位或取代既有資料')); return screen.getByRole('button', { name: '帶入下列表單' }) }

it('applies only checked fields, preserves manual values, and requires explicit series selection without writing a draft', async () => {
 mockSearch()
 const repo = createInMemoryRepositories(), service = new BookService(repo)
 const book = await service.create({ title: '人工書名', authorNames: ['人工作者'], publisherName: '人工出版社', originalTitle: 'Manual Original', translatorNames: ['人工譯者'], illustratorNames: ['人工繪者'], wordCount: 100, mediaTypeId: 'ebook', newSeriesName: '人工系列', sequence: { kind: 'volume', label: '第 1 集', sortValue: 1 } })
 const submit = vi.fn(async () => undefined)
 render(<BookForm book={book} dictionaries={await repo.dictionaries.getAll()} collections={await repo.collections.getAll()} onSubmit={submit} onCancel={vi.fn()} />)
 const apply = await search()
 fireEvent.click(apply)
 expect(screen.getByLabelText('原文書名', { exact: true })).toHaveProperty('value', 'Manual Original')
 expect(screen.getByLabelText('譯者（每行一位）')).toHaveProperty('value', '人工譯者')
 expect(screen.getByLabelText('繪者／插畫者（每行一位）')).toHaveProperty('value', '人工繪者')
 expect(screen.getByLabelText('書籍字數')).toHaveProperty('value', '100')
 const choices = within(screen.getByRole('group', { name: '選擇要套用的欄位：候選書名' }))
 fireEvent.click(choices.getByRole('checkbox', { name: '作者：候選作者' }))
 fireEvent.click(choices.getByRole('checkbox', { name: '出版社：候選出版社' }))
 fireEvent.click(choices.getByRole('checkbox', { name: '字數：200' }))
 fireEvent.click(screen.getByLabelText('已核對版本，允許候選取代目前欄位'))
 fireEvent.click(apply)
 expect(screen.getByLabelText('作者（每行一位）')).toHaveProperty('value', '人工作者')
 expect(screen.getByLabelText('出版社', { exact: true })).toHaveProperty('value', '人工出版社')
 expect(screen.getByLabelText('書籍字數')).toHaveProperty('value', '100')
 expect(screen.getByLabelText('原文書名', { exact: true })).toHaveProperty('value', 'Candidate Original')
 expect(screen.getByLabelText('譯者（每行一位）')).toHaveProperty('value', '候選譯者')
 expect(screen.getByLabelText('繪者／插畫者（每行一位）')).toHaveProperty('value', '候選繪者')
 expect(screen.getByLabelText('系列名稱')).toHaveProperty('value', book.collectionId)
 expect(screen.getByLabelText('卷次／集數')).toHaveProperty('value', '第 1 集')
 fireEvent.click(choices.getByRole('checkbox', { name: '系列名稱：候選系列' }))
 fireEvent.click(choices.getByRole('checkbox', { name: '卷次／集數：第 2 集' }))
 fireEvent.click(apply)
 expect(screen.getByLabelText('系列名稱')).toHaveProperty('value', '__new')
 expect(screen.getByLabelText('新系列名稱')).toHaveProperty('value', '候選系列')
 expect(screen.getByLabelText('卷次／集數')).toHaveProperty('value', '第 2 集')
 expect(screen.getByLabelText('卷次排序（選填）')).toHaveProperty('value', '')
 expect(submit).not.toHaveBeenCalled()
 expect(await repo.books.getAll()).toEqual([book])
 expect(await repo.collections.getAll()).toHaveLength(1)
 expect(await repo.readingRecords.getAll()).toEqual([])
})

it('clears replacement approval and field choices on a new search, and disables applying when nothing is selected', async () => {
 mockSearch()
 const onSelect = vi.fn()
 render(<BookMetadataSearch title="書" author="" disabled={false} onSelect={onSelect} />)
 let apply = await search()
 const group = within(screen.getByRole('group', { name: '選擇要套用的欄位：候選書名' }))
 group.getAllByRole('checkbox').filter(input => (input as HTMLInputElement).checked).forEach(input => fireEvent.click(input))
 expect(apply).toHaveProperty('disabled', true)
 fireEvent.click(group.getByRole('checkbox', { name: '系列名稱：候選系列' }))
 fireEvent.click(screen.getByLabelText('已核對版本，允許候選取代目前欄位'))
 fireEvent.click(screen.getByRole('button', { name: '返回搜尋結果' }))
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 fireEvent.click(await screen.findByRole('button', { name: '核對《候選書名》' }))
 fireEvent.click(screen.getByText('調整帶入欄位或取代既有資料'))
 apply = screen.getByRole('button', { name: '帶入下列表單' })
 expect(screen.getByLabelText('已核對版本，允許候選取代目前欄位')).toHaveProperty('checked', false)
 expect(screen.getByRole('checkbox', { name: '系列名稱：候選系列' })).toHaveProperty('checked', false)
 fireEvent.click(apply)
 expect(onSelect).toHaveBeenCalledWith(candidate, false, expect.not.arrayContaining(['seriesName']))
})

it('retains the ebook edition guard and keeps word-count attribution until a manual edit', async () => {
 const row = { ...candidate, source: '讀書共和國' as const, sourceUrl: 'https://www.bookrep.com.tw/?md=gwindex&cl=book&at=bookcontent&id=18250' }
 mockSearch(row)
 render(<BookForm onSubmit={vi.fn()} onCancel={vi.fn()} />)
 fireEvent.change(screen.getByLabelText('出版書名'), { target: { value: '書' } })
 fireEvent.click(await search())
 expect(screen.getByLabelText('ISBN', { exact: true })).toHaveProperty('value', '')
 expect(screen.getByLabelText('出版日期或年份')).toHaveProperty('value', '')
 expect(screen.getByLabelText('書籍字數')).toHaveProperty('value', '200')
 expect(screen.getByRole('link', { name: '核對字數來源' }).getAttribute('href')).toBe(row.sourceUrl)
 fireEvent.change(screen.getByLabelText('書籍字數'), { target: { value: '201' } })
 expect(screen.queryByRole('link', { name: '核對字數來源' })).toBeNull()
})
