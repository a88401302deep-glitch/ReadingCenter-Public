import { describe, expect, it } from 'vitest'
import { hasLongReview, readingContentTypes, type ReadingContent } from '../../src/domain'

const base = {
  id: 'content-1',
  bookId: 'book-1',
  cycleId: null,
  readingRecordId: null,
  recordedForAt: null,
  createdAt: '2026-09-14T04:00:00Z',
  updatedAt: '2026-09-14T04:00:00Z',
  revision: 1,
  schemaVersion: 1,
  provenance: { kind: 'manual' as const }
}

describe('reading content', () => {
  it('locks the three supported content types', () => {
    expect(readingContentTypes).toEqual(['highlight', 'shortReview', 'longReview'])
  })

  it('derives the long-review marker', () => {
    const contents: ReadingContent[] = [
      { ...base, type: 'shortReview', text: '短評' },
      { ...base, id: 'content-2', type: 'longReview', title: null, text: '長篇心得' }
    ]
    expect(hasLongReview(contents)).toBe(true)
  })
})
