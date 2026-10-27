import { getBookSourceUrls, getBookNotes, type Book } from './book'
import type { ReadingRecord } from './reading-record'
import type { ActivityLog } from './activity-log'
import type { MediaType, Work } from './work'

export type LegacyMediaTypeResolver = (mediaTypeId: string) => MediaType
const LEGACY_MEDIA_TYPE_MAP: Readonly<Record<string, MediaType>> = { book: 'book', ebook: 'book', printedBook: 'book', novel: 'novel', webNovel: 'webNovel', webSerial: 'webNovel', manga: 'manga', magazine: 'magazine', anime: 'anime', drama: 'drama', movie: 'movie', video: 'video' }
export function resolveLegacyMediaType(mediaTypeId: string): MediaType { return LEGACY_MEDIA_TYPE_MAP[mediaTypeId] ?? mediaTypeId }

export function migrateBookToWork(book: Book, resolveMediaType: LegacyMediaTypeResolver = resolveLegacyMediaType): Work {
  return { id: book.id, createdAt: book.createdAt, updatedAt: book.updatedAt, revision: book.revision, schemaVersion: book.schemaVersion, provenance: book.provenance, title: book.title, preferredTitle: book.preferredTitle, subtitle: book.subtitle, originalTitle: book.originalTitle, languageTag: book.languageTag, titleAliases: [...book.titleAliases], sourceUrls: getBookSourceUrls(book), externalReferences: book.externalReferences.map((reference) => ({ sourceId: reference.sourceId, externalId: reference.externalId, sourceTitle: reference.sourceTitle, sourceCreatorNames: [...reference.sourceAuthorNames] })), mediaType: resolveMediaType(book.mediaTypeId), creatorIds: [...book.authorIds], ...(book.creatorCredits !== undefined ? { creatorCredits: book.creatorCredits.map((credit) => ({ ...credit })) } : {}), categoryIds: [...book.categoryIds], tagIds: [...book.tagIds], sourceIds: [...book.sourceIds], cover: book.cover ? { ...book.cover } : null, rating: book.rating ?? null, ...(book.wordCount !== undefined ? { wordCount: book.wordCount } : {}), note: getBookNotes(book).bookNote, ...(getBookNotes(book).importSourceNotes !== undefined ? { importSourceNotes: getBookNotes(book).importSourceNotes } : {}), typeMetadata: { kind: 'publication', publicationKind: book.publicationKind, collectionId: book.collectionId, sequence: book.sequence ? { ...book.sequence } : null, serialization: book.serialization ? { ...book.serialization } : null, isbn: book.isbn, publishedOn: book.publishedOn, publisherId: book.publisherId } }
}

export function migrateReadingRecordToActivityLog(record: ReadingRecord): ActivityLog {
  return { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt, revision: record.revision, schemaVersion: record.schemaVersion, provenance: record.provenance, workId: record.bookId, cycleId: record.cycleId, activityType: 'read', startedAt: record.startedAt, endedAt: record.endedAt, durationMinutes: record.durationMinutes, progressBefore: null, progressAfter: record.progress ? { ...record.progress } : null, deviceId: record.deviceId, sourceId: record.sourceId, note: '' }
}
