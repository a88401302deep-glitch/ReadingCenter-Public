import 'fake-indexeddb/auto'
import { afterEach, expect, it } from 'vitest'
import { createSyncingIndexedDbRepositories, type SyncingLocalRepositoryContext } from '../../src/data'
import { createMetadata } from '../../src/domain'
import { importMoonBackupBatch } from '../../src/import/moon-backup-batch-import'

const locals: SyncingLocalRepositoryContext[] = []
const local = () => { const context = createSyncingIndexedDbRepositories(`moon-batch-${crypto.randomUUID()}`); locals.push(context); return context }
afterEach(async () => { for (const context of locals.splice(0)) await context.deleteDatabase() })
const statistic = (path: string) => ({ path, durationMs: 60000, readWords: 20, days: [{ dayCode: 20697, durationMs: 60000, readWords: 20, progressPercent: 40 }] })
const backup = (
  books: { title: string; author: string; path: string; coverPath: string | null }[],
  statistics = books.map(book => statistic(book.path))
) => ({ books, statistics })

it('batch-links a unique title and author, creates absent books, and imports source progress atomically', async () => {
  const context = local()
  const author = { ...createMetadata({ id: 'author-existing', now: '2026-10-08T00:00:00.000Z' }), kind: 'author' as const, name: 'Existing Author', color: null, aliases: [] }
  await context.repositories.dictionaries.save(author)
  const existing = {
    ...createMetadata({ id: 'book-existing', now: '2026-10-08T00:00:00.000Z' }),
    title: 'Existing title', preferredTitle: null, subtitle: null, originalTitle: null, languageTag: 'und', titleAliases: [],
    externalReferences: [], publicationKind: 'other' as const, collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null,
    authorIds: [author.id], publisherId: null, mediaTypeId: 'ebook', categoryIds: [], tagIds: [], sourceIds: [], cover: null, rating: null,
    sourceUrls: [], wordCount: null, bookNote: ''
  }
  await context.repositories.books.save(existing)
  const input = backup([
    { title: 'Existing title', author: 'Existing Author', path: '/books/existing.txt', coverPath: null },
    { title: 'New title', author: 'New Author', path: '/books/new.epub', coverPath: null }
  ])
  const result = await importMoonBackupBatch(context.repositories, [{ deviceId: 'reader', name: 'backup.mrpro', backup: input }], new Set(), '2026-10-08T01:00:00.000Z')
  expect(result).toMatchObject({ booksCreated: 1, booksMatched: 1, booksPending: 0, statistics: { imported: 2, skipped: 0 } })
  const rows = await context.repositories.sourceReadingDays.getAll()
  expect(rows.find(row => row.sourcePath === '/books/existing.txt')?.bookId).toBe('book-existing')
  const added = (await context.repositories.books.getAll()).find(book => book.title === 'New title')
  expect(added?.authorIds).toHaveLength(1)
  expect(rows.find(row => row.sourcePath === '/books/new.epub')?.bookId).toBe(added?.id)
  expect(await context.repositories.readingCycles.getAll()).toEqual([])

  const repeated = await importMoonBackupBatch(context.repositories, [{ deviceId: 'reader', name: 'backup.mrpro', backup: input }], new Set(), '2026-10-08T02:00:00.000Z')
  expect(repeated.booksCreated).toBe(0)
  expect(await context.repositories.books.getAll()).toHaveLength(2)
  expect(await context.repositories.sourceReadingDays.getAll()).toHaveLength(2)
  context.close()
})

it('leaves a same-title item pending when Moon+ has no author evidence', async () => {
  const context = local()
  const existing = {
    ...createMetadata({ id: 'book-collision', now: '2026-10-08T00:00:00.000Z' }),
    title: 'Shared title', preferredTitle: null, subtitle: null, originalTitle: null, languageTag: 'und', titleAliases: [],
    externalReferences: [], publicationKind: 'other' as const, collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null,
    authorIds: [], publisherId: null, mediaTypeId: 'ebook', categoryIds: [], tagIds: [], sourceIds: [], cover: null, rating: null,
    sourceUrls: [], wordCount: null, bookNote: ''
  }
  await context.repositories.books.save(existing)
  const input = backup([{ title: 'Shared title', author: '', path: '/books/shared.txt', coverPath: null }])
  const result = await importMoonBackupBatch(context.repositories, [{ deviceId: 'reader', name: 'backup.mrpro', backup: input }], new Set(), '2026-10-08T01:00:00.000Z')
  expect(result).toMatchObject({ booksCreated: 0, booksMatched: 0, booksPending: 1, statistics: { imported: 1, skipped: 0 } })
  expect((await context.repositories.sourceReadingDays.getAll())[0].bookId).toBeNull()
  expect(await context.repositories.books.getAll()).toHaveLength(1)
  context.close()
})

it('creates a title-only book for a statistic whose source path is absent from the Moon+ book catalog', async () => {
  const context = local()
  const input = backup([], [statistic('/storage/Books/042. Orphaned title.epub')])
  const result = await importMoonBackupBatch(context.repositories, [{ deviceId: 'reader', name: 'backup.mrpro', backup: input }], new Set(), '2026-10-08T01:00:00.000Z')
  expect(result).toMatchObject({ booksCreated: 1, booksMatched: 0, booksPending: 0, statistics: { imported: 1, skipped: 0 } })
  const added = (await context.repositories.books.getAll())[0]
  expect(added.title).toBe('Orphaned title')
  expect(added.authorIds).toEqual([])
  expect(added.importSourceNotes).toContain('/storage/Books/042. Orphaned title.epub')
  expect((await context.repositories.sourceReadingDays.getAll())[0]?.bookId).toBe(added.id)
  expect(await context.repositories.readingCycles.getAll()).toEqual([])
  context.close()
})

it('leaves an orphan statistic pending when its path title collides with an existing book', async () => {
  const context = local()
  const existing = {
    ...createMetadata({ id: 'book-orphan-collision', now: '2026-10-08T00:00:00.000Z' }),
    title: 'Orphaned title', preferredTitle: null, subtitle: null, originalTitle: null, languageTag: 'und', titleAliases: [],
    externalReferences: [], publicationKind: 'other' as const, collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null,
    authorIds: [], publisherId: null, mediaTypeId: 'ebook', categoryIds: [], tagIds: [], sourceIds: [], cover: null, rating: null,
    sourceUrls: [], wordCount: null, bookNote: ''
  }
  await context.repositories.books.save(existing)
  const input = backup([], [statistic('/storage/Books/042. Orphaned title.epub')])
  const result = await importMoonBackupBatch(context.repositories, [{ deviceId: 'reader', name: 'backup.mrpro', backup: input }], new Set(), '2026-10-08T01:00:00.000Z')
  expect(result).toMatchObject({ booksCreated: 0, booksMatched: 0, booksPending: 1, statistics: { imported: 1, skipped: 0 } })
  expect((await context.repositories.sourceReadingDays.getAll())[0]?.bookId).toBeNull()
  expect(await context.repositories.books.getAll()).toHaveLength(1)
  context.close()
})
