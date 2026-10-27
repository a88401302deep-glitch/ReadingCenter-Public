import { describe, expect, it } from 'vitest'
import { assertValidBook, createMetadata, type Book } from '../../src/domain'

const base = (): Book => ({
  ...createMetadata({ id: 'book-1', now: '2026-09-14T00:00:00.000Z' }),
  title: '測試', preferredTitle: null, subtitle: null, originalTitle: null, languageTag: 'zh-Hant', titleAliases: [], externalReferences: [],
  publicationKind: 'published', collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null,
  authorIds: [], publisherId: null, mediaTypeId: 'ebook', categoryIds: [], tagIds: [], sourceIds: [], cover: null, bookNote: ''
})

describe('publication models', () => {
  it('orders independent manga volumes within one series', () => {
    const volumes = [3, 1, 2].map((value) => ({ ...base(), id: `manga-${value}`, mediaTypeId: 'manga', collectionId: 'series-1', sequence: { kind: 'volume' as const, label: `第 ${value} 冊`, sortValue: value } }))
    expect(volumes.sort((a, b) => a.sequence.sortValue - b.sequence.sortValue).map((x) => x.id)).toEqual(['manga-1', 'manga-2', 'manga-3'])
  })

  it('represents magazine issues with sortable issue details', () => {
    const issue = { ...base(), mediaTypeId: 'magazine', collectionId: 'periodical-1', sequence: { kind: 'issue' as const, label: '2026 年 9 月號', sortValue: 202609, year: 2026, month: 9 }, publishedOn: '2026-09-01' }
    expect(() => assertValidBook(issue)).not.toThrow()
  })

  it('updates one web serial Book without changing its stable ID', () => {
    const serial: Book = { ...base(), publicationKind: 'webTranslation', serialization: { status: 'ongoing', latestChapter: '第 120 話', updatedAt: '2026-09-14T01:00:00.000Z' }, externalReferences: [{ sourceId: 'fan-translation', externalId: 'novel-88', sourceTitle: '測試', sourceAuthorNames: [] }] }
    const updated = { ...serial, serialization: { ...serial.serialization!, latestChapter: '第 121 話' } }
    expect(updated.id).toBe(serial.id)
    expect(updated.serialization.latestChapter).toBe('第 121 話')
    expect(() => assertValidBook(updated)).not.toThrow()
  })

  it('allows books without cover, ISBN or publisher', () => {
    expect(() => assertValidBook(base())).not.toThrow()
  })
})
