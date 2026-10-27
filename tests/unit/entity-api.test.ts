import { describe, expect, it } from 'vitest'
import { StoreConflictError, handleEntityApi, type RemoteEntity, type RemoteEntityKind, type RemoteEntityStore, type RemoteMutationResult, type StoredRemoteEntity } from '../../src/server/entity-api'

const firstAt = '2026-09-15T00:00:00.000Z'
const secondAt = '2026-09-15T01:00:00.000Z'

describe('Cloudflare entity API contract', () => {
  it('creates, lists, updates and tombstones a book without changing createdAt', async () => {
    const store = new MemoryStore()
    const created = await call(store, 'PUT', '/api/v1/entities/book/book-1', { mutationId: 'mutation:create:1', baseRevision: 0, entity: book({ revision: 1 }) })
    expect(created.status).toBe(201)
    expect((await created.json()).data.revision).toBe(1)
    expect((await (await call(store, 'GET', '/api/v1/entities/book')).json()).data).toHaveLength(1)

    const updated = await call(store, 'PUT', '/api/v1/entities/book/book-1', {
      mutationId: 'mutation:update:1', baseRevision: 1,
      entity: book({ title: '更新書名', createdAt: secondAt, updatedAt: secondAt, revision: 2 })
    })
    const updatedBody = await updated.json()
    expect(updatedBody.data.createdAt).toBe(firstAt)
    expect(updatedBody.data.payload.title).toBe('更新書名')

    const removed = await call(store, 'DELETE', '/api/v1/entities/book/book-1', { mutationId: 'mutation:delete:1', baseRevision: 2, deletedAt: '2026-09-15T02:00:00.000Z' })
    expect(removed.status).toBe(200)
    expect((await call(store, 'GET', '/api/v1/entities/book/book-1')).status).toBe(404)
    expect((await call(store, 'GET', '/api/v1/entities/book/book-1?includeDeleted=true')).status).toBe(200)
  })

  it('replays a mutation idempotently and rejects a stale revision', async () => {
    const store = new MemoryStore()
    const input = { mutationId: 'mutation:create:2', baseRevision: 0, entity: book({ revision: 1 }) }
    await call(store, 'PUT', '/api/v1/entities/book/book-1', input)
    const replay = await call(store, 'PUT', '/api/v1/entities/book/book-1', input)
    expect(replay.status).toBe(200)
    expect((await replay.json()).replayed).toBe(true)
    const conflict = await call(store, 'PUT', '/api/v1/entities/book/book-1', { mutationId: 'mutation:stale:2', baseRevision: 0, entity: book({ revision: 1, title: '過期修改' }) })
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error.code).toBe('revision_conflict')
  })

  it('accepts Work and ActivityLog through the shared entity API', async () => {
    const store = new MemoryStore()
    const workResponse = await call(store, 'PUT', '/api/v1/entities/work/work-1', {
      mutationId: 'mutation:work:1',
      baseRevision: 0,
      entity: work()
    })
    const activityResponse = await call(store, 'PUT', '/api/v1/entities/activityLog/activity-1', {
      mutationId: 'mutation:activity:1',
      baseRevision: 0,
      entity: activityLog()
    })

    expect(workResponse.status).toBe(201)
    expect(activityResponse.status).toBe(201)
    expect((await workResponse.json()).data.kind).toBe('work')
    expect((await activityResponse.json()).data.kind).toBe('activityLog')
  })

  it('rejects invalid ActivityLog types, durations, and time ranges', async () => {
    const invalidType = await call(new MemoryStore(), 'PUT', '/api/v1/entities/activityLog/activity-1', {
      mutationId: 'mutation:activity:type',
      baseRevision: 0,
      entity: activityLog({ activityType: 'listen' })
    })
    const invalidDuration = await call(new MemoryStore(), 'PUT', '/api/v1/entities/activityLog/activity-1', {
      mutationId: 'mutation:activity:duration',
      baseRevision: 0,
      entity: activityLog({ durationMinutes: -1 })
    })
    const invalidRange = await call(new MemoryStore(), 'PUT', '/api/v1/entities/activityLog/activity-1', {
      mutationId: 'mutation:activity:range',
      baseRevision: 0,
      entity: activityLog({ endedAt: '2026-09-14T23:00:00.000Z' })
    })

    expect(invalidType.status).toBe(400)
    expect(invalidDuration.status).toBe(400)
    expect(invalidRange.status).toBe(400)
  })

  it('rejects malformed domain data before it reaches storage', async () => {
    const response = await call(new MemoryStore(), 'PUT', '/api/v1/entities/readingContent/note-1', {
      mutationId: 'mutation:invalid:1', baseRevision: 0,
      entity: { ...book({ id: 'note-1', revision: 1 }), type: 'unknown', text: '', bookId: 'book-1' }
    })
    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

async function call(store: RemoteEntityStore, method: string, path: string, body?: unknown): Promise<Response> {
  return handleEntityApi(new Request(`https://reading.example${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  }), store)
}

function book(changes: Partial<RemoteEntity> = {}): RemoteEntity {
  return { id: 'book-1', title: '測試書籍', mediaTypeId: 'media-book', createdAt: firstAt, updatedAt: firstAt, revision: 1, schemaVersion: 1, provenance: { kind: 'manual' }, ...changes }
}

function work(changes: Partial<RemoteEntity> = {}): RemoteEntity {
  return {
    id: 'work-1',
    title: '測試作品',
    mediaType: 'novel',
    createdAt: firstAt,
    updatedAt: firstAt,
    revision: 1,
    schemaVersion: 1,
    provenance: { kind: 'manual' },
    ...changes
  }
}

function activityLog(changes: Partial<RemoteEntity> = {}): RemoteEntity {
  return {
    id: 'activity-1',
    workId: 'work-1',
    activityType: 'read',
    startedAt: firstAt,
    endedAt: secondAt,
    durationMinutes: 60,
    createdAt: firstAt,
    updatedAt: firstAt,
    revision: 1,
    schemaVersion: 1,
    provenance: { kind: 'manual' },
    ...changes
  }
}

class MemoryStore implements RemoteEntityStore {
  private readonly entities = new Map<string, StoredRemoteEntity>()
  private readonly receipts = new Map<string, string>()

  async get(kind: RemoteEntityKind, id: string): Promise<StoredRemoteEntity | undefined> { return this.entities.get(`${kind}:${id}`) }
  async list(kind: RemoteEntityKind, includeDeleted: boolean): Promise<StoredRemoteEntity[]> {
    return [...this.entities.values()].filter((item) => item.kind === kind && (includeDeleted || !item.deletedAt))
  }
  async put(input: { kind: RemoteEntityKind; mutationId: string; baseRevision: number; entity: RemoteEntity }): Promise<RemoteMutationResult> {
    const replay = this.replay(input.mutationId, input.kind, input.entity.id)
    if (replay) return replay
    const current = await this.get(input.kind, input.entity.id)
    if ((current?.revision ?? 0) !== input.baseRevision || current?.deletedAt) throw new StoreConflictError(current)
    const payload = { ...input.entity, createdAt: current?.createdAt ?? input.entity.createdAt, revision: input.baseRevision + 1 }
    const entity: StoredRemoteEntity = { kind: input.kind, id: payload.id, revision: payload.revision, createdAt: payload.createdAt, updatedAt: payload.updatedAt, schemaVersion: payload.schemaVersion, provenance: payload.provenance, deletedAt: null, payload }
    this.entities.set(`${input.kind}:${input.entity.id}`, entity)
    this.receipts.set(input.mutationId, `${input.kind}:${input.entity.id}`)
    return { entity, replayed: false, created: !current }
  }
  async delete(input: { kind: RemoteEntityKind; id: string; mutationId: string; baseRevision: number; deletedAt: string }): Promise<RemoteMutationResult> {
    const replay = this.replay(input.mutationId, input.kind, input.id)
    if (replay) return replay
    const current = await this.get(input.kind, input.id)
    if (!current || current.deletedAt || current.revision !== input.baseRevision) throw new StoreConflictError(current)
    const entity = { ...current, revision: current.revision + 1, updatedAt: input.deletedAt, deletedAt: input.deletedAt, payload: null }
    this.entities.set(`${input.kind}:${input.id}`, entity)
    this.receipts.set(input.mutationId, `${input.kind}:${input.id}`)
    return { entity, replayed: false, created: false }
  }
  private replay(mutationId: string, kind: RemoteEntityKind, id: string): RemoteMutationResult | undefined {
    const key = this.receipts.get(mutationId)
    if (!key) return undefined
    if (key !== `${kind}:${id}`) throw new StoreConflictError()
    const entity = this.entities.get(key)
    if (!entity) throw new Error('Missing replay entity')
    return { entity, replayed: true, created: false }
  }
}
