-- 0002 — subscribe_suppressions: addresses this page must never mail again.
--
-- Additive and idempotent; nothing else in the schema changes. Apply with:
--   wrangler d1 execute dairo-status --local  --file=./migration/0002_subscribe_suppressions.sql
--   wrangler d1 execute dairo-status --remote --file=./migration/0002_subscribe_suppressions.sql
--
-- (db/schema.sql carries the same definition, so a fresh database needs no migration.)
--
-- Why this table has to exist on our side: Dairo creates suppressions from complaints only,
-- NOT from bounces. Nothing upstream stops us re-mailing a mailbox that does not exist, and a
-- bounced *pending* row is never marked — it simply expires after 7 days, after which the same
-- address becomes eligible for a fresh confirmation send. That is an unbounded retry loop
-- against a dead address on a shared sending domain. This table is the terminal state that
-- loop was missing.
--
-- Written by src/data/bounces.ts (the Dairo webhook receiver); read by src/email/notify.ts
-- immediately before every send.

CREATE TABLE IF NOT EXISTS subscribe_suppressions (
  email      TEXT PRIMARY KEY,   -- lowercased; compared exactly against the send recipient
  reason     TEXT NOT NULL,      -- hard_bounce | complaint | abuse
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscribe_suppressions_reason
  ON subscribe_suppressions (reason, created_at);
