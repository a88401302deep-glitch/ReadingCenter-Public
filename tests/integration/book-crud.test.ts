import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createIndexedDbRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'

const names: string[] = []
afterEach(async () => { for (const name of names) await Dexie.delete(name); names.length = 0 })
describe('Book CRUD integration', () => {
  it('keeps unrelated book and reading data across scoped saves, conflicts and database reopen', async () => {
    const name = `scoped-book-${crypto.randomUUID()}`; names.push(name)
    const first = createIndexedDbRepositories(name)
    try {
      const service = new BookService(first.repositories)
      const book = await service.create({ reservedId: 'scoped-book', title: '人工書名', mediaTypeId: 'ebook', authorNames: ['人工作者'], sourceIds: ['old-source'], categoryIds: ['category'], tagIds: ['tag'], cover: { path: '/local-cover.jpg', mimeType: 'image/jpeg' }, rating: { value: 4, scale: 5 }, bookNote: '我的備註' })
      const cycle = { ...book, id: 'scoped-cycle', bookId: book.id, sequence: 1, status: 'reading' as const, startedAt: book.createdAt, finishedAt: null, abandonedReason: null }
      await first.repositories.readingCycles.save(cycle)
      const draft = { title: book.title, mediaTypeId: book.mediaTypeId, cover: book.cover }
      const personal = await service.update(book.id, { ...draft, sourceIds: ['new-source'] }, book.revision)
      const bibliography = await service.update(book.id, { ...draft, title: '改書名' }, personal.revision)
      await expect(service.update(book.id, { ...draft, sourceIds: [] }, book.revision)).rejects.toThrow()
      expect(await first.repositories.readingCycles.getById(cycle.id)).toEqual(cycle)
      first.close()
      const reopened = createIndexedDbRepositories(name)
      try {
        expect(await reopened.repositories.books.getById(book.id)).toMatchObject({ title: '改書名', revision: bibliography.revision, sourceIds: ['new-source'], authorIds: book.authorIds, categoryIds: ['category'], tagIds: ['tag'], rating: book.rating, cover: book.cover, bookNote: '我的備註' })
        expect(await reopened.repositories.readingCycles.getById(cycle.id)).toEqual(cycle)
      } finally { reopened.close() }
    } finally { first.close() }
  })
  it('persists a book across repository instances and cascades confirmed deletion', async () => {
    const name = `book-crud-${crypto.randomUUID()}`; names.push(name)
    const first = createIndexedDbRepositories(name)
    const service = new BookService(first.repositories, () => 'book-1', () => '2026-09-14T00:00:00.000Z')
    const book = await service.create({ title: '持久化書籍', mediaTypeId: 'ebook' })
    await first.repositories.readingCycles.save({ ...book, id: 'cycle-1', bookId: book.id, sequence: 1, status: 'reading', startedAt: book.createdAt, finishedAt: null, abandonedReason: null })
    first.close()
    const reopened = createIndexedDbRepositories(name)
    const reopenedService = new BookService(reopened.repositories)
    expect((await reopenedService.list()).map((item) => item.title)).toEqual(['持久化書籍'])
    expect(await reopenedService.deletionImpact(book.id)).toEqual({ readingCycles: 1, readingRecords: 0, readingContents: 0 })
    await reopenedService.delete(book.id)
    expect(await reopened.repositories.books.getById(book.id)).toBeUndefined()
    expect(await reopened.repositories.readingCycles.getAll()).toEqual([])
    reopened.close()
  })
})
