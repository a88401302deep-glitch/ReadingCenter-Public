import { expect, it, vi } from 'vitest'
import { createMetadata, type SourceReadingDay } from '../../src/domain'
import { handleEntityApi, type RemoteEntityStore } from '../../src/server/entity-api'
import { validateRemote } from '../../src/sync/cloudflare/cache'

it('validates source evidence on the remote API and refuses date/quantity corruption', async () => {
  const now = '2026-01-01T00:00:00Z'
  const entity: SourceReadingDay = { ...createMetadata({ id: 'source', now }), source: 'moon', deviceId: 'one', sourcePath: '/book.txt', sourceTitle: 'Book', backupName: 'backup.mrpro', dayCode: 20697, date: '2026-09-02', durationMs: 12345, readWords: 10, progressPercent: 100, bookId: null, completionDisputed: false }
  const remote = { kind: 'sourceReadingDay' as const, id: entity.id, revision: 1, createdAt: now, updatedAt: now, schemaVersion: 1, provenance: entity.provenance, deletedAt: null, payload: { ...entity } }
  const store: RemoteEntityStore = { get: vi.fn(), list: vi.fn(), delete: vi.fn(), put: vi.fn().mockResolvedValue({ entity: remote, replayed: false, created: true }) }
  const request = (value: unknown) => new Request('https://example.test/api/v1/entities/sourceReadingDay/source', { method: 'PUT', body: JSON.stringify({ mutationId: 'mutation-source', baseRevision: 0, entity: value }) })
  expect((await handleEntityApi(request(entity), store)).status).toBe(201)
  expect(() => validateRemote('sourceReadingDay', remote)).not.toThrow()
  for (const invalid of [{ ...entity, date: '2026-09-01' }, { ...entity, durationMs: -1 }, { ...entity, progressPercent: 101 }]) {
    expect((await handleEntityApi(request(invalid), store)).status).toBe(400)
  }
  expect(store.put).toHaveBeenCalledTimes(1)
})
