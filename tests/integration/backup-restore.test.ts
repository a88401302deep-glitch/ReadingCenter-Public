import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createIndexedDbRepositories, createSyncingIndexedDbRepositories, type LocalRepositoryContext } from '../../src/data'
import { createMetadata } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { captureDeviceBackup } from '../../src/features/backup/backup-export'
import { restoreBackup, restoreRows } from '../../src/features/backup/backup-restore'
import type { VerifiedBackup } from '../../src/features/backup/backup-preview'
import { fingerprint } from '../../src/sync/cloudflare/cache'
const contexts: LocalRepositoryContext[] = []
afterEach(async () => { for (const local of contexts.splice(0)) { local.close(); await local.deleteDatabase() } })
const now = '2026-10-14T12:00:00.000Z'
async function fixture() {
  const local = createIndexedDbRepositories(`restore-${crypto.randomUUID()}`); contexts.push(local)
  const book = await new BookService(local.repositories, () => '11111111-1111-4111-8111-111111111111', () => now).create({ title: '合成還原測試', mediaTypeId: 'ebook', bookNote: '目前人工備註' })
  const expected = await captureDeviceBackup(local.repositories), backup = structuredClone(expected)
  backup.data.books[0].bookNote = '備份備註'; backup.data.books[0].revision = 99
  return { local, book, expected, verified: { backup, includedCovers: 0, referenceCovers: 0, warnings: [], coverFiles: new Map() } as VerifiedBackup, selected: new Set([`books:${book.id}`]) }
}
it('requires explicit choices, rebases revisions and repeated restore offers no new changes', async () => {
  const { local, book, expected, verified, selected } = await fixture()
  await expect(restoreBackup({ repositories: local.repositories, expected, verified, selected: new Set() })).rejects.toThrow('選擇')
  expect((await local.repositories.books.getById(book.id))?.bookNote).toBe('目前人工備註')
  await restoreBackup({ repositories: local.repositories, expected, verified, selected, now })
  const restored = (await local.repositories.books.getById(book.id))!
  expect(restored.bookNote).toBe('備份備註'); expect(restored.revision).toBe(2); expect(restored.createdAt).toBe(book.createdAt)
  expect(restoreRows(verified.backup, await captureDeviceBackup(local.repositories))).toHaveLength(0)
})
it('preserves manual provenance and unselected data', async () => {
  const { local, book, expected, verified, selected } = await fixture()
  verified.backup.data.books[0].provenance = { kind: 'import', sourceId: 'source', externalId: 'external', importedAt: now }
  verified.backup.data.books.push({ ...book, id: 'new-book' }); verified.backup.counts.books++
  await restoreBackup({ repositories: local.repositories, expected, verified, selected, now })
  expect((await local.repositories.books.getById(book.id))?.provenance).toEqual({ kind: 'manual' })
  expect(await local.repositories.books.getById('new-book')).toBeUndefined()
})
it('rejects stale previews before writing', async () => {
  const { local, book, expected, verified, selected } = await fixture()
  await new BookService(local.repositories).update(book.id, { title: '新的編輯', mediaTypeId: 'ebook', bookNote: '新資料' })
  await expect(restoreBackup({ repositories: local.repositories, expected, verified, selected })).rejects.toThrow('已有更新')
  expect((await local.repositories.books.getById(book.id))?.title).toBe('新的編輯')
})
it('rolls back all writes if any selected save fails', async () => {
  const { local, book, expected, verified, selected } = await fixture()
  verified.backup.data.collections.push({ ...createMetadata({ id: 'series', now }), kind: 'series', name: '測試系列' }); verified.backup.counts.collections++
  selected.add('collections:series')
  vi.spyOn(local.repositories.collections, 'save').mockRejectedValue(new Error('disk failure'))
  await expect(restoreBackup({ repositories: local.repositories, expected, verified, selected })).rejects.toThrow('disk failure')
  expect((await local.repositories.books.getById(book.id))?.bookNote).toBe('目前人工備註')
  expect(await local.repositories.collections.getAll()).toHaveLength(0)
})
it('requires dependent book rows and creates new data with revision one while keeping current-only books', async () => {
  const { local, book, expected, verified } = await fixture()
  verified.backup.data.books[0] = { ...book, id: 'other-book' }
  verified.backup.data.readingCycles.push({ ...createMetadata({ id: 'cycle', now }), bookId: 'other-book', sequence: 1, status: 'planned', startedAt: null, finishedAt: null, abandonedReason: null }); verified.backup.counts.readingCycles++
  await expect(restoreBackup({ repositories: local.repositories, expected, verified, selected: new Set(['readingCycles:cycle']) })).rejects.toThrow('關聯')
  await restoreBackup({ repositories: local.repositories, expected, verified, selected: new Set(['readingCycles:cycle', 'books:other-book']), now })
  expect((await local.repositories.books.getById('other-book'))?.revision).toBe(1)
  expect(await local.repositories.books.getById(book.id)).toEqual(book)
})
it('blocks pending edits and cached tombstones and queues selected changes through normal repositories', async () => {
  const local = createSyncingIndexedDbRepositories(`restore-sync-${crypto.randomUUID()}`); contexts.push(local)
  const book = await new BookService(local.repositories, () => 'book', () => now).create({ title: '同步測試', mediaTypeId: 'ebook', bookNote: '' })
  const expected = await captureDeviceBackup(local.repositories), backup = structuredClone(expected); backup.data.books[0].bookNote = '選定備註'
  const verified: VerifiedBackup = { backup, includedCovers: 0, referenceCovers: 0, warnings: [], coverFiles: new Map() }, selected = new Set(['books:book'])
  await expect(restoreBackup({ repositories: local.repositories, local, expected, verified, selected })).rejects.toThrow('待同步')
  await local.database.syncOutbox.clear(); await local.database.syncCache.put({ key: 'book:book', revision: 1, fingerprint: fingerprint(book) })
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ data: [{ kind: 'book', ...book, deletedAt: null, payload: book }] }))
  await restoreBackup({ repositories: local.repositories, local, expected, verified, selected, now, fetch: fetcher })
  expect((await local.outbox.getAll())[0]).toMatchObject({ operation: 'put', baseRevision: 1, entity: { revision: 2, bookNote: '選定備註' } })
  await local.database.syncOutbox.clear(); await local.rawRepositories.books.delete('book'); await local.database.syncCache.put({ key: 'book:book', revision: 3, fingerprint: null })
  await expect(restoreBackup({ repositories: local.repositories, local, expected: await captureDeviceBackup(local.repositories), verified, selected })).rejects.toThrow('已刪除')
  expect(await local.repositories.books.getAll()).toHaveLength(0)
})
it('recreates packaged covers before committing and refuses writes on upload failure', async () => {
  const { local, expected, verified, selected } = await fixture()
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const cover = { path: `/api/v1/covers/covers/11111111-1111-4111-8111-111111111111/${hash}-test.png`, mimeType: 'image/png' as const }
  verified.backup.data.books[0].cover = cover; verified.coverFiles.set(cover.path, bytes)
  await expect(restoreBackup({ repositories: local.repositories, expected, verified, selected, fetch: vi.fn().mockResolvedValue(new Response('', { status: 503 })) })).rejects.toThrow('封面還原失敗')
  expect((await local.repositories.books.getAll())[0].cover).toBeNull()
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { cover, sha256: hash, bytes: bytes.length } }))
  await restoreBackup({ repositories: local.repositories, expected, verified, selected, fetch: fetcher, now })
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][0]).toBe('/api/v1/covers/moon'); expect((await local.repositories.books.getAll())[0].cover).toEqual(cover)
})
it('checks cloud deletion even without a cache and refuses unreachable cloud state', async () => {
  const local = createSyncingIndexedDbRepositories(`restore-cloud-${crypto.randomUUID()}`); contexts.push(local)
  const book = await new BookService(local.rawRepositories, () => 'deleted-book', () => now).create({ title: '歷史書籍', mediaTypeId: 'ebook' })
  const backup = await captureDeviceBackup(local.rawRepositories); await local.rawRepositories.books.delete(book.id)
  const expected = await captureDeviceBackup(local.repositories), verified: VerifiedBackup = { backup, includedCovers: 0, referenceCovers: 0, warnings: [], coverFiles: new Map() }, selected = new Set(['books:deleted-book'])
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ kind: 'book', ...book, revision: 2, updatedAt: now, deletedAt: now, payload: null }] }))
  await expect(restoreBackup({ repositories: local.repositories, local, expected, verified, selected, fetch: fetcher })).rejects.toThrow('雲端已刪除')
  await expect(restoreBackup({ repositories: local.repositories, local, expected, verified, selected, fetch: vi.fn().mockRejectedValue(new TypeError('offline')) })).rejects.toThrow('需要連線')
  expect(await local.repositories.books.getAll()).toHaveLength(0); expect(await local.outbox.getAll()).toHaveLength(0)
})
