import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, expect, it } from 'vitest'
import { createIndexedDbRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { captureDeviceBackup } from '../../src/features/backup/backup-export'
import { confirmPhotoReading } from '../../src/import/photo-reading'

const databases: string[] = []
afterEach(async () => { for (const name of databases) await Dexie.delete(name); databases.length = 0 })
it('atomically deduplicates confirmed screenshot evidence and preserves original facts, backup and reopen', async () => {
 const name = `evidence-${crypto.randomUUID()}`; databases.push(name)
 const first = createIndexedDbRepositories(name)
 try {
  const book = await new BookService(first.repositories).create({ title: '合成閱讀安全', mediaTypeId: 'ebook', bookNote: '人工作品備註', rating: { value: 4, scale: 5 }, cover: { path: '/synthetic.jpg', mimeType: 'image/jpeg' } })
  const draft = { status: 'reading' as const, startedOn: '2026-09-01', lastReadOn: '2026-09-03', completedOn: '', progressPercent: '100', totalMinutes: '123', allowReread: false }
  const [a,b] = await Promise.all([confirmPhotoReading(first.repositories,book.id,'a'.repeat(64),draft),confirmPhotoReading(first.repositories,book.id,'a'.repeat(64),draft)])
  expect(a.id).toBe(b.id)
  expect(await first.repositories.readingCycles.getAll()).toHaveLength(1)
  await expect(confirmPhotoReading(first.repositories,book.id,'a'.repeat(64),{ ...draft, totalMinutes: '999' })).rejects.toThrow('未新增或覆寫')
  await expect(confirmPhotoReading(first.repositories,book.id,'b'.repeat(64),draft)).rejects.toThrow('未重複新增')
  expect(await first.repositories.books.getById(book.id)).toEqual(book)
  expect(await first.repositories.readingRecords.getAll()).toEqual([])
  const before = await first.repositories.readingCycles.getAll()
  const overview = new ReadingOverviewService(first.repositories)
  for (let i=0;i<2;i++) {
   const result = await overview.getOverview()
   expect(result.byBook[book.id]).toMatchObject({ totalMinutes: 123, completedBookCount: 0 })
  }
  expect(await first.repositories.readingCycles.getAll()).toEqual(before)
  const backup = await captureDeviceBackup(first.repositories,new Date().toISOString())
  expect(backup.data.readingCycles[0]).toMatchObject({ status: 'reading', startedOn: '2026-09-01', lastReadOn: '2026-09-03', reportedProgressPercent: 100, startedAt: null, finishedAt: null, completionDate: null })
  first.close()
  const reopened = createIndexedDbRepositories(name)
  try {
   const service = new ReadingCycleService(reopened.repositories)
   expect(await service.listForBook(book.id)).toEqual(before)
   const done = await service.update(a.id,{ status:'completed',startedAt:null,finishedAt:null,completionDate:{ precision:'date',completedOn:'2026-09-05' } },a.revision)
   expect(done).toMatchObject({ startedOn:draft.startedOn,lastReadOn:draft.lastReadOn,reportedProgressPercent:100,reportedDurationMinutes:123,revision:a.revision+1 })
   await expect(service.update(a.id,{status:'reading'},a.revision)).rejects.toThrow('草稿已保留')
   expect(await service.listForBook(book.id)).toEqual([done])
   expect(await reopened.repositories.books.getById(book.id)).toEqual(book)
   expect(await reopened.repositories.readingRecords.getAll()).toEqual([])
  } finally { reopened.close() }
 } finally { first.close() }
})
