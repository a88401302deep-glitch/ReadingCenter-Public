import { expect, it, vi } from 'vitest'
import { handlePhotoBookOcr, parsePhotoResult } from '../../worker/photo-book-ocr'
import type { D1Database } from '../../worker/cloudflare-types'
const result = { title: '照片書名', author: '', publisher: '', isbn: '', visibleText: '照片書名' }
const request = (body: BodyInit = new Uint8Array([255,216,1,255,217])) => new Request('https://example.test/api/v1/import/photo/book', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body })
const database = (quota: unknown) => ({ prepare: () => ({ bind: () => ({ first: async () => quota }) }) }) as unknown as D1Database
it('returns only bounded reviewed fields and rejects missing or oversized output', () => {
 expect(parsePhotoResult({ choices: [{ message: { content: JSON.stringify(result) } }] })).toEqual(result)
 expect(() => parsePhotoResult({ response: JSON.stringify({ ...result, title: 'a'.repeat(301) }) })).toThrow()
 expect(() => parsePhotoResult({ response: '{}' })).toThrow()
})
it('rejects invalid photos and exhausted quota without running AI', async () => {
 const ai = { run: vi.fn() }
 expect((await handlePhotoBookOcr(request('invalid'), database({}), ai)).status).toBe(415)
 expect((await handlePhotoBookOcr(request(), database(null), ai)).status).toBe(429)
 const large = request(new Uint8Array(2 * 1024 * 1024 + 1))
 expect((await handlePhotoBookOcr(large, database({}), ai)).status).toBe(413)
 expect(ai.run).not.toHaveBeenCalled()
})
it('runs a bounded vision request and returns candidates without entity writes', async () => {
 const ai = { run: vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(result) } }] }) }
 const response = await handlePhotoBookOcr(request(), database({ failed_attempts: 1 }), ai)
 expect(response.status).toBe(200)
 expect((await response.json()).data).toEqual(result)
 expect(ai.run.mock.calls[0][1]).toMatchObject({ max_completion_tokens: 1500, store: false })
})
it('returns separate bounded books for a list screenshot while retaining the single-book API', async () => {
 const { parsePhotoBooks } = await import('../../worker/photo-book-ocr')
 const books = [result, { ...result, title: '第二本書', author: '另一作者' }]
 expect(parsePhotoBooks({ response: JSON.stringify({ books }) })).toEqual({ books })
 expect(() => parsePhotoBooks({ response: JSON.stringify({ books: Array(11).fill(result) }) })).toThrow()
 expect(() => parsePhotoBooks({ response: JSON.stringify({ books: [{ ...result, author: null }] }) })).toThrow()
 const ai = { run: vi.fn().mockResolvedValue({ response: JSON.stringify({ books }) }) }
 const multiRequest = request(); multiRequest.headers.set('X-Photo-Mode','multiple')
 const response = await handlePhotoBookOcr(multiRequest, database({}), ai)
 expect((await response.json()).data).toEqual({ books })
 expect(ai.run.mock.calls[0][1]).toMatchObject({ max_completion_tokens: 6000, store: false })
})
it('keeps per-book explicit dates and cumulative minutes bounded and separate, with legacy compatibility', async () => {
 const { parsePhotoBooks } = await import('../../worker/photo-book-ocr')
 const books = [{ ...result, completedOn: '2026-10-04', totalMinutes: '199' }, { ...result, title: '第二本', completedOn: '2026-10-02', totalMinutes: '341' }]
 expect(parsePhotoBooks({ response: JSON.stringify({ books }) })).toEqual({ books })
 expect(parsePhotoResult({ response: JSON.stringify(result) })).toEqual(result)
 expect(() => parsePhotoResult({ response: JSON.stringify({ ...result, completedOn: 123 }) })).toThrow()
 expect(() => parsePhotoResult({ response: JSON.stringify({ ...result, totalMinutes: '1'.repeat(13) }) })).toThrow()
})
