import { expect, it } from 'vitest'
import { defaultMetadataFields, isBookMetadataCandidate } from '../../src/domain/book-metadata'
const candidate = { id: 'ol:OL1M', source: 'Open Library' as const, title: '書', authors: ['作者'], publisher: '出版社', isbn: '', publishedOn: '', sourceUrl: 'https://openlibrary.org/books/OL1M', coverUrl: null, translators: ['譯者'], wordCount: 100, seriesName: '系列', sequenceLabel: '1' }
it('accepts bounded optional fields without guessing series membership', () => {
 expect(isBookMetadataCandidate(candidate)).toBe(true)
 expect(defaultMetadataFields(candidate)).toContain('translators')
 expect(defaultMetadataFields(candidate)).not.toContain('seriesName')
 expect(defaultMetadataFields(candidate)).not.toContain('sequenceLabel')
})
it('rejects malformed supplementary values and unsafe source URLs', () => {
 for (const patch of [{ translators: [7] }, { wordCount: 1.5 }, { wordCount: -1 }, { seriesName: 'x'.repeat(201) }, { sourceUrl: 'javascript:alert(1)' }]) expect(isBookMetadataCandidate({ ...candidate, ...patch })).toBe(false)
})
