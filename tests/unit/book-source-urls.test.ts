import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { getBookSourceUrls } from '../../src/domain/book'
import { migrateBookToWork } from '../../src/domain/legacy-migration'

it('exposes legacy imported URLs, saves them on editing, and preserves original evidence', async () => {
  const repos = createInMemoryRepositories()
  const service = new BookService(repos, () => 'legacy', () => '2026-10-02T00:00:00.000Z')
  const book = await service.create({ title: '原書名', mediaTypeId: 'ebook' })
  delete book.sourceUrls
  book.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: 'snapshot:2', importedAt: book.createdAt }
  book.importSourceNotes = 'Notion 歷史搬遷｜原始資料保留\n【來源第 2 列】\n網址：https://example.com/book\n網址：javascript:alert(1)\n網址：https://example.com/book'
  await repos.books.save(book)
  expect(getBookSourceUrls(book)).toEqual(['https://example.com/book'])
  const updated = await service.update(book.id, { title: book.title, mediaTypeId: 'ebook' }, book.revision)
  expect(updated.sourceUrls).toEqual(['https://example.com/book'])
  expect(updated.importSourceNotes).toBe(book.importSourceNotes)
  expect(migrateBookToWork(updated).sourceUrls).toEqual(updated.sourceUrls)
  const cleared = await service.update(book.id, { title: book.title, mediaTypeId: 'ebook', sourceUrls: [] }, updated.revision)
  expect(getBookSourceUrls(cleared)).toEqual([])
  expect(cleared.importSourceNotes).toBe(book.importSourceNotes)
})
it('never infers source URLs from manual notes', async () => {
  const service = new BookService(createInMemoryRepositories(), () => 'manual', () => '2026-10-02T00:00:00.000Z')
  const book = await service.create({ title: '手動書籍', mediaTypeId: 'ebook', bookNote: '網址：https://example.com' })
  delete book.sourceUrls
  expect(getBookSourceUrls(book)).toEqual([])
})
it('rejects unsafe URLs before saving', async () => {
  const repos = createInMemoryRepositories()
  const service = new BookService(repos, () => 'unsafe', () => '2026-10-02T00:00:00.000Z')
  for (const url of ['javascript:alert(1)', 'file:///tmp/book', 'https://user:password@example.com', 'not a URL']) {
    await expect(service.create({ title: '書名', mediaTypeId: 'ebook', sourceUrls: [url] })).rejects.toThrow('書籍網址')
  }
  expect(await repos.books.getAll()).toEqual([])
})
