import { assertIsoDateTime, type EntityId, type EntityMetadata } from './common'
import { assertValidProgress, type ReadingProgress } from './progress'

export interface ReadingRecord extends EntityMetadata {
  bookId: EntityId
  cycleId: EntityId | null
  startedAt: string
  endedAt: string | null
  durationMinutes: number | null
  progress: ReadingProgress | null
  deviceId: EntityId | null
  sourceId: EntityId | null
}

export function assertValidReadingRecord(record: ReadingRecord): void {
  if (!record.bookId.trim()) throw new Error('ReadingRecord bookId must not be empty')
  assertIsoDateTime(record.startedAt, 'ReadingRecord startedAt')
  if (record.endedAt !== null) assertIsoDateTime(record.endedAt, 'ReadingRecord endedAt')
  if (record.endedAt !== null && record.endedAt < record.startedAt) {
    throw new Error('ReadingRecord endedAt must not precede startedAt')
  }
  if (
    record.durationMinutes !== null &&
    (!Number.isInteger(record.durationMinutes) || record.durationMinutes < 0)
  ) {
    throw new Error('durationMinutes must be a non-negative integer or null')
  }
  assertValidProgress(record.progress)
}
