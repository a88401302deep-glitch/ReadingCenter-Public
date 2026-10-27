CREATE TABLE IF NOT EXISTS integration_tokens (
  credential_id TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
