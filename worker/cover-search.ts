import type { CoverSearchCandidate } from '../src/domain/cover-search'
import type { CoverKV } from './cloudflare-types'
const noStore = { 'Cache-Control': 'no-store' }
const failure = (message: string, status = 502) => Response.json({ error: { message } }, { status, headers: noStore })

async function readLimited(response: Response, limit: number): Promise<ArrayBuffer> {
  if (Number(response.headers.get('Content-Length')) > limit || !response.body) throw new Error('來源回應過大或沒有內容')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error('來源回應過大') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes.buffer
}

/** Authenticated routes; only the fixed public API and numeric cover IDs are fetched. */
export async function handleCoverSearch(request: Request, kv?: CoverKV, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'GET') return failure('只支援搜尋與預覽', 405)
  const url = new URL(request.url)
  try {
    if (url.pathname.startsWith('/api/v1/covers/search/image/')) {
      const id = url.pathname.slice('/api/v1/covers/search/image/'.length)
      if (!/^[1-9]\d{0,12}$/.test(id)) return failure('無效封面識別', 400)
      const response = await fetcher(`https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'ReadingCenter/1.0 (personal book lookup)' } })
      if (!response.ok) return failure('此候選封面無法取得，請選另一張', response.status === 404 ? 404 : 502)
      const mime = response.headers.get('Content-Type')?.split(';')[0]
      if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return failure('來源不是支援的圖片')
      const bytes = await readLimited(response, 10 * 1024 * 1024)
      return new Response(bytes, { headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' } })
    }
    if (url.pathname !== '/api/v1/covers/search') return failure('找不到搜尋功能', 404)
    const title = (url.searchParams.get('title') ?? '').trim(), author = (url.searchParams.get('author') ?? '').trim()
    const isbn = (url.searchParams.get('isbn') ?? '').replace(/[\s-]/g, '')
    if ((!title && !isbn) || title.length > 300 || author.length > 300 || isbn && !/^(?:\d{9}[\dXx]|\d{13})$/.test(isbn)) return failure('請輸入有效書名或 ISBN', 400)
    const upstream = new URL('https://openlibrary.org/search.json')
    if (isbn) upstream.searchParams.set('q', `isbn:${isbn}`)
    else { upstream.searchParams.set('title', title); if (author) upstream.searchParams.set('author', author) }
    upstream.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year,edition_count')
    upstream.searchParams.set('limit', '12'); upstream.searchParams.set('lang', 'zh')
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(upstream.toString()))), byte => byte.toString(16).padStart(2, '0')).join('')
    const cacheKey = `cover-search:v1:${hash}`
    if (kv) {
      try {
        const cached = await kv.get(cacheKey, 'arrayBuffer')
        if (cached && cached.byteLength < 128000) { const value = JSON.parse(new TextDecoder().decode(cached)); if (value.expires > Date.now() && Array.isArray(value.candidates)) return Response.json({ data: value.candidates }, { headers: noStore }) }
      } catch { /* A cache failure does not block a user-requested search. */ }
    }
    const response = await fetcher(upstream, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'ReadingCenter/1.0 (personal book lookup)', Accept: 'application/json' } })
    if (!response.ok) return failure(response.status === 429 ? '搜尋來源暫時限流，請稍後重試' : '搜尋來源暫時無法使用', response.status === 429 ? 429 : 502)
    const body: unknown = JSON.parse(new TextDecoder().decode(await readLimited(response, 256000)))
    if (!body || typeof body !== 'object' || !('docs' in body) || !Array.isArray(body.docs)) return failure('搜尋來源格式無效')
    const candidates: CoverSearchCandidate[] = [], seen = new Set<number>()
    for (const doc of body.docs) {
      if (!doc || typeof doc !== 'object' || !Number.isSafeInteger(doc.cover_i) || doc.cover_i < 1 || typeof doc.title !== 'string' || typeof doc.key !== 'string' || !/^\/works\/OL\d+W$/.test(doc.key) || seen.has(doc.cover_i)) continue
      seen.add(doc.cover_i)
      candidates.push({ coverId: doc.cover_i, title: doc.title.slice(0, 300), authors: Array.isArray(doc.author_name) ? doc.author_name.filter((name: unknown): name is string => typeof name === 'string').slice(0, 5).map((name: string) => name.slice(0, 150)) : [], firstPublishedYear: Number.isInteger(doc.first_publish_year) ? doc.first_publish_year : null, editionCount: Number.isInteger(doc.edition_count) ? doc.edition_count : null, previewUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg?default=false`, sourceUrl: `https://openlibrary.org${doc.key}` })
      if (candidates.length === 8) break
    }
    if (kv) try { await kv.put(cacheKey, new TextEncoder().encode(JSON.stringify({ expires: Date.now() + 10 * 60_000, candidates })).buffer) } catch { /* Cache writes are optional. */ }
    return Response.json({ data: candidates }, { headers: noStore })
  } catch { return failure('封面搜尋或下載失敗，請稍後重試或手動上傳') }
}
