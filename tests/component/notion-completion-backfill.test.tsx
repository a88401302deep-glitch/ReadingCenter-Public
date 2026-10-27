// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NotionCompletionBackfill } from '../../src/features/import/NotionCompletionBackfill'
import { BookService } from '../../src/features/books/book-service'
import { createInMemoryRepositories } from '../../src/data'

afterEach(() => vi.unstubAllGlobals())
it('previews without writing, then confirms a single undated completion and refreshes sync', async () => {
  const book = await new BookService(createInMemoryRepositories(), () => 'book', () => '2026-10-03T00:00:00.000Z').create({ title: '未註日期', mediaTypeId: 'ebook' })
  book.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: `${'a'.repeat(64)}:2`, importedAt: book.createdAt }
  book.importSourceNotes = 'Notion 歷史搬遷｜原始資料保留\n【來源第 2 列】\n時間：\n閱讀：已讀完\n閱讀時間：總共閱讀0天\n關聯生活點滴：'
  const stored = { kind: 'book', id: book.id, revision: 1, createdAt: book.createdAt, updatedAt: book.updatedAt, schemaVersion: 1, provenance: book.provenance, deletedAt: null, payload: book }
  const request = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
    if (init?.method === 'PUT') {
      const { entity } = JSON.parse(String(init.body))
      return Response.json({ data: { ...stored, kind: 'readingCycle', id: entity.id, payload: entity } })
    }
    return Response.json({ data: String(path).includes('/entities/book/') ? stored : String(path).includes('/entities/book') ? [stored] : [] })
  })
  vi.stubGlobal('fetch', request)
  const updated = vi.fn()
  render(<NotionCompletionBackfill onUpdated={updated} />)
  fireEvent.click(screen.getByRole('button', { name: '比對缺少的完讀狀態' }))
  await screen.findByText(/可批次補 1 本.*尚未寫入/)
  expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '確認批次補完讀狀態' }))
  await screen.findByText(/本批結束：已補 1 本/)
  expect(updated).toHaveBeenCalledTimes(1)
  const puts = request.mock.calls.filter(([, init]) => init?.method === 'PUT')
  expect(puts).toHaveLength(1)
  expect(JSON.parse(String(puts[0][1]?.body)).entity).toMatchObject({ completionDate: null, reportedReadingDays: null })
})
