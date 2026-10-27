import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createIndexedDbRepositories } from '../../src/data'
import type { Book, DictionaryEntry } from '../../src/domain'
import { emptyLibraryFilters, filterLibrary } from '../../src/features/library/library-query'

const now = '2026-09-14T00:00:00.000Z'
const meta = (id: string) => ({ id, createdAt: now, updatedAt: now, revision: 1, schemaVersion: 1, provenance: { kind: 'manual' as const } })
const entry = (id: string, kind: DictionaryEntry['kind'], name: string): DictionaryEntry => kind === 'author' ? { ...meta(id), kind, name, color: null, aliases: [] } : { ...meta(id), kind, name, color: null }
const book = (id: string, title: string, authorIds: string[], categoryIds: string[], tagIds: string[], sourceIds: string[]): Book => ({ ...meta(id), title, preferredTitle: null, subtitle: null, originalTitle: null, languageTag: 'zh-Hant', titleAliases: [], externalReferences: [], publicationKind: 'published', collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null, authorIds, publisherId: null, mediaTypeId: 'ebook', categoryIds, tagIds, sourceIds, cover: null, bookNote: '' })
const names: string[] = []
afterEach(async () => { for (const name of names) await Dexie.delete(name); names.length = 0 })

describe('library search and filters', () => {
  it('combines title or author search with category, tag and source filters', async () => {
    const name = `library-search-${crypto.randomUUID()}`; names.push(name)
    const context = createIndexedDbRepositories(name)
    const dictionaries = [entry('author-1', 'author', '梨木香步'), entry('category-1', 'category', '文學'), entry('tag-1', 'tag', '療癒'), entry('source-1', 'source', '讀墨')]
    const books = [book('book-1', '唐草人偶', ['author-1'], ['category-1'], ['tag-1'], ['source-1']), book('book-2', '其他作品', [], [], [], [])]
    await Promise.all(dictionaries.map((item) => context.repositories.dictionaries.save(item)))
    await Promise.all(books.map((item) => context.repositories.books.save(item)))
    const storedBooks = await context.repositories.books.getAll()
    const storedDictionaries = await context.repositories.dictionaries.getAll()
    expect(filterLibrary(storedBooks, storedDictionaries, '梨木', { ...emptyLibraryFilters, categoryId: 'category-1', tagId: 'tag-1', sourceId: 'source-1' }).map((item) => item.id)).toEqual(['book-1'])
    expect(filterLibrary(storedBooks, storedDictionaries, '', emptyLibraryFilters)).toHaveLength(2)
    context.close()
  })

  it('searches source title, preferred title, aliases, author aliases and either Chinese script', () => {
    const author = { ...entry('author-2', 'author', '金庸'), aliases: ['查良鏞'] } as DictionaryEntry
    const item = { ...book('book-3', '天龙八部', ['author-2'], [], [], ['wechat-reading']), preferredTitle: '天龍八部（珍藏版）', titleAliases: ['Demi-Gods and Semi-Devils'], externalReferences: [{ sourceId: 'wechat-reading', externalId: 'wx-88', sourceTitle: '天龙八部', sourceAuthorNames: ['金庸'] }] }
    expect(filterLibrary([item], [author], '天龍八部', emptyLibraryFilters)).toHaveLength(1)
    expect(filterLibrary([item], [author], '天龙八部', emptyLibraryFilters)).toHaveLength(1)
    expect(filterLibrary([item], [author], '查良镛', emptyLibraryFilters)).toHaveLength(1)
    expect(filterLibrary([item], [author], 'Demi-Gods', emptyLibraryFilters)).toHaveLength(1)
  })
})
