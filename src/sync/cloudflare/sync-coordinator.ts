import type { StoredRemoteEntity } from '../../server/entity-api'
import type { IsoDateTime } from '../../domain'
import type {
  EntityRepository,
  ReadingCenterRepositories,
  SyncConflictReason,
  SyncConflictRepository,
  SyncEntityKind,
  SyncOutboxEntry,
  SyncOutboxRepository,
  SyncableEntity
} from '../../data'
import { RemoteApiError, RemoteNetworkError, RemoteProtocolError } from './entity-client'

export interface RemoteMutationClient {
  apply(entry: SyncOutboxEntry): Promise<StoredRemoteEntity>
}

export type SyncStopReason = 'api' | 'network' | 'protocol' | 'unexpected'

export interface SyncRunCompleted {
  status: 'completed'
  processed: number
  remaining: 0
}

export interface SyncRunStopped {
  status: 'stopped'
  processed: number
  remaining: number
  failedMutationId: string
  reason: SyncStopReason
  error: Error
}

export type SyncRunResult = SyncRunCompleted | SyncRunStopped

export interface SyncCoordinatorOptions {
  now?: () => IsoDateTime
  conflicts?: SyncConflictRepository
  acknowledge?: (entry: SyncOutboxEntry, remote: StoredRemoteEntity) => Promise<void>
}

/**
 * Drains the durable outbox in sequence. A failed mutation stops the run so a
 * later edit can never overtake the revision it was based on.
 */
export class CloudflareSyncCoordinator {
  private activeRun: Promise<SyncRunResult> | null = null
  private readonly now: () => IsoDateTime

  constructor(
    private readonly outbox: SyncOutboxRepository,
    private readonly repositories: ReadingCenterRepositories,
    private readonly client: RemoteMutationClient,
    private readonly options: SyncCoordinatorOptions = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
  }

  sync(): Promise<SyncRunResult> {
    if (this.activeRun) return this.activeRun

    this.activeRun = this.drain().finally(() => {
      this.activeRun = null
    })
    return this.activeRun
  }

  private async drain(): Promise<SyncRunResult> {
    const entries = await this.outbox.getAll()
    let processed = 0

    for (const [index, entry] of entries.entries()) {
      try {
        const remote = await this.client.apply(entry)
        assertMatchingRemoteEntity(entry, remote)

        if (this.options.acknowledge) {
          await this.options.acknowledge(entry, remote)
        } else {
          const acknowledged = new Set(entries.slice(0, index + 1).map((item) => item.mutationId))
          const pending = await this.outbox.getAll()
          if (!hasLaterMutationForEntity(entries, index, entry)
            && !pending.some((candidate) => !acknowledged.has(candidate.mutationId)
              && candidate.kind === entry.kind && candidate.entityId === entry.entityId)) {
            await hydrateRemoteEntity(this.repositories, entry.kind, remote)
          }
          await this.outbox.remove(entry.mutationId)
        }
        await this.options.conflicts?.remove(entry.mutationId)
        processed += 1
      } catch (error) {
        const normalized = normalizeError(error)
        const attemptedAt = this.now()
        await this.persistConflict(entry, normalized, attemptedAt)
        await this.outbox.markFailed(entry.mutationId, attemptedAt, describeError(normalized))
        return {
          status: 'stopped',
          processed,
          remaining: entries.length - processed,
          failedMutationId: entry.mutationId,
          reason: classifyError(normalized),
          error: normalized
        }
      }
    }

    return { status: 'completed', processed, remaining: 0 }
  }

  private async persistConflict(entry: SyncOutboxEntry, error: Error, detectedAt: IsoDateTime): Promise<void> {
    if (!(error instanceof RemoteApiError) || !isConflictReason(error.code) || !this.options.conflicts) return
    await this.options.conflicts.save({
      mutationId: entry.mutationId,
      kind: entry.kind,
      entityId: entry.entityId,
      reason: error.code,
      detectedAt,
      local: entry,
      remote: error.current ? {
        ...error.current,
        kind: entry.kind,
        payload: error.current.payload as unknown as SyncableEntity | null
      } : null
    })
  }
}

function isConflictReason(code: string): code is SyncConflictReason {
  return code === 'revision_conflict' || code === 'manual_data_protected'
}

function hasLaterMutationForEntity(
  entries: SyncOutboxEntry[],
  currentIndex: number,
  current: SyncOutboxEntry
): boolean {
  return entries.slice(currentIndex + 1).some(
    (candidate) => candidate.kind === current.kind && candidate.entityId === current.entityId
  )
}

function assertMatchingRemoteEntity(entry: SyncOutboxEntry, remote: StoredRemoteEntity): void {
  if (remote.kind !== entry.kind || remote.id !== entry.entityId) {
    throw new RemoteProtocolError('Remote mutation result does not match the queued entity')
  }
  if (remote.payload && remote.payload.id !== entry.entityId) {
    throw new RemoteProtocolError('Remote mutation payload has a mismatched entity id')
  }
}

async function hydrateRemoteEntity(
  repositories: ReadingCenterRepositories,
  kind: SyncEntityKind,
  remote: StoredRemoteEntity
): Promise<void> {
  const repository = repositoryForKind(repositories, kind)
  if (remote.deletedAt || !remote.payload) {
    await repository.delete(remote.id)
    return
  }
  await repository.save(remote.payload as unknown as SyncableEntity)
}

function repositoryForKind(
  repositories: ReadingCenterRepositories,
  kind: SyncEntityKind
): EntityRepository<SyncableEntity> {
  switch (kind) {
    case 'work': return repositories.works as EntityRepository<SyncableEntity>
    case 'activityLog': return repositories.activityLogs as EntityRepository<SyncableEntity>
    case 'book': return repositories.books as EntityRepository<SyncableEntity>
    case 'readingCycle': return repositories.readingCycles as EntityRepository<SyncableEntity>
    case 'readingRecord': return repositories.readingRecords as EntityRepository<SyncableEntity>
    case 'readingContent': return repositories.readingContents as EntityRepository<SyncableEntity>
    case 'dictionary': return repositories.dictionaries as EntityRepository<SyncableEntity>
    case 'collection': return repositories.collections as EntityRepository<SyncableEntity>
    case 'readingGoal': return repositories.readingGoals as EntityRepository<SyncableEntity>
    case 'sourceReadingDay': return repositories.sourceReadingDays as EntityRepository<SyncableEntity>
    case 'readingPreferences': return repositories.readingPreferences as EntityRepository<SyncableEntity>
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function classifyError(error: Error): SyncStopReason {
  if (error instanceof RemoteApiError) return 'api'
  if (error instanceof RemoteNetworkError) return 'network'
  if (error instanceof RemoteProtocolError) return 'protocol'
  return 'unexpected'
}

function describeError(error: Error): string {
  if (error instanceof RemoteApiError) return `${error.code}: ${error.message}`
  return `${error.name}: ${error.message}`
}

