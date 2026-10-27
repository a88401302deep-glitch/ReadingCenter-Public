import { expect, it, vi } from 'vitest'
import { BookService } from '../../src/features/books/book-service'
import { createInMemoryRepositories } from '../../src/data'
import { prepareNotionCompletionBackfill, runNotionCompletionBackfill } from '../../src/import/notion-completion-backfill'
import type { StoredRemoteEntity } from '../../src/server/entity-api'
import { RemoteApiError } from '../../src/sync/cloudflare/entity-client'

async function fixture() {
  const book = await new BookService(createInMemoryRepositories(), () => 'book', () => '2026-10-03T00:00:00.000Z').create({ title: '日期未提供', mediaTypeId: 'ebook' })
  book.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: `${'a'.repeat(64)}:2`, importedAt: book.createdAt }
  book.importSourceNotes = 'Notion 歷史搬遷｜原始資料保留\n【來源第 2 列】\n書名：日期未提供\n時間：\n閱讀：已讀完\n閱讀時間：總共閱讀3天\n關聯生活點滴：'
  const stored = { kind: 'book', id: book.id, revision: 3, deletedAt: null, payload: book } as unknown as StoredRemoteEntity
  return { book, stored }
}
it('selects only explicit undated completion sources and accepts books changed by author backfill', async () => {
  const { book, stored } = await fixture()
  expect(prepareNotionCompletionBackfill([stored], []).candidates).toHaveLength(1)
  for (const [from, to] of [['時間：\n', '時間：2020/01/01\n'], ['閱讀：已讀完', '閱讀：尚未開始'], ['關聯生活點滴：', '關聯生活點滴：日誌'], ['第 2 列', '第 3 列'], ['總共閱讀3天', '不明'], ['關聯生活點滴：', '關聯生活點滴：\n【來源第 3 列】\n閱讀：已讀完']]) {
    expect(prepareNotionCompletionBackfill([{ ...stored, payload: { ...book, importSourceNotes: book.importSourceNotes!.replace(from, to) } } as unknown as StoredRemoteEntity], []).candidates).toHaveLength(0)
  }
  expect(prepareNotionCompletionBackfill([{ ...stored, payload: { ...book, provenance: { kind: 'manual' } } } as unknown as StoredRemoteEntity], []).candidates).toHaveLength(0)
})
it('preserves any existing reading cycle and deterministic deleted cycle IDs', async () => {
  const { book, stored } = await fixture()
  for (const cycle of [
    { kind: 'readingCycle', id: 'manual', payload: { bookId: book.id } },
    { kind: 'readingCycle', id: `notion:cycle:${'a'.repeat(64)}:2`, deletedAt: '2026-10-03T00:00:00.000Z', payload: null }
  ]) expect(prepareNotionCompletionBackfill([stored], [cycle as unknown as StoredRemoteEntity])).toMatchObject({ candidates: [], preserved: 1 })
})
it('creates only an undated completed cycle, retains source days, and repeated runs are skipped', async () => {
  const { stored } = await fixture()
  const cycles: StoredRemoteEntity[] = []
  const apply = vi.fn().mockImplementation(async (entry) => { const result = { kind: entry.kind, id: entry.entityId, payload: entry.entity }; cycles.push(result as unknown as StoredRemoteEntity); return result })
  const client = { get: vi.fn().mockResolvedValue(stored), list: vi.fn().mockImplementation(async () => cycles), apply }
  const plan = prepareNotionCompletionBackfill([stored], [])
  expect(await runNotionCompletionBackfill(plan, client, new AbortController().signal, () => {})).toMatchObject({ added: 1, stopped: false })
  expect(apply.mock.calls[0][0]).toMatchObject({ kind: 'readingCycle', baseRevision: 0, entity: { status: 'completed', sequence: 1, completionDate: null, startedAt: null, finishedAt: null, reportedReadingDays: 3 } })
  expect(await runNotionCompletionBackfill(plan, client, new AbortController().signal, () => {})).toMatchObject({ added: 0, skipped: 1 })
  expect(apply).toHaveBeenCalledTimes(1)
})
it('skips changed books, stops on authentication loss and writes nothing after cancellation', async () => {
  const { stored } = await fixture()
  const plan = prepareNotionCompletionBackfill([stored], [])
  const apply = vi.fn()
  const client = { get: vi.fn().mockResolvedValue({ ...stored, revision: 4 }), list: vi.fn().mockResolvedValue([]), apply }
  expect(await runNotionCompletionBackfill(plan, client, new AbortController().signal, () => {})).toMatchObject({ skipped: 1, added: 0 })
  client.get.mockRejectedValue(new RemoteApiError(401, 'unauthorized', '請登入'))
  expect(await runNotionCompletionBackfill(plan, client, new AbortController().signal, () => {})).toMatchObject({ stopped: true, added: 0 })
  const controller = new AbortController(); controller.abort()
  expect(await runNotionCompletionBackfill(plan, client, controller.signal, () => {})).toMatchObject({ stopped: true, added: 0 })
  expect(apply).not.toHaveBeenCalled()
})
