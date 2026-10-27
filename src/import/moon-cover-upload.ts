import type { Book, BookCover } from '../domain'

export async function uploadMoonCover(book: Book, blob: Blob): Promise<BookCover> {
  const response = await fetch('/api/v1/covers/moon', {
    method: 'POST', credentials: 'include', body: blob,
    headers: { 'Content-Type': blob.type, 'X-Book-Id': book.id, 'X-Book-Title': encodeURIComponent(book.title) }
  })
  if (!response.ok) throw new Error(`封面上傳失敗（${response.status}）`)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || !('data' in body) || !body.data || typeof body.data !== 'object' || !('cover' in body.data)) throw new Error('封面回應無效')
  const cover = body.data.cover
  if (!cover || typeof cover !== 'object' || !('path' in cover) || typeof cover.path !== 'string' || !cover.path.startsWith('/api/v1/covers/covers/') || !('mimeType' in cover) || !['image/jpeg', 'image/png', 'image/webp'].includes(String(cover.mimeType))) throw new Error('封面回應無效')
  return { path: cover.path, mimeType: cover.mimeType as BookCover['mimeType'] }
}
