import { handleBookMetadataSearch } from './book-metadata-search'

// Standalone preview adapter. This preview has no D1/KV bindings and cannot save books.
const appOrigin = 'https://preview.example.invalid'
const authPaths = new Set(['/api/v1/auth/login', '/api/v1/auth/logout'])
const metadataPaths = new Set(['/api/v1/books/metadata', '/api/v1/books/metadata/cover'])

interface PreviewEnv { GOOGLE_BOOKS_API_KEY?: string }

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function handleMetadataReviewPreview(request: Request, env: PreviewEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url)
  const isRead = request.method === 'GET' || request.method === 'HEAD'
  const isLogin = request.method === 'POST' && authPaths.has(url.pathname)
  if (!isRead && !isLogin) return error(405, 'preview_read_only', '此預覽只供查詢與核對，不儲存書籍、閱讀紀錄或封面')
  if (isLogin && request.headers.get('Origin') !== url.origin) return error(403, 'invalid_origin', '請從此預覽頁面登入')
  if (url.pathname.startsWith('/api/') && !metadataPaths.has(url.pathname)
    && !authPaths.has(url.pathname) && url.pathname !== '/api/v1/auth/session'
    && !url.pathname.startsWith('/api/v1/entities/') && !url.pathname.startsWith('/api/v1/covers/')) {
    return error(404, 'preview_route_unavailable', '此預覽不提供這項操作')
  }
  try {
    const headers = new Headers()
    for (const name of ['Accept', 'Content-Type', 'Cookie']) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    if (metadataPaths.has(url.pathname)) {
      if (request.method !== 'GET') return error(405, 'method_not_allowed', '只支援查詢與預覽')
      const session = await fetcher(appOrigin + '/api/v1/auth/session', {
        headers, redirect: 'manual', signal: AbortSignal.timeout(12000)
      })
      if (!session.ok) return error(503, 'auth_unavailable', '目前無法驗證登入')
      const payload = await session.json() as { data?: { authenticated?: boolean } }
      if (payload.data?.authenticated !== true) return error(401, 'authentication_required', '請先登入')
      if (!env.GOOGLE_BOOKS_API_KEY) return error(503, 'google_not_configured', '此預覽尚未帶入 Google Books 金鑰')
      return handleBookMetadataSearch(request, env.GOOGLE_BOOKS_API_KEY, fetcher)
    }
    const upstream = new URL(appOrigin)
    upstream.pathname = url.pathname
    upstream.search = url.search
    const response = await fetcher(upstream, {
      method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(20000),
      ...(isLogin ? { body: await request.arrayBuffer() } : {})
    })
    if (response.status >= 300 && response.status < 400) return error(502, 'unexpected_redirect', '預覽來源回傳非預期轉址')
    if (request.method !== 'HEAD' && response.ok && (url.pathname === '/api/v1/auth/session' || isLogin)) {
      const payload = await response.json() as { data?: { authenticated?: boolean; expiresAt?: string } }
      if (typeof payload.data?.authenticated !== 'boolean') return error(502, 'invalid_auth_response', '預覽登入回應無效')
      const responseHeaders = new Headers(response.headers)
      responseHeaders.delete('Content-Length'); responseHeaders.delete('Content-Encoding')
      responseHeaders.set('Content-Type', 'application/json'); responseHeaders.set('Cache-Control', 'no-store')
      return new Response(JSON.stringify({ data: { ...payload.data, previewReadOnly: true } }), { status: response.status, headers: responseHeaders })
    }
    return response
  } catch { return error(502, 'preview_upstream_unavailable', '預覽來源暫時無法使用') }
}

export default {
  fetch(request: Request, env: PreviewEnv): Promise<Response> {
    return handleMetadataReviewPreview(request, env)
  }
}
