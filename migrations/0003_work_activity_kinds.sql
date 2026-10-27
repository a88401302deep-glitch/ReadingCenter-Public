PRAGMA foreign_keys = ON;

-- SQLite cannot alter a CHECK constraint in place. Rebuild only the generic
-- entity table so existing rows, revisions, provenance, and mutation IDs remain
-- unchanged while the next-generation entity kinds become valid.
CREATE TABLE entities_next (
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('work', 'activityLog', 'book', 'readingCycle', 'readingRecord', 'readingContent', 'dictionary', 'collection')),
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

INSERT INTO entities_next (
  entity_kind,
  entity_id,
  revision,
  created_at,
  updated_at,
  schema_version,
  provenance_json,
  deleted_at,
  payload_json,
  last_mutation_id
)
SELECT
  entity_kind,
  entity_id,
  revision,
  created_at,
  updated_at,
  schema_version,
  provenance_json,
  deleted_at,
  payload_json,
  last_mutation_id
FROM entities;

DROP TABLE entities;
ALTER TABLE entities_next RENAME TO entities;

CREATE INDEX idx_entities_kind_updated ON entities (entity_kind, updated_at DESC);
CREATE INDEX idx_entities_live_kind_updated ON entities (entity_kind, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_entities_payload_book ON entities (entity_kind, json_extract(payload_json, '$.bookId')) WHERE deleted_at IS NULL;
CREATE INDEX idx_entities_payload_work ON entities (entity_kind, json_extract(payload_json, '$.workId')) WHERE entity_kind = 'activityLog' AND deleted_at IS NULL;
CREATE INDEX idx_entities_book_title ON entities (entity_kind, json_extract(payload_json, '$.title')) WHERE entity_kind = 'book' AND deleted_at IS NULL;
CREATE INDEX idx_entities_work_title ON entities (entity_kind, json_extract(payload_json, '$.title')) WHERE entity_kind = 'work' AND deleted_at IS NULL;
CREATE INDEX idx_entities_dictionary_name ON entities (entity_kind, json_extract(payload_json, '$.name')) WHERE entity_kind IN ('dictionary', 'collection') AND deleted_at IS NULL;

CREATE TRIGGER entities_receipt_after_insert AFTER INSERT ON entities
BEGIN
  INSERT INTO mutation_receipts (mutation_id, entity_kind, entity_id, revision, applied_at)
  VALUES (NEW.last_mutation_id, NEW.entity_kind, NEW.entity_id, NEW.revision, NEW.updated_at);
END;

CREATE TRIGGER entities_receipt_after_update AFTER UPDATE ON entities
BEGIN
  INSERT INTO mutation_receipts (mutation_id, entity_kind, entity_id, revision, applied_at)
  VALUES (NEW.last_mutation_id, NEW.entity_kind, NEW.entity_id, NEW.revision, NEW.updated_at);
END;
