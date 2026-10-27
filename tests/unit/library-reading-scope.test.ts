import { expect, it } from 'vitest'
import { BookService } from '../../src/features/books/book-service'
import { createInMemoryRepositories } from '../../src/data'
import { isWaitingBook } from '../../src/features/library/library-reading-scope'
import type { ReadingCycle, ReadingRecord } from '../../src/domain'

async function fixture() {
  const book = await new BookService(createInMemoryRepositories(), () => 'book', () => '2026-10-03T00:00:00.000Z').create({ title: '待讀書籍', mediaTypeId: 'novel' })
  book.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: `${'a'.repeat(64)}:2`, importedAt: book.createdAt }
  book.importSourceNotes = 'Notion 歷史搬遷｜原始資料保留\n【來源第 2 列】\n一行心得：\n時間：\n讀完：No\n閱讀：尚未開始\n閱讀時間：總共閱讀0天\n關聯生活點滴：'
  return book
}
it('moves only explicit unstarted sources to waiting, keeping unknown and conflicting evidence visible', async () => {
  const book = await fixture()
  expect(isWaitingBook(book, [], [])).toBe(true)
  for (const [from, to] of [['閱讀：尚未開始', '閱讀：'], ['閱讀：尚未開始', '閱讀：已讀完'], ['時間：\n', '時間：2024/01/01\n'], ['一行心得：\n', '一行心得：看完了\n'], ['讀完：No', '讀完：Yes'], ['總共閱讀0天', '總共閱讀2天'], ['關聯生活點滴：', '關聯生活點滴：日誌']]) expect(isWaitingBook({ ...book, importSourceNotes: book.importSourceNotes!.replace(from, to) }, [], [])).toBe(false)
  expect(isWaitingBook({ ...book, provenance: { kind: 'manual' } }, [], [])).toBe(false)
  expect(isWaitingBook({ ...book, importSourceNotes: undefined, bookNote: book.importSourceNotes! }, [], [])).toBe(true)
})
it('prioritizes reading records and nonplanned cycles, and moves started books back into the catalog', async () => {
  const book = await fixture()
  const planned = { bookId: book.id, status: 'planned', startedAt: null, finishedAt: null, completionDate: null, reportedReadingDays: null } as ReadingCycle
  expect(isWaitingBook(book, [planned], [])).toBe(true)
  for (const status of ['reading', 'completed', 'paused', 'abandoned'] as const) expect(isWaitingBook(book, [{ ...planned, status }], [])).toBe(false)
  expect(isWaitingBook(book, [planned], [{ bookId: book.id } as ReadingRecord])).toBe(false)
  expect(isWaitingBook(book, [{ ...planned, startedAt: '2026-10-03T00:00:00.000Z' }], [])).toBe(false)
  expect(isWaitingBook(book, [{ ...planned, bookId: 'other' }], [{ bookId: 'other' } as ReadingRecord])).toBe(true)
})
