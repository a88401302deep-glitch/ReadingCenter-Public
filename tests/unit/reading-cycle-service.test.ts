import { describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'

describe('ReadingCycleService', () => {
  it('assigns stable increasing sequences and preserves identity when edited', async () => {
    const repositories = createInMemoryRepositories()
    const book = await new BookService(repositories, () => 'book-1', () => '2026-09-14T00:00:00.000Z').create({ title: '測試', mediaTypeId: 'ebook' })
    const ids = ['cycle-1', 'cycle-2']
    const times = ['2026-09-14T01:00:00.000Z', '2026-09-14T02:00:00.000Z', '2026-09-14T03:00:00.000Z']
    const service = new ReadingCycleService(repositories, () => ids.shift()!, () => times.shift()!)
    const first = await service.create(book.id, { status: 'completed', startedAt: '2026-09-01T00:00:00.000Z', finishedAt: '2026-09-02T00:00:00.000Z' })
    await service.create(book.id, { status: 'reading', startedAt: '2026-09-14T00:00:00.000Z' })
    const edited = await service.update(first.id, { status: 'completed', startedAt: first.startedAt, finishedAt: '2026-09-03T00:00:00.000Z' })
    expect((await service.listForBook(book.id)).map((cycle) => cycle.sequence)).toEqual([1, 2])
    expect(edited).toMatchObject({ id: first.id, createdAt: first.createdAt, sequence: 1, revision: 2 })
  })

  it('does not create a cycle for a missing Book', async () => {
    const service = new ReadingCycleService(createInMemoryRepositories())
    await expect(service.create('missing', { status: 'planned' })).rejects.toThrow('找不到所屬書籍')
  })

  it('keeps date-only completion without inventing a timestamp', async () => {
    const repositories = createInMemoryRepositories()
    const book = await new BookService(repositories, () => 'book-1').create({ title: '測試', mediaTypeId: 'ebook' })
    const service = new ReadingCycleService(repositories, () => 'cycle-1')
    const created = await service.create(book.id, { status: 'completed', completionDate: { precision: 'range', startedOn: '2024-02-22', completedOn: '2024-02-25' }, reportedReadingDays: 1 })
    expect(created).toMatchObject({ startedAt: null, finishedAt: null, reportedReadingDays: 1, completionDate: { startedOn: '2024-02-22', completedOn: '2024-02-25' } })
    const edited = await service.update(created.id, { status: 'completed' })
    expect(edited.completionDate).toEqual(created.completionDate)
    expect(edited.reportedReadingDays).toBe(1)
    await expect(service.update(created.id, { status: 'completed', reportedReadingDays: 0 })).rejects.toThrow('positive integer')
    await expect(service.update(created.id, { status: 'reading', completionDate: created.completionDate })).rejects.toThrow('Only a completed')
  })

  it('reports impact and cascades only records and contents owned by the cycle', async () => {
    const repositories = createInMemoryRepositories()
    const book = await new BookService(repositories, () => 'book-1').create({ title: '測試', mediaTypeId: 'ebook' })
    const service = new ReadingCycleService(repositories, () => 'cycle-1')
    const cycle = await service.create(book.id, { status: 'reading' })
    const metadata = { id: 'record-1', createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z', revision: 1, schemaVersion: 1, provenance: { kind: 'manual' as const } }
    await repositories.readingRecords.save({ ...metadata, bookId: book.id, cycleId: cycle.id, startedAt: metadata.createdAt, endedAt: null, durationMinutes: 10, progress: null, deviceId: null, sourceId: null })
    await repositories.readingContents.save({ ...metadata, id: 'content-1', bookId: book.id, cycleId: cycle.id, readingRecordId: 'record-1', recordedForAt: null, type: 'shortReview', text: '測試短評' })
    expect(await service.deletionImpact(cycle.id)).toEqual({ readingRecords: 1, readingContents: 1 })
    await service.delete(cycle.id)
    expect(await repositories.readingCycles.getAll()).toEqual([])
    expect(await repositories.readingRecords.getAll()).toEqual([])
    expect(await repositories.readingContents.getAll()).toEqual([])
    expect(await repositories.books.getById(book.id)).toBeDefined()
  })
})
