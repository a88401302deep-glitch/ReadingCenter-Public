import { describe, expect, it, vi } from 'vitest'
import type { Book } from '../../src/domain'
import type { SyncOutboxEntry } from '../../src/data'
import {
  CloudflareEntityClient,
  RemoteApiError,
  RemoteNetworkError,
  RemoteProtocolError
} from '../../src/sync/cloudflare'

const now = '2026-09-15T00:00:00.000Z'
const book: Book = {
  id: 'book/1', createdAt: now, updatedAt: now, revision: 1, schemaVersion: 1,
  provenance: { kind: 'manual' }, title: '同步測試', preferredTitle: null, subtitle: null,
  languageTag: 'zh-Hant', titleAliases: [], externalReferences: [], publicationKind: 'published',
  collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null,
  originalTitle: null, authorIds: [], publisherId: null, mediaTypeId: 'ebook', categoryIds: [],
  tagIds: [], sourceIds: [], cover: null, bookNote: ''
}

const putEntry: SyncOutboxEntry = {
  mutationId: 'mutation:create:1', kind: 'book', entityId: book.id, operation: 'put',
  baseRevision: 0, queuedAt: now, attemptCount: 0, lastAttemptAt: null, lastError: null, entity: book
}

const stored = {
  kind: 'book', id: book.id, revision: 1, createdAt: now, updatedAt: now,
  schemaVersion: 1, provenance: { kind: 'manual' as const }, deletedAt: null, payload: book
}

describe('CloudflareEntityClient', () => {
  it('calls browser fetch with the global receiver rather than the client instance', async () => {
    const fetcher = vi.fn(async function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Response.json({ data: [] })
    })
    await expect(new CloudflareEntityClient('', fetcher).list('book')).resolves.toEqual([])
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('sends a queued mutation with its stable id, revision, and session cookie', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: stored, replayed: false }, { status: 201 }))
    const client = new CloudflareEntityClient('https://reading.example/', fetcher)

    await expect(client.apply(putEntry)).resolves.toEqual(stored)
    expect(fetcher).toHaveBeenCalledWith('https://reading.example/api/v1/entities/book/book%2F1', expect.objectContaining({
      method: 'PUT', credentials: 'include',
      body: JSON.stringify({ mutationId: putEntry.mutationId, baseRevision: 0, entity: book })
    }))
  })

  it('sends tombstones as DELETE mutations', async () => {
    const deleted = { ...stored, revision: 2, deletedAt: now, payload: null }
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: deleted, replayed: false }))
    const client = new CloudflareEntityClient('', fetcher)
    const entry: SyncOutboxEntry = {
      mutationId: 'mutation:delete:1', kind: 'book', entityId: book.id, operation: 'delete',
      baseRevision: 1, deletedAt: now, queuedAt: now, attemptCount: 0, lastAttemptAt: null, lastError: null
    }

    await client.apply(entry)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/entities/book/book%2F1', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify({ mutationId: entry.mutationId, baseRevision: 1, deletedAt: now })
    }))
  })

  it('preserves the server copy on revision conflicts', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      error: { code: 'revision_conflict', message: 'Entity revision conflict', current: stored }
    }, { status: 409 }))

    const error = await new CloudflareEntityClient('', fetcher).apply(putEntry).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(RemoteApiError)
    expect(error).toMatchObject({ status: 409, code: 'revision_conflict', current: stored })
  })

  it.each([
    [401, 'authentication_required'],
    [507, 'storage_limit_reached']
  ])('exposes HTTP %i as a typed API error', async (status, code) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code, message: 'blocked' } }, { status }))
    const error = await new CloudflareEntityClient('', fetcher).list('book').catch((reason: unknown) => reason)
    expect(error).toMatchObject({ status, code })
  })

  it('keeps network failures separate from server responses', async () => {
    const cause = new TypeError('Failed to fetch')
    const client = new CloudflareEntityClient('', vi.fn().mockRejectedValue(cause))
    const error = await client.list('book').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(RemoteNetworkError)
    expect(error).toMatchObject({ cause })
  })

  it('rejects malformed success responses instead of discarding local work', async () => {
    const client = new CloudflareEntityClient('', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    await expect(client.apply(putEntry)).rejects.toBeInstanceOf(RemoteProtocolError)
  })
})
