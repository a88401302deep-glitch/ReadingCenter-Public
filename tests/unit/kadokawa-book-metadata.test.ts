import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { kadokawaSearchRows, parseKadokawaBook, searchKadokawa } from '../../worker/kadokawa-book-metadata'
import { handleBookMetadataSearch } from '../../worker/book-metadata-search'
import { defaultMetadataFields, isBookMetadataCandidate, isMetadataSourceUrl } from '../../src/domain/book-metadata'
const fixture = (name: string) => readFileSync(new URL('../fixtures/book-metadata/' + name + '.html', import.meta.url), 'utf8')

it('accepts explicit generic books without inventing a novel/manga classification and still rejects merchandise', () => {
 const html = fixture('kadokawa-9786264002769')
 const row = parseKadokawaBook(html, '9786264002769')
 expect(row).toMatchObject({ title: '發生在近畿某處的那些事', authors: ['背筋'], publisher: '台灣角川' })
 expect(row.bookForm).toBeUndefined()
 expect(isBookMetadataCandidate(row)).toBe(true)
 expect(defaultMetadataFields(row)).toEqual(['title', 'authors', 'publisher'])
 expect(() => parseKadokawaBook(html.replace('<a>書籍</a>', '<a>周邊商品</a>'), '9786264002769')).toThrow()
 expect(() => parseKadokawaBook(html.replace('作者：背筋', ''), '9786264002769')).toThrow()
 expect(() => parseKadokawaBook(html, '9786264002776')).toThrow()
})

it('finds volumes from a series title and only follows matching public book product links', () => {
 const rows = kadokawaSearchRows(fixture('kadokawa-search'), '異世界漫步')
 expect(rows).toHaveLength(4)
 expect(rows.some(row => row.id === '9786263522732')).toBe(true)
 expect(kadokawaSearchRows('<div class="ProductList"><a class="js-quick-cart-item" href="https://evil.example/products/9786263522732"><div class="title">異世界漫步</div></a></div>', '異世界漫步')).toEqual([])
 expect(kadokawaSearchRows('<div class="ProductList"></div>', '沒有這本')).toEqual([])
 expect(() => kadokawaSearchRows('<h1>challenge</h1>', '異世界漫步')).toThrow()
})
it('keeps novel authors, illustrators and explicit volume separate without guessing ISBN or publication date', () => {
 const row = parseKadokawaBook(fixture('kadokawa-9786263522732'), '9786263522732')
 expect(row).toMatchObject({ source: '台灣角川', authors: ['あるくひと'], illustrators: ['ゆーにっと'], publisher: '台灣角川', bookForm: 'novel', sequenceLabel: '第 1 集', isbn: '', publishedOn: '' })
 expect(isBookMetadataCandidate(row)).toBe(true)
 expect(defaultMetadataFields(row)).toContain('bookForm')
 expect(defaultMetadataFields(row)).not.toContain('sequenceLabel')
 expect(row.coverUrl).toContain('kadokawa=')
 const otherVolume = parseKadokawaBook(fixture('kadokawa-9786263781771'), '9786263781771')
 expect(otherVolume).toMatchObject({ authors: ['あるくひと'], sequenceLabel: '第 3 集' })
 expect(otherVolume.illustrators).toBeUndefined()
})
it('keeps the same-title manga distinct and does not confuse original creator or character design with illustrator', () => {
 const row = parseKadokawaBook(fixture('kadokawa-9786264350600'), '9786264350600')
 expect(row).toMatchObject({ title: '異世界漫步 (1)', authors: ['小川慧'], bookForm: 'manga', isbn: '9786264350600', publishedOn: '' })
 expect(row.illustrators).toBeUndefined()
 expect(defaultMetadataFields(row)).not.toContain('isbn')
 expect(isMetadataSourceUrl(row.sourceUrl)).toBe(true)
 expect(isMetadataSourceUrl(row.sourceUrl + '?next=http://127.0.0.1')).toBe(false)
 expect(() => parseKadokawaBook(fixture('kadokawa-9786264350600'), '9786263522732')).toThrow()
})
it('continues when a detail fails and never hides the source failure as a normal empty result', async () => {
 const read = vi.fn(async (input: URL | string) => {
  const url = new URL(String(input))
  if (url.pathname === '/products') return fixture('kadokawa-search')
  if (url.pathname.endsWith('9786263522732')) return fixture('kadokawa-9786263522732')
  throw new Error('unavailable')
 })
 const rows = await searchKadokawa('異世界漫步', '', read)
 expect(rows).toHaveLength(1)
 expect(read).toHaveBeenCalledTimes(5)
 await expect(searchKadokawa('異世界漫步', '', async input => new URL(String(input)).pathname === '/products' ? fixture('kadokawa-search') : '<h1>blocked</h1>')).rejects.toThrow()
})
it('adds Kadokawa to the default title search without requiring ISBN or Google and proxies only fixed cover paths', async () => {
 const fetcher = vi.fn(async (input: URL | string | Request, init?: RequestInit) => {
  expect(init?.redirect).toBe('manual')
  const url = new URL(String(input))
  if (url.hostname === 'www.bookrep.com.tw') return new Response('', { status: 503 })
  if (url.hostname === 'img.shoplineapp.com') return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'Content-Type': 'image/jpeg' } })
  expect(url.hostname).toBe('www.kadokawa.com.tw')
  if (url.pathname === '/products') {
   expect(url.searchParams.get('query')).toBe('異世界漫步')
   return new Response(fixture('kadokawa-search'))
  }
  const id = url.pathname.split('/').pop()
  if (id === '9786263522732' || id === '9786264350600') return new Response(fixture('kadokawa-' + id))
  return new Response('', { status: 503 })
 })
 const result = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?title=異世界漫步'), undefined, fetcher)
 const body = await result.json()
 expect(body.partial).toBe(true)
 expect(body.data.map((row: { bookForm: string }) => row.bookForm).sort()).toEqual(['manga', 'novel'])
 const cover = await handleBookMetadataSearch(new Request('https://app.test' + body.data[0].coverUrl), undefined, fetcher)
 expect(cover.status).toBe(200)
 const count = fetcher.mock.calls.length
 expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?kadokawa=https://evil.example/a.jpg'), undefined, fetcher)).status).toBe(400)
 expect(fetcher).toHaveBeenCalledTimes(count)
})
it('bounds Kadokawa HTML and never forwards the Google key to publisher or cover hosts', async () => {
 const large = vi.fn(async () => new Response('x'.repeat(2000001)))
 expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=kadokawa&title=異世界漫步'), undefined, large)).status).toBe(502)
 const fetcher = vi.fn(async (input: URL | string | Request) => {
  const url = new URL(String(input))
  if (url.hostname === 'www.googleapis.com') { expect(url.searchParams.get('key')).toBe('test-key'); return Response.json({ items: [] }) }
  expect(url.search).not.toContain('test-key')
  return new Response('<div class="ProductList"></div>')
 })
 expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=kadokawa&title=不存在的書'), 'test-key', fetcher)).status).toBe(200)
 expect(fetcher).toHaveBeenCalledTimes(2)
})
