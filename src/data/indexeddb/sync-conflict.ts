import type { IsoDateTime, Provenance } from '../../domain'
import type { SyncEntityKind, SyncOutboxEntry, SyncableEntity } from './sync-outbox'

export type SyncConflictReason = 'revision_conflict' | 'manual_data_protected'

export interface RemoteEntitySnapshot {
  kind: SyncEntityKind
  id: string
  revision: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  schemaVersion: number
  provenance: Provenance
  deletedAt: IsoDateTime | null
  payload: SyncableEntity | null
}

export interface SyncConflictRecord {
  mutationId: string
  kind: SyncEntityKind
  entityId: string
  reason: SyncConflictReason
  detectedAt: IsoDateTime
  local: SyncOutboxEntry
  remote: RemoteEntitySnapshot | null
}

export interface SyncConflictRepository {
  getAll(): Promise<SyncConflictRecord[]>
  getByMutationId(mutationId: string): Promise<SyncConflictRecord | undefined>
  save(conflict: SyncConflictRecord): Promise<void>
  remove(mutationId: string): Promise<void>
}
