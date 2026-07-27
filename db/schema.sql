-- Dairo Status — D1 (SQLite) schema.
-- One public status page; monitors are probed by the external health checker, which POSTs
-- results to /ingest. The page is rendered read-only from these tables.

CREATE TABLE IF NOT EXISTS pages (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  icon         TEXT NOT NULL DEFAULT '',
  homepage_url TEXT,
  contact_url  TEXT,
  allow_index  INTEGER NOT NULL DEFAULT 1,
  show_uptime  INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS component_groups (
  id         INTEGER PRIMARY KEY,
  page_id    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- A monitor is a probe target. `external_name` is the label shown on the board.
CREATE TABLE IF NOT EXISTS monitors (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  external_name TEXT NOT NULL,
  url           TEXT NOT NULL,
  method        TEXT NOT NULL DEFAULT 'GET',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

-- A board row. Not every monitor has a component (a monitor without one is probed but hidden).
CREATE TABLE IF NOT EXISTS components (
  id          INTEGER PRIMARY KEY,
  page_id     INTEGER NOT NULL,
  monitor_id  INTEGER,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  group_id    INTEGER
);

-- Current live state of a monitor (upserted by the checker every run).
CREATE TABLE IF NOT EXISTS monitor_status (
  monitor_id      INTEGER PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'active',  -- active | degraded | error
  last_checked_at TEXT,
  last_code       INTEGER,
  last_latency_ms INTEGER
);

-- Daily uptime rollup — the source for the uptime bars. total counts every check; ok counts up.
CREATE TABLE IF NOT EXISTS uptime_daily (
  monitor_id INTEGER NOT NULL,
  day        TEXT NOT NULL,   -- YYYY-MM-DD (UTC)
  ok         INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, day)
);

-- Auto-incidents opened/resolved by the checker. Open = resolved_at IS NULL.
CREATE TABLE IF NOT EXISTS incidents (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'investigating',
  started_at  TEXT NOT NULL,
  resolved_at TEXT,
  auto        INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents (monitor_id, resolved_at);

-- Operator-authored status reports (+ a timeline of updates, + affected components/impact).
CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY,
  page_id    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'investigating',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_updates (
  id         INTEGER PRIMARY KEY,
  report_id  INTEGER NOT NULL,
  status     TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  date       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_update_components (
  report_update_id INTEGER NOT NULL,
  component_id     INTEGER NOT NULL,
  impact           TEXT NOT NULL DEFAULT 'operational',
  PRIMARY KEY (report_update_id, component_id)
);

-- Scheduled maintenance windows (+ affected components).
CREATE TABLE IF NOT EXISTS maintenances (
  id         INTEGER PRIMARY KEY,
  page_id    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  start_at   TEXT NOT NULL,
  end_at     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS maintenance_components (
  maintenance_id INTEGER NOT NULL,
  component_id   INTEGER NOT NULL,
  PRIMARY KEY (maintenance_id, component_id)
);

-- Email subscribers (double opt-in). token is the capability key in every action URL.
-- component_ids is a JSON array; [] means whole-page. Active = accepted_at set, unsubscribed_at null.
CREATE TABLE IF NOT EXISTS subscribers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token           TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL,
  component_ids   TEXT NOT NULL DEFAULT '[]',
  accepted_at     TEXT,
  unsubscribed_at TEXT,
  expires_at      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers (email);

-- Fixed-window rate-limit counters for POST /api/subscribe (security/guard.ts).
-- One row per key ("ip:<addr>" or "global"); the window resets in place.
CREATE TABLE IF NOT EXISTS subscribe_rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL
);

-- Audit trail for POST /api/subscribe: one row per submission, whatever the outcome. This is
-- forensics, not enforcement — the limits themselves live in subscribe_rate_limits above.
-- See src/data/gate.ts and migration/0001_subscribe_gate.sql.
CREATE TABLE IF NOT EXISTS subscribe_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL DEFAULT 'unknown',  -- CF-Connecting-IP, or 'unknown'
  email      TEXT NOT NULL DEFAULT '',
  outcome    TEXT NOT NULL,                    -- sent | honeypot | captcha_failed | rate_limited
                                               -- | global_limited | invalid_email
                                               -- | already_subscribed | already_pending | suppressed
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscribe_attempts_ip ON subscribe_attempts (ip, created_at);
CREATE INDEX IF NOT EXISTS idx_subscribe_attempts_created ON subscribe_attempts (created_at);

-- Addresses this page must never mail again. Dairo creates suppressions from complaints only,
-- NOT from bounces, and a bounced *pending* subscriber row was never marked — it expired after
-- 7 days and the address became eligible for another confirmation send. Written by
-- src/data/bounces.ts (the Dairo webhook receiver), read by src/email/notify.ts before every
-- send. See migration/0002_subscribe_suppressions.sql.
CREATE TABLE IF NOT EXISTS subscribe_suppressions (
  email      TEXT PRIMARY KEY,   -- lowercased; compared exactly against the send recipient
  reason     TEXT NOT NULL,      -- hard_bounce | complaint | abuse
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscribe_suppressions_reason
  ON subscribe_suppressions (reason, created_at);
