import Dexie, { type Table } from 'dexie'
import { emptyPhotoReading, type PhotoReadingDraft } from './photo-reading'
import { preparePhoto, type PhotoBookDraft } from './photo-book'
export const emptyPhotoDraft: PhotoBookDraft = { title: '', author: '', publisher: '', isbn: '', visibleText: '' }
export interface PhotoBookCandidate { id: string; draft: PhotoBookDraft; source: string; mediaType: string; bookId: string | null; allowSameTitle: boolean; savedBookId: string | null; status: 'pending' | 'saved' | 'ignored'; variant?: string; reading?: PhotoReadingDraft; savedReadingCycleId?: string }
export interface PhotoReviewItem {
 id: string; hash: string; filename: string; createdAt: string; image: Blob | ArrayBuffer | null
 status: 'pending' | 'ready' | 'error' | 'saved'; draft: PhotoBookDraft; source: string; mediaType: string
 bookId: string | null; allowSameTitle: boolean; error: string; savedBookId: string | null; candidates?: PhotoBookCandidate[]; reading?: PhotoReadingDraft; savedReadingCycleId?: string
}
export class PhotoReviewQueue extends Dexie {
 items!: Table<PhotoReviewItem, string>
 constructor(name = 'reading-center-photo-review') { super(name); this.version(1).stores({ items: 'id, &hash, createdAt, status' }) }
 async list() { return this.items.orderBy('createdAt').toArray() }
 async add(file: File, source = '其他'): Promise<{ id: string; duplicate: boolean }> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || !file.size || file.size > 15 * 1024 * 1024) throw new Error('請選擇 15 MB 以內的 JPEG、PNG 或 WebP 圖片')
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const known = await this.items.where('hash').equals(hash).first()
  if (known) return { id: known.id, duplicate: true }
  if (await this.items.where('status').notEqual('saved').count() >= 20) throw new Error('待確認匣最多保留 20 張圖片，請先確認或移除部分項目')
  const prepared = await preparePhoto(file)
  const image = await photoBytes(prepared)
  return this.transaction('rw', this.items, async () => {
   const repeated = await this.items.where('hash').equals(hash).first()
   if (repeated) return { id: repeated.id, duplicate: true }
   if (await this.items.where('status').notEqual('saved').count() >= 20) throw new Error('待確認匣最多保留 20 張圖片，請先確認或移除部分項目')
   const id = crypto.randomUUID()
   await this.items.add({ id, hash, filename: file.name, createdAt: new Date().toISOString(), image, status: 'pending', draft: { ...emptyPhotoDraft }, source, mediaType: 'ebook', bookId: null, allowSameTitle: false, error: '', savedBookId: null })
   return { id, duplicate: false }
  })
 }
 async patch(id: string, changes: Partial<Pick<PhotoReviewItem, 'draft' | 'source' | 'mediaType' | 'bookId' | 'allowSameTitle' | 'status' | 'error' | 'savedBookId' | 'image'>>) {
  if (!await this.items.update(id, changes)) throw new Error('待確認項目已不存在，請重新載入')
 }
 async setCandidates(id: string, drafts: PhotoBookDraft[]) {
  await this.transaction('rw', this.items, async () => {
   const item = await this.items.get(id); if (!item) throw new Error('待確認項目已不存在')
   if (item.candidates?.some(candidate => candidate.status === 'saved')) throw new Error('已有確認的候選，請保留目前結果')
   const candidates = drafts.map((draft, index) => {
    const duplicateTitle = drafts.filter(other => other.title.normalize('NFKC').replace(/\s/g,'').toLowerCase() === draft.title.normalize('NFKC').replace(/\s/g,'').toLowerCase()).length > 1
    const editionKey = (value: PhotoBookDraft) => value.isbn.replace(/[\s-]/g,'') || value.author.normalize('NFKC').trim()
    const publisherVariant = drafts.some((other, otherIndex) => otherIndex !== index && other.title.normalize('NFKC').replace(/\s/g,'').toLowerCase() === draft.title.normalize('NFKC').replace(/\s/g,'').toLowerCase() && editionKey(other) === editionKey(draft) && other.publisher.normalize('NFKC').trim() !== draft.publisher.normalize('NFKC').trim())
    const variant = `variant:${editionKey(draft) || index}${publisherVariant ? `:publisher:${JSON.stringify(draft.publisher.normalize('NFKC').trim())}` : ''}`
    return { id: `${id}:${index}`, draft, source: item.source, mediaType: item.mediaType, bookId: null, allowSameTitle: false, savedBookId: null, status: 'pending' as const, reading: { ...emptyPhotoReading, progressPercent: draft.progressPercent ?? '', startedOn: draft.startedOn ?? '', lastReadOn: draft.lastReadOn ?? '', status: draft.completedOn || !draft.startedOn && !draft.lastReadOn && !draft.progressPercent?.trim() ? 'completed' as const : 'reading' as const, completedOn: draft.completedOn ?? '', totalMinutes: draft.totalMinutes ?? '' }, ...(duplicateTitle ? { variant } : {}) }
   })
   await this.items.update(id, { candidates, draft: drafts[0] ?? { ...emptyPhotoDraft }, status: 'ready', error: drafts.length ? '' : '未辨識到清楚書名，可手動填寫或重新選圖' })
  })
 }
 async patchCandidate(id: string, candidateId: string, changes: Partial<PhotoBookCandidate>) {
  await this.transaction('rw', this.items, async () => {
   const item = await this.items.get(id), candidate = item?.candidates?.find(candidate => candidate.id === candidateId)
   if (!item || !candidate) throw new Error('書籍候選已不存在，請重新載入')
   if (candidate.status !== 'pending') throw new Error('已完成或略過的候選不能再修改')
   const candidates = item.candidates!.map(value => value.id === candidateId ? { ...value, ...changes, id: value.id } : value)
   const complete = candidates.every(candidate => candidate.status !== 'pending')
   await this.items.update(id, { candidates, status: complete ? 'saved' : 'ready', image: complete ? null : item.image, error: '' })
  })
 }
 async patchReading(id: string, candidateId: string | undefined, reading: PhotoReadingDraft, savedReadingCycleId?: string) {
  await this.transaction('rw', this.items, async () => {
   const item = await this.items.get(id)
   if (!item) throw new Error('待確認項目已不存在')
   if (candidateId) {
    const candidate = item.candidates?.find(value => value.id === candidateId)
    if (!candidate || candidate.status === 'ignored' || candidate.savedReadingCycleId) throw new Error('此候選無法補登閱讀紀錄')
    await this.items.update(id, { candidates: item.candidates!.map(value => value.id === candidateId ? { ...value, reading, ...(savedReadingCycleId ? { savedReadingCycleId } : {}) } : value) })
   } else {
    if (item.savedReadingCycleId) throw new Error('此圖片已補登閱讀紀錄')
    await this.items.update(id, { reading, ...(savedReadingCycleId ? { savedReadingCycleId } : {}) })
   }
  })
 }
 async finish(id: string, bookId: string, candidateId?: string) {
  if (candidateId) await this.patchCandidate(id, candidateId, { status: 'saved', savedBookId: bookId })
  else await this.patch(id, { status: 'saved', savedBookId: bookId, image: null, error: '' })
 }
 async remove(id: string) { await this.items.delete(id) }
}
export const photoReviewQueue = new PhotoReviewQueue()
export class PhotoRecognitionError extends Error { constructor(message: string, readonly status = 0) { super(message) } }
export async function recognizeQueuedPhoto(image: Blob, signal?: AbortSignal, request: typeof fetch = fetch): Promise<PhotoBookDraft[]> {
 let response: Response, body: unknown
 try { response = await request('/api/v1/import/photo/book', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Mode': 'multiple' }, body: image, signal }); body = await response.json() } catch { throw new PhotoRecognitionError('無法連線或讀取辨識結果，請稍後重試') }
 if (!response.ok) {
  const message = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'message' in body.error && typeof body.error.message === 'string' ? body.error.message : '辨識失敗，請重試'
  throw new PhotoRecognitionError(message, response.status)
 }
 const data = body && typeof body === 'object' && 'data' in body ? body.data : null
 if (!data || typeof data !== 'object') throw new PhotoRecognitionError('辨識回應無效')
 const raw = 'books' in data ? (data as { books: unknown }).books : [data]
 if (!Array.isArray(raw) || raw.length > 10) throw new PhotoRecognitionError('辨識書籍清單無效')
 const seen = new Set<string>(), books: PhotoBookDraft[] = []
 const limits = { title: 300, author: 200, publisher: 200, isbn: 40, visibleText: 2000 }
 for (const item of raw) {
  if (!item || typeof item !== 'object') throw new PhotoRecognitionError('辨識回應無效')
  for (const [key, maximum] of Object.entries(limits)) { const value = (item as Record<string, unknown>)[key]; if (typeof value !== 'string' || value.length > maximum) throw new PhotoRecognitionError('辨識回應無效') }
  const book: PhotoBookDraft = { title: String(item.title).trim(), author: String(item.author).trim(), publisher: String(item.publisher).trim(), isbn: String(item.isbn).trim(), visibleText: String(item.visibleText).trim() }
  for (const [key, maximum] of [['progressPercent', 16], ['startedOn', 10], ['lastReadOn', 10], ['completedOn', 10], ['totalMinutes', 12]] as const) {
   const value = (item as Record<string, unknown>)[key]
   if (value !== undefined) { if (typeof value !== 'string' || value.length > maximum) throw new PhotoRecognitionError('閱讀辨識回應無效'); book[key] = value.trim() }
  }
  const key = JSON.stringify([book.title.normalize('NFKC').replace(/\s/g,'').toLowerCase(), book.author.normalize('NFKC').trim(), book.isbn.replace(/[\s-]/g,''), book.publisher.normalize('NFKC').trim()])
  if (!seen.has(key)) { books.push(book); seen.add(key) }
 }
 return books
}

export function photoImage(value: Blob | ArrayBuffer): Blob { return value instanceof Blob ? value : new Blob([value], { type: 'image/jpeg' }) }
async function photoBytes(blob: Blob): Promise<ArrayBuffer> {
 if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
 return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('照片內容無法保存')); reader.onerror = () => reject(new Error('照片內容無法保存')); reader.readAsArrayBuffer(blob) })
}
