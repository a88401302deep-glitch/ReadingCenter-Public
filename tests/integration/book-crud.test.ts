import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createIndexedDbRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'

const names: string[] = []
afterEach(async () => { for (const name of names) await Dexie.delete(name); names.length = 0 })
describe('Book CRUD integration', () => {
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
