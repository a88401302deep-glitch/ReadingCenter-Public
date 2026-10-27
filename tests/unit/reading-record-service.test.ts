import { describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'

describe('ReadingRecordService', () => {
  it('creates, sorts and edits records while preserving identity', async () => {
    const repositories = createInMemoryRepositories()
    const book = await new BookService(repositories, () => 'book-1').create({ title: '測試', mediaTypeId: 'ebook' })
    const cycle = await new ReadingCycleService(repositories, () => 'cycle-1').create(book.id, { status: 'reading' })
    const ids = ['record-1', 'record-2']
    const service = new ReadingRecordService(repositories, () => ids.shift()!, () => '2026-09-14T03:00:00.000Z')
    const first = await service.create(book.id, { cycleId: cycle.id, startedAt: '2026-09-14T01:00:00.000Z', durationMinutes: 20, progress: { unit: 'percent', value: 10 } })
    await service.create(book.id, { cycleId: cycle.id, startedAt: '2026-09-14T02:00:00.000Z', durationMinutes: 30, progress: { unit: 'percent', value: 20 } })
    expect((await service.listForBook(book.id)).map((record) => record.id)).toEqual(['record-2', 'record-1'])
    const edited = await service.update(first.id, { cycleId: cycle.id, startedAt: first.startedAt, durationMinutes: 25, progress: { unit: 'percent', value: 15 } })
    expect(edited).toMatchObject({ id: first.id, createdAt: first.createdAt, revision: 2, durationMinutes: 25 })
  })

  it('rejects a cycle from another Book', async () => {
    const repositories = createInMemoryRepositories()
    const books = new BookService(repositories, (() => { const ids = ['book-1', 'book-2']; return () => ids.shift()! })())
    const first = await books.create({ title: '一', mediaTypeId: 'ebook' })
    const second = await books.create({ title: '二', mediaTypeId: 'ebook' })
    const cycle = await new ReadingCycleService(repositories, () => 'cycle-1').create(second.id, { status: 'reading' })
    await expect(new ReadingRecordService(repositories).create(first.id, { cycleId: cycle.id, startedAt: '2026-09-14T00:00:00.000Z' })).rejects.toThrow('不屬於')
  })

  it('deletes a record and detaches retained ReadingContent', async () => {
    const repositories = createInMemoryRepositories()
    const book = await new BookService(repositories, () => 'book-1').create({ title: '測試', mediaTypeId: 'ebook' })
    const record = await new ReadingRecordService(repositories, () => 'record-1', () => '2026-09-14T00:00:00.000Z').create(book.id, { startedAt: '2026-09-14T00:00:00.000Z' })
    await repositories.readingContents.save({ ...record, id: 'content-1', type: 'shortReview', readingRecordId: record.id, recordedForAt: null, text: '保留內容' })
    await new ReadingRecordService(repositories, undefined, () => '2026-09-14T01:00:00.000Z').delete(record.id)
    expect(await repositories.readingRecords.getAll()).toEqual([])
    expect(await repositories.readingContents.getById('content-1')).toMatchObject({ readingRecordId: null, revision: 2 })
  })
})
