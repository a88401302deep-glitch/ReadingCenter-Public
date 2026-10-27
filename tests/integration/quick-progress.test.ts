import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { createSyncingIndexedDbRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { QuickProgressService } from '../../src/features/reading-overview/quick-progress-service'

it('persists one record and one sync mutation for concurrent retries across reopen', async () => {
  const name = 'quick-progress-' + crypto.randomUUID()
  const local = createSyncingIndexedDbRepositories(name)
  try {
    const book = await new BookService(local.repositories).create({ title: '持久化', mediaTypeId: 'ebook' })
    const cycle = await new ReadingCycleService(local.repositories).create(book.id, { status: 'reading' })
    const service = new QuickProgressService(local.repositories), context = await service.load(book.id)
    const before = await local.database.syncOutbox.count()
    await Promise.all([1, 2].map(() => service.save(book.id, 'operation', context.token, '2026-10-03T03:00:00.000Z', { unit: 'page', value: 32, total: 200 })))
    expect(await local.database.syncOutbox.count()).toBe(before + 1)
    local.close()
    const reopened = createSyncingIndexedDbRepositories(name)
    try {
      expect(await reopened.repositories.readingRecords.getAll()).toEqual([expect.objectContaining({ id: 'operation', cycleId: cycle.id, durationMinutes: null, endedAt: null, progress: { unit: 'page', value: 32, total: 200 } })])
      expect(await reopened.repositories.readingCycles.getById(cycle.id)).toEqual(cycle)
    } finally { reopened.close() }
  } finally { local.close(); await local.deleteDatabase() }
})
it('rolls back the record and sync mutation on failure and then permits retry', async () => {
  const local = createSyncingIndexedDbRepositories('quick-progress-rollback-' + crypto.randomUUID())
  try {
    const book = await new BookService(local.repositories).create({ title: '回復測試', mediaTypeId: 'ebook' })
    await new ReadingCycleService(local.repositories).create(book.id, { status: 'reading' })
    const service = new QuickProgressService(local.repositories), context = await service.load(book.id)
    const before = await local.database.syncOutbox.count(), actual = local.repositories.readingRecords.save.bind(local.repositories.readingRecords)
    const spy = vi.spyOn(local.repositories.readingRecords, 'save').mockImplementationOnce(async row => { await actual(row); throw new Error('模擬儲存中斷') })
    await expect(service.save(book.id, 'operation', context.token, '2026-10-03T03:00:00.000Z', { unit: 'percent', value: 40 })).rejects.toThrow('儲存中斷')
    expect(await local.repositories.readingRecords.getAll()).toHaveLength(0)
    expect(await local.database.syncOutbox.count()).toBe(before)
    spy.mockRestore()
    await service.save(book.id, 'operation', context.token, '2026-10-03T03:00:00.000Z', { unit: 'percent', value: 40 })
    expect(await local.repositories.readingRecords.getAll()).toHaveLength(1)
    expect(await local.database.syncOutbox.count()).toBe(before + 1)
  } finally { local.close(); await local.deleteDatabase() }
})
