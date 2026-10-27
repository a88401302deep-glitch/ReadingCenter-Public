// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BookMetadataSearch } from '../../src/features/books/BookMetadataSearch'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
const candidate = { id: 'ol:OL1M', source: 'Open Library', title: '原始書名', authors: ['作者'], publisher: '出版社', isbn: '', publishedOn: '', sourceUrl: 'https://openlibrary.org/books/OL1M', coverUrl: null }

it('automatically searches once in StrictMode, reviews a single candidate and never applies it without confirmation', async () => {
 const request = vi.fn(async () => Response.json({ data: [candidate] })), select = vi.fn()
 vi.stubGlobal('fetch', request)
 const props = { title: '原始書名', author: '作者', disabled: false, autoSearch: true, onSelect: select }
 const view = render(<StrictMode><BookMetadataSearch {...props} /></StrictMode>)
 expect(await screen.findByRole('heading', { name: '原始書名' })).toBeTruthy()
 expect(request).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled()
 view.rerender(<StrictMode><BookMetadataSearch {...props} title="人工修正" /></StrictMode>)
 await act(async () => undefined)
 expect(request).toHaveBeenCalledOnce()
})

it('cancels a pending search, ignores late results and allows an explicit retry', async () => {
 let finish!: (value: Response) => void
 const request = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve })).mockResolvedValueOnce(Response.json({ data: [] }))
 vi.stubGlobal('fetch', request)
 const select = vi.fn()
 render(<BookMetadataSearch title="原始書名" author="" disabled={false} autoSearch onSelect={select} />)
 expect(await screen.findByRole('dialog', { name: '正在尋找書籍資料…' })).toBeTruthy()
 const signal = request.mock.calls[0][1].signal as AbortSignal
 fireEvent.click(screen.getByRole('button', { name: '取消搜尋' }))
 expect(signal.aborted).toBe(true); expect(screen.queryByRole('dialog')).toBeNull()
 await act(async () => { finish(Response.json({ data: [candidate] })) })
 expect(screen.queryByRole('heading', { name: candidate.title })).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: '重試搜尋' }))
 expect(await screen.findByText('查無書目資料；已保留書名與閱讀紀錄，可直接確認匯入，日後再補全。')).toBeTruthy()
 expect(screen.getByLabelText('查詢書名')).toHaveProperty('value', '原始書名')
 expect(select).not.toHaveBeenCalled()
})

it('times out a stalled search after 25 seconds and closes the modal', async () => {
 vi.useFakeTimers()
 const request = vi.fn((_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) }))
 vi.stubGlobal('fetch', request)
 render(<BookMetadataSearch title="書名" author="" disabled={false} onSelect={vi.fn()} />)
 fireEvent.click(screen.getByText('搜尋並補全書籍資料'))
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 await act(async () => { await vi.advanceTimersByTimeAsync(25000) })
 expect(screen.queryByRole('dialog')).toBeNull()
 expect(screen.getByRole('alert').textContent).toContain('搜尋逾時')
 expect(screen.getByRole('button', { name: '重試搜尋' })).toHaveProperty('disabled', false)
})

it('handles Escape inside a book editor without dismissing the underlying edit form', async () => {
 const parentEscape = vi.fn()
 document.addEventListener('keydown', parentEscape)
 vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) })))
 try {
  render(<BookMetadataSearch title="書名" author="" disabled={false} autoSearch onSelect={vi.fn()} />)
  const modal = await screen.findByRole('dialog', { name: '正在尋找書籍資料…' })
  fireEvent.keyDown(modal, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(parentEscape).not.toHaveBeenCalled()
 } finally { document.removeEventListener('keydown', parentEscape) }
})

it('reuses successful lookups when switching screenshots and keeps different versions separate', async () => {
 const request = vi.fn(async () => Response.json({ data: [candidate, { ...candidate, id: 'ol:OL2M', title: '不同版本' }] }))
 vi.stubGlobal('fetch', request)
 const cache = new Map(), props = { title: '原始書名', author: '', disabled: false, autoSearch: true, lookupCache: cache, onSelect: vi.fn() }
 const view = render(<BookMetadataSearch key="first" {...props} />)
 expect(await screen.findByRole('button', { name: '核對《原始書名》' })).toBeTruthy()
 expect(screen.getByRole('button', { name: '核對《不同版本》' })).toBeTruthy()
 expect(screen.queryByRole('button', { name: '帶入下列表單' })).toBeNull()
 view.rerender(<BookMetadataSearch key="reopened" {...props} />)
 await waitFor(() => expect(screen.getByRole('button', { name: '核對《原始書名》' })).toBeTruthy())
 expect(request).toHaveBeenCalledOnce()
})
