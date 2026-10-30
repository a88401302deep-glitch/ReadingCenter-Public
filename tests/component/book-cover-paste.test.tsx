// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BookCoverPaste } from '../../src/features/books/BookCoverPaste'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('reads only after a user click and stages a supported clipboard image', async () => {
  const selected = vi.fn(), read = vi.fn().mockResolvedValue([{ types: ['text/plain', 'image/png'], getType: async () => new Blob(['image'], { type: 'image/png' }) }])
  vi.stubGlobal('navigator', { clipboard: { read } })
  render(<BookCoverPaste disabled={false} onSelect={selected} />)
  expect(read).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '貼上封面' }))
  await waitFor(() => expect(selected).toHaveBeenCalledWith(expect.any(File)))
  expect(selected.mock.calls[0][0].type).toBe('image/png')
})
it('accepts a direct paste and rejects text-only or unsupported images without replacing a cover', () => {
  const selected = vi.fn()
  render(<BookCoverPaste disabled={false} onSelect={selected} />)
  const area = screen.getByLabelText('圖片貼上區')
  fireEvent.paste(area, { clipboardData: { files: [] } })
  expect(screen.getByRole('alert').textContent).toContain('不是複製圖片網址')
  fireEvent.paste(area, { clipboardData: { files: [new File(['image'], 'test.gif', { type: 'image/gif' })] } })
  expect(selected).not.toHaveBeenCalled()
  fireEvent.paste(area, { clipboardData: { files: [new File(['image'], 'test.png', { type: 'image/png' })] } })
  expect(selected).toHaveBeenCalledTimes(1)
})
it('preserves the existing cover when clipboard access is denied', async () => {
  const selected = vi.fn()
  vi.stubGlobal('navigator', { clipboard: { read: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) } })
  render(<BookCoverPaste disabled={false} onSelect={selected} />)
  fireEvent.click(screen.getByRole('button', { name: '貼上封面' }))
  await screen.findByRole('alert')
  expect(selected).not.toHaveBeenCalled()
})
it('compact paste reveals the fallback only after clipboard failure and accepts a direct image paste', async () => {
  const selected = vi.fn()
  vi.stubGlobal('navigator', { clipboard: { read: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) } })
  render(<BookCoverPaste compact disabled={false} onSelect={selected} />)
  expect(screen.queryByLabelText('圖片貼上區')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '貼上封面' }))
  await screen.findByRole('alert')
  fireEvent.paste(screen.getByLabelText('圖片貼上區'), { clipboardData: { files: [new File(['image'], 'paste.png', { type: 'image/png' })] } })
  expect(selected).toHaveBeenCalledOnce()
  expect(screen.queryByLabelText('圖片貼上區')).toBeNull()
})
