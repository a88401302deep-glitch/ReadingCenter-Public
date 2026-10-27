import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createIndexedDbRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'

const databases: string[] = []
afterEach(async () => { for (const name of databases) await Dexie.delete(name); databases.length = 0 })

describe('ReadingCycle CRUD integration', () => {
  it('persists a paused cycle and resumes it without an abandonment reason', async () => {
    const name = `cycle-pause-${crypto.randomUUID()}`; databases.push(name)
    const first = createIndexedDbRepositories(name)
    const book = await new BookService(first.repositories, () => 'book-pause').create({ title: '暫停測試', mediaTypeId: 'ebook' })
    const cycle = await new ReadingCycleService(first.repositories, () => 'cycle-pause').create(book.id, { status: 'paused' })
    first.close()
    const reopened = createIndexedDbRepositories(name)
    const service = new ReadingCycleService(reopened.repositories)
    expect(await service.listForBook(book.id)).toMatchObject([{ id: cycle.id, status: 'paused', abandonedReason: null }])
    await service.update(cycle.id, { status: 'reading' })
    expect(await service.listForBook(book.id)).toMatchObject([{ id: cycle.id, status: 'reading', abandonedReason: null, sequence: 1 }])
    reopened.close()
  })

  it('persists ordered cycles across reopen and preserves identity on edit', async () => {
    const name = `cycle-crud-${crypto.randomUUID()}`; databases.push(name)
    const first = createIndexedDbRepositories(name)
    const book = await new BookService(first.repositories, () => 'book-1').create({ title: '重讀測試', mediaTypeId: 'ebook' })
    const ids = ['cycle-1', 'cycle-2']
    const service = new ReadingCycleService(first.repositories, () => ids.shift()!)
    const original = await service.create(book.id, { status: 'completed', finishedAt: '2026-09-01T00:00:00.000Z', reportedReadingDays: 3 })
    await service.create(book.id, { status: 'reading' })
    first.close()
    const reopened = createIndexedDbRepositories(name)
    const reopenedService = new ReadingCycleService(reopened.repositories, undefined, () => '2026-09-14T03:00:00.000Z')
    expect((await reopenedService.listForBook(book.id)).map((item) => item.sequence)).toEqual([1, 2])
    const edited = await reopenedService.update(original.id, { status: 'completed', finishedAt: '2026-09-02T00:00:00.000Z' })
    expect(edited).toMatchObject({ id: original.id, createdAt: original.createdAt, sequence: 1, revision: 2, reportedReadingDays: 3 })
    reopened.close()
  })
})
