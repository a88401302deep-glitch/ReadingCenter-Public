import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { sortLibrary } from '../../src/features/library/library-sort'

it('sorts titles naturally and scores proportionally, keeping missing scores last without mutating input', async () => {
  const repositories = createInMemoryRepositories(), service = new BookService(repositories)
  const books = [
    await service.create({ title: 'Book 10', mediaTypeId: 'ebook', rating: { value: 7, scale: 10 } }),
    await service.create({ title: 'Book 2', mediaTypeId: 'ebook', rating: { value: 4, scale: 5 } }),
    await service.create({ title: 'Book 1', mediaTypeId: 'ebook' }),
  ]
  const before = structuredClone(books), titles = (items: typeof books) => items.map(book => book.title)
  expect(titles(sortLibrary(books, 'title', [], [], [], []))).toEqual(['Book 1', 'Book 2', 'Book 10'])
  expect(titles(sortLibrary(books, 'ratingDesc', [], [], [], []))).toEqual(['Book 2', 'Book 10', 'Book 1'])
  expect(titles(sortLibrary(books, 'ratingAsc', [], [], [], []))).toEqual(['Book 10', 'Book 2', 'Book 1'])
  expect(books).toEqual(before)
  expect(sortLibrary(books, 'existing', [], [], [], [])).toEqual(books)
})

it('uses explicit reading/completion days rather than metadata update dates or planned dates', async () => {
  const repositories = createInMemoryRepositories(), service = new BookService(repositories), cycles = new ReadingCycleService(repositories)
  const first = await service.create({ title: 'First', mediaTypeId: 'ebook' })
  const second = await service.create({ title: 'Second', mediaTypeId: 'ebook' })
  const unknown = await service.create({ title: 'No date', mediaTypeId: 'ebook' })
  await cycles.create(first.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2025-01-01' } })
  await cycles.create(second.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2025-02-01' } })
  await cycles.create(unknown.id, { status: 'planned', startedOn: '2030-01-01' })
  const rows = await repositories.readingCycles.getAll(), input = [unknown, first, second]
  for (const order of ['lastRead', 'completed'] as const) expect(sortLibrary(input, order, [], rows, [], []).map(book => book.id)).toEqual([second.id, first.id, unknown.id])
  expect(await repositories.readingRecords.getAll()).toEqual([])
})

it('orders addition times and author names with unknown authors last', async () => {
  const repositories = createInMemoryRepositories(), service = new BookService(repositories)
  const first = await service.create({ title: 'First', mediaTypeId: 'ebook', authorNames: ['Zed'] })
  const second = await service.create({ title: 'Second', mediaTypeId: 'ebook', authorNames: ['Alice'] })
  const third = await service.create({ title: 'Third', mediaTypeId: 'ebook' })
  const books = [{ ...first, createdAt: '2025-01-01T00:00:00Z' }, { ...second, createdAt: '2025-02-01T00:00:00Z' }, { ...third, createdAt: '2025-03-01T00:00:00Z' }]
  const dictionaries = await repositories.dictionaries.getAll()
  expect(sortLibrary(books, 'author', dictionaries, [], [], []).map(book => book.id)).toEqual([second.id, first.id, third.id])
  expect(sortLibrary(books, 'addedDesc', dictionaries, [], [], []).map(book => book.id)).toEqual([third.id, second.id, first.id])
  expect(sortLibrary(books, 'addedAsc', dictionaries, [], [], []).map(book => book.id)).toEqual([first.id, second.id, third.id])
})
