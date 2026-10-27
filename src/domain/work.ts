import { assertValidCreatorCredits, type CreatorCredit } from './creator-credit'
import type { EntityId, EntityMetadata } from './common'
import { assertValidBookWordCount, type BookRating } from './book'

export const CORE_MEDIA_TYPES = [
  'book', 'novel', 'webNovel', 'manga', 'magazine', 'anime', 'drama', 'movie', 'video'
] as const

export type CoreMediaType = (typeof CORE_MEDIA_TYPES)[number]
export type MediaType = string

export interface WorkCover {
  path: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'
  width?: number
  height?: number
}

export interface WorkExternalReference {
  sourceId: EntityId
  externalId: string
  sourceTitle: string
  sourceCreatorNames: string[]
}

export type AiringStatus = 'announced' | 'airing' | 'completed' | 'hiatus' | 'cancelled' | 'unknown'
export type WorkPublicationKind = 'published' | 'webSerial' | 'webTranslation' | 'other'
export type WorkSerializationStatus = 'ongoing' | 'completed' | 'hiatus' | 'unknown'

export type WorkSequence =
  | { kind: 'volume'; label: string; sortValue: number }
  | { kind: 'issue'; label: string; sortValue: number; year: number | null; month: number | null }

export interface WorkSerialization {
  status: WorkSerializationStatus
  latestChapter: string | null
  updatedAt: string | null
}

export type WorkTypeMetadata =
  | { kind: 'publication'; publicationKind: WorkPublicationKind; collectionId: EntityId | null; sequence: WorkSequence | null; serialization: WorkSerialization | null; isbn: string | null; publishedOn: string | null; publisherId: EntityId | null }
  | { kind: 'episodic'; season: number | null; episode: number | null; totalEpisodes: number | null; airingStatus: AiringStatus }
  | { kind: 'movie'; releasedOn: string | null; runtimeMinutes: number | null }
  | { kind: 'other'; values: Record<string, unknown> }

export interface Work extends EntityMetadata {
  title: string
  preferredTitle: string | null
  subtitle: string | null
  originalTitle: string | null
  languageTag: string
  titleAliases: string[]
  sourceUrls?: string[]
  externalReferences: WorkExternalReference[]
  mediaType: MediaType
  creatorIds: EntityId[]
  /** Optional role credits; absent on legacy data. */
  creatorCredits?: CreatorCredit[]
  categoryIds: EntityId[]
  tagIds: EntityId[]
  sourceIds: EntityId[]
  cover: WorkCover | null
  rating?: BookRating | null
  wordCount?: number | null
  note: string
  importSourceNotes?: string
  typeMetadata: WorkTypeMetadata
}

export function assertValidWork(work: Work): void {
  assertValidCreatorCredits(work.creatorCredits)
  assertValidBookWordCount(work.wordCount)
  if (!work.title.trim()) throw new Error('Work title must not be empty')
  if (!work.mediaType.trim()) throw new Error('Work mediaType must not be empty')
  try { new Intl.Locale(work.languageTag) } catch { throw new Error('Work languageTag must be a valid BCP 47 language tag') }
  for (const reference of work.externalReferences) {
    if (!reference.sourceId.trim() || !reference.externalId.trim()) throw new Error('Work external reference requires sourceId and externalId')
  }
  if (work.cover?.path.startsWith('data:')) throw new Error('Work cover must use a file path, not a Base64 data URL')
  if (work.rating != null && (!Number.isInteger(work.rating.value) || ![5, 10].includes(work.rating.scale) || work.rating.value < 1 || work.rating.value > work.rating.scale)) {
    throw new Error('Work rating must be an integer from 1 to its scale')
  }
  if (work.typeMetadata.kind === 'episodic') {
    assertNullableNonNegativeInteger(work.typeMetadata.season, 'season')
    assertNullableNonNegativeInteger(work.typeMetadata.episode, 'episode')
    assertNullableNonNegativeInteger(work.typeMetadata.totalEpisodes, 'totalEpisodes')
  }
  if (work.typeMetadata.kind === 'movie') assertNullableNonNegativeInteger(work.typeMetadata.runtimeMinutes, 'runtimeMinutes')
}

export function getWorkDisplayTitle(work: Pick<Work, 'preferredTitle' | 'title'>): string {
  return work.preferredTitle?.trim() || work.title
}

function assertNullableNonNegativeInteger(value: number | null, field: string): void {
  if (value !== null && (!Number.isInteger(value) || value < 0)) throw new Error(`Work ${field} must be a non-negative integer or null`)
}
