import { isWaitingBook } from '../../src/features/library/library-reading-scope'
import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { importMoonBackupBatch } from '../../src/import/moon-backup-batch-import'
import { createMetadata, type SourceReadingDay } from '../../src/domain'

it('shows linked daily evidence in recent books and single-book metrics, preserves dates and disputed progress without inventing cycles', async () => {
  const repo = createInMemoryRepositories()
  const book = await new BookService(repo).create({ title: '來源書', mediaTypeId: 'ebook' })
  const row = (id: string, deviceId: string, date: string, bookId: string | null): SourceReadingDay => ({
    ...createMetadata({ id, now: '2026-10-10T00:00:00Z' }), source: 'moon', deviceId, sourcePath: '/book.txt', sourceTitle: book.title,
    backupName: 'backup.mrpro', dayCode: 0, date, bookId, durationMs: 600000, readWords: 100, progressPercent: 84, completionDisputed: false
  })
  await repo.sourceReadingDays.save(row('a', 'TUCP', '2026-10-05', book.id))
  await repo.sourceReadingDays.save(row('b', 'PALMA2', '2026-10-05', book.id))
  await repo.sourceReadingDays.save({ ...row('c', 'TUCP', '2026-10-06', book.id), progressPercent: 100, completionDisputed: true })
  await repo.sourceReadingDays.save(row('unmatched', 'B7PRO', '2026-10-07', null))
  const result = await new ReadingOverviewService(repo, () => new Date('2026-10-10T00:00:00Z')).getOverview()
  expect(result.recentBooks).toHaveLength(1)
  expect(result.recentBooks[0]).toMatchObject({ lastReadAt: '2026-10-06', totalMinutes: 30, progress: { unit: 'percent', value: 100 } })
  expect(result.byBook[book.id]).toMatchObject({ readingDays: 2, totalMinutes: 30, readWords: 300, sourceDayCount: 3, completedBookCount: 0, recordCount: 3 })
  expect(result.metrics).toMatchObject({ readingDays: 3, totalMinutes: 40, completedBookCount: 0 })
  expect(result.sourceDaysByBook?.[book.id][0].completionDisputed).toBe(true)
  expect(await repo.readingRecords.getAll()).toEqual([])
  expect(await repo.readingCycles.getAll()).toEqual([])
})

it('fills a missing cover on a previously linked book and preserves that manual link on repeat import', async () => {
  const repo = createInMemoryRepositories()
  const book = await new BookService(repo).create({ title: '人工書名', mediaTypeId: 'ebook' })
  await repo.books.save({ ...book, externalReferences: [{ sourceId: 'moon-reader', externalId: 'TUCP:/book.txt', sourceTitle: '來源名稱', sourceAuthorNames: [] }] })
  const snapshot = { deviceId: 'TUCP', name: 'backup.mrpro', backup: { books: [{ title: '來源名稱', author: '', path: '/book.txt', coverPath: '/cover.jpg' }], statistics: [], readCover: async () => new Blob(['image'], { type: 'image/jpeg' }) } }
  let uploads = 0
  const options = { saveCover: async () => { uploads++; return { path: '/api/v1/covers/covers/test.jpg', mimeType: 'image/jpeg' as const } } }
  const first = await importMoonBackupBatch(repo, [snapshot], new Set(), '2026-10-10T00:00:00Z', options)
  expect(first).toMatchObject({ booksCreated: 0, booksMatched: 1, coversSaved: 1, coverWarnings: [] })
  expect((await repo.books.getById(book.id))?.title).toBe('人工書名')
  expect((await repo.books.getById(book.id))?.cover?.path).toContain('/api/v1/covers/')
  await importMoonBackupBatch(repo, [snapshot], new Set(), '2026-10-10T00:00:01Z', options)
  expect(uploads).toBe(1)
  expect(await repo.books.getAll()).toHaveLength(1)
})

it('reports cover upload failure while still preserving source book metadata', async () => {
  const repo = createInMemoryRepositories()
  const snapshot = { deviceId: 'TUCP', name: 'backup.mrpro', backup: { books: [{ title: '書名', author: '', path: '/book.txt', coverPath: '/cover.jpg' }], statistics: [], readCover: async () => new Blob(['image']) } }
  const result = await importMoonBackupBatch(repo, [snapshot], new Set(), undefined, { saveCover: async () => { throw new Error('503') } })
  expect(result.coverWarnings).toEqual(['書名：503'])
  expect(result.coversSaved).toBe(0)
  expect(await repo.books.getAll()).toHaveLength(1)
})

it('excludes five minutes or less, sums devices, keeps raw evidence and counts daily entries without creating sessions', async () => {
  const repo = createInMemoryRepositories()
  const book = await new BookService(repo).create({ title: '試開', mediaTypeId: 'ebook' })
  const row = (id: string, durationMs: number): SourceReadingDay => ({ ...createMetadata({ id, now: '2026-10-10T00:00:00Z' }), source: 'moon', deviceId: id, sourcePath: '/book.txt', sourceTitle: book.title, backupName: 'backup.mrpro', dayCode: 0, date: '2026-10-05', bookId: book.id, durationMs, readWords: 100, progressPercent: 1, completionDisputed: false })
  await repo.sourceReadingDays.save(row('one', 120000))
  await repo.sourceReadingDays.save(row('two', 180000))
  const service = new ReadingOverviewService(repo, () => new Date('2026-10-10T00:00:00Z'))
  let result = await service.getOverview()
  expect(result.recentBooks).toEqual([])
  expect(result.byBook[book.id]).toMatchObject({ recordCount: 0, readingDays: 0, sourceDayCount: 2 })
  expect(result.sourceDaysByBook?.[book.id]).toHaveLength(2)
  expect(isWaitingBook(book, [], [], await repo.sourceReadingDays.getAll())).toBe(true)
  await repo.sourceReadingDays.save(row('two', 180001))
  result = await service.getOverview()
  expect(result.recentBooks).toHaveLength(1)
  expect(result.byBook[book.id].recordCount).toBe(2)
  expect(result.timeline?.entries.map(entry => entry.kind)).toEqual(['source', 'source'])
  expect(result.statistics?.days[0].minutes).toBeCloseTo(5 + 1 / 60000)
  expect(isWaitingBook(book, [], [], await repo.sourceReadingDays.getAll())).toBe(false)
  expect(await repo.readingRecords.getAll()).toEqual([])
})
