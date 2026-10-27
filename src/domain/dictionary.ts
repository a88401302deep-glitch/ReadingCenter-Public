import type { EntityMetadata } from './common'

export type DictionaryKind =
  | 'author'
  | 'publisher'
  | 'category'
  | 'tag'
  | 'source'
  | 'mediaType'
  | 'device'

interface DictionaryEntryBase extends EntityMetadata {
  kind: DictionaryKind
  name: string
  color: string | null
}

export interface AuthorEntry extends DictionaryEntryBase {
  kind: 'author'
  aliases: string[]
}

export interface NamedDictionaryEntry extends DictionaryEntryBase {
  kind: Exclude<DictionaryKind, 'author'>
}

export type DictionaryEntry = AuthorEntry | NamedDictionaryEntry

export function assertValidDictionaryEntry(entry: DictionaryEntry): void {
  if (!entry.name.trim()) throw new Error('Dictionary entry name must not be empty')
}
