import { isMetadataSourceUrl } from './book-metadata'
import { assertValidCreatorCredits, type CreatorCredit } from './creator-credit'
import type { EntityId, EntityMetadata } from './common'

export interface BookCover {
  path: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'
  width?: number
  height?: number
}

export interface BookRating { value: number; scale: 5 | 10 }

export interface BookExternalReference {
  sourceId: EntityId
  externalId: string
  sourceTitle: string
  sourceAuthorNames: string[]
}

export type PublicationKind = 'published' | 'webSerial' | 'webTranslation' | 'other'
export type SerializationStatus = 'ongoing' | 'completed' | 'hiatus' | 'unknown'

export type BookSequence =
  | { kind: 'volume'; label: string; sortValue: number }
  | { kind: 'issue'; label: string; sortValue: number; year: number | null; month: number | null }

export interface BookSerialization {
  status: SerializationStatus
  latestChapter: string | null
  updatedAt: string | null
}

export interface Book extends EntityMetadata {
  /** Source/original title. Imported data must never overwrite this with a display preference. */
  title: string
  preferredTitle: string | null
  subtitle: string | null
  originalTitle: string | null
  authorOriginalNames?: string[]
  bookForm?: 'novel' | 'manga' | 'magazine' | 'webNovel' | 'other'
  languageTag: string
  titleAliases: string[]
  externalReferences: BookExternalReference[]
  publicationKind: PublicationKind
  collectionId: EntityId | null
  sequence: BookSequence | null
  serialization: BookSerialization | null
  isbn: string | null
  publishedOn: string | null
  authorIds: EntityId[]
  /** Optional role credits; absent on legacy data. */
  creatorCredits?: CreatorCredit[]
  publisherId: EntityId | null
  mediaTypeId: EntityId
  categoryIds: EntityId[]
  tagIds: EntityId[]
  sourceIds: EntityId[]
  cover: BookCover | null
  /** Optional for books created before rating support; null means unrated. */
  rating?: BookRating | null
  sourceUrls?: string[]
  /** Total book text count; absent or null means unknown. */
  wordCount?: number | null
  wordCountSourceUrl?: string | null
  bookNote: string
  /** Preserved import evidence, separate from user-authored notes. */
  importSourceNotes?: string
}

export function assertValidBook(book: Book): void {
  assertValidCreatorCredits(book.creatorCredits)
  if (book.originalTitle != null && (typeof book.originalTitle !== 'string' || book.originalTitle.length > 500)) throw new Error('原文書名過長或格式無效')
  if (book.authorOriginalNames !== undefined && (!Array.isArray(book.authorOriginalNames) || book.authorOriginalNames.length > 20 || book.authorOriginalNames.some(name => typeof name !== 'string' || !name.trim() || name.length > 200))) throw new Error('作者原名格式無效')
  if (book.bookForm !== undefined && !['novel', 'manga', 'magazine', 'webNovel', 'other'].includes(book.bookForm)) throw new Error('作品形式無效')
  assertValidBookWordCount(book.wordCount)
  if (book.wordCountSourceUrl != null && !isMetadataSourceUrl(book.wordCountSourceUrl)) throw new Error('字數來源無效')
  if (book.sourceUrls !== undefined && (!Array.isArray(book.sourceUrls) || book.sourceUrls.some((url) => typeof url !== 'string' || !isBookSourceUrl(url)))) throw new Error('書籍網址必須是完整的 HTTP 或 HTTPS 網址')
  if (book.importSourceNotes !== undefined && typeof book.importSourceNotes !== 'string') throw new Error('Book import source notes must be text')
  if (!book.title.trim()) throw new Error('Book title must not be empty')
  if (!book.mediaTypeId.trim()) throw new Error('Book mediaTypeId must not be empty')
  try {
    new Intl.Locale(book.languageTag)
  } catch {
    throw new Error('Book languageTag must be a valid BCP 47 language tag')
  }
  for (const reference of book.externalReferences) {
    if (!reference.sourceId.trim() || !reference.externalId.trim()) {
      throw new Error('Book external reference requires sourceId and externalId')
    }
  }
  if (book.sequence && (!Number.isFinite(book.sequence.sortValue) || book.sequence.sortValue < 0)) {
    throw new Error('Book sequence sortValue must be a non-negative number')
  }
  if (book.sequence?.kind === 'issue' && book.sequence.month !== null && (book.sequence.month < 1 || book.sequence.month > 12)) {
    throw new Error('Magazine issue month must be between 1 and 12')
  }
  if ((book.publicationKind === 'webSerial' || book.publicationKind === 'webTranslation') && !book.serialization) {
    throw new Error('Serialized publication requires serialization details')
  }
  if (book.cover?.path.startsWith('data:')) {
    throw new Error('Book cover must use a file path, not a Base64 data URL')
  }
  if (book.rating != null && (!Number.isInteger(book.rating.value) || ![5, 10].includes(book.rating.scale) || book.rating.value < 1 || book.rating.value > book.rating.scale)) {
    throw new Error('Book rating must be an integer from 1 to its scale')
  }
}

export function getBookDisplayTitle(book: Pick<Book, 'preferredTitle' | 'title'>): string {
  return book.preferredTitle?.trim() || book.title
}

/** Present legacy migration blocks without deleting or guessing user edits within them. */
export function getBookNotes(book: Book): { bookNote: string; importSourceNotes?: string } {
  if (book.importSourceNotes !== undefined) return { bookNote: book.bookNote, importSourceNotes: book.importSourceNotes }
  if (book.provenance.kind === 'import' && book.provenance.sourceId === 'notion-csv-snapshot' &&
    book.bookNote.startsWith('Notion 歷史搬遷｜原始資料保留\n【來源第 ')) {
    return { bookNote: '', importSourceNotes: book.bookNote }
  }
  return { bookNote: book.bookNote }
}

export function isBookSourceUrl(value: string): boolean {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password } catch { return false }
}

/** Undefined means legacy data; an explicit empty list means the user cleared it. */
export function getBookSourceUrls(book: Book): string[] {
  if (book.sourceUrls !== undefined) return [...book.sourceUrls]
  if (book.provenance.kind !== 'import' || book.provenance.sourceId !== 'notion-csv-snapshot') return []
  const notes = getBookNotes(book).importSourceNotes
  if (!notes?.startsWith('Notion 歷史搬遷｜原始資料保留\n【來源第 ')) return []
  return [...new Set(notes.split('\n').filter((line) => line.startsWith('網址：')).map((line) => line.slice(3).trim()).filter(isBookSourceUrl))]
}

export function assertValidBookWordCount(value: number | null | undefined): void {
  if (value != null && (!Number.isSafeInteger(value) || value < 1)) throw new Error('書籍字數必須是正整數；未知請留白')
}

