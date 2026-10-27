import { describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { createMetadata, type ReadingContent } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'

it('uses historical completion evidence, normalizes ratings, and groups categories without inventing dates', async () => {
  const repos = createInMemoryRepositories()
  let id = 0
  const books = new BookService(repos, () => `book-${++id}`)
  const cycles = new ReadingCycleService(repos, () => `cycle-${++id}`)
  const older = await books.create({ title: '舊完讀', mediaTypeId: 'ebook', categoryIds: ['category'], rating: { value: 4, scale: 5 } })
  const newer = await books.create({ title: '新完讀', mediaTypeId: 'ebook', categoryIds: ['category'], rating: { value: 8, scale: 10 } })
  const unknown = await books.create({ title: '未知日期', mediaTypeId: 'ebook', rating: { value: 5, scale: 5 } })
  const planned = await books.create({ title: '待讀', mediaTypeId: 'ebook', rating: { value: 5, scale: 5 } })
  await cycles.create(planned.id, { status: 'planned' })
  const oldCycle = await cycles.create(older.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2025-01-01' } })
  await cycles.create(newer.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2025-02-01' } })
  await cycles.create(newer.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2025-01-20' } })
  await cycles.create(unknown.id, { status: 'completed' })
  await repos.dictionaries.save({ ...createMetadata({ id: 'category', now: '2026-10-04T00:00:00.000Z' }), kind: 'category', name: '小說', color: null })
  const note: ReadingContent = { ...createMetadata({ id: 'note', now: '2026-10-04T00:00:00.000Z', provenance: { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: 'row:short-review', importedAt: '2026-10-04T00:00:00.000Z' } }), bookId: older.id, cycleId: oldCycle.id, readingRecordId: null, recordedForAt: null, type: 'shortReview', text: '歷史心得' }
  await repos.readingContents.save(note)
  await repos.readingContents.save({ ...note, id: 'long', bookId: unknown.id, cycleId: null, type: 'longReview', title: null, text: '無日期長文' })
  const summary = (await new ReadingOverviewService(repos).getOverview()).summaries!
  expect(summary.completed.map(item => [item.book.title, item.date])).toEqual([['新完讀', '2025-02-01'], ['舊完讀', '2025-01-01'], ['未知日期', null]])
  expect(summary.highRated.map(item => item.book.title)).toEqual(['新完讀', '舊完讀', '未知日期'])
  expect(summary.notes.map(item => [item.content.id, item.date, item.dateLabel])).toEqual([['note', '2025-01-01', '完讀日'], ['long', null, '日期未確定']])
  expect(summary.categories.map(item => [item.categories.map(category => category.name).join("・"), item.book.title])).toEqual([['小說', '新完讀']])
})

describe('summary limits', () => {
  it('caps completion and rating lists at 100 distinct books', async () => {
    const repos = createInMemoryRepositories()
    let id = 0
    const books = new BookService(repos, () => `book-${++id}`)
    const cycles = new ReadingCycleService(repos, () => `cycle-${++id}`)
    for (let i = 0; i < 105; i++) {
      const book = await books.create({ title: `書 ${i}`, mediaTypeId: 'ebook', rating: { value: 5, scale: 5 } })
      await cycles.create(book.id, { status: 'completed', finishedAt: new Date(Date.UTC(2025, 0, i + 1)).toISOString() })
    }
    const summary = (await new ReadingOverviewService(repos).getOverview()).summaries!
    expect(summary.completed).toHaveLength(100)
    expect(summary.highRated).toHaveLength(100)
    expect(summary.completed[0].book.title).toBe('書 104')
  })
})


it('merges category winners by book without substituting a second-latest book or merging equal titles', async () => {
  const repos = createInMemoryRepositories()
  let id = 0
  const books = new BookService(repos, () => `book-${++id}`)
  const cycles = new ReadingCycleService(repos, () => `cycle-${++id}`)
  for (const name of ['主分類', '子分類', '另分類']) await repos.dictionaries.save({ ...createMetadata({ id: name, now: '2026-10-04T00:00:00.000Z' }), kind: 'category', name, color: null })
  const newest = await books.create({ title: '同名書', mediaTypeId: 'ebook', categoryIds: ['主分類', '子分類', '子分類'] })
  const older = await books.create({ title: '較舊的書', mediaTypeId: 'ebook', categoryIds: ['子分類'] })
  const other = await books.create({ title: '同名書', mediaTypeId: 'ebook', categoryIds: ['另分類'] })
  for (const [book, day] of [[newest, '03'], [older, '01'], [other, '02']] as const) await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: `2025-01-${day}` } })
  const categories = (await new ReadingOverviewService(repos).getOverview()).summaries!.categories
  expect(categories.map(item => item.book.id)).toEqual([newest.id, other.id])
  expect(categories[0].categories.map(category => category.name)).toEqual(['主分類', '子分類'])
})
