export type EntityId = string
export type IsoDateTime = string

export type Provenance =
  | { kind: 'manual' }
  | {
      kind: 'import'
      sourceId: EntityId
      externalId: string
      importedAt: IsoDateTime
    }

export interface EntityMetadata {
  id: EntityId
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  revision: number
  schemaVersion: number
  provenance: Provenance
}

type MetadataKey = keyof EntityMetadata
export type EntityChanges<T extends EntityMetadata> = Partial<Omit<T, MetadataKey>>

export interface NewEntityMetadata {
  id: EntityId
  now: IsoDateTime
  provenance?: Provenance
  schemaVersion?: number
}

export function createMetadata({
  id,
  now,
  provenance = { kind: 'manual' },
  schemaVersion = 1
}: NewEntityMetadata): EntityMetadata {
  if (!id.trim()) throw new Error('Entity id must not be empty')
  assertIsoDateTime(now, 'now')
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error('schemaVersion must be a positive integer')
  }

  return {
    id,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    schemaVersion,
    provenance
  }
}

export function updateEntity<T extends EntityMetadata>(
  entity: T,
  changes: EntityChanges<T>,
  updatedAt: IsoDateTime
): T {
  assertIsoDateTime(updatedAt, 'updatedAt')

  return {
    ...entity,
    ...changes,
    id: entity.id,
    createdAt: entity.createdAt,
    updatedAt,
    revision: entity.revision + 1,
    schemaVersion: entity.schemaVersion,
    provenance: entity.provenance
  }
}

export function assertIsoDateTime(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(`${field} must be an ISO 8601 UTC datetime`)
  }
}
