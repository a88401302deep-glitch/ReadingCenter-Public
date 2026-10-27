import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createIndexedDbRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'

const databases: string[] = []
afterEach(async () => { for (const name of databases) await Dexie.delete(name); databases.length = 0 })

describe('ReadingContent CRUD integration', () => {
  it('persists content across reopen, preserves createdAt on edit, and deletes immediately', async () => {
    const name = `content-crud-${crypto.randomUUID()}`; databases.push(name)
    const first = createIndexedDbRepositories(name)
    const book = await new BookService(first.repositories, () => 'book-1').create({ title: '閱讀內容測試', mediaTypeId: 'ebook', bookNote: '書籍備註' })
    const created = await new ReadingContentService(first.repositories, () => 'content-1', () => '2026-09-14T00:00:00.000Z').create(book.id, { type: 'shortReview', text: '原始短評' })
    first.close()
    const reopened = createIndexedDbRepositories(name)
    const service = new ReadingContentService(reopened.repositories, undefined, () => '2026-09-14T01:00:00.000Z')
    expect((await service.listForBook(book.id))[0]?.text).toBe('原始短評')
    const edited = await service.update(created.id, { type: 'shortReview', text: '修改後短評' })
    expect(edited).toMatchObject({ createdAt: created.createdAt, updatedAt: '2026-09-14T01:00:00.000Z', revision: 2 })
    await service.delete(created.id)
    expect(await service.listForBook(book.id)).toEqual([])
    expect((await reopened.repositories.books.getById(book.id))?.bookNote).toBe('書籍備註')
    reopened.close()
  })
})
