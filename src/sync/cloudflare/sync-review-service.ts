import {
  createPutOutboxEntry, type SyncableEntity, type SyncEntityKind, type SyncingLocalRepositoryContext,
  type SyncOutboxEntry, type SyncReviewArchive, type SyncReviewChoice, type SyncReviewItem
} from '../../data'
import type { RemoteEntitySnapshot } from '../../data'
import type { StoredRemoteEntity } from '../../server/entity-api'
import { CloudflareEntityClient, RemoteApiError, RemoteProtocolError } from './entity-client'
import { fingerprint, syncTables, validateRemote } from './cache'
import { withCloudSyncLock } from './sync-lock'

export class StaleSyncReviewError extends Error {
  constructor() { super('資料在核對後已有變動；請重新載入並核對'); this.name = 'StaleSyncReviewError' }
}

const kinds = Object.keys(syncTables) as SyncEntityKind[]
const keyFor = (kind: SyncEntityKind, id: string) => `${kind}:${id}`
const matches = (entry: SyncOutboxEntry, kind: SyncEntityKind, id: string) => entry.kind === kind && entry.entityId === id
const pendingFingerprint = (entries: SyncOutboxEntry[]) => fingerprint(entries.map((entry) => {
  return { mutationId: entry.mutationId, kind: entry.kind, entityId: entry.entityId,
    sequence: entry.sequence, baseRevision: entry.baseRevision, operation: entry.operation,
    ...(entry.operation === 'put' ? { entity: entry.entity } : { deletedAt: entry.deletedAt }) }
}))

export function canKeepLocal(item: SyncReviewItem): boolean {
  return !(item.local?.provenance.kind === 'import' && item.remote?.provenance.kind === 'manual')
}

/** Decisions change only the local transaction/outbox. Server revision checks
 * still apply when the replacement mutation is sent. Both reviewed copies are archived. */
export class SyncReviewService {
  constructor(private readonly local: SyncingLocalRepositoryContext,
    private readonly client = new CloudflareEntityClient(),
    private readonly now = () => new Date().toISOString(),
    private readonly uuid = () => crypto.randomUUID(), private readonly signal?: AbortSignal) {}

  list(): Promise<SyncReviewItem[]> {
    return withCloudSyncLock(() => this.readReviews(), this.signal)
  }

  private async readReviews(): Promise<SyncReviewItem[]> {
    const snapshots = await Promise.all(kinds.map(async (kind) => {
      const rows = await this.client.list(kind, true)
      const seen = new Set<string>()
      for (const row of rows) {
        validateRemote(kind, row)
        if (seen.has(row.id)) throw new RemoteProtocolError('Duplicate remote entity id')
        seen.add(row.id)
      }
      return { kind, rows }
    }))
    const db = this.local.database
    return db.transaction('r', db.tables, async () => {
      const pending = await this.local.outbox.getAll()
      const conflicts = await this.local.conflicts.getAll()
      const reviews: SyncReviewItem[] = []
      for (const { kind, rows } of snapshots) {
        const copies = await db.table<SyncableEntity, string>(syncTables[kind]).toArray()
        const localById = new Map(copies.map((entity) => [entity.id, entity]))
        const remoteById = new Map(rows.map((entity) => [entity.id, entity]))
        const ids = new Set([...localById.keys(), ...pending.filter((entry) => entry.kind === kind).map((entry) => entry.entityId),
          ...conflicts.filter((entry) => entry.kind === kind).map((entry) => entry.entityId)])
        for (const id of ids) {
          const copy = localById.get(id) ?? null
          const remote = remoteById.get(id) ?? null
          const queued = pending.filter((entry) => matches(entry, kind, id))
          const baseline = await db.syncCache.get(keyFor(kind, id))
          const conflict = conflicts.some((entry) => entry.kind === kind && entry.entityId === id)
          const unverified = queued[0]?.baseRevision > 0 && (!baseline || baseline.revision < queued[0].baseRevision)
          const differs = copy && fingerprint(copy) !== fingerprint(remote?.payload ?? null)
            && (!baseline || fingerprint(copy) !== baseline.fingerprint)
          if (!conflict && !unverified && (queued.length > 0 || (!differs && !(copy && !remote)))) continue
          reviews.push({ key: keyFor(kind, id), kind, entityId: id,
            reason: conflict ? 'conflict' : unverified ? 'unverified' : !remote ? 'local-only' : 'different',
            local: copy, remote: remote as unknown as RemoteEntitySnapshot | null, pending: queued })
        }
      }
      return reviews
    })
  }

  resolve(review: SyncReviewItem, choice: SyncReviewChoice): Promise<void> {
    return withCloudSyncLock(() => this.applyDecision(review, choice), this.signal)
  }

  private async applyDecision(review: SyncReviewItem, choice: SyncReviewChoice): Promise<void> {
    if (choice === 'local' && !canKeepLocal(review)) throw new Error('匯入資料不能覆蓋遠端人工資料，請採用遠端版本')
    const remote = await this.getRemote(review.kind, review.entityId)
    if (fingerprint(remote) !== fingerprint(review.remote)) throw new StaleSyncReviewError()
    const selected = choice === 'local' ? review.local : remote?.payload ?? null
    if (selected) await this.checkParents(selected as unknown as SyncableEntity, review.kind)
    else await this.checkRemoteDependents(review.kind, review.entityId)

    const db = this.local.database
    await db.transaction('rw', db.tables, async () => {
      const table = db.table<SyncableEntity, string>(syncTables[review.kind])
      const copy = await table.get(review.entityId) ?? null
      const pending = (await this.local.outbox.getAll()).filter((entry) => matches(entry, review.kind, review.entityId))
      if (fingerprint(copy) !== fingerprint(review.local) || pendingFingerprint(pending) !== pendingFingerprint(review.pending)) {
        throw new StaleSyncReviewError()
      }
      if (!selected) await this.checkLocalDependents(review.kind, review.entityId)
      await db.syncReviewArchive.add({ id: this.uuid(), resolvedAt: this.now(), choice, review })
      for (const entry of pending) await this.local.outbox.remove(entry.mutationId)
      await db.syncConflicts.where('[kind+entityId]').equals([review.kind, review.entityId]).delete()
      const key = keyFor(review.kind, review.entityId)
      if (remote) await db.syncCache.put({ key, revision: remote.revision, fingerprint: remote.payload ? fingerprint(remote.payload) : null })
      else await db.syncCache.delete(key)

      if (choice === 'remote') {
        if (remote?.payload) await table.put(remote.payload as unknown as SyncableEntity)
        else await table.delete(review.entityId)
        return
      }
      let replacement: SyncOutboxEntry | undefined
      if (review.local) {
        const entity = { ...review.local, revision: (remote?.revision ?? 0) + 1,
          createdAt: remote?.createdAt ?? review.local.createdAt, updatedAt: this.now() }
        const envelope = { ...entity, kind: review.kind, deletedAt: null, payload: entity } as unknown as StoredRemoteEntity
        validateRemote(review.kind, envelope)
        await table.put(entity)
        replacement = createPutOutboxEntry(review.kind, entity, this.uuid(), this.now())
      } else if (remote && !remote.deletedAt) {
        replacement = { mutationId: this.uuid(), kind: review.kind, entityId: review.entityId, operation: 'delete',
          baseRevision: remote.revision, queuedAt: this.now(), deletedAt: this.now(),
          attemptCount: 0, lastAttemptAt: null, lastError: null }
      }
      // Replace at the original queue position so related later mutations cannot overtake this decision.
      if (replacement) await db.syncOutbox.add({ ...replacement, ...(pending[0]?.sequence === undefined ? {} : { sequence: pending[0].sequence }) })
    })
  }

  async archives(): Promise<SyncReviewArchive[]> {
    return this.local.database.syncReviewArchive.orderBy('resolvedAt').reverse().toArray()
  }

  private async getRemote(kind: SyncEntityKind, id: string): Promise<StoredRemoteEntity | null> {
    try {
      const remote = await this.client.get(kind, id, true)
      validateRemote(kind, remote)
      if (remote.id !== id) throw new RemoteProtocolError('Remote entity id does not match')
      return remote
    } catch (error) {
      if (error instanceof RemoteApiError && error.status === 404 && error.code === 'not_found') return null
      throw error
    }
  }

  private async checkParents(entity: SyncableEntity, kind: SyncEntityKind): Promise<void> {
    const fields = entity as unknown as Record<string, unknown>
    const parents: Array<[SyncEntityKind, unknown]> = []
    if (kind === 'readingCycle' || kind === 'readingRecord' || kind === 'readingContent') parents.push(['book', fields.bookId])
    if (kind === 'activityLog') parents.push(['work', fields.workId])
    if (kind === 'readingRecord' || kind === 'readingContent' || kind === 'activityLog') parents.push(['readingCycle', fields.cycleId])
    if (kind === 'readingContent') parents.push(['readingRecord', fields.readingRecordId])
    if (kind === 'book') parents.push(['collection', fields.collectionId])
    if (kind === 'work') parents.push(['collection', (fields.typeMetadata as { collectionId?: string })?.collectionId])
    for (const [parentKind, id] of parents) {
      if (id === null || id === undefined) continue
      if (typeof id !== 'string' || !id) throw new Error('所屬資料格式不正確，請先核對')
      const parent = await this.getRemote(parentKind, id)
      if (!parent?.payload || parent.deletedAt) throw new Error('請先核對並同步所屬書籍、作品或閱讀紀錄，再處理此筆資料')
      if ((parentKind === 'readingCycle' || parentKind === 'readingRecord') && fields.bookId
        && parent.payload.bookId !== fields.bookId) throw new Error('關聯閱讀資料屬於另一部書籍，請先核對關聯')
      if (parentKind === 'readingRecord' && fields.cycleId && parent.payload.cycleId !== fields.cycleId) {
        throw new Error('關聯閱讀紀錄屬於另一個閱讀週期，請先核對關聯')
      }
    }
  }

  private isDependent(kind: SyncEntityKind, id: string, candidate: SyncableEntity): boolean {
    const value = candidate as unknown as Record<string, unknown>
    return (kind === 'book' && value.bookId === id) || (kind === 'work' && value.workId === id)
      || (kind === 'readingCycle' && value.cycleId === id) || (kind === 'readingRecord' && value.readingRecordId === id)
      || (kind === 'collection' && (value.collectionId === id || (value.typeMetadata as { collectionId?: string })?.collectionId === id))
      || (kind === 'dictionary' && ['authorIds', 'creatorIds', 'categoryIds', 'tagIds', 'sourceIds'].some((field) => Array.isArray(value[field]) && value[field].includes(id)))
      || (kind === 'dictionary' && ['publisherId', 'mediaTypeId', 'deviceId', 'sourceId'].some((field) => value[field] === id))
  }

  private async checkRemoteDependents(kind: SyncEntityKind, id: string): Promise<void> {
    if (kind === 'readingContent' || kind === 'activityLog') return
    const lists = await Promise.all(kinds.map((candidateKind) => this.client.list(candidateKind, true)))
    for (const [index, rows] of lists.entries()) {
      for (const row of rows) {
        validateRemote(kinds[index], row)
        if (row.payload && this.isDependent(kind, id, row.payload as unknown as SyncableEntity)) {
          throw new Error('仍有關聯資料使用此筆，請先核對或處理關聯資料，再確認刪除')
        }
      }
    }
  }

  private async checkLocalDependents(kind: SyncEntityKind, id: string): Promise<void> {
    for (const tableName of Object.values(syncTables)) {
      if ((await this.local.database.table<SyncableEntity>(tableName).toArray()).some((entity) => this.isDependent(kind, id, entity))) {
        throw new Error('仍有本機關聯資料使用此筆，請先核對或處理關聯資料，再確認刪除')
      }
    }
  }
}
