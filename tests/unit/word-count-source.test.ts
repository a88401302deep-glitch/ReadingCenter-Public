import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data/in-memory-repositories'
import { BookService } from '../../src/features/books/book-service'
it('persists word-count attribution, clears it on a manual change, and rejects unsafe attribution before writes', async () => {
 const repo = createInMemoryRepositories(), service = new BookService(repo)
 const source = 'https://openlibrary.org/books/OL1M'
 const book = await service.create({ title: '書', mediaTypeId: 'ebook', wordCount: 100, wordCountSourceUrl: source })
 expect(book.wordCountSourceUrl).toBe(source)
 const preserved = await service.update(book.id, { title: '新書名', mediaTypeId: 'ebook' })
 expect(preserved.wordCountSourceUrl).toBe(source)
 const changed = await service.update(book.id, { title: '新書名', mediaTypeId: 'ebook', wordCount: 101 })
 expect(changed.wordCountSourceUrl).toBeNull()
 await expect(service.create({ title: '壞資料', mediaTypeId: 'ebook', authorNames: ['不應建立'], wordCount: 100, wordCountSourceUrl: 'javascript:alert(1)' })).rejects.toThrow('字數來源')
 expect(await repo.books.getAll()).toHaveLength(1)
 expect(await repo.dictionaries.getAll()).toEqual([])
})
