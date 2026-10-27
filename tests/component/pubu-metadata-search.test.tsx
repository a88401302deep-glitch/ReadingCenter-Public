// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BookMetadataSearch } from '../../src/features/books/BookMetadataSearch'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('offers explicit Pubu URL lookup, keeps version fields unchecked and clears candidates on source change', async () => {
 const candidate = { id: 'pubu:697279', source: 'Pubu', title: '幻影都城1', authors: ['蝴蝶'], publisher: '春光出版', isbn: '9786267935583', publishedOn: '2026-09-29', sourceUrl: 'https://www.pubu.com.tw/ebook/697279', coverUrl: null, wordCount: 67559, seriesName: '幻影都城' }
 const fetcher = vi.fn(async (url: RequestInfo | URL) => { expect(new URL(String(url), 'https://app.test').searchParams.get('source')).toBe('pubu'); return Response.json({ data: [candidate] }) }), select = vi.fn()
 vi.stubGlobal('fetch', fetcher)
 render(<BookMetadataSearch title="原書名" author="" disabled={false} onSelect={select} />)
 fireEvent.click(screen.getByText('搜尋並補全書籍資料'))
 fireEvent.change(screen.getByLabelText('書目來源'), { target: { value: 'pubu' } })
 expect(screen.queryByLabelText('查詢書名')).toBeNull()
 fireEvent.change(screen.getByLabelText('Pubu 書頁網址'), { target: { value: candidate.sourceUrl } })
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 const apply = await screen.findByRole('button', { name: '帶入下列表單' })
 expect(new URL(String(fetcher.mock.calls[0][0]), 'https://app.test').searchParams.get('url')).toBe(candidate.sourceUrl)
 expect(screen.getByLabelText('ISBN：9786267935583')).toHaveProperty('checked', false)
 expect(screen.getByLabelText('出版日期：2026-09-29')).toHaveProperty('checked', false)
 expect(screen.getByLabelText('系列名稱：幻影都城')).toHaveProperty('checked', false)
 expect(select).not.toHaveBeenCalled()
 fireEvent.click(apply)
 expect(select).toHaveBeenCalledWith(candidate, false, expect.arrayContaining(['wordCount']))
 expect(select.mock.calls[0][2]).not.toContain('isbn')
 fireEvent.change(screen.getByLabelText('書目來源'), { target: { value: 'taiwan' } })
 expect(screen.queryByRole('button', { name: '帶入下列表單' })).toBeNull()
 expect(screen.getByLabelText('查詢書名')).toHaveProperty('value', '原書名')
})
