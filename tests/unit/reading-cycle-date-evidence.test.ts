import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'

async function fixture() {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories).create({ title: '日期精度', mediaTypeId: 'ebook' })
  return { repositories, book, service: new ReadingCycleService(repositories) }
}
it('preserves start and last-read dates without inventing completion, sessions or midnight', async () => {
  const f = await fixture()
  const cycle = await f.service.create(f.book.id, { status: 'reading', startedOn: '2026-10-01', lastReadOn: '2026-10-05', reportedDurationMinutes: 200 })
  expect(cycle).toMatchObject({ status: 'reading', startedOn: '2026-10-01', lastReadOn: '2026-10-05', startedAt: null, finishedAt: null, completionDate: null, reportedDurationMinutes: 200 })
  expect(await f.repositories.readingRecords.getAll()).toEqual([])
  expect((await f.service.listForBook(f.book.id))[0]).toEqual(cycle)
  const updated = await f.service.update(cycle.id, { status: 'paused' }, cycle.revision)
  expect(updated).toMatchObject({ startedOn: cycle.startedOn, lastReadOn: cycle.lastReadOn, reportedDurationMinutes: 200, completionDate: null })
})
it('allows independent dates and explicit clearing without changing the other date', async () => {
  const f = await fixture()
  const cycle = await f.service.create(f.book.id, { status: 'reading', lastReadOn: '2026-10-05' })
  expect(cycle.startedOn).toBeUndefined()
  const updated = await f.service.update(cycle.id, { status: 'reading', startedOn: '2026-10-01' }, cycle.revision)
  const cleared = await f.service.update(cycle.id, { status: 'reading', lastReadOn: null }, updated.revision)
  expect(cleared).toMatchObject({ startedOn: '2026-10-01', lastReadOn: null, completionDate: null })
})
for (const bad of [
  { startedOn: '2026-02-30' }, { lastReadOn: '2026-13-01' },
  { startedOn: '' }, { lastReadOn: '2026-10-05T00:00:00Z' },
  { startedOn: '2026-10-06', lastReadOn: '2026-10-05' }
]) it('rejects invalid date evidence before saving: ' + JSON.stringify(bad), async () => {
  const f = await fixture()
  await expect(f.service.create(f.book.id, { status: 'reading', ...bad })).rejects.toThrow()
  expect(await f.repositories.readingCycles.getAll()).toEqual([])
})
it('keeps existing data intact after invalid edits or stale revisions', async () => {
  const f = await fixture()
  const cycle = await f.service.create(f.book.id, { status: 'reading', startedOn: '2026-10-01', lastReadOn: '2026-10-05' })
  await expect(f.service.update(cycle.id, { status: 'reading', startedOn: '2026-10-06' }, cycle.revision)).rejects.toThrow()
  await expect(f.service.update(cycle.id, { status: 'reading', lastReadOn: null }, cycle.revision + 1)).rejects.toThrow('新版本')
  expect(await f.repositories.readingCycles.getById(cycle.id)).toEqual(cycle)
})
it('keeps completion explicitly separate and rejects completion before start', async () => {
  const f = await fixture()
  const cycle = await f.service.create(f.book.id, { status: 'completed', startedOn: '2026-10-01', lastReadOn: '2026-10-04', completionDate: { precision: 'date', completedOn: '2026-10-05' } })
  expect(cycle.lastReadOn).toBe('2026-10-04')
  await expect(f.service.update(cycle.id, { status: 'completed', startedOn: '2026-10-06' }, cycle.revision)).rejects.toThrow()
  expect(await f.repositories.readingCycles.getById(cycle.id)).toEqual(cycle)
})
