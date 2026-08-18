-- 0003 — prune the addresses already known to be undeliverable or abusive (LUK-32/LUK-42).
--
-- Apply AFTER 0002. Idempotent (INSERT OR IGNORE / DELETE):
--   wrangler d1 execute dairo-status --local  --file=./migration/0003_prune_known_bounces.sql
--   wrangler d1 execute dairo-status --remote --file=./migration/0003_prune_known_bounces.sql
--
-- ── Provenance ───────────────────────────────────────────────────────────────────────────
-- Every address below is tagged with how strongly it is evidenced, because the two are not
-- equally trustworthy and a suppression is permanent.
--
--   [verified 2026-07-27]  Re-checked against Dairo's live ledger while writing this file:
--                            GET /v1/messages?direction=outbound&limit=100   (status=bounced)
--                            GET /v1/messages/{id}/events                    (bounceType, diag)
--                          The bounceType and SMTP code quoted are copied from that response.
--
--   [LUK-32, unverifiable] Recorded in the parent issue's earlier sample and NOT re-checkable
--                          now: the outbound ledger returns only the most recent 100 messages,
--                          which today reaches back to 2026-07-24T12:57Z. These bounced before
--                          that and have aged out of the window. They are included because a
--                          permanent bounce does not become deliverable again, but nobody
--                          should read them as re-confirmed.
--
-- The abuse is ONGOING, not historical: duysqk@gmail.com and kward97501@charter.net both hard
-- bounced on 2026-07-27, hours before this file was written. 9 of the last 100 outbound
-- messages are bounces.

-- ── Permanent (hard) bounces — the mailbox does not exist or refuses us outright ──────────
INSERT OR IGNORE INTO subscribe_suppressions (email, reason, detail, created_at) VALUES
  ('aidaggal1@gmail.com',                  'hard_bounce', '[verified 2026-07-27] Permanent/General 550-5.1.1 account does not exist',     datetime('now')),
  ('tjones-charles@tulaliptribes-nsn.gov', 'hard_bounce', '[verified 2026-07-27] Permanent/General 550 5.4.1 recipient address rejected', datetime('now')),
  ('duysqk@gmail.com',                     'hard_bounce', '[verified 2026-07-27] Permanent/General 550-5.1.1 account does not exist',     datetime('now')),
  ('kward97501@charter.net',               'hard_bounce', '[verified 2026-07-27] Permanent/General 550 5.1.1 recipient rejected',         datetime('now')),
  ('pbrumbaugh1@yahoo.com',                'hard_bounce', '[LUK-32, unverifiable] Permanent 5.3.0 mailbox not found',                     datetime('now')),
  ('marybuckley797@gmail.com',             'hard_bounce', '[LUK-32, unverifiable] Permanent 5.2.1 account is inactive',                   datetime('now')),
  ('be9345@centurytel.net',                'hard_bounce', '[LUK-32, unverifiable] Permanent 5.1.1 recipient rejected',                    datetime('now'));

-- ── Complaint — marked us as spam. The signal SES weighs heaviest; never mail again. ──────
-- NOTE: no complaint-flagged message exists in the current 100-message window, so unlike the
-- bounces above this one could not be re-confirmed. Kept on LUK-32's word alone.
INSERT OR IGNORE INTO subscribe_suppressions (email, reason, detail, created_at) VALUES
  ('shakti069@yahoo.com', 'complaint', '[LUK-32, unverifiable] complaint recorded on the outbound message', datetime('now'));

-- ── Abuse — random local parts at throwaway domains, all failing the same way ─────────────
-- SES classifies these Transient ("550 5.1.1 Remote MTA does not support STARTTLS"), but four
-- distinct disposable domains with random-string local parts is a list-bombing signature, not
-- four unlucky subscribers. Treating them as retryable is exactly what keeps them in the loop.
-- Note they carry 5.x.x SMTP codes while being Transient — which is why the webhook receiver
-- keys on bounceType and not on the "5." prefix.
INSERT OR IGNORE INTO subscribe_suppressions (email, reason, detail, created_at) VALUES
  ('sc5bys@gongjua.com',     'abuse', '[verified 2026-07-27] Transient 5.1.1 no STARTTLS; random local part', datetime('now')),
  ('py73cv@swagpapa.com',    'abuse', '[verified 2026-07-27] Transient 5.1.1 no STARTTLS; random local part', datetime('now')),
  ('anhamq@embassybase.com', 'abuse', '[verified 2026-07-27] Transient 5.1.1 no STARTTLS; random local part', datetime('now')),
  ('o1htqj@deepmails.org',   'abuse', '[verified 2026-07-27] Transient 5.1.1 no STARTTLS; random local part', datetime('now'));

-- Deliberately NOT suppressed: jacob.lee@bridgeig.com. It bounced [verified 2026-07-27]
-- Transient with "550 Administrative prohibition - envelope blocked" (a Mimecast policy
-- block) — that is a receiving-side policy decision at a real company, not a dead mailbox.
-- Suppressing it would silently blacklist a real would-be subscriber. Revisit only if it
-- bounces repeatedly.

-- Drop any subscriber row (pending or confirmed) for a suppressed address, so the 7-day
-- expire-and-retry loop has nothing left to pick up.
DELETE FROM subscribers WHERE email IN (SELECT email FROM subscribe_suppressions);
