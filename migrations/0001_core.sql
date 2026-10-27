PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entities (
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('book', 'readingCycle', 'readingRecord', 'readingContent', 'dictionary', 'collection')),
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  deleted_at TEXT,
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  last_mutation_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (entity_kind, entity_id),
  CHECK ((deleted_at IS NULL AND payload_json IS NOT NULL) OR (deleted_at IS NOT NULL AND payload_json IS NULL))
);

CREATE TABLE IF NOT EXISTS mutation_receipts (
  mutation_id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entities_kind_updated ON entities (entity_kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_entities_live_kind_updated ON entities (entity_kind, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entities_payload_book ON entities (entity_kind, json_extract(payload_json, '$.bookId')) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entities_book_title ON entities (entity_kind, json_extract(payload_json, '$.title')) WHERE entity_kind = 'book' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entities_dictionary_name ON entities (entity_kind, json_extract(payload_json, '$.name')) WHERE entity_kind IN ('dictionary', 'collection') AND deleted_at IS NULL;

CREATE TRIGGER IF NOT EXISTS entities_receipt_after_insert AFTER INSERT ON entities
BEGIN
  INSERT INTO mutation_receipts (mutation_id, entity_kind, entity_id, revision, applied_at)
  VALUES (NEW.last_mutation_id, NEW.entity_kind, NEW.entity_id, NEW.revision, NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS entities_receipt_after_update AFTER UPDATE ON entities
BEGIN
  INSERT INTO mutation_receipts (mutation_id, entity_kind, entity_id, revision, applied_at)
  VALUES (NEW.last_mutation_id, NEW.entity_kind, NEW.entity_id, NEW.revision, NEW.updated_at);
END;
