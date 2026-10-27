import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createIndexedDbRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'

const databases: string[] = []
afterEach(async () => { for (const name of databases) await Dexie.delete(name); databases.length = 0 })

describe('reading notes query integration', () => {
  it('returns all books newest first and reflects edits and deletions immediately', async () => {
    const name = `reading-notes-${crypto.randomUUID()}`; databases.push(name)
    const data = createIndexedDbRepositories(name)
    const bookIds = ['book-1', 'book-2']
    const bookService = new BookService(data.repositories, () => bookIds.shift()!)
    const firstBook = await bookService.create({ title: '第一本', mediaTypeId: 'ebook', bookNote: '不應出現在閱讀筆記' })
    const secondBook = await bookService.create({ title: '第二本', mediaTypeId: 'ebook' })
    const ids = ['content-1', 'content-2']
    const times = ['2026-09-14T01:00:00.000Z', '2026-09-14T02:00:00.000Z', '2026-09-14T03:00:00.000Z']
    const service = new ReadingContentService(data.repositories, () => ids.shift()!, () => times.shift()!)
    const first = await service.create(firstBook.id, { type: 'shortReview', text: '第一則' })
    await service.create(secondBook.id, { type: 'highlight', text: '第二則' })
    expect((await service.listAll()).map((item) => item.text)).toEqual(['第二則', '第一則'])
    await service.update(first.id, { type: 'shortReview', text: '已編輯' })
    expect((await service.listAll()).find((item) => item.id === first.id)).toMatchObject({ text: '已編輯', createdAt: '2026-09-14T01:00:00.000Z', revision: 2 })
    await service.delete(first.id)
    expect((await service.listAll()).map((item) => item.text)).toEqual(['第二則'])
    expect((await data.repositories.books.getById(firstBook.id))?.bookNote).toBe('不應出現在閱讀筆記')
    data.close()
  })
})
