import type { Book, DictionaryEntry } from '../../domain'
import type { MultiSelectOption } from '../../shared/ui/MultiSelect'

export function recommendBookTerms(books: readonly Book[], dictionaries: readonly DictionaryEntry[], kind: 'category' | 'tag', limit = 3): MultiSelectOption[] {
  const counts = new Map<string, number>()
  for (const book of books) for (const id of kind === 'category' ? book.categoryIds : book.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  const entries = new Map(dictionaries.filter((item) => item.kind === kind).map((item) => [item.id, item.name]))
  return [...counts].filter(([id]) => entries.has(id)).sort((a, b) => b[1] - a[1] || (entries.get(a[0]) ?? '').localeCompare(entries.get(b[0]) ?? '', 'zh-TW')).slice(0, limit).map(([id]) => ({ id, label: entries.get(id)! }))
}

export function findSimilarTerm(name: string, dictionaries: readonly DictionaryEntry[], kind: 'category' | 'tag'): DictionaryEntry | undefined {
  const normalized = name.normalize('NFKC').replace(/[系類]/g, '').trim().toLocaleLowerCase('zh-TW')
  return dictionaries.find((item) => item.kind === kind && item.name.normalize('NFKC').replace(/[系類]/g, '').trim().toLocaleLowerCase('zh-TW') === normalized)
}
