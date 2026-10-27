import type { D1Database } from './cloudflare-types'
import { D1EntityStore } from './d1-entity-store'

// Additive, idempotent initialization after authentication. Never rebuild book tables.
export const sourceReadingDaySchema = [
  `CREATE TABLE IF NOT EXISTS source_reading_day_entities (
    entity_kind TEXT NOT NULL CHECK (entity_kind = 'sourceReadingDay'), entity_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1), provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
    deleted_at TEXT, payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)), last_mutation_id TEXT NOT NULL UNIQUE,
    PRIMARY KEY (entity_kind, entity_id), CHECK ((deleted_at IS NULL AND payload_json IS NOT NULL) OR (deleted_at IS NOT NULL AND payload_json IS NULL))
  )`,
  `CREATE TRIGGER IF NOT EXISTS source_reading_day_receipt_after_insert AFTER INSERT ON source_reading_day_entities BEGIN
    INSERT INTO mutation_receipts (mutation_id, entity_kind, entity_id, revision, applied_at)
    VALUES (NEW.last_mutation_id, NEW.entity_kind, NEW.entity_id, NEW.revision, NEW.updated_at); END`,
  `CREATE TRIGGER IF NOT EXISTS source_reading_day_receipt_after_update AFTER UPDATE ON source_reading_day_entities BEGIN
    INSERT INTO mutation_receipts (mutation_id, entity_kind, entity_id, revision, applied_at)
    VALUES (NEW.last_mutation_id, NEW.entity_kind, NEW.entity_id, NEW.revision, NEW.updated_at); END`
] as const
const initialized = new WeakMap<D1Database, Promise<void>>()
export async function createSourceReadingDayStore(database: D1Database): Promise<D1EntityStore> {
  let ready = initialized.get(database)
  if (!ready) {
    ready = (async () => { for (const sql of sourceReadingDaySchema) await database.prepare(sql).run() })()
    initialized.set(database, ready)
    void ready.catch(() => initialized.delete(database))
  }
  await ready
  return new D1EntityStore(database, 'source_reading_day_entities')
}

