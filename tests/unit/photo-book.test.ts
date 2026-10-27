import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { confirmPhotoBook } from '../../src/import/photo-book'
const draft = { title: '測試書', author: '辨識作者', publisher: '辨識出版社', isbn: '9781234567890', visibleText: '測試書\n辨識作者' }
const options = { bookId: null, hash: 'a'.repeat(64), source: '圖書館', mediaType: 'ebook', allowSameTitle: false }
it('creates a confirmed book with metadata and source, but no cover or reading records; repeated confirmation is rejected', async () => {
 const repo = createInMemoryRepositories()
 const book = await confirmPhotoBook(repo, draft, options)
 expect(book).toMatchObject({ title: draft.title, isbn: draft.isbn, cover: null, authorIds: [expect.any(String)], publisherId: expect.any(String), sourceIds: [expect.any(String)] })
 expect(await repo.readingRecords.getAll()).toEqual([])
 expect(await repo.readingCycles.getAll()).toEqual([])
 await expect(confirmPhotoBook(repo, draft, options)).rejects.toThrow('已確認匯入')
 expect(await repo.books.getAll()).toHaveLength(1)
})
it('blocks same-title creation unless explicitly confirmed, and linking preserves existing manual values', async () => {
 const repo = createInMemoryRepositories()
 const book = await new BookService(repo).create({ title: '測試書', mediaTypeId: 'ebook', cover: { path: '/old.png', mimeType: 'image/png' }, bookNote: '人工心得' })
 await repo.books.save({ ...book, authorIds: ['manual-author'], publisherId: 'manual-publisher', isbn: '9789876543210' })
 await expect(confirmPhotoBook(repo, draft, options)).rejects.toThrow('同名書')
 expect(await repo.dictionaries.getAll()).toEqual([])
 const linked = await confirmPhotoBook(repo, draft, { ...options, bookId: book.id })
 expect(linked).toMatchObject({ title: book.title, authorIds: ['manual-author'], publisherId: 'manual-publisher', isbn: '9789876543210', cover: book.cover, bookNote: '人工心得' })
 expect(await repo.books.getAll()).toHaveLength(1)
})
it('confirms reviewed Chinese metadata from a photographed title, keeping source and separate authors without making reading records or covers', async () => {
 const repo = createInMemoryRepositories()
 const book = await confirmPhotoBook(repo, { ...draft, author: '甲、乙', authors: ['甲','乙'], publisher: '大牌出版', publishedOn: '2024-05-02', metadataSourceUrl: 'https://www.bookrep.com.tw/?md=gwindex&cl=book&at=bookcontent&id=18250' }, options)
 expect(book).toMatchObject({ cover: null, publishedOn: '2024-05-02', sourceUrls: ['https://www.bookrep.com.tw/?md=gwindex&cl=book&at=bookcontent&id=18250'] })
 expect(book.authorIds).toHaveLength(2)
 expect((await repo.dictionaries.getAll()).filter(entry => entry.kind === 'author').map(entry => entry.name)).toEqual(['甲','乙'])
 expect(await repo.readingCycles.getAll()).toEqual([])
 expect(await repo.readingRecords.getAll()).toEqual([])
})
