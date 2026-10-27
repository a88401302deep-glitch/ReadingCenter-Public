import type { SyncableEntity, SyncEntityKind, SyncingLocalRepositoryContext, SyncOutboxEntry } from '../../data'
import type { StoredRemoteEntity } from '../../server/entity-api'
import { CloudflareEntityClient, RemoteProtocolError } from './entity-client'
import { CloudflareSyncCoordinator } from './sync-coordinator'
import { fingerprint, syncTables, validateRemote } from './cache'

export interface SessionSyncResult {
  status: 'completed' | 'stopped'
  pending: number
  conflicts: number
  preserved: number
  error?: Error
}

export class LocalReconciliationRequiredError extends Error {
  constructor() {
    super('Existing local data has no verified remote baseline')
    this.name = 'LocalReconciliationRequiredError'
  }
}

/** Network work happens outside transactions; applying results and acknowledging
 * the outbox happen atomically with UI edits, including edits from other tabs. */
export class CloudflareSyncSession {
  private active: Promise<SessionSyncResult> | null = null
  private readonly coordinator: CloudflareSyncCoordinator

  constructor(private readonly local: SyncingLocalRepositoryContext, private readonly client = new CloudflareEntityClient()) {
    this.coordinator = new CloudflareSyncCoordinator(local.outbox, local.rawRepositories, {
      apply: async (entry) => {
        const baseline = await local.database.syncCache.get(`${entry.kind}:${entry.entityId}`)
        if (entry.baseRevision > 0 && (!baseline || baseline.revision < entry.baseRevision)) {
          throw new LocalReconciliationRequiredError()
        }
        return client.apply(entry)
      }
    }, {
      conflicts: local.conflicts,
      acknowledge: (entry, remote) => this.acknowledge(entry, remote)
    })
  }

  sync(): Promise<SessionSyncResult> {
    if (this.active) return this.active
    this.active = this.run().finally(() => { this.active = null })
    return this.active
  }

  private async run(): Promise<SessionSyncResult> {
    let preserved = 0
    let error: Error | undefined
    try {
      const pushed = await this.coordinator.sync()
      if (pushed.status === 'stopped') error = pushed.error
      // Pull even after a mutation conflict so independent remote data remains visible.
      const kinds = Object.keys(syncTables) as SyncEntityKind[]
      const snapshots = await Promise.all(kinds.map(async (kind) => {
        const rows = await this.client.list(kind, true)
        const ids = new Set<string>()
        for (const row of rows) {
          validateRemote(kind, row)
          if (ids.has(row.id)) throw new RemoteProtocolError('Remote list contains duplicate entity ids')
          ids.add(row.id)
        }
        return { kind, rows }
      }))
      const db = this.local.database
      await db.transaction('rw', db.tables, async () => {
        const pending = new Set((await this.local.outbox.getAll()).map((entry) => `${entry.kind}:${entry.entityId}`))
        for (const { kind, rows } of snapshots) {
          const table = db.table<SyncableEntity, string>(syncTables[kind])
          const remoteIds = new Set(rows.map((row) => row.id))
          for (const row of rows) {
            const key = `${kind}:${row.id}`
            if (pending.has(key)) continue
            const local = await table.get(row.id)
            const baseline = await db.syncCache.get(key)
            const localFingerprint = local ? fingerprint(local) : null
            const remoteFingerprint = row.payload ? fingerprint(row.payload) : null
            // A previously local-only copy requires explicit reconciliation. A
            // delayed snapshot must not roll back an acknowledged newer revision.
            if ((baseline && row.revision < baseline.revision)
              || (local && localFingerprint !== remoteFingerprint && localFingerprint !== baseline?.fingerprint)) {
              preserved += 1
              continue
            }
            if (row.payload) await table.put(row.payload as unknown as SyncableEntity)
            else await table.delete(row.id)
            await db.syncCache.put({ key, revision: row.revision, fingerprint: remoteFingerprint })
          }
          for (const local of await table.toArray()) {
            if (!remoteIds.has(local.id) && !pending.has(`${kind}:${local.id}`)) preserved += 1
          }
        }
      })
    } catch (reason) {
      error ??= reason instanceof Error ? reason : new Error(String(reason))
    }
    return {
      status: error ? 'stopped' : 'completed', error, preserved,
      pending: (await this.local.outbox.getAll()).length,
      conflicts: (await this.local.conflicts.getAll()).length
    }
  }

  private async acknowledge(entry: SyncOutboxEntry, remote: StoredRemoteEntity): Promise<void> {
    validateRemote(entry.kind, remote)
    const db = this.local.database
    await db.transaction('rw', db.tables, async () => {
      const pending = await this.local.outbox.getAll()
      const newer = pending.some((item) => item.mutationId !== entry.mutationId
        && item.kind === entry.kind && item.entityId === entry.entityId)
      const baseline = await db.syncCache.get(`${entry.kind}:${entry.entityId}`)
      if (!newer && (!baseline || baseline.revision <= remote.revision)) {
        const table = db.table<SyncableEntity, string>(syncTables[entry.kind])
        if (remote.payload) await table.put(remote.payload as unknown as SyncableEntity)
        else await table.delete(remote.id)
      }
      if (!baseline || baseline.revision <= remote.revision) {
        await db.syncCache.put({ key: `${entry.kind}:${entry.entityId}`, revision: remote.revision,
          fingerprint: remote.payload ? fingerprint(remote.payload) : null })
      }
      await this.local.outbox.remove(entry.mutationId)
    })
  }
}
