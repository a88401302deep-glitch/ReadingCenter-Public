import { assertValidBook, createMetadata, updateEntity, type Book, type DictionaryEntry } from '../domain'
import { isMetadataSourceUrl } from '../domain/book-metadata'
import type { ReadingCenterRepositories } from '../data'
export interface PhotoBookDraft { title: string; author: string; publisher: string; isbn: string; visibleText: string; progressPercent?: string; startedOn?: string; lastReadOn?: string; completedOn?: string; totalMinutes?: string; authors?: string[]; metadataSourceUrl?: string; publishedOn?: string }
export const photoTitleKey = (title: string) => title.normalize('NFKC').trim().replace(/\s+/g, '').toLocaleLowerCase()

/** Candidate suggestions only; never selects or writes a book. */
export function matchPhotoBooks(books: readonly Book[], draft: Pick<PhotoBookDraft, 'title' | 'isbn'> & Partial<Pick<PhotoBookDraft, 'author'>>, authorNames: Readonly<Record<string, readonly string[]>> = {}): Book[] {
  const title = photoTitleKey(draft.title), author = photoTitleKey(draft.author ?? '')
  const isbnKey = (value: string) => value.normalize('NFKC').replace(/[\s-]/g, '').toUpperCase()
  const isbn = isbnKey(draft.isbn)
  return books.map(book => {
    const bookTitle = photoTitleKey(book.title)
    const rank = isbn && isbnKey(book.isbn ?? '') === isbn ? 0
      : title && bookTitle === title ? 1
      : title && bookTitle && (bookTitle.includes(title) || title.includes(bookTitle)) ? 2 : 3
    const authorMatch = Boolean(author && book.authorIds.some(id => authorNames[id]?.some(name => photoTitleKey(name) === author)))
    return { book, rank, authorMatch }
  }).filter(value => value.rank < 3).sort((a, b) => a.rank - b.rank || Number(b.authorMatch) - Number(a.authorMatch)).slice(0, 30).map(value => value.book)
}

/** Called only by explicit confirmation. Existing manual values always win. */
export async function confirmPhotoBook(repositories: ReadingCenterRepositories, draft: PhotoBookDraft, options: { bookId: string | null; hash: string; source: string; mediaType: string; allowSameTitle: boolean; candidateKey?: string }): Promise<Book> {
  const title = draft.title.trim(), isbn = draft.isbn.replace(/[\s-]/g, '')
  if (!title || title.length > 300) throw new Error('請核對有效書名')
  if (isbn && !/^(?:\d{9}[\dXx]|\d{13})$/.test(isbn)) throw new Error('ISBN 應為 10 或 13 碼；不確定請清空')
  if (!/^[a-f0-9]{64}$/.test(options.hash) || !options.mediaType.trim()) throw new Error('照片或媒體類型無效')
  if (draft.metadataSourceUrl && !isMetadataSourceUrl(draft.metadataSourceUrl)) throw new Error('書籍資料來源無效')
  const persist = async () => {
    const [books, dictionaries] = await Promise.all([repositories.books.getAll(), repositories.dictionaries.getAll()])
    const externalId = `${options.hash}:${photoTitleKey(title)}${options.candidateKey ? `:${options.candidateKey}` : ''}`
    const repeated = books.find(book => book.externalReferences.some(ref => ref.sourceId === 'photo-import' && ref.externalId === externalId))
    if (repeated) throw new Error('這張照片的同一書名已確認匯入，請到書庫編輯')
    const existing = options.bookId ? books.find(book => book.id === options.bookId) : undefined
    if (options.bookId && !existing) throw new Error('選取的書籍已不存在，請重新比對')
    if (!existing && !options.allowSameTitle && books.some(book => photoTitleKey(book.title) === photoTitleKey(title))) throw new Error('書庫已有同名書，請選取既有書籍或確認為不同版本')
    const now = new Date().toISOString()
    const additions: DictionaryEntry[] = []
    const dictionary = (kind: 'author' | 'publisher' | 'source', name: string): string | null => {
      if (!name.trim()) return null
      const found = [...dictionaries, ...additions].find(item => item.kind === kind && photoTitleKey(item.name) === photoTitleKey(name))
      if (found) return found.id
      const base = { ...createMetadata({ id: crypto.randomUUID(), now }), name: name.trim(), color: null }
      const entry: DictionaryEntry = kind === 'author' ? { ...base, kind, aliases: [] } : { ...base, kind }
      additions.push(entry); return entry.id
    }
    const authorNames = draft.authors && draft.author === draft.authors.join('、') ? draft.authors : draft.author.trim() ? [draft.author.trim()] : []
    if (authorNames.length > 10 || authorNames.some(name => !name.trim() || name.length > 200)) throw new Error('作者資料無效')
    const authorIds = existing?.authorIds.length ? existing.authorIds : authorNames.map(name => dictionary('author', name)).filter((id): id is string => id !== null)
    const publisherId = existing?.publisherId ?? dictionary('publisher', draft.publisher)
    const sourceId = options.source === '其他' ? null : dictionary('source', options.source)
    const reference = { sourceId: 'photo-import', externalId, sourceTitle: title, sourceAuthorNames: draft.author.trim() ? [draft.author.trim()] : [] }
    const evidence = `拍照／截圖核對匯入\n來源：${options.source}\n圖片 SHA-256：${options.hash}\n辨識原文：${draft.visibleText.slice(0, 2000)}`
    const book: Book = existing ? updateEntity(existing, {
      authorIds: authorIds, publisherId,
      isbn: existing.isbn || isbn || null, publishedOn: existing.publishedOn || draft.publishedOn?.slice(0, 80) || null, sourceUrls: [...new Set([...(existing.sourceUrls ?? []), ...(draft.metadataSourceUrl ? [draft.metadataSourceUrl] : [])])], externalReferences: [...existing.externalReferences, reference],
      sourceIds: [...new Set([...existing.sourceIds, ...(sourceId ? [sourceId] : [])])],
      importSourceNotes: [existing.importSourceNotes, evidence].filter(Boolean).join('\n\n')
    }, now) : {
      ...createMetadata({ id: crypto.randomUUID(), now, provenance: { kind: 'import', sourceId: 'photo-import', externalId, importedAt: now } }),
      title, preferredTitle: null, subtitle: null, originalTitle: null, languageTag: 'und', titleAliases: [],
      externalReferences: [reference], publicationKind: 'other', collectionId: null, sequence: null, serialization: null,
      isbn: isbn || null, publishedOn: draft.publishedOn?.slice(0, 80) || null, authorIds, publisherId, mediaTypeId: options.mediaType.trim(),
      categoryIds: [], tagIds: [], sourceIds: sourceId ? [sourceId] : [], cover: null, rating: null, sourceUrls: draft.metadataSourceUrl ? [draft.metadataSourceUrl] : [], wordCount: null,
      bookNote: '', importSourceNotes: evidence
    }
    assertValidBook(book)
    for (const entry of additions) await repositories.dictionaries.save(entry)
    await repositories.books.save(book)
    return book
  }
  return repositories.transaction ? repositories.transaction(persist) : persist()
}

export async function preparePhoto(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 15 * 1024 * 1024) throw new Error('請選擇 15 MB 以內的 JPEG、PNG 或 WebP 圖片')
  const image = await decodePhoto(file)
  try {
    if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error('照片尺寸過大，請先縮小或裁切')
    const scale = Math.min(1, 2200 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d'); if (!context) throw new Error('無法處理照片')
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image.source, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('無法處理照片')), 'image/jpeg', .9))
    if (blob.size > 2 * 1024 * 1024) throw new Error('照片內容過大，請先裁切書名區域')
    return blob
  } finally { image.close() }
}

async function decodePhoto(file: File): Promise<{ width: number; height: number; source: CanvasImageSource; close: () => void }> {
 if (typeof createImageBitmap === 'function') {
  try { const bitmap = await createImageBitmap(file); return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() } } catch { /* Safari fallback below. */ }
 }
 const image = new Image(), url = URL.createObjectURL(file)
 try { await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('無法讀取照片，請選擇有效圖片')); image.src = url }) }
 catch (error) { URL.revokeObjectURL(url); throw error }
 return { width: image.naturalWidth, height: image.naturalHeight, source: image, close: () => { image.onload = null; image.onerror = null; URL.revokeObjectURL(url) } }
}
