-- 0001 — subscribe_attempts: the counter + audit trail behind the /api/subscribe bot gate.
--
-- Additive and idempotent; nothing else in the schema changes. Apply with:
--   wrangler d1 execute dairo-status --local  --file=./migration/0001_subscribe_attempts.sql
--   wrangler d1 execute dairo-status --remote --file=./migration/0001_subscribe_attempts.sql
--
-- (db/schema.sql carries the same definitions, so a fresh database needs no migration.)

CREATE TABLE IF NOT EXISTS subscribe_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL DEFAULT 'unknown',
  email      TEXT NOT NULL DEFAULT '',
  outcome    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscribe_attempts_ip ON subscribe_attempts (ip, created_at);
CREATE INDEX IF NOT EXISTS idx_subscribe_attempts_created ON subscribe_attempts (created_at);
