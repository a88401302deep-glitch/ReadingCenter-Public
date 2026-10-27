import type {
  Book,
  EntityId,
  IsoDateTime,
  Provenance,
  ReadingContent,
  ReadingCycle,
  ReadingRecord
} from '../domain'

export const oneDriveFormatVersion = 1 as const

export type SyncEntityKind = 'book' | 'readingCycle' | 'readingRecord' | 'readingContent'

export interface SyncEntityMap {
  book: Book
  readingCycle: ReadingCycle
  readingRecord: ReadingRecord
  readingContent: ReadingContent
}

export interface SyncEnvelope<K extends SyncEntityKind = SyncEntityKind> {
  formatVersion: typeof oneDriveFormatVersion
  kind: K
  id: EntityId
  revision: number
  updatedAt: IsoDateTime
  provenance: Provenance
  deleted: boolean
  payload: SyncEntityMap[K] | null
}

export interface OneDriveManifest {
  formatVersion: typeof oneDriveFormatVersion
  schemaVersion: number
  snapshotId: string
  generatedAt: IsoDateTime
  entityFiles: Record<SyncEntityKind, string>
}

export interface OneDriveSnapshot {
  manifest: OneDriveManifest
  entities: {
    [K in SyncEntityKind]: SyncEnvelope<K>[]
  }
}

export interface RemoteObject {
  path: string
  content: string
  version: string
}

export interface RemoteChange {
  path: string
  deleted: boolean
  version: string
}

export interface RemoteChangePage {
  changes: RemoteChange[]
  nextCheckpoint: string
}

export type RemoteWrite =
  | { operationId: string; kind: 'put'; path: string; content: string; expectedVersion?: string }
  | { operationId: string; kind: 'delete'; path: string; expectedVersion?: string }

export interface RemoteWriteResult {
  operationId: string
  path: string
  version: string
}

export interface SyncStoreAdapter {
  listChanges(checkpoint?: string): Promise<RemoteChangePage>
  read(path: string): Promise<RemoteObject | undefined>
  apply(writes: readonly RemoteWrite[]): Promise<RemoteWriteResult[]>
}

export type ConflictResolution<K extends SyncEntityKind = SyncEntityKind> =
  | { status: 'resolved'; winner: SyncEnvelope<K>; reason: 'same' | 'manual-priority' | 'revision' | 'updatedAt' | 'tombstone' }
  | { status: 'conflict'; local: SyncEnvelope<K>; remote: SyncEnvelope<K>; reason: 'concurrent-manual' }

export function createEnvelope<K extends SyncEntityKind>(
  kind: K,
  entity: SyncEntityMap[K]
): SyncEnvelope<K> {
  return {
    formatVersion: oneDriveFormatVersion,
    kind,
    id: entity.id,
    revision: entity.revision,
    updatedAt: entity.updatedAt,
    provenance: entity.provenance,
    deleted: false,
    payload: entity
  }
}

export function createTombstone<K extends SyncEntityKind>(
  kind: K,
  entity: SyncEntityMap[K],
  deletedAt: IsoDateTime,
  revision = entity.revision + 1
): SyncEnvelope<K> {
  return {
    formatVersion: oneDriveFormatVersion,
    kind,
    id: entity.id,
    revision,
    updatedAt: deletedAt,
    provenance: entity.provenance,
    deleted: true,
    payload: null
  }
}
