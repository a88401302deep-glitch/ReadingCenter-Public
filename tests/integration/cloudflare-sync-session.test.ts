import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyncingIndexedDbRepositories, type SyncingLocalRepositoryContext } from '../../src/data'
import { updateEntity, type Book } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { CloudflareEntityClient } from '../../src/sync/cloudflare'
import { CloudflareSyncSession } from '../../src/sync/cloudflare/sync-session'
import type { RemoteEntity, StoredRemoteEntity } from '../../src/server/entity-api'

const contexts: SyncingLocalRepositoryContext[] = []
const now = '2026-10-01T00:00:00.000Z'
function device() {
  const local = createSyncingIndexedDbRepositories(`sync-session-${crypto.randomUUID()}`)
  contexts.push(local)
  return local
}
function stored(book: Book): StoredRemoteEntity {
  return { kind: 'book', id: book.id, revision: book.revision, createdAt: book.createdAt,
    updatedAt: book.updatedAt, schemaVersion: book.schemaVersion, provenance: book.provenance,
    deletedAt: null, payload: book as unknown as RemoteEntity }
}
function remoteService() {
  const rows = new Map<string, StoredRemoteEntity>()
  let offline = false
  let afterApply: (() => Promise<void>) | undefined
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (offline) throw new TypeError('offline')
    const url = new URL(String(input), 'https://sync.test')
    const parts = url.pathname.split('/')
    const kind = parts[4]
    if (!init?.method) return Response.json({ data: [...rows.values()].filter((row) => row.kind === kind) })
    const body = JSON.parse(String(init.body))
    const id = decodeURIComponent(parts[5])
    const current = rows.get(id)
    if ((current?.revision ?? 0) !== body.baseRevision) {
      return Response.json({ error: { code: 'revision_conflict', message: 'Conflict', current } }, { status: 409 })
    }
    const row = init.method === 'DELETE'
      ? { ...current!, revision: current!.revision + 1, updatedAt: body.deletedAt, deletedAt: body.deletedAt, payload: null }
      : stored(body.entity)
    rows.set(id, row)
    await afterApply?.()
    afterApply = undefined
    return Response.json({ data: row })
  })
  return { rows, fetcher, client: new CloudflareEntityClient('https://sync.test', fetcher),
    offline: (value: boolean) => { offline = value }, afterApply: (callback: () => Promise<void>) => { afterApply = callback } }
}

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.deleteDatabase()
})

describe('authenticated cloud sync session', () => {
  it('pushes edits, rebuilds an empty second device, and applies remote updates and tombstones without echoing them', async () => {
    const remote = remoteService()
    const first = device(), second = device()
    const service = new BookService(first.repositories, () => 'book-sync', () => now)
    const book = await service.create({ title: '跨裝置合成資料', mediaTypeId: 'ebook' })
    const a = new CloudflareSyncSession(first, remote.client), b = new CloudflareSyncSession(second, remote.client)
    expect(await a.sync()).toMatchObject({ status: 'completed', pending: 0, preserved: 0 })
    await b.sync()
    expect(await second.repositories.books.getById(book.id)).toEqual(book)
    expect(await second.outbox.getAll()).toEqual([])
    await service.update(book.id, { title: '更新合成資料', mediaTypeId: 'ebook' }, book.revision)
    await a.sync(); await b.sync()
    expect(await second.repositories.books.getById(book.id)).toMatchObject({ title: '更新合成資料', revision: 2 })
    await service.delete(book.id); await a.sync(); await b.sync()
    expect(await second.repositories.books.getById(book.id)).toBeUndefined()
    expect(await second.outbox.getAll()).toEqual([])
    expect(remote.fetcher.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true)
  })

  it('keeps offline edits durably and replays them after reopening', async () => {
    const remote = remoteService(), local = device()
    await new BookService(local.repositories, () => 'offline-book', () => now).create({ title: '離線合成資料', mediaTypeId: 'ebook' })
    remote.offline(true)
    expect(await new CloudflareSyncSession(local, remote.client).sync()).toMatchObject({ status: 'stopped', pending: 1 })
    const name = local.database.name
    local.close()
    const reopened = createSyncingIndexedDbRepositories(name)
    contexts.push(reopened)
    expect(await reopened.repositories.books.getById('offline-book')).toBeDefined()
    remote.offline(false)
    expect(await new CloudflareSyncSession(reopened, remote.client).sync()).toMatchObject({ status: 'completed', pending: 0 })
    expect(remote.rows.get('offline-book')?.payload?.title).toBe('離線合成資料')
  })

  it('does not overwrite an edit queued while an older request is in flight', async () => {
    const remote = remoteService(), local = device()
    const service = new BookService(local.repositories, () => 'concurrent-book', () => now)
    await service.create({ title: '第一版', mediaTypeId: 'ebook' })
    remote.afterApply(async () => { await service.update('concurrent-book', { title: '較新本機版', mediaTypeId: 'ebook' }) })
    const session = new CloudflareSyncSession(local, remote.client)
    expect(await session.sync()).toMatchObject({ pending: 1 })
    expect(await local.repositories.books.getById('concurrent-book')).toMatchObject({ title: '較新本機版', revision: 2 })
    await session.sync()
    expect(remote.rows.get('concurrent-book')?.payload?.title).toBe('較新本機版')
  })

  it('retains both versions and the queue on a concurrent-device conflict', async () => {
    const remote = remoteService(), a = device(), b = device()
    const sa = new CloudflareSyncSession(a, remote.client), sb = new CloudflareSyncSession(b, remote.client)
    const serviceA = new BookService(a.repositories, () => 'conflict-book', () => now)
    await serviceA.create({ title: '共同初版', mediaTypeId: 'ebook' }); await sa.sync(); await sb.sync()
    await serviceA.update('conflict-book', { title: '裝置 A', mediaTypeId: 'ebook' })
    await new BookService(b.repositories).update('conflict-book', { title: '裝置 B', mediaTypeId: 'ebook' })
    await sa.sync()
    expect(await sb.sync()).toMatchObject({ status: 'stopped', pending: 1, conflicts: 1 })
    expect(await b.repositories.books.getById('conflict-book')).toMatchObject({ title: '裝置 B' })
    expect((await b.conflicts.getAll())[0].remote?.payload).toMatchObject({ title: '裝置 A' })
  })

  it('preserves pre-existing local-only or different data without auto-uploading or overwriting it', async () => {
    const remote = remoteService(), local = device()
    const seed = device()
    const book = await new BookService(seed.rawRepositories, () => 'legacy-book', () => now).create({ title: '既有本機版', mediaTypeId: 'ebook' })
    await local.rawRepositories.books.save(book)
    remote.rows.set(book.id, stored({ ...book, title: '遠端版本', revision: 2 }))
    await new BookService(local.rawRepositories, () => 'local-only', () => now).create({ title: '尚未送出', mediaTypeId: 'ebook' })
    expect(await new CloudflareSyncSession(local, remote.client).sync()).toMatchObject({ preserved: 2, pending: 0 })
    expect(await local.repositories.books.getById(book.id)).toEqual(book)
    expect(remote.fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('validates the entire pull before changing any table', async () => {
    const remote = remoteService(), local = device(), seed = device()
    const book = await new BookService(seed.rawRepositories, () => 'valid-book', () => now).create({ title: '有效資料', mediaTypeId: 'ebook' })
    remote.rows.set(book.id, stored(book))
    remote.rows.set('bad-book', { ...stored(book), id: 'bad-book' })
    expect(await new CloudflareSyncSession(local, remote.client).sync()).toMatchObject({ status: 'stopped' })
    expect(await local.repositories.books.getAll()).toEqual([])
  })

  it('does not upload an edit of unverified legacy data even when its revision happens to match the remote copy', async () => {
    const remote = remoteService(), local = device()
    const book = await new BookService(local.rawRepositories, () => 'unverified-book', () => now).create({ title: '未核對本機資料', mediaTypeId: 'ebook' })
    remote.rows.set(book.id, stored({ ...book, title: '同版號不同遠端內容' }))
    await new BookService(local.repositories).update(book.id, { title: '本機修改', mediaTypeId: 'ebook' })
    expect(await new CloudflareSyncSession(local, remote.client).sync()).toMatchObject({ status: 'stopped', pending: 1 })
    expect(remote.rows.get(book.id)?.payload?.title).toBe('同版號不同遠端內容')
    expect(await local.repositories.books.getById(book.id)).toMatchObject({ title: '本機修改' })
    expect(remote.fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('rejects a stale form after a remote refresh and rejects concurrent local saves atomically', async () => {
    const remote = remoteService(), local = device()
    const service = new BookService(local.repositories, () => 'stale-book', () => now)
    const book = await service.create({ title: '初版', mediaTypeId: 'ebook' })
    const session = new CloudflareSyncSession(local, remote.client)
    await session.sync()
    remote.rows.set(book.id, stored(updateEntity(book, { title: '遠端新版' }, now)))
    await session.sync()
    await expect(service.update(book.id, { title: '舊表單', mediaTypeId: 'ebook' }, book.revision)).rejects.toThrow('資料已有新版本')
    const current = (await service.get(book.id))!
    const results = await Promise.allSettled([
      local.repositories.books.save(updateEntity(current, { title: '同時編輯 A' }, now)),
      local.repositories.books.save(updateEntity(current, { title: '同時編輯 B' }, now))
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await local.outbox.getAll()).toHaveLength(1)
  })
})
