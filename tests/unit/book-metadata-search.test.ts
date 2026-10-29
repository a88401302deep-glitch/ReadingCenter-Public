import { expect, it, vi } from 'vitest'
import { handleBookMetadataSearch, parseGoogleVolumes, searchGoogleBooks } from '../../worker/book-metadata-search'
import { readFileSync } from 'node:fs'
import googleKyoto from '../fixtures/book-metadata/google-kyoto-diagnostic.json'

it('leaves Google placeholder authors unknown without dropping the book or normal names', () => {
 for (const placeholder of ['?????', '？？？', '? ? ?', '\uFFFD \uFFFD']) {
  const [row] = parseGoogleVolumes({ items: [{ id: '0MXpEAAAQBAJ', volumeInfo: { title: '異世界漫步 (3) ∼艾法魔導國．散步篇∼', authors: [placeholder], publisher: '台灣角川', publishedDate: '2023-12-01', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9786263782433' }] } }] })
  expect(row).toMatchObject({ authors: [], publisher: '台灣角川', isbn: '9786263782433', publishedOn: '2023-12-01' })
 }
 const [mixed] = parseGoogleVolumes({ items: [{ id: 'mixed', volumeInfo: { title: '書', authors: ['?????', 'あるくひと', '小川慧', '三木大雲', '作者？'] } }] })
 expect(mixed.authors).toEqual(['あるくひと', '小川慧', '三木大雲', '作者？'])
})

it('falls back only after explicit Google zero results and excludes unrelated books observed in the ordinary query', async () => {
 const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ totalItems: 0 })).mockResolvedValueOnce(Response.json(googleKyoto))
 const rows = await searchGoogleBooks('京都怪奇談', '', 'test-key', fetcher)
 expect(rows).toHaveLength(7)
 expect(rows[0]).toMatchObject({ title: '京都怪奇談', authors: ['三木大雲'], publisher: '大牌出版', isbn: '9786267305126' })
 expect(rows.some(row => row.title === '佛經預言')).toBe(false)
 expect(rows.some(row => row.title === '京都怪奇談3')).toBe(true)
 expect(rows.some(row => row.authors.length === 0)).toBe(true)
 expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('q'))).toEqual(['intitle:京都怪奇談', '京都怪奇談'])
 for (const [url, init] of fetcher.mock.calls) {
  const target = new URL(String(url))
  expect(target.origin + target.pathname).toBe('https://www.googleapis.com/books/v1/volumes')
  expect(target.searchParams.get('key')).toBe('test-key')
  expect(target.searchParams.get('maxResults')).toBe('8')
  expect(init.redirect).toBe('manual')
 }
 expect(fetcher.mock.calls[0][1].signal).toBe(fetcher.mock.calls[1][1].signal)
})
it.each([403, 429, 500])('does not retry Google HTTP %i as a zero-result search', async status => {
 const fetcher = vi.fn(async () => new Response('', { status }))
 await expect(searchGoogleBooks('京都怪奇談', '', 'test-key', fetcher)).rejects.toThrow()
 expect(fetcher).toHaveBeenCalledTimes(1)
})
it('does not retry usable, malformed or parser-filtered responses as explicit zero results', async () => {
 for (const body of [googleKyoto, { totalItems: 1, items: [{ id: '../bad', volumeInfo: { title: '京都怪奇談' } }] }, { totalItems: 0, items: {} }, {}]) {
  const fetcher = vi.fn(async () => Response.json(body))
  await searchGoogleBooks('京都怪奇談', '', 'test-key', fetcher)
  expect(fetcher).toHaveBeenCalledTimes(1)
 }
})
it('keeps the author in the ordinary query and separates requested Chinese volumes', async () => {
 const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ totalItems: 0, items: [] })).mockResolvedValueOnce(Response.json(googleKyoto))
 const rows = await searchGoogleBooks('京都 怪奇談３', '三木大雲', 'test-key', fetcher)
 expect(rows.map(row => row.title)).toEqual(['京都怪奇談3'])
 expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('q')).toBe('京都 怪奇談３ 三木大雲')
})
it('reports a failed fallback while preserving another provider and bounds successful empty attempts to two', async () => {
 const empty = vi.fn(async () => Response.json({ totalItems: 0 }))
 expect(await searchGoogleBooks('不存在的書', '', 'test-key', empty)).toEqual([])
 expect(empty).toHaveBeenCalledTimes(2)
 const fetcher = vi.fn(async (input: URL | string | Request) => {
  const url = new URL(String(input))
  if (url.hostname === 'openlibrary.org') return url.pathname === '/search.json'
   ? Response.json({ docs: [{ editions: { docs: [{ key: '/books/OL1M' }] } }] })
   : Response.json({ 'OLID:OL1M': { title: '京都怪奇談' } })
  return url.searchParams.get('q')?.startsWith('intitle:') ? Response.json({ totalItems: 0 }) : new Response('', { status: 429 })
 })
 const body = await (await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=openlibrary&title=京都怪奇談'), 'test-key', fetcher)).json()
 expect(body).toMatchObject({ partial: true, data: [{ source: 'Open Library', title: '京都怪奇談' }] })
 expect(JSON.stringify(body)).not.toContain('test-key')
})

it.each([301, 302, 303, 307, 308])('rejects HTTP %i redirects without following their targets for every metadata upstream', async status => {
 const paths = [
  '/api/v1/books/metadata?title=京都怪奇談',
  '/api/v1/books/metadata?source=openlibrary&title=京都怪奇談',
  '/api/v1/books/metadata?source=kadokawa&title=異世界漫步',
  '/api/v1/books/metadata/cover?kadokawa=%2Fmedia%2Fimage_clips%2F664021a2f2f18f001c1621a0%2Foriginal.jpg',
  '/api/v1/books/metadata/cover?publisher=pic_1713926395_95668_1.jpg',
  '/api/v1/books/metadata/cover?path=%2Fb%2Fid%2F123-L.jpg',
  '/api/v1/books/metadata/cover?google=volume1',
 ]
 for (const path of paths) {
  const fetcher = vi.fn(async (_url: URL | string | Request, init?: RequestInit) => {
   expect(init?.redirect).toBe('manual')
   return new Response('must not be used as metadata or image', { status, headers: { Location: 'http://127.0.0.1/private', 'Content-Type': 'image/jpeg' } })
  })
  const response = await handleBookMetadataSearch(new Request('https://app.test' + path), undefined, fetcher)
  expect(response.status).toBe(502)
  expect(fetcher).toHaveBeenCalledTimes(path.startsWith('/api/v1/books/metadata?title=') ? 2 : 1)
  expect(await response.text()).not.toContain('127.0.0.1')
 }
 const google = vi.fn(async (_url: URL | string | Request, init?: RequestInit) => {
  expect(init?.redirect).toBe('manual')
  return new Response('', { status, headers: { Location: 'http://127.0.0.1/private' } })
 })
 expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=openlibrary&title=書'), 'test-key', google)).status).toBe(502)
 expect(google).toHaveBeenCalledTimes(2)
})

// Minimal dimension headers; the proxy reads dimensions without decoding pixels.
const jpegHeader = (width: number, height: number, marker = 0xc0) => {
 const bytes = new Uint8Array(width > 128 ? 32 : 13)
 bytes.set([255, 216, 255, marker, 0, 7, 8, height >> 8, height & 255, width >> 8, width & 255, 255, 217])
 return bytes
}
it('rejects the white Google PNG returned with matching larger dimensions and HTTP 200', async () => {
 const original = new Uint8Array(12643)
 original.set(jpegHeader(128, 182))
 const blank = readFileSync(new URL('../fixtures/book-metadata/google-blank-cover.png', import.meta.url))
 const fetcher = vi.fn().mockResolvedValueOnce(new Response(original, { headers: { 'Content-Type': 'image/jpeg' } })).mockResolvedValueOnce(new Response(blank, { headers: { 'Content-Type': 'image/png' } }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?google=JiS9EAAAQBAJ'), undefined, fetcher)
 expect(response.status).toBe(200)
 expect(response.headers.get('Content-Type')).toBe('image/jpeg')
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(original)
 expect(fetcher).toHaveBeenCalledTimes(2)
})
it('conservatively retains the original when larger dimensions have fewer image bytes', async () => {
 const original = new Uint8Array(64); original.set(jpegHeader(128, 182))
 const fetcher = vi.fn().mockResolvedValueOnce(new Response(original, { headers: { 'Content-Type': 'image/jpeg' } })).mockResolvedValueOnce(new Response(jpegHeader(800, 1135), { headers: { 'Content-Type': 'image/jpeg' } }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?google=volume1'), undefined, fetcher)
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(original)
})
it('requests a larger Google cover for the same volume and preserves its image bytes', async () => {
 const original = jpegHeader(128, 182), bytes = jpegHeader(800, 1135, 0xc2)
 const signals: (AbortSignal | null | undefined)[] = []
 const fetcher = vi.fn(async (input: URL | string | Request, init?: RequestInit) => {
  const target = new URL(String(input))
  expect(target.origin).toBe('https://books.google.com')
  expect(target.pathname).toBe('/books/content')
  const large = target.searchParams.get('zoom') === '0'
  expect(Object.fromEntries(target.searchParams)).toEqual({ id: 'volume1', printsec: 'frontcover', img: '1', zoom: large ? '0' : '1', ...(large ? { w: '800' } : {}), source: 'gbs_api' })
  expect(init?.redirect).toBe('manual')
  expect(init?.signal).toBeInstanceOf(AbortSignal)
  expect(init?.headers).toBeUndefined()
  signals.push(init?.signal)
  return new Response(large ? bytes : original, { headers: { 'Content-Type': 'image/jpeg' } })
 })
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?google=volume1&zoom=1&w=9999&url=https://private.test', { headers: { Cookie: 'private-session' } }), 'private-key', fetcher)
 expect(response.status).toBe(200)
 expect(response.headers.get('Content-Type')).toBe('image/jpeg')
 expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
 expect(fetcher).toHaveBeenCalledTimes(2)
 expect(signals[0]).toBe(signals[1])
})
it.each([
 ['cropped banner', jpegHeader(800, 350)],
 ['same thumbnail', jpegHeader(128, 182)],
 ['smaller image', jpegHeader(64, 91)],
 ['unrecognized image', new Uint8Array([1, 2, 3])],
])('keeps the complete original when the larger Google image is a %s', async (_name, bytes) => {
 const original = jpegHeader(128, 182)
 const fetcher = vi.fn().mockResolvedValueOnce(new Response(original, { headers: { 'Content-Type': 'image/jpeg' } })).mockResolvedValueOnce(new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?google=volume1'), undefined, fetcher)
 expect(response.status).toBe(200)
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(original)
 expect(fetcher).toHaveBeenCalledTimes(2)
})
it.each(['http', 'redirect', 'mime', 'oversize', 'network'])('keeps the original if the larger Google cover fails with %s', async failure => {
 const original = jpegHeader(128, 182)
 const fetcher = vi.fn().mockResolvedValueOnce(new Response(original, { headers: { 'Content-Type': 'image/jpeg' } })).mockImplementationOnce(async () => {
  if (failure === 'network') throw new TypeError('upstream unavailable')
  return new Response('unusable', { status: failure === 'http' ? 404 : failure === 'redirect' ? 302 : 200, headers: { 'Content-Type': failure === 'mime' ? 'text/html' : 'image/jpeg', ...(failure === 'oversize' ? { 'Content-Length': String(10 * 1024 * 1024 + 1) } : {}), Location: 'https://private.test' } })
 })
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?google=volume1'), undefined, fetcher)
 expect(response.status).toBe(200)
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(original)
 expect(fetcher).toHaveBeenCalledTimes(2)
})
it('does not replace a cover whose dimensions cannot safely be identified', async () => {
 const original = new Uint8Array([255, 216, 255, 224, 255, 255])
 const fetcher = vi.fn(async () => new Response(original, { headers: { 'Content-Type': 'image/jpeg' } }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?google=volume1'), undefined, fetcher)
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(original)
 expect(fetcher).toHaveBeenCalledTimes(1)
})
it('accepts a complete larger PNG cover without converting the image', async () => {
 const pngHeader = (width: number, height: number) => {
  const bytes = new Uint8Array(width > 128 ? 32 : 24), view = new DataView(bytes.buffer)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  view.setUint32(12, 0x49484452); view.setUint32(16, width); view.setUint32(20, height)
  return bytes
 }
 const original = pngHeader(128, 182), larger = pngHeader(800, 1135)
 const fetcher = vi.fn().mockResolvedValueOnce(new Response(original, { headers: { 'Content-Type': 'image/png' } })).mockResolvedValueOnce(new Response(larger, { headers: { 'Content-Type': 'image/png' } }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?google=volume1'), undefined, fetcher)
 expect(response.headers.get('Content-Type')).toBe('image/png')
 expect(new Uint8Array(await response.arrayBuffer())).toEqual(larger)
 expect(fetcher).toHaveBeenCalledTimes(2)
})
it.each(['../private', 'https://private.test', 'x'.repeat(81)])('rejects invalid Google cover id %s without an upstream request', async id => {
 const fetcher = vi.fn()
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?google=' + encodeURIComponent(id)), undefined, fetcher)
 expect(response.status).toBe(400)
 expect(fetcher).not.toHaveBeenCalled()
})
it.each([
 { mime: 'text/html', bytes: 0 },
 { mime: 'image/svg+xml', bytes: 0 },
 { mime: 'image/jpeg', bytes: 10 * 1024 * 1024 + 1 },
])('keeps Google cover MIME and size protections: %j', async ({ mime, bytes }) => {
 const headers = new Headers({ 'Content-Type': mime })
 if (bytes) headers.set('Content-Length', String(bytes))
 const fetcher = vi.fn(async () => new Response('not a usable cover', { headers }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?google=volume1'), undefined, fetcher)
 expect(response.status).toBe(502)
 expect(fetcher).toHaveBeenCalledTimes(1)
})
it('returns Chinese metadata and image bytes with Workers-compatible requests', async () => {
 const fetcher = vi.fn(async (input: URL | string | Request, init?: RequestInit) => {
  expect(init?.redirect).toBe('manual')
  const url = new URL(String(input))
  if (url.hostname === 'www.bookrepclub.com.tw') return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'Content-Type': 'image/jpeg' } })
  const html = url.searchParams.has('id') ? readFileSync(new URL('../fixtures/book-metadata/bookrep-18250.html', import.meta.url), 'utf8') : '<ul id="re_list"><h3><a href="?md=gwindex&amp;cl=book&amp;at=bookcontent&amp;id=18250">京都怪奇談【幽冥之門篇】</a></h3></ul>'
  return new Response(html)
 })
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?title=京都怪奇談'), undefined, fetcher)
 expect(response.status).toBe(200)
 const body = await response.json()
 expect(body.data[0]).toMatchObject({ authors: ['三木大雲'], publisher: '大牌出版', isbn: '9786267378939' })
 const cover = await handleBookMetadataSearch(new Request('https://app.test' + body.data[0].coverUrl), undefined, fetcher)
 expect(cover.status).toBe(200)
 expect(cover.headers.get('Content-Type')).toBe('image/jpeg')
 expect((await cover.arrayBuffer()).byteLength).toBe(4)
})
it('searches by title without ISBN and uses a single edition for publisher, authors and identifiers', async () => {
 const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ docs: [{ editions: { docs: [{ key: '/books/OL1M' }] }, publisher: ['錯版出版社'], isbn: ['錯版ISBN'] }] })).mockResolvedValueOnce(Response.json({ 'OLID:OL1M': { title: '京都怪奇談', authors: [{ name: '甲' }, { name: '乙' }], publishers: [{ name: '正確出版社' }], identifiers: { isbn_13: ['9781234567890'] }, publish_date: '2025', cover: { large: 'https://covers.openlibrary.org/b/id/123-L.jpg' } } }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=openlibrary&title=京都怪奇談'), undefined, fetcher)
 const body = await response.json()
 expect(body.data[0]).toMatchObject({ title: '京都怪奇談', authors: ['甲', '乙'], publisher: '正確出版社', isbn: '9781234567890', sourceUrl: 'https://openlibrary.org/books/OL1M' })
 expect(String(fetcher.mock.calls[0][0])).not.toContain('isbn')
 expect(fetcher).toHaveBeenCalledTimes(2)
})
it('rejects invalid cover targets and bounds upstream payloads', async () => {
 const fetcher = vi.fn()
 expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?path=https://private.test'), undefined, fetcher)).status).toBe(400)
 expect(fetcher).not.toHaveBeenCalled()
 fetcher.mockResolvedValue(new Response('x'.repeat(512001)))
 expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=openlibrary&title=書名'), undefined, fetcher)).status).toBe(502)
})
it('keeps usable results if another configured provider fails and tolerates books without a cover', async () => {
 const fetcher = vi.fn().mockImplementation(async url => String(url).includes('googleapis') ? Response.json({ items: [{ id: 'volume1', volumeInfo: { title: '書名', authors: ['作者'], publisher: '出版社' } }] }) : new Response('', { status: 503 }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=openlibrary&title=書名'), 'test-key', fetcher)
 expect(await response.json()).toMatchObject({ partial: true, data: [{ title: '書名', source: 'Google Books', coverUrl: null }] })
 expect(parseGoogleVolumes({ items: [{ id: '../bad', volumeInfo: { title: '不應出現' } }] })).toEqual([])
})

it('reports a disabled Google lookup instead of implying every source was searched', async () => {
 const fetcher = vi.fn(async () => Response.json({ docs: [] }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=openlibrary&title=書名'), undefined, fetcher)
 expect(await response.json()).toMatchObject({ data: [], partial: false, warning: 'Google Books 尚未啟用；目前僅查詢所選來源。' })
 expect(fetcher).toHaveBeenCalledTimes(1)
})

it('keeps partial empty responses distinct from a successful empty lookup without leaking credentials', async () => {
 const fetcher = vi.fn(async url => String(url).includes('googleapis') ? new Response('', { status: 429 }) : Response.json({ docs: [] }))
 const response = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=openlibrary&title=書名'), 'private-test-key', fetcher)
 const body = await response.json()
 expect(body).toMatchObject({ data: [], partial: true })
 expect(JSON.stringify(body)).not.toContain('private-test-key')
 expect(body.warning).toBeUndefined()
})

it('uses the explicit Google imprint instead of the group without guessing other publishers', () => {
 for (const [raw, expected] of [['讀書共和國／野人', '野人文化'], ['讀書共和國╱野人文化', '野人文化'], ['讀書共和國 / 大牌出版', '大牌出版'], ['讀書共和國', '讀書共和國'], ['甲／乙', '甲／乙'], ['讀書共和國／甲／乙', '讀書共和國／甲／乙'], ['讀書共和國／', '讀書共和國／']]) {
  const input = { items:[{ id:'publisher', volumeInfo:{ title:'合成書名', publisher:raw } }] }
  expect(parseGoogleVolumes(input)[0].publisher).toBe(expected)
  expect(input.items[0].volumeInfo.publisher).toBe(raw)
 }
})
