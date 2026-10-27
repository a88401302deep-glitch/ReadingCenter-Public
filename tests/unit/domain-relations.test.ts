import { describe, expect, it } from 'vitest'
import {
  assertValidBook,
  assertValidReadingCycle,
  assertValidReadingRecord,
  createMetadata,
  type Book,
  type ReadingCycle,
  type ReadingRecord
} from '../../src/domain'

const now = '2026-09-14T04:00:00Z'

describe('core entity relationships', () => {
  it('allows multiple reading cycles and records to share one Book', () => {
    const cycleMetadata = createMetadata({ id: 'cycle-1', now })
    const cycles: ReadingCycle[] = [
      {
        ...cycleMetadata,
        bookId: 'book-1',
        sequence: 1,
        status: 'completed',
        startedAt: now,
        finishedAt: '2026-09-14T05:00:00Z',
        abandonedReason: null
      },
      {
        ...cycleMetadata,
        id: 'cycle-2',
        bookId: 'book-1',
        sequence: 2,
        status: 'reading',
        startedAt: '2026-09-14T06:00:00Z',
        finishedAt: null,
        abandonedReason: null
      }
    ]
    const recordMetadata = createMetadata({ id: 'record-1', now })
    const records: ReadingRecord[] = cycles.map((cycle, index) => ({
      ...recordMetadata,
      id: `record-${index + 1}`,
      bookId: 'book-1',
      cycleId: cycle.id,
      startedAt: cycle.startedAt ?? now,
      endedAt: null,
      durationMinutes: null,
      progress: null,
      deviceId: null,
      sourceId: null
    }))

    expect(new Set(cycles.map((cycle) => cycle.bookId))).toEqual(new Set(['book-1']))
    expect(new Set(records.map((record) => record.bookId))).toEqual(new Set(['book-1']))
    cycles.forEach(assertValidReadingCycle)
    expect(() => assertValidReadingCycle({ ...cycles[0], completionDate: { precision: 'date', completedOn: '2024-02-30' } })).toThrow('invalid')
    expect(() => assertValidReadingCycle({ ...cycles[1], completionDate: { precision: 'date', completedOn: '2024-02-14' } })).toThrow('Only a completed')
    records.forEach(assertValidReadingRecord)
  })

  it('keeps Book notes on Book and rejects Base64 covers', () => {
    const book: Book = {
      ...createMetadata({ id: 'book-1', now }),
      title: '測試書籍',
      preferredTitle: null,
      subtitle: null,
      languageTag: 'und',
      titleAliases: [],
      externalReferences: [],
      publicationKind: 'published',
      collectionId: null,
      sequence: null,
      serialization: null,
      isbn: null,
      publishedOn: null,
      originalTitle: null,
      authorIds: [],
      publisherId: null,
      mediaTypeId: 'media-book',
      categoryIds: [],
      tagIds: [],
      sourceIds: [],
      cover: null,
      bookNote: '書籍本身備註'
    }
    expect(() => assertValidBook(book)).not.toThrow()
    expect(book.bookNote).toBe('書籍本身備註')

    expect(() =>
      assertValidBook({
        ...book,
        cover: { path: 'data:image/png;base64,AAAA', mimeType: 'image/png' }
      })
    ).toThrow(/file path/)
  })
})
