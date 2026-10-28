import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import type { DictionaryEntry, ReadingCycle, ReadingRecord, SourceReadingDay } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { libraryBookReadings, libraryBookType, missingBookFields } from '../../src/features/library/library-book-summary'

const makeBook = () => new BookService(createInMemoryRepositories(), () => 'book').create({ title: '測試', mediaTypeId: 'ebook' })

it('requires only the seven agreed fields; progress, ISBN and notes remain optional', async () => {
 const book = await makeBook()
 expect(missingBookFields(book, [], 'unknown')).toEqual(['作者', '出版社', '封面', '分類', '閱讀狀態', '類型'])
 const dictionaries = [
  { id: 'a', kind: 'author', name: '作者' }, { id: 'p', kind: 'publisher', name: '出版社' }, { id: 'c', kind: 'category', name: '分類' },
 ] as DictionaryEntry[]
 const complete = { ...book, authorIds: ['a'], publisherId: 'p', categoryIds: ['c'], bookForm: 'webNovel' as const, cover: { path: 'https://example.com/cover.jpg', mimeType: 'image/jpeg' as const } }
 expect(missingBookFields(complete, dictionaries, 'planned')).toEqual([])
 expect(missingBookFields({ ...complete, publisherId: null }, dictionaries, 'planned')).toEqual(['出版社'])
 expect(missingBookFields(complete, [], 'planned')).toEqual(['作者', '出版社', '分類'])
})

it('persists all four work types and never treats ebook or print as a work type', async () => {
 const service = new BookService(createInMemoryRepositories(), () => crypto.randomUUID())
 for (const type of ['novel', 'manga', 'magazine', 'webNovel'] as const) {
  const book = await service.create({ title: type, mediaTypeId: 'ebook', bookForm: type })
  expect(libraryBookType((await service.list()).find(row => row.id === book.id)!, [])).toBe(type)
 }
 const book = await makeBook()
 expect(libraryBookType(book, [])).toBeNull()
 expect(libraryBookType({ ...book, mediaTypeId: 'print' }, [])).toBeNull()
 expect(libraryBookType({ ...book, publicationKind: 'webSerial' }, [])).toBe('webNovel')
})

it('keeps unknown progress distinct from zero and uses the latest reading cycle', async () => {
 const book = await makeBook()
 expect(libraryBookReadings([book], [], [], []).get(book.id)).toEqual({ status: 'unknown', progress: null })
 const cycles = [{ bookId: book.id, sequence: 1, status: 'completed' }, { bookId: book.id, sequence: 2, status: 'paused' }] as ReadingCycle[]
 const records = [{ bookId: book.id, startedAt: '2026-10-03T10:00:00Z', progress: { unit: 'percent', value: 0 } }] as ReadingRecord[]
 expect(libraryBookReadings([book], cycles, records, []).get(book.id)).toEqual({ status: 'paused', progress: { unit: 'percent', value: 0 } })
})

it('shows qualified imported progress without writing or guessing a disputed completion', async () => {
 const book = await makeBook()
 const row = { bookId: book.id, date: '2026-10-04', durationMs: 600000, progressPercent: 100, completionDisputed: true } as SourceReadingDay
 expect(libraryBookReadings([book], [], [], [row]).get(book.id)).toEqual({ status: 'reading', progress: { unit: 'percent', value: 100 } })
 expect(libraryBookReadings([book], [], [], [{ ...row, completionDisputed: false }]).get(book.id)?.status).toBe('completed')
 expect(row.completionDisputed).toBe(true)
})

it('shows screenshot percentages including zero and 100 without completing or mutating the book', async () => {
 const book = await makeBook()
 for (const value of [0, 65.5, 100]) {
  const cycle = { id: 'photo', bookId: book.id, sequence: 1, status: 'reading', reportedProgressPercent: value, lastReadOn: '2026-10-04' } as ReadingCycle
  const before = JSON.stringify(cycle)
  expect(libraryBookReadings([book], [cycle], [], []).get(book.id)).toEqual({ status: 'reading', progress: { unit: 'percent', value } })
  expect(JSON.stringify(cycle)).toBe(before)
 }
})

it('keeps newer and same-local-day manual progress ahead of a screenshot', async () => {
 const book = await makeBook()
 const cycle = { id: 'photo', bookId: book.id, sequence: 1, status: 'reading', reportedProgressPercent: 65, lastReadOn: '2026-10-04' } as ReadingCycle
 for (const [startedAt, expected] of [['2026-10-03T01:00:00Z', 65], ['2026-10-03T23:00:00Z', 40], ['2026-10-05T01:00:00Z', 40]] as const) {
  const record = { bookId: book.id, cycleId: cycle.id, startedAt, progress: { unit: 'percent', value: 40 } } as ReadingRecord
  expect(libraryBookReadings([book], [cycle], [record], []).get(book.id)?.progress?.value).toBe(expected)
 }
})

it('uses an undated screenshot only as a fallback and ignores snapshots from earlier readings', async () => {
 const book = await makeBook()
 const cycle = { id: 'photo', bookId: book.id, sequence: 1, status: 'reading', reportedProgressPercent: 65 } as ReadingCycle
 const record = { bookId: book.id, cycleId: cycle.id, startedAt: '2026-10-03T01:00:00Z', progress: { unit: 'percent', value: 40 } } as ReadingRecord
 expect(libraryBookReadings([book], [cycle], [], []).get(book.id)?.progress?.value).toBe(65)
 expect(libraryBookReadings([book], [cycle], [record], []).get(book.id)?.progress?.value).toBe(40)
 const reread = { ...cycle, id: 'reread', sequence: 2, reportedProgressPercent: null }
 expect(libraryBookReadings([book], [cycle, reread], [], []).get(book.id)?.progress).toBeNull()
})

it('preserves a newer qualified source percentage and uses a newer screenshot', async () => {
 const book = await makeBook()
 const cycle = { id: 'photo', bookId: book.id, sequence: 1, status: 'reading', reportedProgressPercent: 65, lastReadOn: '2026-10-04' } as ReadingCycle
 for (const [date, expected] of [['2026-10-03', 65], ['2026-10-05', 80]] as const) {
  const row = { bookId: book.id, date, durationMs: 600000, progressPercent: 80 } as SourceReadingDay
  expect(libraryBookReadings([book], [cycle], [], [row]).get(book.id)?.progress?.value).toBe(expected)
 }
})
