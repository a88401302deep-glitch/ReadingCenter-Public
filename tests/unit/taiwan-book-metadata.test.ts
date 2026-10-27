import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { parsePublisherBook, publisherSearchRows, searchTaiwanPublisher } from '../../worker/taiwan-book-metadata'
import { handleBookMetadataSearch } from '../../worker/book-metadata-search'
import { isMetadataSourceUrl } from '../../src/domain/book-metadata'
const fixture = (name: string) => readFileSync(new URL('../fixtures/book-metadata/' + name, import.meta.url), 'utf8')
it('reports the verified maintenance redirect while preserving successful zero results or candidates from other sources', async () => {
 for (const withGoogle of [false, true]) {
  const fetcher = vi.fn(async (input: URL | string | Request, init?: RequestInit) => {
   expect(init?.redirect).toBe('manual')
   const url = new URL(String(input))
   if (url.hostname === 'www.bookrep.com.tw') return new Response('must not be parsed', { status: 302, headers: { Location: 'https://event.bookrep.com.tw/activity/20261022/index.html' } })
   if (url.hostname === 'www.googleapis.com') return Response.json({ items: [{ id: 'volume1', volumeInfo: { title: '京都怪奇談', authors: ['三木大雲'] } }] })
   expect(url.hostname).toBe('www.kadokawa.com.tw')
   return new Response('<div class="ProductList"></div>')
  })
  const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?title=京都怪奇談'), withGoogle ? 'test-key' : undefined, fetcher)
  const body = await response.json()
  expect(response.status).toBe(200)
  expect(body).toMatchObject({ partial: true, warnings: ['讀書共和國目前導向官方維護公告，暫時無法搜尋。'] })
  expect(body.diagnostics).toContainEqual({ source: '讀書共和國', status: 'failed', kind: 'maintenance', count: 0 })
  expect(body.diagnostics).toContainEqual(withGoogle ? { source: 'Google Books', status: 'ok', count: 1, steps: [{ query: 'title', received: 1, parsed: 1, kept: 1, explicitZero: false }] } : { source: 'Google Books', status: 'disabled', count: 0 })
  expect(body.data).toHaveLength(withGoogle ? 1 : 0)
  expect(fetcher).toHaveBeenCalledTimes(withGoogle ? 3 : 2)
 }
})
it('does not label an arbitrary redirect as maintenance or expose its target', async () => {
 const fetcher = vi.fn(async () => new Response('', { status: 302, headers: { Location: 'https://evil.test/private?secret=hidden' } }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?title=書'), undefined, fetcher)
 const body = await response.text()
 expect(response.status).toBe(502)
 expect(body).toContain('HTTP 302')
 expect(body).not.toContain('維護公告')
 expect(body).not.toContain('hidden')
 expect(fetcher).toHaveBeenCalledTimes(2)
})
it('parses live-captured Chinese edition metadata without mixing the author with translator or promotional text', () => {
 const first = parsePublisherBook(fixture('bookrep-18250.html'), '18250')
 expect(first).toMatchObject({ source: '讀書共和國', authors: ['三木大雲'], publisher: '大牌出版', isbn: '9786267378939', publishedOn: '2024-05-02' })
 expect(first.title).toContain('幽冥之門篇')
 expect(first.originalTitle).toBe('怪談和尚の京都怪奇譚 幽冥の門篇')
 expect(first.translators).toEqual(['林以庭'])
 expect(first.authors).toEqual(['三木大雲'])
 expect(first.seriesName).toBeUndefined()
 expect(first.wordCount).toBeUndefined()
 expect(first.coverUrl).toContain('publisher=pic_1713926395_95668_1.jpg')
 expect(parsePublisherBook(fixture('bookrep-18628.html'), '18628').title).toContain('宿緣之道篇')
 expect(parsePublisherBook(fixture('bookrep-17933.html'), '17933').title).toContain('京都怪奇談3')
 expect(isMetadataSourceUrl(first.sourceUrl)).toBe(true)
 expect(isMetadataSourceUrl(first.sourceUrl.replace('www.bookrep.com.tw', 'www.bookrep.com.tw.evil.test'))).toBe(false)
})
it('excludes bundles unless asked, prioritizes the requested volume and defaults to a Chinese source without ISBN', async () => {
 const rows = publisherSearchRows(fixture('bookrep-search.html'), '京都怪奇談3')
 expect(rows[0].id).toBe('17933')
 expect(rows.every(row => !row.title.includes('套書'))).toBe(true)
 const fetcher = vi.fn(async (url: URL | string | Request) => {
  const u = new URL(String(url)), id = u.searchParams.get('id')
  expect(u.hostname).toBe('www.bookrep.com.tw')
  return new Response(fixture(id === '18250' ? 'bookrep-18250.html' : 'bookrep-search.html'), { headers: { 'Content-Type': 'text/html' } })
 })
 // An exact one-row search is used here; the parser's broader search is tested above.
 fetcher.mockImplementation(async url => {
  const target = new URL(String(url))
  if (target.hostname === 'www.kadokawa.com.tw') {
   expect(target.searchParams.get('query')).toBe('京都怪奇談')
   return new Response('<div class="ProductList"></div>')
  }
  expect(target.hostname).toBe('www.bookrep.com.tw')
  return new Response(target.searchParams.has('id') ? fixture('bookrep-18250.html') : '<ul id="re_list"><h3><a href="?md=gwindex&amp;cl=book&amp;at=bookcontent&amp;id=18250">京都怪奇談【幽冥之門篇】</a></h3></ul>')
 })
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?title=京都怪奇談'), undefined, fetcher)
 expect(response.status).toBe(200)
 expect((await response.json()).data[0].isbn).toBe('9786267378939')
 expect(fetcher).toHaveBeenCalledTimes(3)
 expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).hostname === 'www.bookrep.com.tw')).toHaveLength(2)
 expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).hostname === 'www.kadokawa.com.tw')).toHaveLength(1)
})
it('limits detail fanout and refuses arbitrary publisher cover paths', async () => {
 const read = vi.fn(async () => fixture('bookrep-search.html'))
 await expect(searchTaiwanPublisher('京都怪奇談', '', read)).rejects.toThrow('頁面格式')
 expect(read).toHaveBeenCalledTimes(5)
 const fetcher = vi.fn()
 const bad = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?publisher=..%2Fprivate.jpg'), undefined, fetcher)
 expect(bad.status).toBe(400); expect(fetcher).not.toHaveBeenCalled()
})
it('distinguishes upstream HTTP, connection and page-format failures without exposing response bodies', async () => {
 const request = () => new Request('https://app.test/api/v1/books/metadata?title=京都怪奇談')
 const http = await handleBookMetadataSearch(request(), undefined, vi.fn(async () => new Response('private upstream body', { status: 403 })))
 expect(http.status).toBe(502)
 const httpBody = await http.json()
 expect(httpBody).toEqual({
  error: { message: '出版社來源回應失敗（HTTP 403），可改用網頁搜尋。' },
  diagnostics: [
   { source: '讀書共和國', status: 'failed', count: 0, kind: 'http', httpStatus: 403 },
   { source: '台灣角川', status: 'failed', count: 0, kind: 'http', httpStatus: 403 },
   { source: 'Google Books', status: 'disabled', count: 0 }
  ]
 })
 expect(JSON.stringify(httpBody)).not.toContain('private upstream body')
 const network = await handleBookMetadataSearch(request(), undefined, vi.fn(async () => { throw new Error('secret URL or transport details') }))
 expect((await network.json()).error.message).toBe('目前無法連線至出版社來源，可改用網頁搜尋。')
 const format = await handleBookMetadataSearch(request(), undefined, vi.fn(async () => new Response('<html>unrecognized upstream content</html>')))
 expect((await format.json()).error.message).toBe('出版社頁面格式無法辨識，可改用網頁搜尋。')
})
