import { expect, it } from 'vitest'
import { handleBookMetadataSearch } from '../../worker/book-metadata-search'
import { metadataDiagnosticMessages } from '../../src/features/books/metadata-diagnostics'
const request = () => new Request('https://app.test/api/v1/books/metadata?source=openlibrary&title=測試')
it.each([403, 429])('identifies Google HTTP %i while keeping a successful empty provider separate', async status => {
 const response = await handleBookMetadataSearch(request(), 'private-key', async url => String(url).includes('googleapis') ? new Response('', { status }) : Response.json({ docs: [] }))
 const body = await response.json()
 expect(body.diagnostics).toEqual([{ source: 'Open Library', status: 'empty', count: 0 }, { source: 'Google Books', status: 'failed', count: 0, kind: 'http', httpStatus: status }])
 expect(body.partial).toBe(true)
 expect(JSON.stringify(body)).not.toContain('private-key')
})
it.each([
 ['timeout', () => { throw new DOMException('secret-url', 'TimeoutError') }],
 ['network', () => { throw new Error('secret-url') }],
 ['format', () => new Response('not JSON secret-url')],
] as const)('distinguishes %s without returning raw errors', async (kind, upstream) => {
 const response = await handleBookMetadataSearch(request(), 'private-key', async url => String(url).includes('googleapis') ? upstream() : Response.json({ docs: [] }))
 const body = await response.json()
 expect(body.diagnostics[1]).toEqual({ source: 'Google Books', status: 'failed', count: 0, kind })
 expect(JSON.stringify(body)).not.toContain('secret-url')
})
it('includes diagnostics in all-provider failures and labels a missing key', async () => {
 const response = await handleBookMetadataSearch(request(), undefined, async () => new Response('', { status: 503 }))
 expect(response.status).toBe(502)
 expect((await response.json()).diagnostics).toEqual([{ source: 'Open Library', status: 'failed', count: 0, kind: 'http', httpStatus: 503 }, { source: 'Google Books', status: 'disabled', count: 0 }])
})
it('identifies publisher and Pubu HTTP failures without following redirects', async () => {
 for (const path of ['?source=kadokawa&title=書', '?source=pubu&url=https://www.pubu.com.tw/ebook/123']) {
  const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata' + path), undefined, async (_url, init) => {
   expect(init?.redirect).toBe('manual')
   return new Response('', { status: 302, headers: { Location: 'https://secret.invalid/' } })
  })
  const body = await response.json()
  expect(body.diagnostics[0]).toMatchObject({ status: 'failed', kind: 'http', httpStatus: 302 })
  expect(JSON.stringify(body)).not.toContain('secret.invalid')
 }
})
it('renders only bounded, fixed diagnostic codes and never arbitrary upstream messages', () => {
 expect(metadataDiagnosticMessages([
  { source: 'Google Books', status: 'failed', kind: 'http', httpStatus: 429, message: 'private-key' },
  { source: 'Open Library', status: 'empty' },
  { source: '台灣角川', status: 'ok', count: 2 },
  { source: 'evil source private-key', status: 'failed', kind: 'network' },
 ])).toEqual(['Google Books：HTTP 429', 'Open Library：查詢成功，沒有候選', '台灣角川：取得 2 筆候選'])
 expect(metadataDiagnosticMessages(null)).toEqual([])
})
