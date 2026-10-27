import { describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'

describe('ReadingContentService', () => {
  it('keeps multiple short reviews ordered newest first and preserves createdAt on edit', async () => {
    const repositories = createInMemoryRepositories()
    const book = await new BookService(repositories, () => 'book-1').create({ title: '測試', mediaTypeId: 'ebook' })
    const ids = ['content-1', 'content-2']
    const times = ['2026-09-14T01:00:00.000Z', '2026-09-14T02:00:00.000Z', '2026-09-14T03:00:00.000Z']
    const service = new ReadingContentService(repositories, () => ids.shift()!, () => times.shift()!)
    const first = await service.create(book.id, { type: 'shortReview', text: '第一則' })
    await service.create(book.id, { type: 'shortReview', text: '第二則' })
    expect((await service.listForBook(book.id)).map((item) => item.text)).toEqual(['第二則', '第一則'])
    const edited = await service.update(first.id, { type: 'shortReview', text: '修改第一則' })
    expect(edited).toMatchObject({ id: first.id, createdAt: first.createdAt, updatedAt: '2026-09-14T03:00:00.000Z', revision: 2 })
  })

  it('creates only the three domain types and derives the long-review marker', async () => {
    const repositories = createInMemoryRepositories()
    const book = await new BookService(repositories, () => 'book-1').create({ title: '測試', mediaTypeId: 'ebook' })
    const ids = ['highlight', 'short', 'long']
    const service = new ReadingContentService(repositories, () => ids.shift()!)
    await service.create(book.id, { type: 'highlight', text: '畫線', note: '附註', locator: '第 3 章' })
    await service.create(book.id, { type: 'shortReview', text: '短評' })
    await service.create(book.id, { type: 'longReview', title: '長文', text: '心得' })
    expect(await service.hasLongReview(book.id)).toBe(true)
    expect((await service.listForBook(book.id)).map((item) => item.type).sort()).toEqual(['highlight', 'longReview', 'shortReview'])
  })

  it('deletes one item without affecting Book notes or other content', async () => {
    const repositories = createInMemoryRepositories()
    const book = await new BookService(repositories, () => 'book-1').create({ title: '測試', mediaTypeId: 'ebook', bookNote: '書籍備註' })
    const ids = ['content-1', 'content-2']
    const service = new ReadingContentService(repositories, () => ids.shift()!)
    const first = await service.create(book.id, { type: 'shortReview', text: '刪除我' })
    await service.create(book.id, { type: 'shortReview', text: '保留我' })
    await service.delete(first.id)
    expect((await service.listForBook(book.id)).map((item) => item.text)).toEqual(['保留我'])
    expect((await repositories.books.getById(book.id))?.bookNote).toBe('書籍備註')
  })
})
