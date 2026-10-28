import { describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { getBookNotes } from '../../src/domain/book'
import { migrateBookToWork } from '../../src/domain/legacy-migration'
import { BookService } from '../../src/features/books/book-service'

describe('BookService', () => {
  it('persists source selections, preserves omitted sources and clears only on an explicit empty selection', async () => {
    const service = new BookService(createInMemoryRepositories())
    const book = await service.create({ reservedId: 'source-book', title: '來源保留', mediaTypeId: 'ebook', sourceIds: ['source-1'], cover: { path: '/cover.jpg', mimeType: 'image/jpeg' }, categoryIds: ['category-1'], tagIds: ['tag-1'], rating: { value: 4, scale: 5 }, bookNote: '人工備註' })
    const draft = { title: book.title, mediaTypeId: book.mediaTypeId, cover: book.cover }
    const updated = await service.update(book.id, draft, book.revision)
    expect(updated.sourceIds).toEqual(['source-1'])
    const cleared = await service.update(book.id, { ...draft, sourceIds: [] }, updated.revision)
    expect(cleared).toMatchObject({ sourceIds: [], categoryIds: ['category-1'], tagIds: ['tag-1'], rating: book.rating, bookNote: '人工備註', cover: book.cover })
    await expect(service.update(book.id, { ...draft, sourceIds: ['stale'] }, updated.revision)).rejects.toThrow()
    expect((await service.get(book.id))?.sourceIds).toEqual([])
  })
  it('uses the reserved draft identity for a new cover without persisting draft-only fields', async () => {
    const repositories = createInMemoryRepositories(), service = new BookService(repositories)
    const book = await service.create({ reservedId: 'reserved-book', title: '新書', mediaTypeId: 'ebook', cover: { path: '/api/v1/covers/covers/reserved.jpg', mimeType: 'image/jpeg', width: 800, height: 1135 } })
    expect(book.id).toBe('reserved-book')
    expect(book.cover).toMatchObject({ width: 800, height: 1135 })
    expect(book).not.toHaveProperty('reservedId')
    expect(await repositories.books.getAll()).toHaveLength(1)
  })
  it('refuses a reserved identity collision without replacing a book or adding metadata', async () => {
    const repositories = createInMemoryRepositories(), service = new BookService(repositories)
    const original = await service.create({ title: '原書', mediaTypeId: 'ebook' })
    await expect(service.create({ reservedId: original.id, title: '不應覆寫', authorNames: ['不應新增作者'], mediaTypeId: 'ebook' })).rejects.toThrow('未覆寫')
    expect(await service.get(original.id)).toEqual(original)
    expect(await repositories.dictionaries.getAll()).toEqual([])
  })
  it('creates and edits a book while preserving identity and creation time', async () => {
    const repositories = createInMemoryRepositories()
    const times = ['2026-09-14T00:00:00.000Z', '2026-09-14T01:00:00.000Z']
    const service = new BookService(repositories, () => 'book-1', () => times.shift()!)
    const created = await service.create({ title: ' 原書名 ', mediaTypeId: 'ebook', bookNote: '備註', categoryIds: ['c1'], tagIds: ['t1'], rating: { value: 4, scale: 5 } })
    const edited = await service.update(created.id, { title: '新書名', mediaTypeId: 'ebook', bookNote: '新備註', categoryIds: ['c2'], tagIds: ['t2'] })
    expect(edited).toMatchObject({ id: created.id, createdAt: created.createdAt, updatedAt: '2026-09-14T01:00:00.000Z', revision: 2, title: '新書名', bookNote: '新備註', categoryIds: ['c2'], tagIds: ['t2'] })
    expect(edited.rating).toEqual({ value: 4, scale: 5 })
    expect(await repositories.readingContents.getAll()).toEqual([])
  })
  it('allows a rating to be cleared without turning an unrated book into zero', async () => {
    const service = new BookService(createInMemoryRepositories(), () => 'book-1', () => '2026-09-14T00:00:00.000Z')
    const created = await service.create({ title: '書名', mediaTypeId: 'ebook', rating: { value: 8, scale: 10 } })
    expect((await service.update(created.id, { title: '書名', mediaTypeId: 'ebook', rating: null })).rating).toBeNull()
    await expect(service.update(created.id, { title: '書名', mediaTypeId: 'ebook', rating: { value: 0, scale: 5 } })).rejects.toThrow('rating')
  })
  it('rejects Base64 covers and does not save invalid books', async () => {
    const repositories = createInMemoryRepositories()
    const service = new BookService(repositories, () => 'book-1', () => '2026-09-14T00:00:00.000Z')
    await expect(service.create({ title: '書名', mediaTypeId: 'ebook', cover: { path: 'data:image/png;base64,abc', mimeType: 'image/png' } })).rejects.toThrow('file path')
    expect(await repositories.books.getAll()).toEqual([])
  })
  it('separates legacy Notion evidence when editing, preserving all original text and identity', async () => {
    const repositories = createInMemoryRepositories()
    const service = new BookService(repositories, () => 'book-legacy', () => '2026-10-02T00:00:00.000Z')
    const original = 'Notion 歷史搬遷｜原始資料保留\n【來源第 2 列】\n書名：原書名\n時間：2024/02/25\n人工補充也保留'
    const book = await service.create({ title: '原書名', mediaTypeId: 'ebook', bookNote: original })
    book.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: 'snapshot:2', importedAt: book.createdAt }
    await repositories.books.save(book)
    expect(getBookNotes(book)).toEqual({ bookNote: '', importSourceNotes: original })
    expect(migrateBookToWork(book)).toMatchObject({ note: '', importSourceNotes: original })
    expect((await repositories.books.getById(book.id))?.bookNote).toBe(original)
    const updated = await service.update(book.id, { title: book.title, mediaTypeId: 'ebook', bookNote: '我的書籍備註' }, book.revision)
    expect(updated).toMatchObject({ id: book.id, createdAt: book.createdAt, revision: 2, provenance: book.provenance, bookNote: '我的書籍備註', importSourceNotes: original })
    expect(getBookNotes(updated)).toEqual({ bookNote: '我的書籍備註', importSourceNotes: original })
    expect(migrateBookToWork(updated)).toMatchObject({ note: '我的書籍備註', importSourceNotes: original })
    const second = await service.update(book.id, { title: '改書名', mediaTypeId: 'ebook' }, updated.revision)
    expect(second).toMatchObject({ bookNote: '我的書籍備註', importSourceNotes: original })
  })

  it('does not interpret manual notes or edited-away legacy markers as import evidence', async () => {
    const service = new BookService(createInMemoryRepositories(), () => 'manual-book', () => '2026-10-02T00:00:00.000Z')
    const book = await service.create({ title: '書名', mediaTypeId: 'ebook', bookNote: 'Notion 歷史搬遷｜原始資料保留\n【來源第 2 列】\n我的文字' })
    expect(getBookNotes(book)).toEqual({ bookNote: book.bookNote })
    book.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: 'snapshot:2', importedAt: book.createdAt }
    book.bookNote = '使用者已改寫的備註'
    expect(getBookNotes(book)).toEqual({ bookNote: '使用者已改寫的備註' })
  })

})

it('preserves book word counts through unrelated edits and work migration, supports clearing, and rejects invalid counts', async () => {
  const repositories = createInMemoryRepositories()
  const service = new BookService(repositories, () => 'counted-book')
  const book = await service.create({ title: '字數測試', mediaTypeId: 'book', wordCount: 123456 })
  expect(migrateBookToWork(book).wordCount).toBe(123456)
  expect((await service.update(book.id, { title: book.title, mediaTypeId: 'book' })).wordCount).toBe(123456)
  for (const wordCount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await expect(service.update(book.id, { title: book.title, mediaTypeId: 'book', wordCount })).rejects.toThrow('字數')
  expect((await repositories.books.getById(book.id))?.wordCount).toBe(123456)
  expect((await service.update(book.id, { title: book.title, mediaTypeId: 'book', wordCount: null })).wordCount).toBeNull()
})
