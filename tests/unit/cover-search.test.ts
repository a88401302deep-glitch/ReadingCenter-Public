import { expect, it, vi } from 'vitest'
import { handleCoverSearch } from '../../worker/cover-search'
const request = (suffix: string) => new Request('https://example.test/api/v1/covers/search' + suffix)
it('normalizes ISBN, filters unsafe or duplicate results and caches repeated searches', async () => {
  const objects = new Map<string, ArrayBuffer>()
  const kv = { get: async (key: string) => objects.get(key) ?? null, put: async (key: string, value: ArrayBuffer) => { objects.set(key, value) } }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
    const url = new URL(String(input))
    expect(url.origin).toBe('https://openlibrary.org')
    expect(url.searchParams.get('q')).toBe('isbn:9781234567890')
    expect(url.searchParams.has('title')).toBe(false)
    return Response.json({ docs: [
      { key: '/works/OL1W', title: '測試書', cover_i: 12, author_name: ['作者'] },
      { key: '/works/OL2W', title: '重複圖片', cover_i: 12 },
      { key: 'https://untrusted.test', title: '無效來源', cover_i: 13 },
      { key: '/works/OL3W', title: '沒有封面' }
    ] })
  })
  for (let i = 0; i < 2; i++) {
    const result = await handleCoverSearch(request('?isbn=978-1234567890&title=other'), kv, fetcher)
    expect(result.status).toBe(200)
    expect((await result.json()).data).toEqual([expect.objectContaining({ coverId: 12, title: '測試書', sourceUrl: 'https://openlibrary.org/works/OL1W' })])
  }
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('rejects arbitrary image URLs without fetching, and bounds downloaded image size', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('large', { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(11 * 1024 * 1024) } }))
  expect((await handleCoverSearch(request('/image/https://untrusted.test'), undefined, fetcher)).status).toBe(400)
  expect(fetcher).not.toHaveBeenCalled()
  expect((await handleCoverSearch(request('/image/12'), undefined, fetcher)).status).toBe(502)
  expect(fetcher.mock.calls[0][0]).toBe('https://covers.openlibrary.org/b/id/12-L.jpg?default=false')
})
it('reports upstream rate limits and rejects oversized streaming search responses', async () => {
  const limited = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }))
  expect((await handleCoverSearch(request('?title=test'), undefined, limited)).status).toBe(429)
  const large = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(256001)))
  expect((await handleCoverSearch(request('?title=test'), undefined, large)).status).toBe(502)
})
