import type {
  ActivityLog,
  Book,
  BookCollection,
  DictionaryEntry,
  EntityId,
  EntityMetadata,
  IsoDateTime,
  ReadingContent,
  ReadingCycle,
  ReadingRecord,
  ReadingGoal,
  ReadingPreferences,
  SourceReadingDay,
  Work
} from '../../domain'

export type SyncEntityKind =
  | 'work'
  | 'activityLog'
  | 'book'
  | 'readingCycle'
  | 'readingRecord'
  | 'readingContent'
  | 'dictionary'
  | 'collection'
  | 'readingGoal'
  | 'readingPreferences'
  | 'sourceReadingDay'

export type SyncableEntity =
  | Work
  | ActivityLog
  | Book
  | ReadingCycle
  | ReadingRecord
  | ReadingContent
  | DictionaryEntry
  | BookCollection
  | ReadingGoal
  | ReadingPreferences
  | SourceReadingDay

interface SyncOutboxEntryBase {
  sequence?: number
  mutationId: string
  kind: SyncEntityKind
  entityId: EntityId
  baseRevision: number
  queuedAt: IsoDateTime
  attemptCount: number
  lastAttemptAt: IsoDateTime | null
  lastError: string | null
}

export interface SyncOutboxPutEntry extends SyncOutboxEntryBase {
  operation: 'put'
  entity: SyncableEntity
}

export interface SyncOutboxDeleteEntry extends SyncOutboxEntryBase {
  operation: 'delete'
  deletedAt: IsoDateTime
}

export type SyncOutboxEntry = SyncOutboxPutEntry | SyncOutboxDeleteEntry

export interface SyncOutboxRepository {
  getAll(): Promise<SyncOutboxEntry[]>
  remove(mutationId: string): Promise<void>
  markFailed(mutationId: string, attemptedAt: IsoDateTime, error: string): Promise<void>
}

export interface SyncOutboxWriter {
  addMany(entries: SyncOutboxEntry[]): Promise<void>
}

export function createPutOutboxEntry(
  kind: SyncEntityKind,
  entity: SyncableEntity,
  mutationId: string,
  queuedAt: IsoDateTime
): SyncOutboxPutEntry {
  return {
    mutationId,
    kind,
    entityId: entity.id,
    operation: 'put',
    baseRevision: entity.revision - 1,
    queuedAt,
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    entity
  }
}

export function createDeleteOutboxEntry(
  kind: SyncEntityKind,
  entity: EntityMetadata,
  mutationId: string,
  deletedAt: IsoDateTime
): SyncOutboxDeleteEntry {
  return {
    mutationId,
    kind,
    entityId: entity.id,
    operation: 'delete',
    baseRevision: entity.revision,
    queuedAt: deletedAt,
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    deletedAt
  }
}

