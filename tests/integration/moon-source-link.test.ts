import 'fake-indexeddb/auto'
import { afterEach, expect, it } from 'vitest'
import { createSyncingIndexedDbRepositories, type SyncingLocalRepositoryContext } from '../../src/data'
import { importMoonStatistics } from '../../src/import/moon-statistics-import'
import { linkMoonSourceGroup } from '../../src/import/moon-source-link'
import { BookService } from '../../src/features/books/book-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'

const locals: SyncingLocalRepositoryContext[] = []
const local = () => { const context = createSyncingIndexedDbRepositories('moon-link-' + crypto.randomUUID()); locals.push(context); return context }
afterEach(async () => { for (const context of locals.splice(0)) await context.deleteDatabase() })
const snapshot = { deviceId: 'device-one', name: 'test.mrpro', statistics: [{
  path: '/book.txt', durationMs: 120000, readWords: 50,
  days: [{ dayCode: 20696, durationMs: 60000, readWords: 20, progressPercent: 30 }, { dayCode: 20697, durationMs: 60000, readWords: 30, progressPercent: 100 }]
}] }

it('links the entire reviewed group, preserves source values and counts, and survives repeated backup imports', async () => {
  const context = local(), repositories = context.repositories
  const book = await new BookService(repositories, () => 'existing-book').create({ title: '正式書籍', mediaTypeId: 'ebook' })
  await importMoonStatistics(repositories, [snapshot, { ...snapshot, deviceId: 'device-two' }])
  const before = await repositories.sourceReadingDays.getAll()
  const reviewed = before.filter(row => row.deviceId === 'device-one')
  const overview = await new ReadingOverviewService(repositories).getOverview()
  await expect(linkMoonSourceGroup(repositories, reviewed, book.id, '2026-10-08T00:00:00Z')).resolves.toBe(2)
  const after = await repositories.sourceReadingDays.getAll()
  for (const row of after) {
    const original = before.find(item => item.id === row.id)!
    expect(row).toEqual(row.deviceId === 'device-one' ? { ...original, bookId: book.id, revision: original.revision + 1, updatedAt: '2026-10-08T00:00:00Z' } : original)
  }
  expect(await repositories.books.getById(book.id)).toEqual(book)
  expect(await repositories.readingCycles.getAll()).toEqual([])
  expect(await repositories.readingRecords.getAll()).toEqual([])
  expect((await new ReadingOverviewService(repositories).getOverview()).sourceTotals).toEqual(overview.sourceTotals)
  expect((await context.outbox.getAll()).filter(row => row.kind === 'sourceReadingDay' && row.baseRevision === 1)).toHaveLength(2)
  await importMoonStatistics(repositories, [snapshot])
  expect(await repositories.sourceReadingDays.getAll()).toEqual(after)
})

it('rejects a stale or incomplete reviewed group and missing books before any pairing writes', async () => {
  const context = local(), repositories = context.repositories
  const book = await new BookService(repositories, () => 'existing-book').create({ title: '正式書籍', mediaTypeId: 'ebook' })
  await importMoonStatistics(repositories, [snapshot])
  const before = await repositories.sourceReadingDays.getAll()
  await expect(linkMoonSourceGroup(repositories, before, 'missing')).rejects.toThrow('不存在')
  await expect(linkMoonSourceGroup(repositories, before.slice(0, 1), book.id)).rejects.toThrow('新版本')
  expect(await repositories.sourceReadingDays.getAll()).toEqual(before)
  await linkMoonSourceGroup(repositories, before, book.id)
  await expect(linkMoonSourceGroup(repositories, before, null)).rejects.toThrow('新版本')
  expect((await repositories.sourceReadingDays.getAll()).every(row => row.bookId === book.id)).toBe(true)
})
