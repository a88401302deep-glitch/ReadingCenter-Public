import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyncingIndexedDbRepositories, type SyncingLocalRepositoryContext, type SyncOutboxEntry } from '../../src/data'
import { updateEntity, type Book } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'
import { CloudflareEntityClient, RemoteApiError, RemoteNetworkError } from '../../src/sync/cloudflare'
import { CloudflareSyncSession } from '../../src/sync/cloudflare/sync-session'
import { SyncReviewService, StaleSyncReviewError } from '../../src/sync/cloudflare/sync-review-service'
import type { RemoteEntity, RemoteEntityKind, StoredRemoteEntity } from '../../src/server/entity-api'

const now = '2026-10-01T00:00:00.000Z'
const contexts: SyncingLocalRepositoryContext[] = []
const rowFor = (book: Book): StoredRemoteEntity => ({ kind: 'book', id: book.id, revision: book.revision,
  createdAt: book.createdAt, updatedAt: book.updatedAt, schemaVersion: book.schemaVersion, provenance: book.provenance,
  deletedAt: null, payload: book as unknown as RemoteEntity })
class Remote extends CloudflareEntityClient {
  rows = new Map<string, StoredRemoteEntity>()
  offline = false
  async list(kind: RemoteEntityKind): Promise<StoredRemoteEntity[]> {
    this.checkNetwork()
    return structuredClone([...this.rows.values()].filter((row) => row.kind === kind))
  }
  async get(kind: RemoteEntityKind, id: string): Promise<StoredRemoteEntity> {
    this.checkNetwork()
    const row = this.rows.get(`${kind}:${id}`)
    if (!row) throw new RemoteApiError(404, 'not_found', 'Not found')
    return structuredClone(row)
  }
  async apply(entry: SyncOutboxEntry): Promise<StoredRemoteEntity> {
    this.checkNetwork()
    const key = `${entry.kind}:${entry.entityId}`
    const current = this.rows.get(key)
    if ((current?.revision ?? 0) !== entry.baseRevision) throw new RemoteApiError(409, 'revision_conflict', 'Conflict', current)
    const row: StoredRemoteEntity = entry.operation === 'put'
      ? { kind: entry.kind, ...entry.entity, deletedAt: null, payload: entry.entity as unknown as RemoteEntity }
      : { ...current!, revision: current!.revision + 1, updatedAt: entry.deletedAt, deletedAt: entry.deletedAt, payload: null }
    this.rows.set(key, row)
    return structuredClone(row)
  }
  private checkNetwork() { if (this.offline) throw new RemoteNetworkError(new TypeError('offline')) }
}
function setup() {
  const local = createSyncingIndexedDbRepositories(`review-${crypto.randomUUID()}`)
  contexts.push(local)
  const remote = new Remote()
  const service = new BookService(local.repositories, () => 'book-review', () => now)
  const review = new SyncReviewService(local, remote, () => now)
  const session = new CloudflareSyncSession(local, remote)
  return { local, remote, service, review, session }
}
afterEach(async () => { for (const context of contexts.splice(0)) await context.deleteDatabase() })

describe('explicit sync review decisions', () => {
  it('migrates a local-only copy with a fresh create revision and archives the original before sending', async () => {
    const { local, remote, review, session } = setup()
    const original = await new BookService(local.rawRepositories, () => 'legacy-book', () => now).create({ title: '本機待遷移合成資料', mediaTypeId: 'ebook' })
    await local.rawRepositories.books.save({ ...original, revision: 5 })
    const [item] = await review.list()
    expect(item.reason).toBe('local-only')
    await review.resolve(item, 'local')
    expect(remote.rows.size).toBe(0)
    expect(await local.outbox.getAll()).toEqual([expect.objectContaining({ baseRevision: 0, entity: expect.objectContaining({ revision: 1 }) })])
    expect((await review.archives())[0].review.local?.revision).toBe(5)
    expect(await session.sync()).toMatchObject({ status: 'completed', pending: 0 })
    expect(remote.rows.get('book:legacy-book')?.payload?.title).toBe(original.title)
  })

  it('rebases all later edits of the conflicted entity into one replacement at the original queue position', async () => {
    const { local, remote, service, review, session } = setup()
    const original = await service.create({ title: '共同初版', mediaTypeId: 'ebook' }); await session.sync()
    await service.update(original.id, { title: '第二版本機', mediaTypeId: 'ebook' })
    await service.update(original.id, { title: '最新本機內容', mediaTypeId: 'ebook' })
    await new BookService(local.repositories, () => 'unrelated', () => now).create({ title: '另一筆合成資料', mediaTypeId: 'ebook' })
    remote.rows.set(`book:${original.id}`, rowFor(updateEntity(original, { title: '遠端競爭版本' }, now)))
    expect(await session.sync()).toMatchObject({ conflicts: 1, pending: 3 })
    const [item] = await review.list()
    const before = await local.outbox.getAll()
    await review.resolve(item, 'local')
    const after = await local.outbox.getAll()
    expect(after).toHaveLength(2)
    expect(after[0]).toMatchObject({ entityId: original.id, baseRevision: 2, sequence: before[0].sequence, entity: { title: '最新本機內容', revision: 3 } })
    expect(after[0].mutationId).not.toBe(before[0].mutationId)
    expect(after[1].entityId).toBe('unrelated')
    expect(await local.conflicts.getAll()).toEqual([])
    expect((await review.archives())[0].review.pending).toHaveLength(2)
    expect(await session.sync()).toMatchObject({ status: 'completed', pending: 0 })
    expect(remote.rows.get(`book:${original.id}`)?.payload?.title).toBe('最新本機內容')
  })

  it('adopts the remote copy without echoing a write and keeps unrelated pending work', async () => {
    const { local, remote, service, review, session } = setup()
    const original = await service.create({ title: '共同初版', mediaTypeId: 'ebook' }); await session.sync()
    await service.update(original.id, { title: '本機未送出', mediaTypeId: 'ebook' })
    await new BookService(local.repositories, () => 'other').create({ title: '其他資料', mediaTypeId: 'ebook' })
    const changed = updateEntity(original, { title: '選用遠端內容' }, now)
    remote.rows.set(`book:${original.id}`, rowFor(changed)); await session.sync()
    const [item] = await review.list(); await review.resolve(item, 'remote')
    expect(await local.repositories.books.getById(original.id)).toEqual(changed)
    expect((await local.outbox.getAll()).map((entry) => entry.entityId)).toEqual(['other'])
    expect((await review.archives())[0].review.local).toMatchObject({ title: '本機未送出' })
  })

  it('rejects a decision after newer local edits, retaining the queue and both stored copies', async () => {
    const { local, remote, service, review, session } = setup()
    const original = await service.create({ title: '初版', mediaTypeId: 'ebook' }); await session.sync()
    await service.update(original.id, { title: '核對時本機', mediaTypeId: 'ebook' })
    remote.rows.set(`book:${original.id}`, rowFor(updateEntity(original, { title: '遠端新版' }, now))); await session.sync()
    const [item] = await review.list()
    await service.update(original.id, { title: '核對後新編輯', mediaTypeId: 'ebook' })
    await expect(review.resolve(item, 'remote')).rejects.toBeInstanceOf(StaleSyncReviewError)
    expect(await local.repositories.books.getById(original.id)).toMatchObject({ title: '核對後新編輯' })
    expect(await local.outbox.getAll()).toHaveLength(2)
    expect(await review.archives()).toEqual([])
  })

  it('rejects a decision after the remote version changes or the connection fails', async () => {
    const { local, remote, review } = setup()
    const book = await new BookService(local.rawRepositories, () => 'legacy').create({ title: '本機版', mediaTypeId: 'ebook' })
    remote.rows.set('book:legacy', rowFor({ ...book, title: '遠端一版' }))
    const [item] = await review.list()
    remote.rows.set('book:legacy', rowFor(updateEntity(book, { title: '遠端再次更新' }, now)))
    await expect(review.resolve(item, 'local')).rejects.toBeInstanceOf(StaleSyncReviewError)
    remote.offline = true
    await expect(review.resolve(item, 'remote')).rejects.toBeInstanceOf(RemoteNetworkError)
    expect(await local.repositories.books.getById(book.id)).toEqual(book)
    expect(await local.outbox.getAll()).toEqual([])
    expect(await review.archives()).toEqual([])
  })

  it('does not let imported data override a manual remote copy', async () => {
    const { local, remote, review } = setup()
    const book = await new BookService(local.rawRepositories, () => 'protected', () => now).create({ title: '匯入資料', mediaTypeId: 'ebook' })
    await local.rawRepositories.books.save({ ...book, provenance: { kind: 'import', sourceId: 'notion', externalId: 'synthetic', importedAt: now } })
    remote.rows.set('book:protected', rowFor({ ...book, title: '人工維護資料' }))
    const [item] = await review.list()
    await expect(review.resolve(item, 'local')).rejects.toThrow('匯入資料不能覆蓋')
    await review.resolve(item, 'remote')
    expect(await local.repositories.books.getById(book.id)).toMatchObject({ title: '人工維護資料', provenance: { kind: 'manual' } })
    expect((await review.archives())[0].review.local?.provenance.kind).toBe('import')
  })

  it('can restore a pending local deletion from the reviewed remote copy', async () => {
    const { local, remote, service, review, session } = setup()
    const book = await service.create({ title: '刪除核對合成資料', mediaTypeId: 'ebook' }); await session.sync()
    await local.repositories.books.delete(book.id)
    remote.rows.set(`book:${book.id}`, rowFor(updateEntity(book, { title: '遠端保留新版' }, now))); await session.sync()
    const [item] = await review.list()
    expect(item.local).toBeNull()
    await review.resolve(item, 'remote')
    expect(await local.repositories.books.getById(book.id)).toMatchObject({ title: '遠端保留新版' })
    expect(await local.outbox.getAll()).toEqual([])
  })

  it('requires a synced parent before migrating a child and protects local referenced data from removal', async () => {
    const { local, remote, review } = setup()
    const book = await new BookService(local.rawRepositories, () => 'parent', () => now).create({ title: '所屬書籍合成資料', mediaTypeId: 'ebook' })
    const content = await new ReadingContentService(local.rawRepositories, () => 'child', () => now).create(book.id, { type: 'shortReview', text: '所屬短評', cycleId: null, recordedForAt: null })
    const items = await review.list()
    await expect(review.resolve(items.find((item) => item.kind === 'readingContent')!, 'local')).rejects.toThrow('請先核對並同步所屬')
    await expect(review.resolve(items.find((item) => item.kind === 'book')!, 'remote')).rejects.toThrow('本機關聯資料')
    remote.rows.set(`book:${book.id}`, rowFor(book))
    const [child] = await review.list()
    expect(child.entityId).toBe(content.id)
    await review.resolve(child, 'local')
    expect(await local.outbox.getAll()).toHaveLength(1)
  })

  it('retains a remote tombstone until the user confirms whether to restore the local copy', async () => {
    const { local, remote, review, session } = setup()
    const book = await new BookService(local.rawRepositories, () => 'tombstone', () => now).create({ title: '刪除來源合成資料', mediaTypeId: 'ebook' })
    remote.rows.set('book:tombstone', { ...rowFor(book), revision: 2, deletedAt: now, payload: null })
    const [item] = await review.list(); await review.resolve(item, 'local')
    expect((await local.outbox.getAll())[0]).toMatchObject({ baseRevision: 2, entity: { revision: 3 } })
    expect(await session.sync()).toMatchObject({ status: 'completed' })
    expect(remote.rows.get('book:tombstone')?.deletedAt).toBeNull()
  })

  it('leaves the conflict and queue intact when the retained-copy transaction cannot be stored', async () => {
    const { local, remote, service, review, session } = setup()
    const book = await service.create({ title: '交易失敗合成資料', mediaTypeId: 'ebook' }); await session.sync()
    await service.update(book.id, { title: '保留本機編輯', mediaTypeId: 'ebook' })
    remote.rows.set(`book:${book.id}`, rowFor(updateEntity(book, { title: '保留遠端編輯' }, now))); await session.sync()
    const [item] = await review.list()
    const pending = await local.outbox.getAll()
    vi.spyOn(local.database.syncReviewArchive, 'add').mockRejectedValueOnce(new Error('Quota exceeded'))
    await expect(review.resolve(item, 'remote')).rejects.toThrow('Quota exceeded')
    expect(await local.outbox.getAll()).toEqual(pending)
    expect(await local.conflicts.getAll()).toHaveLength(1)
    expect(await local.repositories.books.getById(book.id)).toMatchObject({ title: '保留本機編輯' })
    expect(await review.archives()).toEqual([])
  })
})
