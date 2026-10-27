import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data/in-memory-repositories'
import { BookService } from '../../src/features/books/book-service'
import { seriesBooks } from '../../src/features/books/book-series'

it('persists original names and separate creator roles, and preserves them when omitted from an update', async () => {
  const repo = createInMemoryRepositories(), service = new BookService(repo)
  const book = await service.create({ title: '中文書名', originalTitle: 'Original Title', authorNames: ['作者'], authorOriginalNames: ['Original Author'], translatorNames: ['譯者甲', '譯者乙'], illustratorNames: ['繪者'], publisherName: '出版社', mediaTypeId: 'ebook', bookForm: 'novel', newSeriesName: '系列甲', sequence: { kind: 'volume', label: '第 1 集', sortValue: 1 } })
  expect(book).toMatchObject({ originalTitle: 'Original Title', authorOriginalNames: ['Original Author'], bookForm: 'novel' })
  const names = new Map((await repo.dictionaries.getAll()).map(entry => [entry.id, entry.name]))
  expect(book.authorIds.map(id => names.get(id))).toEqual(['作者'])
  expect(book.creatorCredits?.map(credit => [credit.role, names.get(credit.creatorId)])).toEqual([['author', '作者'], ['translator', '譯者甲'], ['translator', '譯者乙'], ['illustration', '繪者']])
  const updated = await service.update(book.id, { title: book.title, mediaTypeId: 'ebook', authorNames: ['新作者'] })
  expect(updated).toMatchObject({ originalTitle: book.originalTitle, authorOriginalNames: book.authorOriginalNames, collectionId: book.collectionId, sequence: book.sequence, bookForm: 'novel' })
  expect(updated.creatorCredits?.filter(credit => credit.role !== 'author')).toEqual(book.creatorCredits?.filter(credit => credit.role !== 'author'))
  const cleared = await service.update(book.id, { title: book.title, mediaTypeId: 'ebook', translatorNames: [] })
  expect(cleared.creatorCredits?.some(credit => credit.role === 'translator')).toBe(false)
  expect(cleared.creatorCredits?.some(credit => credit.role === 'illustration')).toBe(true)
  expect(await repo.readingRecords.getAll()).toEqual([])
})

it('keeps equal series names and novel/manga books separate; uses only explicit membership and numeric volume order', async () => {
  const repo = createInMemoryRepositories(), service = new BookService(repo)
  const first = await service.create({ title: '同名', authorNames: ['同作者'], mediaTypeId: 'ebook', bookForm: 'novel', newSeriesName: '同系列名', sequence: { kind: 'volume', label: '第 2 集', sortValue: 2 } })
  const second = await service.create({ title: '同名', authorNames: ['同作者'], mediaTypeId: 'manga', bookForm: 'manga', newSeriesName: '同系列名' })
  expect(second.collectionId).not.toBe(first.collectionId)
  expect(await repo.collections.getAll()).toHaveLength(2)
  const one = await service.create({ title: '第一集', mediaTypeId: 'ebook', bookForm: 'novel', collectionId: first.collectionId, sequence: { kind: 'volume', label: '第 1 集', sortValue: 1 } })
  const extra = await service.create({ title: '外傳', mediaTypeId: 'ebook', bookForm: 'novel', collectionId: first.collectionId, sequence: { kind: 'volume', label: '外傳', sortValue: 0 } })
  expect(seriesBooks(await repo.books.getAll(), first.collectionId! ).map(book => book.id)).toEqual([one.id, first.id, extra.id])
  expect(await repo.books.getAll()).toHaveLength(4)
})

it('validates before saving any collection, dictionary or book', async () => {
  const repo = createInMemoryRepositories(), service = new BookService(repo)
  await expect(service.create({ title: '書', mediaTypeId: 'ebook', newSeriesName: '不應建立', translatorNames: ['譯者'], authorOriginalNames: ['x'.repeat(201)] })).rejects.toThrow('作者原名')
  await expect(service.create({ title: '書', mediaTypeId: 'ebook', sequence: { kind: 'volume', label: '1', sortValue: 1 } })).rejects.toThrow('系列')
  await expect(service.create({ title: '書', mediaTypeId: 'ebook', collectionId: 'missing' })).rejects.toThrow('找不到')
  expect(await repo.collections.getAll()).toEqual([])
  expect(await repo.dictionaries.getAll()).toEqual([])
  expect(await repo.books.getAll()).toEqual([])
})
