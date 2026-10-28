import type { GoogleSearchStep, LookupFailureKind, MetadataDiagnostic, MetadataProvider } from '../src/features/books/metadata-diagnostics'
import { searchKadokawa, kadokawaCoverPath } from './kadokawa-book-metadata'
import { parsePubuBook, pubuBookId, pubuCoverPath } from './pubu-book-metadata'
import { PublisherLookupError, searchTaiwanPublisher } from './taiwan-book-metadata'
import type { BookMetadataCandidate } from '../src/domain/book-metadata'
class MetadataUpstreamError extends Error {
 readonly kind: LookupFailureKind
 readonly httpStatus?: number
 constructor(kind: LookupFailureKind, httpStatus?: number) { super('書目來源失敗'); this.kind = kind; this.httpStatus = httpStatus }
}
const requestFailure = (reason: unknown): LookupFailureKind => reason instanceof Error && (reason.name === 'TimeoutError' || reason.name === 'AbortError') ? 'timeout' : 'network'
function diagnosticFailure(source: MetadataProvider, reason: unknown): MetadataDiagnostic {
 const error = reason instanceof MetadataUpstreamError || reason instanceof PublisherLookupError ? reason : undefined
 return { source, status: 'failed', count: 0, kind: error?.kind ?? 'format', ...(error?.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}) }
}
const headers = { 'Cache-Control': 'no-store' }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const strings = (value: unknown, max = 200): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(0, 10).map(x => x.trim().slice(0, max)).filter(Boolean) : []
const isbnOf = (value: unknown) => strings(value, 40).map(x => x.replace(/[\s-]/g, '')).find(x => /^(?:\d{13}|\d{9}[\dXx])$/.test(x)) ?? ''
async function limited(response: Response, maximum: number): Promise<ArrayBuffer> {
 if (!response.body || Number(response.headers.get('Content-Length')) > maximum) throw new Error('回應過大')
 const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0
 try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maximum) { await reader.cancel(); throw new Error('回應過大') }; parts.push(value) } } finally { reader.releaseLock() }
 const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length }; return bytes.buffer
}
/** Only recognize dimensions we can check without decoding in the Worker. */
function coverDimensions(buffer: ArrayBuffer): { width: number; height: number } | null {
 const b = new Uint8Array(buffer), view = new DataView(buffer)
 if (b.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
  const width = view.getUint32(16), height = view.getUint32(20)
  return width && height ? { width, height } : null
 }
 if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
 let offset = 2
 while (offset + 3 < b.length) {
  if (b[offset++] !== 0xff) return null
  while (b[offset] === 0xff) offset++
  const marker = b[offset++]
  if (marker === 0xda || marker === 0xd9 || offset + 2 > b.length) return null
  if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
  const length = view.getUint16(offset)
  if (length < 2 || offset + length > b.length) return null
  if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) {
   const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5)
   return width && height ? { width, height } : null
  }
  offset += length
 }
 return null
}
async function googleCover(id: string, fetcher: typeof fetch): Promise<Response> {
 const signal = AbortSignal.timeout(12000)
 const read = async (large: boolean) => {
  const target = 'https://books.google.com/books/content?' + new URLSearchParams({ id, printsec: 'frontcover', img: '1', zoom: large ? '0' : '1', ...(large ? { w: '800' } : {}), source: 'gbs_api' })
  const response = await fetcher(target, { signal, redirect: 'manual' })
  const mime = response.headers.get('Content-Type')?.split(';')[0]
  if (!response.ok || !mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('無法取得封面')
  return { bytes: await limited(response, 10 * 1024 * 1024), mime }
 }
 let image = await read(false)
 const original = coverDimensions(image.bytes)
 if (original && original.width < 800) {
  try {
   const larger = await read(true), size = coverDimensions(larger.bytes)
   // Google also returns HTTP 200 white PNG placeholders at the correct size.
   // Conservatively retain the original on format changes or reduced data,
   // as well as cropped banners. This does not attempt arbitrary image decoding.
   if (size && larger.mime === image.mime && larger.bytes.byteLength > image.bytes.byteLength
    && size.width > original.width && size.height > original.height
    && Math.abs(size.width * original.height / (size.height * original.width) - 1) <= .03) image = larger
  } catch { /* An unavailable larger image must not remove a usable cover. */ }
 }
 return new Response(image.bytes, { headers: { ...headers, 'Content-Type': image.mime, 'X-Content-Type-Options': 'nosniff' } })
}
async function json(url: URL | string, fetcher: typeof fetch, signal = AbortSignal.timeout(12000)): Promise<Record<string, unknown>> {
 let response: Response
 try { response = await fetcher(url, { signal, redirect: 'manual', headers: { Accept: 'application/json', 'User-Agent': 'ReadingCenter/1.0 (personal book lookup)' } }) } catch (reason) { throw new MetadataUpstreamError(requestFailure(reason)) }
 if (!response.ok) throw new MetadataUpstreamError('http', response.status)
 try {
  const body: unknown = JSON.parse(new TextDecoder().decode(await limited(response, 512000)))
  if (!body || typeof body !== 'object' || Array.isArray(body) || 'error' in body) throw new Error('format')
  return object(body)
 } catch (reason) { throw new MetadataUpstreamError(requestFailure(reason) === 'timeout' ? 'timeout' : 'format') }
}
async function openLibrary(title: string, author: string, fetcher: typeof fetch): Promise<BookMetadataCandidate[]> {
 const url = new URL('https://openlibrary.org/search.json'); url.search = new URLSearchParams({ title, ...(author ? { author } : {}), fields: 'key,title,editions,editions.key', limit: '5', lang: 'zh' }).toString()
 const search = await json(url, fetcher), docs = Array.isArray(search.docs) ? search.docs : []
 const ids = [...new Set(docs.slice(0, 5).flatMap(doc => {
  const editions = object(object(doc).editions).docs
  return Array.isArray(editions) ? editions.slice(0, 1).map(edition => text(object(edition).key)).filter(key => /^\/books\/OL\d+M$/.test(key)).map(key => key.slice(7)) : []
 }))]
 if (!ids.length) return []
 const detailUrl = new URL('https://openlibrary.org/api/books'); detailUrl.search = new URLSearchParams({ bibkeys: ids.map(id => 'OLID:' + id).join(','), format: 'json', jscmd: 'data' }).toString()
 const details = await json(detailUrl, fetcher)
 return ids.flatMap(id => {
  const book = object(details['OLID:' + id]), title = text(book.title)
  if (!title) return []
  const cover = text(object(book.cover).large, 1000)
  let coverUrl: string | null = null
  try { const parsed = new URL(cover); if (parsed.hostname === 'covers.openlibrary.org' && /^\/b\/(?:id|olid)\/[A-Za-z0-9-]+\.jpg$/.test(parsed.pathname)) coverUrl = parsed.pathname } catch { /* Missing cover is allowed. */ }
  const identifiers = object(book.identifiers)
  return [{ id: 'ol:' + id, source: 'Open Library' as const, title, authors: Array.isArray(book.authors) ? book.authors.slice(0, 10).map(value => text(object(value).name, 200)).filter(Boolean) : [], publisher: Array.isArray(book.publishers) ? book.publishers.slice(0, 1).map(value => text(object(value).name, 200)).join('') : '', isbn: isbnOf(identifiers.isbn_13) || isbnOf(identifiers.isbn_10), publishedOn: text(book.publish_date, 80), sourceUrl: 'https://openlibrary.org/books/' + id, coverUrl: coverUrl ? '/api/v1/books/metadata/cover?path=' + encodeURIComponent(coverUrl) : null }]
 })
}
export function parseGoogleVolumes(body: Record<string, unknown>): BookMetadataCandidate[] {
 return (Array.isArray(body.items) ? body.items : []).slice(0, 8).flatMap(item => {
  const volume = object(item), id = text(volume.id, 80), info = object(volume.volumeInfo), title = text(info.title)
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !title) return []
  const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : []
  const isbn = isbnOf(identifiers.filter(value => ['ISBN_13', 'ISBN_10'].includes(String(object(value).type))).map(value => object(value).identifier))
  // Unknown/encoding-placeholder authors are not names. Keep the book usable
  // without guessing a replacement or changing any previously saved authors.
  const authors = strings(info.authors).filter(name => !/^[?\uFFFD\s]+$/u.test(name.normalize('NFKC')))
  return [{ id: 'gb:' + id, source: 'Google Books' as const, title, authors, publisher: text(info.publisher, 200), isbn, publishedOn: text(info.publishedDate, 80), sourceUrl: 'https://books.google.com/books?id=' + id, coverUrl: object(info.imageLinks).thumbnail ? '/api/v1/books/metadata/cover?google=' + id : null }]
 })
}
export async function searchGoogleBooks(title: string, author: string, googleKey: string, fetcher: typeof fetch = fetch, steps?: GoogleSearchStep[]): Promise<BookMetadataCandidate[]> {
 // Both attempts share the original 12-second budget; no retry on source errors.
 const signal = AbortSignal.timeout(12000)
 const lookup = (query: string) => {
  const url = new URL('https://www.googleapis.com/books/v1/volumes')
  url.search = new URLSearchParams({ q: query, maxResults: '8', printType: 'books', key: googleKey }).toString()
  return json(url, fetcher, signal)
 }
 const body = await lookup('intitle:' + title + (author ? ' inauthor:' + author : ''))
 const initial = parseGoogleVolumes(body)
 const explicitZero = body.totalItems === 0 && (body.items === undefined || Array.isArray(body.items) && body.items.length === 0)
 steps?.push({ query: 'title', received: Array.isArray(body.items) ? Math.min(body.items.length, 8) : 0, parsed: initial.length, kept: initial.length, explicitZero })
 if (!explicitZero) return initial
 // Observed Chinese titles can have zero intitle results but valid ordinary q
 // results. Only retry an explicit source-empty response, never parser failures.
 const fallbackBody = await lookup([title, author].filter(Boolean).join(' '))
 const fallback = parseGoogleVolumes(fallbackBody)
 const titleKey = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
 const queryKey = titleKey(title)
 const kept = fallback.filter(candidate => Boolean(queryKey) && titleKey(candidate.title).includes(queryKey))
 steps?.push({ query: 'general', received: Array.isArray(fallbackBody.items) ? Math.min(fallbackBody.items.length, 8) : 0, parsed: fallback.length, kept: kept.length, explicitZero: fallbackBody.totalItems === 0 && (fallbackBody.items === undefined || Array.isArray(fallbackBody.items) && fallbackBody.items.length === 0) })
 return kept
}
/** Authenticated caller. Search/preview only; no book or cover-storage writes. */
export async function handleBookMetadataSearch(request: Request, googleKey?: string, fetcher: typeof fetch = fetch): Promise<Response> {
 const fail = (message: string, status: number, diagnostics?: MetadataDiagnostic[]) => Response.json({ error: { message }, ...(diagnostics ? { diagnostics } : {}) }, { status, headers })
 if (request.method !== 'GET') return fail('只支援搜尋與預覽', 405)
 const url = new URL(request.url)
 try {
  if (url.pathname === '/api/v1/books/metadata/cover') {
   const google = url.searchParams.get('google'), path = url.searchParams.get('path'), publisher = url.searchParams.get('publisher'), pubu = url.searchParams.get('pubu'), kadokawa = url.searchParams.get('kadokawa')
   let upstream: string
   if (kadokawa && kadokawaCoverPath.test(kadokawa)) upstream = 'https://img.shoplineapp.com' + kadokawa
   else if (pubu && pubuCoverPath.test(pubu)) upstream = 'https://res2.pubu.tw' + pubu
   else if (publisher && /^pic_\d+_\d+_[a-z0-9]+\.(jpg|png|webp)$/.test(publisher)) upstream = 'https://www.bookrepclub.com.tw/webroot/file/book/' + publisher
   else if (google && /^[A-Za-z0-9_-]{1,80}$/.test(google)) return await googleCover(google, fetcher)
   else if (path && /^\/b\/(?:id|olid)\/[A-Za-z0-9-]+\.jpg$/.test(path)) upstream = 'https://covers.openlibrary.org' + path + '?default=false'
   else return fail('封面識別無效', 400)
   const response = await fetcher(upstream, { signal: AbortSignal.timeout(12000), redirect: 'manual' })
   const mime = response.headers.get('Content-Type')?.split(';')[0]
   if (!response.ok || !mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return fail('無法取得候選封面，可改用手動上傳', 502)
   return new Response(await limited(response, 10 * 1024 * 1024), { headers: { ...headers, 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' } })
  }
  const title = (url.searchParams.get('title') ?? '').trim(), author = (url.searchParams.get('author') ?? '').trim()
  const source = url.searchParams.get('source') ?? 'taiwan'
  if (!['taiwan', 'openlibrary', 'pubu', 'kadokawa'].includes(source)) return fail('書目來源無效', 400)
  const readHtml = async (target: URL | string, maximum = 1500000) => {
   let response: Response
   try { response = await fetcher(target, { signal: AbortSignal.timeout(15000), redirect: 'manual', headers: { 'User-Agent': 'ReadingCenter/1.0 (personal book lookup)', Accept: 'text/html' } }) } catch (reason) { throw new PublisherLookupError(requestFailure(reason)) }
   // This exact public destination was verified as the publisher's maintenance
   // notice on 2026-10-27. Recognize it without following any redirect.
   if (new URL(target).hostname === 'www.bookrep.com.tw' && response.status === 302
    && response.headers.get('Location') === 'https://event.bookrep.com.tw/activity/20261022/index.html') throw new PublisherLookupError('maintenance')
   if (!response.ok) throw new PublisherLookupError('http', response.status)
   try { return new TextDecoder().decode(await limited(response, maximum)) } catch (reason) { throw new PublisherLookupError(requestFailure(reason) === 'timeout' ? 'timeout' : 'format') }
  }
  if (source === 'pubu') {
   const id = pubuBookId(url.searchParams.get('url') ?? '')
   if (!id) return fail('請貼上 https://www.pubu.com.tw/ebook/數字 的書頁網址', 400)
   try {
    const candidate = parsePubuBook(await readHtml('https://www.pubu.com.tw/ebook/' + id), id)
    return Response.json({ data: [candidate], partial: false, diagnostics: [{ source: 'Pubu', status: 'ok', count: 1 }] }, { headers })
   } catch (reason) { return fail('Pubu 書目查詢失敗，請查看來源狀態或稍後重試。', 502, [diagnosticFailure('Pubu', reason)]) }
  }
  if (!title || title.length > 300 || author.length > 200) return fail('請輸入有效書名；作者可留白', 400)
  const kadokawa = () => searchKadokawa(title, author, target => readHtml(target, 2000000))
  const providers: MetadataProvider[] = source === 'taiwan' ? ['讀書共和國', '台灣角川'] : [source === 'kadokawa' ? '台灣角川' : 'Open Library']
  const tasks: Promise<BookMetadataCandidate[]>[] = source === 'taiwan' ? [searchTaiwanPublisher(title, author, readHtml), kadokawa()] : [source === 'kadokawa' ? kadokawa() : openLibrary(title, author, fetcher)]
  const googleSteps: GoogleSearchStep[] = []
  if (googleKey) { providers.push('Google Books'); tasks.push(searchGoogleBooks(title, author, googleKey, fetcher, googleSteps)) }
  const results = await Promise.allSettled(tasks), candidates = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const diagnostics: MetadataDiagnostic[] = results.map((result, index) => {
   const diagnostic: MetadataDiagnostic = result.status === 'fulfilled'
    ? { source: providers[index], status: result.value.length ? 'ok' : 'empty', count: result.value.length }
    : diagnosticFailure(providers[index], result.reason)
   return providers[index] === 'Google Books' && googleSteps.length ? { ...diagnostic, steps: googleSteps } : diagnostic
  })
  if (!googleKey) diagnostics.push({ source: 'Google Books', status: 'disabled', count: 0 })
  if (results.every(result => result.status === 'rejected')) {
   const failure = results[0]
   return fail(failure.status === 'rejected' && failure.reason instanceof PublisherLookupError ? failure.reason.message : '書籍搜尋來源暫時無法使用，可手動編輯或開啟網頁搜尋', 502, diagnostics)
  }
  const warnings = results.flatMap(result => result.status === 'rejected' ? [result.reason instanceof PublisherLookupError ? result.reason.message : '部分書目來源暫時無法使用。'] : [])
  return Response.json({ data: candidates, diagnostics, ...(!googleKey ? { warning: 'Google Books 尚未啟用；目前僅查詢所選來源。' } : {}), partial: warnings.length > 0, ...(warnings.length ? { warnings } : {}) }, { headers })
 } catch { return fail('搜尋或封面預覽失敗，請稍後重試', 502) }
}
