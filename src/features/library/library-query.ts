import * as OpenCC from 'opencc-js/cn2t'
import { getBookDisplayTitle, type AuthorEntry, type Book, type DictionaryEntry, type DictionaryKind } from '../../domain'

export interface LibraryFilters {
  categoryId: string
  tagId: string
  sourceId: string
}

export const emptyLibraryFilters: LibraryFilters = { categoryId: '', tagId: '', sourceId: '' }

const toTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' })
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('zh-TW')

export function searchForms(value: string): string[] {
  const normalized = normalize(value)
  return [...new Set([normalized, normalize(toTraditional(normalized))])]
}

function includesSearchForm(values: readonly string[], query: string): boolean {
  const haystack = values.flatMap(searchForms)
  return searchForms(query).some((needle) => haystack.some((text) => text.includes(needle)))
}

export function filterLibrary(
  books: readonly Book[],
  dictionaries: readonly DictionaryEntry[],
  query: string,
  filters: LibraryFilters
): Book[] {
  const entries = new Map(dictionaries.map((entry) => [entry.id, entry]))
  return books.filter((book) => {
    const authors = book.authorIds.map((id) => entries.get(id)).filter((entry): entry is AuthorEntry => entry?.kind === 'author')
    const searchValues = [
      getBookDisplayTitle(book), book.title, book.originalTitle ?? '', ...book.titleAliases, ...(book.authorOriginalNames ?? []),
      ...book.externalReferences.flatMap((reference) => [reference.sourceTitle, ...reference.sourceAuthorNames]),
      ...authors.flatMap((author) => [author.name, ...author.aliases])
    ]
    const matchesQuery = !query.trim() || includesSearchForm(searchValues, query)
    return matchesQuery
      && (!filters.categoryId || book.categoryIds.includes(filters.categoryId))
      && (!filters.tagId || book.tagIds.includes(filters.tagId))
      && (!filters.sourceId || book.sourceIds.includes(filters.sourceId))
  })
}

export function dictionaryOptions(dictionaries: readonly DictionaryEntry[], kind: DictionaryKind) {
  return dictionaries.filter((entry) => entry.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))
}
