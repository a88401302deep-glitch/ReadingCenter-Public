import { describe, expect, it, vi } from 'vitest'
import { createMetadata } from '../../src/domain'
import { StoreConflictError, type RemoteEntityStore, type StoredRemoteEntity } from '../../src/server/entity-api'
import { handleNotionCoverBackfill } from '../../worker/notion-cover-backfill'
import { handleCoverAssetApi } from '../../worker/cover-assets'
import worker from '../../worker/index'
import type { CoverKV } from '../../worker/cloudflare-types'

const hash = 'a'.repeat(64)
const id = `notion:book:${hash}:2`
const now = '2026-10-02T00:00:00.000Z'
async function fixture() {
  const images = new Map<string, ArrayBuffer>()
  const kv: CoverKV = { put: async (key, bytes) => { images.set(key, bytes as ArrayBuffer) }, get: async (key) => images.get(key) ?? null }
  const upload = await handleCoverAssetApi(new Request('https://example.test/api/v1/covers/notion', { method: 'POST', headers: { 'X-Book-Id': id, 'X-Book-Title': encodeURIComponent('書'), 'Content-Type': 'image/jpeg' }, body: new Uint8Array([255, 216, 255, 217]) }), kv, true)
  const cover = (await upload.json()).data.cover
  const payload = { ...createMetadata({ id, now }), title: '人工書名', bookNote: '人工備註', rating: { value: 5, scale: 5 }, cover: null, externalReferences: [{ sourceId: 'notion-csv-snapshot', externalId: `${hash}:2` }] }
  const current: StoredRemoteEntity = { kind: 'book', id, revision: 1, createdAt: now, updatedAt: now, schemaVersion: 1, provenance: payload.provenance, deletedAt: null, payload }
  const put = vi.fn<RemoteEntityStore['put']>().mockResolvedValue({ entity: current, replayed: false, created: false })
  const store: RemoteEntityStore = { get: vi.fn().mockResolvedValue(current), list: vi.fn(), delete: vi.fn(), put }
  const request = (changes = {}) => new Request('https://example.test/api/v1/import/notion/cover', { method: 'POST', body: JSON.stringify({ bookId: id, csvSha256: hash, rowNumber: 2, baseRevision: 1, mutationId: 'cover-test', cover, ...changes }) })
  return { kv, current, put, store, request, cover }
}
describe('cover-only authenticated backfill', () => {
  it('keeps all current manual fields and metadata, attaching only a verified cover', async () => {
    const f = await fixture()
    expect((await handleNotionCoverBackfill(f.request({ entity: { title: '不可覆蓋' } }), f.store, f.kv)).status).toBe(200)
    const change = f.put.mock.calls[0][0]
    expect({ ...change.entity, updatedAt: now }).toEqual({ ...f.current.payload, cover: f.cover })
    expect(change.entity.updatedAt).not.toBe(now)
    expect(change.baseRevision).toBe(1)
  })
  it('preserves a concurrently added existing cover without writing', async () => {
    const f = await fixture(); f.current.payload!.cover = { path: 'manual.jpg', mimeType: 'image/jpeg' }
    const response = await handleNotionCoverBackfill(f.request(), f.store, f.kv)
    expect((await response.json()).data.status).toBe('already-covered')
    expect(f.put).not.toHaveBeenCalled()
  })
  it.each(['deleted', 'wrong-source', 'stale-revision', 'wrong-cover'])('rejects %s without changing a book', async (kind) => {
    const f = await fixture()
    if (kind === 'deleted') { f.current.deletedAt = now; f.current.payload = null }
    if (kind === 'wrong-source') f.current.payload!.externalReferences = []
    if (kind === 'stale-revision') f.current.revision = 2
    const response = await handleNotionCoverBackfill(f.request(kind === 'wrong-cover' ? { cover: { ...f.cover, path: f.cover.path.replace(encodeURIComponent(id), encodeURIComponent(id.replace(/:2$/, ':3'))) } } : {}), f.store, f.kv)
    expect([404, 409]).toContain(response.status)
    expect(f.put).not.toHaveBeenCalled()
  })
  it('reports a race as a conflict and refuses unauthenticated Worker access', async () => {
    const f = await fixture(); f.put.mockRejectedValue(new StoreConflictError())
    expect((await handleNotionCoverBackfill(f.request(), f.store, f.kv)).status).toBe(409)
    const response = await worker.fetch(f.request(), { API_ENABLED: 'true', AUTH_PASSWORD: 'test-password', AUTH_SESSION_SECRET: 'secret', ASSETS: { fetch: vi.fn() } })
    expect(response.status).toBe(401)
  })
})
