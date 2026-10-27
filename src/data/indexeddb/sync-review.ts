import type { SyncableEntity, SyncEntityKind, SyncOutboxEntry } from './sync-outbox'
import type { RemoteEntitySnapshot } from './sync-conflict'

export interface SyncReviewItem {
  key: string
  kind: SyncEntityKind
  entityId: string
  reason: 'conflict' | 'local-only' | 'different' | 'unverified'
  local: SyncableEntity | null
  remote: RemoteEntitySnapshot | null
  pending: SyncOutboxEntry[]
}

export type SyncReviewChoice = 'local' | 'remote'

export interface SyncReviewArchive {
  id: string
  resolvedAt: string
  choice: SyncReviewChoice
  review: SyncReviewItem
}
