import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createIndexedDbRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'

const databases: string[] = []
afterEach(async () => { for (const name of databases) await Dexie.delete(name); databases.length = 0 })

describe('ReadingRecord CRUD integration', () => {
  it('persists records across reopen and keeps createdAt when edited', async () => {
    const name = `record-crud-${crypto.randomUUID()}`; databases.push(name)
    const first = createIndexedDbRepositories(name)
    const book = await new BookService(first.repositories, () => 'book-1').create({ title: '閱讀紀錄測試', mediaTypeId: 'ebook' })
    const record = await new ReadingRecordService(first.repositories, () => 'record-1', () => '2026-09-14T00:00:00.000Z').create(book.id, { startedAt: '2026-09-14T01:00:00.000Z', durationMinutes: 20, progress: { unit: 'percent', value: 10 } })
    first.close()
    const reopened = createIndexedDbRepositories(name)
    const service = new ReadingRecordService(reopened.repositories, undefined, () => '2026-09-14T02:00:00.000Z')
    expect(await service.listForBook(book.id)).toHaveLength(1)
    const edited = await service.update(record.id, { startedAt: record.startedAt, durationMinutes: 30, progress: { unit: 'percent', value: 20 } })
    expect(edited).toMatchObject({ id: record.id, createdAt: record.createdAt, revision: 2, durationMinutes: 30 })
    reopened.close()
  })
})
