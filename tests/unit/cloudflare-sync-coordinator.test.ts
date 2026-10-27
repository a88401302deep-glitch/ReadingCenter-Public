import { describe, expect, it, vi } from 'vitest'
import type { Book } from '../../src/domain'
import type { RemoteEntity, StoredRemoteEntity } from '../../src/server/entity-api'
import type {
  EntityRepository,
  ReadingCenterRepositories,
  SyncOutboxEntry,
  SyncOutboxRepository,
  SyncConflictRecord,
  SyncableEntity
} from '../../src/data'
import {
  CloudflareSyncCoordinator,
  RemoteApiError,
  RemoteNetworkError,
  RemoteProtocolError
} from '../../src/sync/cloudflare'

const firstTime = '2026-09-15T00:00:00.000Z'
const attemptTime = '2026-09-16T00:00:00.000Z'

function createBook(revision: number, title: string): Book {
  return {
    id: 'book-1', createdAt: firstTime, updatedAt: firstTime, revision, schemaVersion: 1,
    provenance: { kind: 'manual' }, title, preferredTitle: null, subtitle: null,
    languageTag: 'zh-Hant', titleAliases: [], externalReferences: [], publicationKind: 'published',
    collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null,
    originalTitle: null, authorIds: [], publisherId: null, mediaTypeId: 'ebook', categoryIds: [],
    tagIds: [], sourceIds: [], cover: null, bookNote: ''
  }
}

function putEntry(revision: number, mutationId: string, title: string): SyncOutboxEntry {
  return {
    mutationId, kind: 'book', entityId: 'book-1', operation: 'put',
    baseRevision: revision - 1, queuedAt: firstTime, attemptCount: 0,
    lastAttemptAt: null, lastError: null, entity: createBook(revision, title)
  }
}

function stored(revision: number, title: string): StoredRemoteEntity {
  return {
    kind: 'book' as const, id: 'book-1', revision, createdAt: firstTime, updatedAt: firstTime,
    schemaVersion: 1, provenance: { kind: 'manual' as const }, deletedAt: null,
    payload: createBook(revision, title) as unknown as RemoteEntity
  }
}

function createHarness(entries: SyncOutboxEntry[]) {
  const saved: SyncableEntity[] = []
  const deleted: string[] = []
  const removed: string[] = []
  const failures: Array<{ mutationId: string; attemptedAt: string; error: string }> = []
  const conflicts: SyncConflictRecord[] = []
  const repository: EntityRepository<SyncableEntity> = {
    getById: vi.fn(), getAll: vi.fn(), clear: vi.fn(),
    save: vi.fn(async (entity) => { saved.push(entity) }),
    delete: vi.fn(async (id) => { deleted.push(id) })
  }
  const repositories = {
    works: repository, activityLogs: repository,
    books: repository, readingCycles: repository, readingRecords: repository,
    readingContents: repository, dictionaries: repository, collections: repository, readingGoals: repository, readingPreferences: repository
  } as unknown as ReadingCenterRepositories
  const outbox: SyncOutboxRepository = {
    getAll: vi.fn(async () => entries),
    remove: vi.fn(async (mutationId) => { removed.push(mutationId) }),
    markFailed: vi.fn(async (mutationId, attemptedAt, error) => {
      failures.push({ mutationId, attemptedAt, error })
    })
  }
  const conflictRepository = {
    getAll: vi.fn(async () => conflicts),
    getByMutationId: vi.fn(async (mutationId: string) => conflicts.find((item) => item.mutationId === mutationId)),
    save: vi.fn(async (conflict: SyncConflictRecord) => {
      const existing = conflicts.findIndex((item) => item.mutationId === conflict.mutationId)
      if (existing >= 0) conflicts[existing] = conflict
      else conflicts.push(conflict)
    }),
    remove: vi.fn(async (mutationId: string) => {
      const index = conflicts.findIndex((item) => item.mutationId === mutationId)
      if (index >= 0) conflicts.splice(index, 1)
    })
  }
  return { repositories, outbox, conflictRepository, conflicts, saved, deleted, removed, failures }
}

describe('CloudflareSyncCoordinator', () => {
  it('drains mutations in sequence, hydrates the latest server copy, and acknowledges each entry', async () => {
    const entries = [putEntry(1, 'mutation-1', '初版'), putEntry(2, 'mutation-2', '新版')]
    const harness = createHarness(entries)
    const apply = vi.fn()
      .mockResolvedValueOnce(stored(1, '初版'))
      .mockResolvedValueOnce(stored(2, '新版'))
    const coordinator = new CloudflareSyncCoordinator(harness.outbox, harness.repositories, { apply })

    await expect(coordinator.sync()).resolves.toEqual({ status: 'completed', processed: 2, remaining: 0 })
    expect(apply.mock.calls.map(([entry]) => entry.mutationId)).toEqual(['mutation-1', 'mutation-2'])
    expect(harness.removed).toEqual(['mutation-1', 'mutation-2'])
    expect(harness.saved).toHaveLength(1)
    expect(harness.saved[0]).toMatchObject({ revision: 2, title: '新版' })
  })

  it('keeps the failed entry and all later work when the network is unavailable', async () => {
    const entries = [putEntry(1, 'mutation-1', '初版'), putEntry(2, 'mutation-2', '新版')]
    const harness = createHarness(entries)
    const apply = vi.fn().mockRejectedValue(new RemoteNetworkError(new TypeError('offline')))
    const coordinator = new CloudflareSyncCoordinator(
      harness.outbox,
      harness.repositories,
      { apply },
      { now: () => attemptTime }
    )

    const result = await coordinator.sync()
    expect(result).toMatchObject({
      status: 'stopped', processed: 0, remaining: 2,
      failedMutationId: 'mutation-1', reason: 'network'
    })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(harness.removed).toEqual([])
    expect(harness.failures).toEqual([{
      mutationId: 'mutation-1', attemptedAt: attemptTime,
      error: 'RemoteNetworkError: Unable to reach the remote data service'
    }])
  })

  it('retains the local mutation and exposes the server copy on a revision conflict', async () => {
    const entry = putEntry(2, 'mutation-2', '本機版本')
    const harness = createHarness([entry])
    const current = stored(2, '伺服器版本')
    const conflict = new RemoteApiError(409, 'revision_conflict', 'Entity revision conflict', current)
    const coordinator = new CloudflareSyncCoordinator(
      harness.outbox,
      harness.repositories,
      { apply: vi.fn().mockRejectedValue(conflict) },
      { now: () => attemptTime, conflicts: harness.conflictRepository }
    )

    const result = await coordinator.sync()
    expect(result).toMatchObject({ status: 'stopped', reason: 'api', error: conflict })
    if (result.status !== 'stopped') throw new Error('Expected sync to stop')
    expect((result.error as RemoteApiError).current).toEqual(current)
    expect(harness.removed).toEqual([])
    expect(harness.saved).toEqual([])
    expect(harness.conflicts).toEqual([expect.objectContaining({
      mutationId: 'mutation-2', reason: 'revision_conflict', detectedAt: attemptTime,
      local: entry, remote: expect.objectContaining({ payload: expect.objectContaining({ title: '伺服器版本' }) })
    })])
  })

  it('deletes the local entity only after the latest tombstone is accepted', async () => {
    const entry: SyncOutboxEntry = {
      mutationId: 'mutation-delete', kind: 'book', entityId: 'book-1', operation: 'delete',
      baseRevision: 1, deletedAt: attemptTime, queuedAt: attemptTime,
      attemptCount: 0, lastAttemptAt: null, lastError: null
    }
    const harness = createHarness([entry])
    const tombstone = { ...stored(2, 'ignored'), deletedAt: attemptTime, payload: null }
    const coordinator = new CloudflareSyncCoordinator(
      harness.outbox, harness.repositories, { apply: vi.fn().mockResolvedValue(tombstone) }
    )

    await coordinator.sync()
    expect(harness.deleted).toEqual(['book-1'])
    expect(harness.removed).toEqual(['mutation-delete'])
  })

  it('does not acknowledge a mismatched server response', async () => {
    const entry = putEntry(1, 'mutation-1', '初版')
    const harness = createHarness([entry])
    const wrong = { ...stored(1, '錯誤'), id: 'different-book' }
    const coordinator = new CloudflareSyncCoordinator(
      harness.outbox,
      harness.repositories,
      { apply: vi.fn().mockResolvedValue(wrong) },
      { now: () => attemptTime }
    )

    const result = await coordinator.sync()
    expect(result).toMatchObject({ status: 'stopped', reason: 'protocol' })
    expect(result.status === 'stopped' && result.error).toBeInstanceOf(RemoteProtocolError)
    expect(harness.removed).toEqual([])
  })

  it('coalesces concurrent sync requests into one drain', async () => {
    const harness = createHarness([putEntry(1, 'mutation-1', '初版')])
    let resolveApply!: (value: ReturnType<typeof stored>) => void
    const apply = vi.fn(() => new Promise<ReturnType<typeof stored>>((resolve) => { resolveApply = resolve }))
    const coordinator = new CloudflareSyncCoordinator(harness.outbox, harness.repositories, { apply })

    const first = coordinator.sync()
    const second = coordinator.sync()
    expect(first).toBe(second)
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    resolveApply(stored(1, '初版'))
    await first
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
