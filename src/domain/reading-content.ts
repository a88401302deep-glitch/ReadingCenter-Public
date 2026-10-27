import type { EntityId, EntityMetadata, IsoDateTime } from './common'

interface ReadingContentBase extends EntityMetadata {
  bookId: EntityId
  cycleId: EntityId | null
  readingRecordId: EntityId | null
  recordedForAt: IsoDateTime | null
}

export interface HighlightContent extends ReadingContentBase {
  type: 'highlight'
  text: string
  note: string | null
  locator: string | null
}

export interface ShortReviewContent extends ReadingContentBase {
  type: 'shortReview'
  text: string
}

export interface LongReviewContent extends ReadingContentBase {
  type: 'longReview'
  title: string | null
  text: string
}

export type ReadingContent = HighlightContent | ShortReviewContent | LongReviewContent
export type ReadingContentType = ReadingContent['type']

export const readingContentTypes: readonly ReadingContentType[] = [
  'highlight',
  'shortReview',
  'longReview'
]

export function assertValidReadingContent(content: ReadingContent): void {
  if (!readingContentTypes.includes(content.type)) {
    throw new Error('Unsupported ReadingContent type')
  }
  if (!content.bookId.trim()) throw new Error('ReadingContent bookId must not be empty')
  if (!content.text.trim()) throw new Error('ReadingContent text must not be empty')
}

export function hasLongReview(contents: readonly ReadingContent[]): boolean {
  return contents.some((content) => content.type === 'longReview')
}
