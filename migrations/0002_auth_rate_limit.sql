CREATE TABLE IF NOT EXISTS auth_rate_limits (
  client_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  blocked_until INTEGER
);
