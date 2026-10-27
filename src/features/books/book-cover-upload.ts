import type { Book, BookCover } from '../../domain'

export function validateCoverFile(file: File): void {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('請選擇 JPEG、PNG 或 WebP 圖片')
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('封面圖片需介於 1 位元組與 10 MB')
}

export async function uploadBookCover(book: Pick<Book, 'id' | 'title'>, file: File): Promise<BookCover> {
  validateCoverFile(file)
  const image = await createImageBitmap(file)
  let blob: Blob
  let width: number, height: number
  try {
    if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error('圖片尺寸過大，請選擇較小的圖片')
    const scale = Math.min(1, 1400 / image.width, 2000 / image.height)
    width = Math.max(1, Math.round(image.width * scale)); height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('無法處理封面圖片')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('無法轉換封面圖片')), 'image/jpeg', .88))
  } finally { image.close() }
  const response = await fetch('/api/v1/covers/manual', { method: 'POST', credentials: 'include', body: blob,
    headers: { 'Content-Type': blob.type, 'X-Book-Id': book.id, 'X-Book-Title': encodeURIComponent(book.title) } })
  if (!response.ok) {
    if (response.status === 405) {
      const body = await response.json().catch(() => null) as { error?: { code?: string } } | null
      if (body?.error?.code === 'preview_read_only') throw new Error('此預覽僅供核對，無法上傳封面；目前選擇尚未儲存')
    }
    throw new Error(`封面上傳失敗（${response.status}），請重試`)
  }
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('data' in data) || !data.data || typeof data.data !== 'object' || !('cover' in data.data)) throw new Error('封面回應無效')
  const cover = data.data.cover
  if (!cover || typeof cover !== 'object' || !('path' in cover) || typeof cover.path !== 'string' || !cover.path.startsWith('/api/v1/covers/covers/') || !('mimeType' in cover) || cover.mimeType !== 'image/jpeg') throw new Error('封面回應無效')
  return { path: cover.path, mimeType: 'image/jpeg', width, height }
}
