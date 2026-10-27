import type { BookCover } from '../src/domain/book'
import type { CoverKV } from './cloudflare-types'

const noStore = { 'Cache-Control': 'no-store' }
const maximumBytes = 10 * 1024 * 1024
const bookIdPattern = /^notion:book:[0-9a-f]{64}:\d+$/
const moonBookIdPattern = /^(?:notion:book:[0-9a-f]{64}:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const coverPattern = /^covers\/((?:notion%3Abook%3A[0-9a-f]{64}%3A\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))\/([0-9a-f]{64})-([^/]{1,160})\.(jpg|png|webp|avif)$/

/** Called after Worker session authentication; writes immutable, versioned cover keys. */
export async function handleCoverAssetApi(request: Request, kv: CoverKV | undefined, importEnabled: boolean): Promise<Response> {
  if (!kv) return jsonError('cover_storage_unavailable', 503)
  const url = new URL(request.url)
  if (request.method === 'POST' && ['/api/v1/covers/notion', '/api/v1/covers/moon', '/api/v1/covers/manual'].includes(url.pathname)) {
    if (url.pathname.endsWith('/notion') && !importEnabled) return jsonError('import_disabled', 503)
    const bookId = request.headers.get('X-Book-Id') ?? ''
    const encodedTitle = request.headers.get('X-Book-Title') ?? ''
    let title: string
    try { title = decodeURIComponent(encodedTitle) } catch { return jsonError('invalid_cover_title', 400) }
    if (!(url.pathname.endsWith('/notion') ? bookIdPattern : moonBookIdPattern).test(bookId) || !title.trim() || title.length > 300) return jsonError('invalid_cover_identity', 400)
    const mimeType = request.headers.get('Content-Type')
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp' && mimeType !== 'image/avif') return jsonError('invalid_cover_type', 415)
    const length = Number(request.headers.get('Content-Length'))
    if (length > maximumBytes) return jsonError('cover_too_large', 413)
    let bytes: ArrayBuffer
    try { bytes = await request.arrayBuffer() } catch { return jsonError('invalid_cover_bytes', 400) }
    if (!bytes.byteLength || bytes.byteLength > maximumBytes) return jsonError('cover_too_large', 413)
    if (!matchesImageSignature(new Uint8Array(bytes), mimeType)) return jsonError('invalid_cover_signature', 415)
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]
    let readableTitle = ''
    for (const char of title.normalize('NFC')) {
      if (char === '/' || char === '\\' || char.codePointAt(0)! < 32) continue
      if (encodeURIComponent(readableTitle + char).length > 120) break
      readableTitle += char
    }
    const slug = encodeURIComponent(readableTitle.trim())
    if (!slug) return jsonError('invalid_cover_title', 400)
    const key = `covers/${encodeURIComponent(bookId)}/${sha256}-${slug}.${extension}`
    try { await kv.put(key, bytes) }
    catch { return jsonError('cover_storage_failed', 503) }
    const cover: BookCover = { path: `/api/v1/covers/${key}`, mimeType }
    return Response.json({ data: { cover, sha256, bytes: bytes.byteLength } }, { status: 201, headers: noStore })
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/v1/covers/covers/')) {
    const key = url.pathname.slice('/api/v1/covers/'.length)
    const match = coverPattern.exec(key)
    if (!match) return jsonError('invalid_cover_path', 404)
    const mimeType = match[4] === 'jpg' ? 'image/jpeg' : `image/${match[4]}`
    const bytes = await kv.get(key, 'arrayBuffer')
    if (!bytes) return jsonError('cover_not_found', 404)
    return new Response(bytes, { headers: { 'Content-Type': mimeType, 'Content-Length': String(bytes.byteLength),
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable' } })
  }
  return jsonError('cover_route_not_found', 404)
}

export async function verifyStoredPilotCover(kv: CoverKV | undefined, bookId: string, cover: BookCover): Promise<void> {
  const path = `/api/v1/covers/`
  const match = cover.path.startsWith(path) ? coverPattern.exec(cover.path.slice(path.length)) : null
  if (!match || decodeURIComponent(match[1]) !== bookId ||
    cover.mimeType !== (match[4] === 'jpg' ? 'image/jpeg' : `image/${match[4]}`)) throw new Error('Pilot cover path does not belong to the book')
  if (!kv) throw new Error('Pilot cover storage is not configured')
  const image = await kv.get(cover.path.slice(path.length), 'arrayBuffer')
  if (!image || image.byteLength > maximumBytes) throw new Error('Pilot cover asset is missing')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', image)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== match[2]) throw new Error('Pilot cover checksum differs from its path')
}

function matchesImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
  if (mimeType === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part)
  if (mimeType === 'image/webp') return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  return bytes.length >= 16 && new TextDecoder().decode(bytes.slice(4, 12)) === 'ftypavif'
}

function jsonError(code: string, status: number): Response {
  return Response.json({ error: { code, message: code.replaceAll('_', ' ') } }, { status, headers: noStore })
}

