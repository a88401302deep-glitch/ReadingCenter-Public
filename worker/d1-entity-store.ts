import { ManualDataProtectedError, StoreConflictError, type RemoteEntity, type RemoteEntityKind, type RemoteEntityStore, type RemoteMutationResult, type StoredRemoteEntity } from '../src/server/entity-api'
import type { D1Database, D1Result } from './cloudflare-types'

interface EntityRow {
  entity_kind: RemoteEntityKind
  entity_id: string
  revision: number
  created_at: string
  updated_at: string
  schema_version: number
  provenance_json: string
  deleted_at: string | null
  payload_json: string | null
}

export class D1EntityStore implements RemoteEntityStore {
  constructor(private readonly database: D1Database, private readonly table: 'entities' | 'reading_goal_entities' | 'reading_preferences_entities' | 'source_reading_day_entities' = 'entities') {}

  async get(kind: RemoteEntityKind, id: string): Promise<StoredRemoteEntity | undefined> {
    const row = await this.database.prepare(`SELECT entity_kind, entity_id, revision, created_at, updated_at, schema_version, provenance_json, deleted_at, payload_json FROM ${this.table} WHERE entity_kind = ? AND entity_id = ?`).bind(kind, id).first<EntityRow>()
    return row ? toStoredEntity(row) : undefined
  }

  async list(kind: RemoteEntityKind, includeDeleted: boolean): Promise<StoredRemoteEntity[]> {
    const condition = includeDeleted ? '' : ' AND deleted_at IS NULL'
    const result = await this.database.prepare(`SELECT entity_kind, entity_id, revision, created_at, updated_at, schema_version, provenance_json, deleted_at, payload_json FROM ${this.table} WHERE entity_kind = ?${condition} ORDER BY updated_at DESC, entity_id`).bind(kind).all<EntityRow>()
    return (result.results ?? []).map(toStoredEntity)
  }

  async put(input: { kind: RemoteEntityKind; mutationId: string; baseRevision: number; entity: RemoteEntity }): Promise<RemoteMutationResult> {
    const replay = await this.findReplay(input.mutationId, input.kind, input.entity.id)
    if (replay) return replay
    const current = await this.get(input.kind, input.entity.id)
    if ((current?.revision ?? 0) !== input.baseRevision || current?.deletedAt) throw new StoreConflictError(current)
    if (current?.provenance.kind === 'manual' && input.entity.provenance.kind === 'import') {
      throw new ManualDataProtectedError(current)
    }
    const created = !current
    const entity: RemoteEntity = { ...input.entity, id: input.entity.id, createdAt: current?.createdAt ?? input.entity.createdAt, revision: input.baseRevision + 1 }
    const result = await this.database.prepare(`INSERT INTO ${this.table} (
      entity_kind, entity_id, revision, created_at, updated_at, schema_version, provenance_json, deleted_at, payload_json, last_mutation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
      revision = excluded.revision,
      updated_at = excluded.updated_at,
      schema_version = excluded.schema_version,
      provenance_json = excluded.provenance_json,
      deleted_at = NULL,
      payload_json = excluded.payload_json,
      last_mutation_id = excluded.last_mutation_id
    WHERE ${this.table}.revision = ? AND ${this.table}.deleted_at IS NULL`).bind(
      input.kind, entity.id, entity.revision, entity.createdAt, entity.updatedAt, entity.schemaVersion,
      JSON.stringify(entity.provenance), JSON.stringify(entity), input.mutationId, input.baseRevision
    ).run()
    await this.assertChanged(result, input.kind, entity.id, input.mutationId)
    return { entity: await this.getRequired(input.kind, entity.id), replayed: false, created }
  }

  async delete(input: { kind: RemoteEntityKind; id: string; mutationId: string; baseRevision: number; deletedAt: string }): Promise<RemoteMutationResult> {
    const replay = await this.findReplay(input.mutationId, input.kind, input.id)
    if (replay) return replay
    const current = await this.get(input.kind, input.id)
    if (!current || current.deletedAt || current.revision !== input.baseRevision) throw new StoreConflictError(current)
    const result = await this.database.prepare(`UPDATE ${this.table} SET
      revision = revision + 1, updated_at = ?, deleted_at = ?, payload_json = NULL, last_mutation_id = ?
      WHERE entity_kind = ? AND entity_id = ? AND revision = ? AND deleted_at IS NULL`).bind(
      input.deletedAt, input.deletedAt, input.mutationId, input.kind, input.id, input.baseRevision
    ).run()
    await this.assertChanged(result, input.kind, input.id, input.mutationId)
    return { entity: await this.getRequired(input.kind, input.id), replayed: false, created: false }
  }

  private async findReplay(mutationId: string, expectedKind: RemoteEntityKind, expectedId: string): Promise<RemoteMutationResult | undefined> {
    const receipt = await this.database.prepare('SELECT entity_kind, entity_id FROM mutation_receipts WHERE mutation_id = ?').bind(mutationId).first<{ entity_kind: RemoteEntityKind; entity_id: string }>()
    if (!receipt) return undefined
    if (receipt.entity_kind !== expectedKind || receipt.entity_id !== expectedId) throw new StoreConflictError()
    return { entity: await this.getRequired(expectedKind, expectedId), replayed: true, created: false }
  }

  private async assertChanged(result: D1Result, kind: RemoteEntityKind, id: string, mutationId: string): Promise<void> {
    if ((result.meta.changes ?? 0) > 0) return
    const replay = await this.findReplay(mutationId, kind, id)
    if (!replay) throw new StoreConflictError(await this.get(kind, id))
  }

  private async getRequired(kind: RemoteEntityKind, id: string): Promise<StoredRemoteEntity> {
    const entity = await this.get(kind, id)
    if (!entity) throw new Error('D1 mutation completed without a readable entity')
    return entity
  }
}

function toStoredEntity(row: EntityRow): StoredRemoteEntity {
  return {
    kind: row.entity_kind,
    id: row.entity_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schemaVersion: row.schema_version,
    provenance: JSON.parse(row.provenance_json) as RemoteEntity['provenance'],
    deletedAt: row.deleted_at,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as RemoteEntity) : null
  }
}

