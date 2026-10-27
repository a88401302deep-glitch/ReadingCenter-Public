import { describe, expect, it } from 'vitest'
import type { Book, DictionaryEntry } from '../../src/domain'
import { findSimilarTerm, recommendBookTerms } from '../../src/features/books/book-recommendations'
const now = '2026-09-14T00:00:00.000Z'
const meta = (id: string) => ({ id, createdAt: now, updatedAt: now, revision: 1, schemaVersion: 1, provenance: { kind: 'manual' as const } })
const dictionary: DictionaryEntry[] = [{ ...meta('c1'), kind: 'category', name: '療癒', color: null }, { ...meta('c2'), kind: 'category', name: '文學', color: null }]
const book = (id: string, categories: string[]): Book => ({ ...meta(id), title: id, preferredTitle: null, subtitle: null, originalTitle: null, languageTag: 'und', titleAliases: [], externalReferences: [], publicationKind: 'published', collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null, authorIds: [], publisherId: null, mediaTypeId: 'ebook', categoryIds: categories, tagIds: [], sourceIds: [], cover: null, bookNote: '' })
describe('book term recommendations', () => {
  it('ranks existing terms without applying them', () => {
    expect(recommendBookTerms([book('b1', ['c1']), book('b2', ['c1']), book('b3', ['c2'])], dictionary, 'category').map((x) => x.id)).toEqual(['c1', 'c2'])
  })
  it('detects a normalized near-duplicate term', () => {
    expect(findSimilarTerm('療癒系', dictionary, 'category')?.id).toBe('c1')
  })
})
