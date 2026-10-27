// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BookCoverSearch } from '../../src/features/books/BookCoverSearch'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('shows candidates without changing a cover, then stages a file only after selection', async () => {
  const selected = vi.fn()
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ coverId: 12, title: '測試書', authors: ['作者'], previewUrl: 'https://covers.openlibrary.org/b/id/12-M.jpg', sourceUrl: 'https://openlibrary.org/works/OL1W' }] }) }).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['image'], { type: 'image/jpeg' }) })
  vi.stubGlobal('fetch', fetcher)
  render(<BookCoverSearch title="測試書" author="作者" isbn={null} disabled={false} onSelect={selected} />)
  fireEvent.click(screen.getByText('搜尋封面'))
  fireEvent.click(screen.getByRole('button', { name: '尋找候選封面' }))
  await screen.findByRole('button', { name: '選用此封面' })
  expect(selected).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '選用此封面' }))
  await waitFor(() => expect(selected).toHaveBeenCalledWith(expect.any(File)))
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/covers/search/image/12')
  expect(fetcher.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true)
})
it('keeps the current cover when there are no search results', async () => {
  const selected = vi.fn()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }))
  render(<BookCoverSearch title="測試書" author="" isbn={null} disabled={false} onSelect={selected} />)
  fireEvent.click(screen.getByText('搜尋封面'))
  fireEvent.click(screen.getByRole('button', { name: '尋找候選封面' }))
  await screen.findByText('查無候選封面，可調整書名、作者或 ISBN，或手動上傳。')
  expect(selected).not.toHaveBeenCalled()
})
