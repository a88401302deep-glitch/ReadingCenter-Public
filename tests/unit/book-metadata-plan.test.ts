import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data/in-memory-repositories'
import { BookService } from '../../src/features/books/book-service'
it('saves reviewed bibliographic metadata without changing identity, reading history, cover or manual notes', async () => {
 const repo = createInMemoryRepositories(), service = new BookService(repo)
 const book = await service.create({ title: '京都怪奇談 3', mediaTypeId: 'ebook', bookNote: '人工心得', cover: { path: '/existing.jpg', mimeType: 'image/jpeg' } })
 const updated = await service.update(book.id, { title: book.title, mediaTypeId: book.mediaTypeId, cover: book.cover, authorNames: ['甲', '乙', '甲'], publisherName: '出版社', isbn: '978-1234567890', publishedOn: '2025', metadataSourceUrl: 'https://openlibrary.org/books/OL1M' }, book.revision)
 expect(updated).toMatchObject({ id: book.id, cover: book.cover, bookNote: '人工心得', isbn: '9781234567890', publishedOn: '2025', sourceUrls: ['https://openlibrary.org/books/OL1M'] })
 expect(updated.authorIds).toHaveLength(2)
 expect((await repo.dictionaries.getAll()).map(entry => entry.name)).toEqual(['甲', '乙', '出版社'])
 expect(await repo.books.getAll()).toHaveLength(1)
 expect(await repo.readingCycles.getAll()).toEqual([])
 expect(await repo.readingRecords.getAll()).toEqual([])
 await expect(service.update(book.id, { title: book.title, mediaTypeId: 'ebook', authorNames: ['新作者'] }, book.revision)).rejects.toThrow('新版本')
 expect(await repo.dictionaries.getAll()).toHaveLength(3)
})
it('validates before dictionary writes and preserves existing authors when a draft omits them', async () => {
 const repo = createInMemoryRepositories(), service = new BookService(repo)
 await expect(service.create({ title: '書', mediaTypeId: 'ebook', authorNames: ['不應建立'], isbn: 'bad' })).rejects.toThrow('ISBN')
 expect(await repo.dictionaries.getAll()).toEqual([])
 const book = await service.create({ title: '書', mediaTypeId: 'ebook', authorNames: ['作者'] })
 const updated = await service.update(book.id, { title: '新書名', mediaTypeId: 'ebook' })
 expect(updated.authorIds).toEqual(book.authorIds)
})
