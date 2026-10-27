import { describe, expect, it, vi } from 'vitest'
import { handleMetadataReviewPreview } from '../../worker/metadata-review-preview'

const origin = 'https://preview.example'
describe('read-only metadata review preview', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'blocks %s book, reading record and cover writes before contacting upstream', async method => {
      const fetcher = vi.fn()
      for (const path of ['/api/v1/entities/work', '/api/v1/entities/activityLog', '/api/v1/covers/upload']) {
        expect((await handleMetadataReviewPreview(new Request(origin + path, { method }), {}, fetcher)).status).toBe(405)
      }
      expect(fetcher).not.toHaveBeenCalled()
    })
  it('rejects cross-origin login without sending credentials upstream', async () => {
    const fetcher = vi.fn()
    const response = await handleMetadataReviewPreview(new Request(origin + '/api/v1/auth/login', {
      method: 'POST', headers: { Origin: 'https://other.example' }, body: '{}'
    }), {}, fetcher)
    expect(response.status).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([false, 'true', undefined])('does not search for an unverified session (%s)', async authenticated => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { authenticated } }))
    const response = await handleMetadataReviewPreview(new Request(origin + '/api/v1/books/metadata?title=中文書'), { GOOGLE_BOOKS_API_KEY: 'test-key' }, fetcher)
    expect(response.status).toBe(401)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('queries actual handler only after authentication; key is sent only to Google', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(init?.redirect).toBe('manual')
      if (url.pathname === '/api/v1/auth/session') return Response.json({ data: { authenticated: true } })
      if (url.hostname === 'openlibrary.org') { expect(url.searchParams.has('key')).toBe(false); return Response.json({ docs: [] }) }
      expect(url.hostname).toBe('www.googleapis.com')
      expect(url.searchParams.get('key')).toBe('test-key')
      expect(new Headers(init?.headers).has('Cookie')).toBe(false)
      return Response.json({ items: [{ id: 'book123', volumeInfo: { title: '中文書', authors: ['作者'], publisher: '出版社' } }] })
    })
    const response = await handleMetadataReviewPreview(new Request(origin + '/api/v1/books/metadata?title=中文書&source=openlibrary', { headers: { Cookie: 'readingcenter_session=test-token' } }), { GOOGLE_BOOKS_API_KEY: 'test-key' }, fetcher)
    expect(response.status).toBe(200)
    expect((await response.json()).data[0]).toMatchObject({ source: 'Google Books', title: '中文書' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('does not proxy OAuth or import routes', async () => {
    const fetcher = vi.fn()
    expect((await handleMetadataReviewPreview(new Request(origin + '/api/v1/onedrive/connect'), {}, fetcher)).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps the fixed upstream host even for a double-slash path', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).hostname).toBe('preview.example.invalid')
      return new Response('ok')
    })
    expect((await handleMetadataReviewPreview(new Request(origin + '//other.example/path'), {}, fetcher)).status).toBe(200)
  })
})

it.each(['/api/v1/auth/session', '/api/v1/auth/login'])('marks %s read-only without losing authentication or session cookies', async path => {
 const fetcher = vi.fn(async () => Response.json({ data: { authenticated: true, expiresAt: '2026-10-20T00:00:00Z' } }, { headers: { 'Set-Cookie': 'readingcenter_session=test; HttpOnly; Secure; Path=/' } }))
 const response = await handleMetadataReviewPreview(new Request(origin + path, path.endsWith('login') ? { method: 'POST', headers: { Origin: origin }, body: '{}' } : undefined), {}, fetcher)
 expect(await response.json()).toMatchObject({ data: { authenticated: true, previewReadOnly: true } })
 expect(response.headers.get('Set-Cookie')).toContain('HttpOnly')
 expect(response.headers.get('Cache-Control')).toBe('no-store')
})
