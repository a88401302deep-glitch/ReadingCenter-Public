import type { EntityMetadata } from './common'

export type CollectionKind = 'series' | 'periodical'

export interface BookCollection extends EntityMetadata {
  kind: CollectionKind
  name: string
}

export function assertValidBookCollection(collection: BookCollection): void {
  if (!collection.name.trim()) throw new Error('Book collection name must not be empty')
}
