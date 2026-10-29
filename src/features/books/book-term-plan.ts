import { createMetadata, type DictionaryEntry } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'
import { bookTermPresets, termKey, type BookTermKind } from './book-term-catalog'

/** Materialize only selected presets, in the enclosing book-save transaction. */
export async function planBookTerms(repositories: ReadingCenterRepositories, draft: { categoryIds?: string[]; tagIds?: string[] }, now: string) {
 const dictionaries = await repositories.dictionaries.getAll()
 const additions: DictionaryEntry[] = []
 const resolve = (kind: BookTermKind, ids: string[] | undefined) => {
  if (ids === undefined) return undefined
  const presets = bookTermPresets(kind)
  return [...new Set(ids.map(id => {
   const preset = presets.find(item => item.id === id)
   if (!preset) {
    if (id.startsWith('book-term:')) throw new Error('分類或標籤選項無效，請重新選擇')
    return id // Preserve existing IDs, including unloaded legacy entries.
   }
   const collision = dictionaries.find(entry => entry.id === id)
   if (collision && (collision.kind !== kind || termKey(collision.name) !== termKey(preset.label))) throw new Error('分類或標籤選項發生衝突，請核對後再儲存')
   const existing = [...dictionaries, ...additions].find(entry => entry.kind === kind && termKey(entry.name) === termKey(preset.label))
   if (existing) return existing.id
   additions.push({ ...createMetadata({ id, now }), kind, name: preset.label, color: null })
   return id
  }))]
 }
 const categoryIds = resolve('category', draft.categoryIds), tagIds = resolve('tag', draft.tagIds)
 return { additions, fields: { ...(categoryIds !== undefined ? { categoryIds } : {}), ...(tagIds !== undefined ? { tagIds } : {}) } }
}
