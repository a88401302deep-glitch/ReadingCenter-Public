// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { uploadBookCover } from '../../src/features/books/book-cover-upload'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('reduces image size without cropping and uploads a JPEG with dimensions and authenticated book identity', async () => {
 const close = vi.fn(), drawImage = vi.fn()
 vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2800, height: 4000, close })))
 vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D)
 vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['jpeg'], { type: 'image/jpeg' })))
 const fetch = vi.fn(async () => Response.json({ data: { cover: { path: '/api/v1/covers/covers/new.jpg', mimeType: 'image/jpeg' } } }))
 vi.stubGlobal('fetch', fetch)
 const cover = await uploadBookCover({ id: 'book-id', title: '中文書' }, new File(['png'], '封面.png', { type: 'image/png' }))
 expect(cover).toMatchObject({ mimeType: 'image/jpeg', width: 1400, height: 2000 })
 expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1400, 2000)
 expect(fetch).toHaveBeenCalledWith('/api/v1/covers/manual', expect.objectContaining({ credentials: 'include', headers: expect.objectContaining({ 'X-Book-Id': 'book-id', 'X-Book-Title': encodeURIComponent('中文書') }) }))
 expect(close).toHaveBeenCalledOnce()
})
it('rejects unsupported files before decoding or uploading', async () => {
 const decode = vi.fn(), fetch = vi.fn(); vi.stubGlobal('createImageBitmap', decode); vi.stubGlobal('fetch', fetch)
 await expect(uploadBookCover({ id: 'book', title: '書' }, new File(['txt'], 'book.txt', { type: 'text/plain' }))).rejects.toThrow('JPEG')
 expect(decode).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})

it('explains an intentional read-only preview rejection instead of asking the user to retry', async () => {
 vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 56, height: 80, close: vi.fn() })))
 vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
 vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['jpeg'], { type: 'image/jpeg' })))
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'preview_read_only' } }, { status: 405 })))
 await expect(uploadBookCover({ id: 'book', title: '書' }, new File(['image'], 'cover.png', { type: 'image/png' }))).rejects.toThrow('此預覽僅供核對')
})
