import { expect, it, vi } from 'vitest'
import { BookService } from '../../src/features/books/book-service'
import { createInMemoryRepositories } from '../../src/data'
import { classifyNotionMedia, prepareNotionMediaBackfill, runNotionMediaBackfill } from '../../src/import/notion-media-backfill'
import { migrateBookToWork } from '../../src/domain'
import type { StoredRemoteEntity } from '../../src/server/entity-api'
import { RemoteApiError } from '../../src/sync/cloudflare/entity-client'

async function fixture(category = '漫畫') {
  const hash = 'a'.repeat(64)
  const book = await new BookService(createInMemoryRepositories(), () => 'book', () => '2026-10-03T00:00:00.000Z').create({ title: '測試書籍', mediaTypeId: `notion:dictionary:${hash}:mediaType:unmapped` })
  book.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: `${hash}:2`, importedAt: book.createdAt }
  book.categoryIds = category.split(',').filter(x => x.trim()).map(x => `notion:dictionary:${hash}:category:${encodeURIComponent(x.trim())}`)
  book.importSourceNotes = `Notion 歷史搬遷｜原始資料保留\n【來源第 2 列】\n主題：${category}\n作者：甲`
  const stored = { kind: 'book', id: book.id, revision: 3, deletedAt: null, payload: book } as unknown as StoredRemoteEntity
  const dictionaries = book.categoryIds.map((id, index) => ({ kind: 'dictionary', id, deletedAt: null, payload: { kind: 'category', name: category.split(',')[index].trim() } }) as unknown as StoredRemoteEntity)
  return { book, stored, dictionaries }
}
it('uses a general book fallback for ambiguous topics and empty categories but rejects explicit conflicts', () => {
  expect(classifyNotionMedia(['溫馨療癒', '漫畫'])).toBe('manga')
  expect(classifyNotionMedia(['網路\\原創小說'])).toBe('webNovel')
  expect(classifyNotionMedia(['輕小說'])).toBe('novel')
  expect(classifyNotionMedia(['雜誌'])).toBe('magazine')
  for (const categories of [['網路'], ['圖文書'], ['懸疑推理'], []]) expect(classifyNotionMedia(categories)).toBe('book')
  expect(classifyNotionMedia(['漫畫', '小說'])).toBeNull()
})
it('preserves changed categories and explicit media types, and separates insufficient evidence', async () => {
  const { book, stored, dictionaries } = await fixture()
  expect(prepareNotionMediaBackfill([stored], dictionaries).candidates).toHaveLength(1)
  expect(prepareNotionMediaBackfill([{ ...stored, payload: { ...book, mediaTypeId: 'novel' } } as unknown as StoredRemoteEntity], dictionaries)).toMatchObject({ candidates: [], preserved: 1 })
  expect(prepareNotionMediaBackfill([{ ...stored, payload: { ...book, categoryIds: [] } } as unknown as StoredRemoteEntity], dictionaries)).toMatchObject({ candidates: [], preserved: 1 })
  expect(prepareNotionMediaBackfill([stored], [{ ...dictionaries[0], deletedAt: '2026-10-03T00:00:00.000Z' }])).toMatchObject({ candidates: [], preserved: 1 })
  const unknown = await fixture('漫畫,小說')
  expect(prepareNotionMediaBackfill([unknown.stored], unknown.dictionaries).unresolved).toHaveLength(1)
})
it('creates readable media dictionaries before updating only mediaTypeId and remains compatible with Work', async () => {
  const { book, stored, dictionaries } = await fixture()
  const apply = vi.fn().mockImplementation(async entry => ({ kind: entry.kind, id: entry.entityId, payload: entry.entity }))
  const client = { get: vi.fn().mockResolvedValue(stored), list: vi.fn().mockResolvedValue(dictionaries), apply }
  expect(await runNotionMediaBackfill(prepareNotionMediaBackfill([stored], dictionaries), client, new AbortController().signal, () => {})).toMatchObject({ added: 1, stopped: false })
  expect(apply.mock.calls[0][0]).toMatchObject({ kind: 'dictionary', entityId: 'manga', entity: { name: '漫畫', kind: 'mediaType' }, baseRevision: 0 })
  const written = apply.mock.calls[1][0].entity
  expect({ ...written, mediaTypeId: book.mediaTypeId, revision: 3, updatedAt: book.updatedAt }).toEqual({ ...book, revision: 3 })
  expect(migrateBookToWork(written).mediaType).toBe('manga')
  expect(prepareNotionMediaBackfill([{ ...stored, payload: written }], dictionaries).candidates).toHaveLength(0)
})
it('skips stale books, stops on dictionary collisions or lost authentication, and supports cancellation', async () => {
  const { stored, dictionaries } = await fixture()
  const plan = prepareNotionMediaBackfill([stored], dictionaries)
  const apply = vi.fn()
  const client = { get: vi.fn().mockResolvedValue({ ...stored, revision: 4 }), list: vi.fn().mockResolvedValue(dictionaries), apply }
  expect(await runNotionMediaBackfill(plan, client, new AbortController().signal, () => {})).toMatchObject({ skipped: 1 })
  client.get.mockResolvedValue(stored)
  client.list.mockResolvedValue([...dictionaries, { id: 'manga', payload: { kind: 'mediaType', name: '不同名稱' } } as unknown as StoredRemoteEntity])
  expect(await runNotionMediaBackfill(plan, client, new AbortController().signal, () => {})).toMatchObject({ added: 0, stopped: true })
  client.get.mockRejectedValue(new RemoteApiError(401, 'unauthorized', '請登入'))
  expect(await runNotionMediaBackfill(plan, client, new AbortController().signal, () => {})).toMatchObject({ stopped: true })
  const controller = new AbortController(); controller.abort()
  expect(await runNotionMediaBackfill(plan, client, controller.signal, () => {})).toMatchObject({ stopped: true })
  expect(apply).not.toHaveBeenCalled()
})

it('writes a general book fallback for empty categories, preserves source notes, and does not repeat it', async () => {
  const { book, stored, dictionaries } = await fixture('')
  const plan = prepareNotionMediaBackfill([stored], dictionaries)
  expect(plan.candidates[0].mediaType).toBe('book')
  const apply = vi.fn().mockResolvedValue({})
  const client = { get: vi.fn().mockResolvedValue(stored), list: vi.fn().mockResolvedValue(dictionaries), apply }
  expect(await runNotionMediaBackfill(plan, client, new AbortController().signal, () => {})).toMatchObject({ added: 1, stopped: false })
  expect(apply.mock.calls[0][0]).toMatchObject({ entityId: 'book', entity: { name: '一般書籍' } })
  const written = apply.mock.calls[1][0].entity
  expect(written.importSourceNotes).toBe(book.importSourceNotes)
  expect(written.categoryIds).toEqual([])
  expect(migrateBookToWork(written).mediaType).toBe('book')
  expect(prepareNotionMediaBackfill([{ ...stored, payload: written }], dictionaries)).toMatchObject({ candidates: [], preserved: 1 })
})
