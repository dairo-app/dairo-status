#!/usr/bin/env bash
# LUK-42 — proof that the POST /api/subscribe bot gate actually refuses traffic.
#
#   ./verify-gate.sh                 # runs everything, exits non-zero on any failure
#   PORT=8899 ./verify-gate.sh       # if 8811 is busy
#
# No credentials are needed and no real mail can be sent: each scenario runs `wrangler dev`
# with a throwaway local D1 and no DAIRO_API_KEY, so src/email/notify.ts stops at its
# "not configured" branch and logs the recipient instead of calling the Dairo API.
#
# ── What this suite does NOT cover ────────────────────────────────────────────────────────
# Turnstile. `verifyTurnstile` returns true when TURNSTILE_SECRET_KEY is unset, which is the
# case under `wrangler dev`, so every request here sails past the layer that is in production
# the load-bearing one. That is deliberate — a local suite cannot solve a real challenge — but
# it means a green run here proves the honeypot, the per-IP cap, the global send cap, the
# suppression list and the webhook signature check, and says nothing about the captcha. The
# captcha is proved separately, against production, in the LUK-42 probe log.
#
# ── Why this is structured as isolated scenarios ──────────────────────────────────────────
# An earlier version of this script ran every case against one long-lived `wrangler dev`,
# resetting tables between them with `wrangler d1 execute --local`. That is not sound. The
# running dev server owns the local SQLite file, so CLI writes race it: `DELETE FROM
# subscribers` silently did nothing (rows from earlier cases survived into later ones) while
# the errors went to /dev/null. Cases then passed or failed for reasons unrelated to the code
# under test — one case reported `already_pending` for an address being submitted for the
# first time, which is impossible on a clean database.
#
# So: one scenario = one fresh persist directory + one fresh dev server. All seeding happens
# BEFORE the server starts, all assertions on the database happen AFTER it stops, and every
# d1 call is retried and fails loudly rather than silently. Ground truth for "a send happened"
# is notify.ts's own per-recipient log line, counted once the server has exited and the log is
# therefore complete — no sleeping and hoping the output flushed in time.

set -uo pipefail
cd "$(dirname "$0")"

PORT=${PORT:-8811}
BASEDIR=${BASEDIR:-$(mktemp -d)}
PERSIST=""
LOG=""
DEV_PGID=""

pass=0; fail=0
check() { # $1=label $2=expected $3=actual
  if [ "$2" = "$3" ]; then echo "  PASS  $1: $3"; pass=$((pass+1));
  else echo "  FAIL  $1: expected $2, got $3"; fail=$((fail+1)); fi
}

# Every d1 call retries: contention with anything else touching this file surfaces as an
# error, and a silently-dropped statement is exactly the failure this script exists to avoid.
d1() {
  local out
  for _ in 1 2 3 4 5 6 7 8; do
    out=$(npx wrangler d1 execute dairo-status --local --persist-to "$PERSIST" \
            --command "$1" --json 2>&1)
    if printf '%s' "$out" | grep -q '"success": true'; then printf '%s' "$out"; return 0; fi
    sleep 1
  done
  echo "d1 FAILED after retries: $1" >&2
  printf '%s' "$out" >&2
  return 1
}

# Scalar out of a --json result, e.g. `num "SELECT COUNT(*) AS n FROM x" n`
num() { d1 "$1" | grep -o "\"$2\": *[0-9]*" | head -1 | grep -o '[0-9]*$'; }
str() { d1 "$1" | grep -o "\"$2\": *\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

# Verification sends that reached the transport with nothing left to stop them, for recipients
# matching $1. Suppressed sends never reach it and log a different line, so they are not counted.
sent_to() { grep -a 'email skipped — DAIRO_API_KEY' "$LOG" | grep -ac "(to=$1"; }

boot() { # $1=scenario slug  $2=optional extra seed SQL (runs before the server starts)
  PERSIST="$BASEDIR/$1"; LOG="$BASEDIR/$1.log"; mkdir -p "$PERSIST"
  npx wrangler d1 execute dairo-status --local --persist-to "$PERSIST" \
    --file=./db/schema.sql >/dev/null 2>&1
  d1 "INSERT OR IGNORE INTO pages (id,slug,title,description,updated_at)
      VALUES (1,'status','Dairo Status','verify-gate fixture',datetime('now'))" >/dev/null || exit 1
  [ -n "${2:-}" ] && { d1 "$2" >/dev/null || exit 1; }

  # Refuse to start on an occupied port. Readiness used to be "something on $PORT returns
  # 200", which silently passes when a LEFTOVER server holds the port: this scenario's own
  # wrangler then fails to bind, every request is served by the other server against its own
  # database, and the assertions read this scenario's empty one. That shows up as a handful of
  # impossible failures (a send that left no log line, a first-ever address reported as
  # already-known) while the code under test is fine. Fail loudly instead.
  if [ -n "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null | grep -v '^000$')" ]; then
    echo "  !! port $PORT is already serving; refusing to test against a server we did not start." >&2
    echo "  !! stop it, or re-run with PORT=<free port>." >&2
    return 1
  fi

  setsid npx wrangler dev --port "$PORT" --local --persist-to "$PERSIST" >"$LOG" 2>&1 &
  DEV_PGID=$!
  # Wait on THIS server's own startup banner, not on the port. Only our log can tell us that
  # the server answering is the one we launched.
  for _ in $(seq 1 90); do
    grep -aq "Ready on" "$LOG" && return 0
    if grep -aq "Address already in use" "$LOG"; then
      echo "  !! wrangler could not bind $PORT:" >&2; tail -5 "$LOG" >&2; return 1
    fi
    sleep 1
  done
  echo "  !! dev server never became ready; last log lines:" >&2; tail -15 "$LOG" >&2
  return 1
}

halt() {
  # Let the server flush before we kill it. `wrangler dev` streams the Worker's console output
  # asynchronously, so tearing it down immediately after the last request truncates the very
  # lines the assertions count — that showed up as a send that happened in the database but
  # left no log line. Wait until the log stops growing, then stop.
  if [ -n "$LOG" ] && [ -f "$LOG" ]; then
    local a b
    a=$(wc -c <"$LOG" 2>/dev/null || echo 0)
    for _ in $(seq 1 15); do
      sleep 1
      b=$(wc -c <"$LOG" 2>/dev/null || echo 0)
      [ "$a" = "$b" ] && break
      a=$b
    done
  fi

  # `$!` is setsid's pid, and setsid forks — so the new process group id is its CHILD's pid,
  # not `$!`, and `kill -- -$!` silently kills nothing. A leaked server then holds the port and
  # the next boot() tests against it. Kill whatever is actually listening on the port; the
  # PGID attempt stays as a cheap first try.
  [ -n "$DEV_PGID" ] && kill -- "-$DEV_PGID" 2>/dev/null
  for _ in $(seq 1 20); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://127.0.0.1:$PORT/" 2>/dev/null)" = "000" ] && break
    # fuser is in psmisc and present on this box; the lsof arm is a fallback.
    fuser -k -TERM "$PORT/tcp" >/dev/null 2>&1 \
      || lsof -ti ":$PORT" 2>/dev/null | xargs -r kill 2>/dev/null
    sleep 1
  done
  sleep 1; DEV_PGID=""
}
trap 'halt' EXIT

# POST a subscription. $1=email $2=client IP $3=honeypot value (optional)
post() {
  curl -s -o "$BASEDIR/body.html" -w '%{http_code}' --max-time 10 -X POST \
    "http://127.0.0.1:$PORT/api/subscribe" \
    -H "CF-Connecting-IP: $2" \
    --data-urlencode "email=$1" \
    --data-urlencode "subscribe_note=${3:-}"
}

# ── Safety interlock ─────────────────────────────────────────────────────────────────────
# This suite submits 60+ subscriptions. That is only safe because the Worker cannot actually
# reach the Dairo API: with no DAIRO_API_KEY, notify.ts stops at its "not configured" branch.
# If a key is present in .dev.vars the run becomes a live mailer pointed at example.com — and
# a `dairo_test_` key is NOT a sandbox, it delivers real mail exactly like a live one, so it
# would manufacture real bounces on the very domain this change exists to protect. (Observed
# for real: a key appeared in .dev.vars mid-development and the only thing that stopped the
# sends was the dairo-edge service binding happening to be unavailable locally.)
#
# Refuse rather than rely on that luck. The per-recipient log line this script counts is also
# only emitted on the "not configured" branch, so a key present here silently zeroes every
# send assertion — the failure is both dangerous and confusing.
if [ -f .dev.vars ] && grep -qE '^[[:space:]]*DAIRO_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]]' .dev.vars; then
  echo "REFUSING TO RUN: .dev.vars sets DAIRO_API_KEY." >&2
  echo "  This suite would attempt real sends to example.com addresses." >&2
  echo "  A dairo_test_ key still delivers real mail — it is not a sandbox." >&2
  echo "  Comment that line out (local dev needs no key) and re-run." >&2
  exit 2
fi

echo "scratch: $BASEDIR    port: $PORT"
echo

echo "=============================================================="
echo " A. Honeypot, a normal send, and a bot submission"
echo "=============================================================="
boot basics || exit 1
HP=$(curl -s "http://127.0.0.1:$PORT/" | grep -c 'name="subscribe_note"')
check "\"Get updates\" form carries the honeypot" 1 "$HP"
curl -s "http://127.0.0.1:$PORT/" | grep -o '<div aria-hidden="true"[^>]*>.\{0,180\}' | head -1 | sed 's/^/    /'

code=$(post "real.human@example.com" "203.0.113.1")
check "normal submit HTTP status" 200 "$code"
check "success page rendered" 1 "$(grep -c 'Check your inbox' "$BASEDIR/body.html")"

code=$(post "bot.victim@example.com" "203.0.113.99" "http://spam.example")
check "honeypot submit HTTP status" 200 "$code"
check "honeypot submit renders the SAME success page (no oracle)" 1 \
  "$(grep -c 'Check your inbox' "$BASEDIR/body.html")"

code=$(post "not-an-email" "203.0.113.1")
# Matched without the apostrophe: Hono escapes it, so the rendered HTML says "doesn&#39;t".
check "invalid address rejected" 1 "$(grep -c 'look like an email' "$BASEDIR/body.html")"
halt
check "verification sends to the real address" 1 "$(sent_to 'real.human@example.com')"
check "verification sends to the honeypot address" 0 "$(sent_to 'bot.victim@example.com')"
check "subscriber rows created (only the real one)" 1 "$(num 'SELECT COUNT(*) AS n FROM subscribers' n)"
echo "  honeypot logged as:"
grep -a 'outcome=honeypot' "$LOG" | sed 's/\x1b\[[0-9;]*m//g' | tail -1 | sed 's/^/    /'
echo

echo "=============================================================="
echo " B. 10 distinct addresses from ONE IP  ->  capped at 5 attempts/hour"
echo "=============================================================="
boot perip || exit 1
for i in $(seq 1 10); do post "burst-$i@example.com" "198.51.100.7" >/dev/null; done
# The per-IP limit is deliberately NOT silent, unlike the honeypot and the suppression list:
# it tells the caller "too many attempts". A rate limit leaks nothing an attacker can use (it
# is a fact about their own traffic), and a real human who trips it needs to know to wait
# rather than believing a confirmation mail is coming. The silent branches are the ones where
# honesty would leak something — that a field is a honeypot, or that an address has bounced.
check "over-limit submission is told so, honestly" 1 \
  "$(grep -c 'Too many attempts' "$BASEDIR/body.html")"
halt
check "verification sends of 10 attempts (IP_LIMIT=5)" 5 "$(sent_to 'burst-')"
check "the 5 rejections are recorded as rate_limited" 5 \
  "$(num "SELECT COUNT(*) AS n FROM subscribe_attempts WHERE outcome='rate_limited'" n)"
check "subscriber rows minted (throttled attempts mint none)" 5 \
  "$(num 'SELECT COUNT(*) AS n FROM subscribers' n)"
echo "  outcomes recorded:"
d1 "SELECT outcome, COUNT(*) AS n FROM subscribe_attempts GROUP BY outcome ORDER BY n DESC" \
  | grep -E '"outcome"|"n"' | paste - - | sed 's/^/    /'
echo

echo "=============================================================="
echo " C. 20 DIFFERENT IPs x 3  ->  global send ceiling stops it at 20"
echo "=============================================================="
boot global || exit 1
for ip in $(seq 1 20); do
  for i in $(seq 1 3); do post "flood-$ip-$i@example.com" "192.0.2.$ip" >/dev/null; done
done
halt
check "verification sends of 60 attempts from 20 IPs (GLOBAL_LIMIT=20)" 20 "$(sent_to 'flood-')"
check "excess refused, not queued (no extra subscriber rows)" 20 \
  "$(num 'SELECT COUNT(*) AS n FROM subscribers' n)"
check "the 40 rejections are recorded as global_limited" 40 \
  "$(num "SELECT COUNT(*) AS n FROM subscribe_attempts WHERE outcome='global_limited'" n)"
echo "  global trip logged:"
grep -a 'GLOBAL verification-send cap' "$LOG" | sed 's/\x1b\[[0-9;]*m//g' | tail -1 | sed 's/^/    /'
echo

echo "=============================================================="
echo " D. A hard-bounced address is never mailed again"
echo "=============================================================="
boot suppress "INSERT INTO subscribe_suppressions (email, reason, detail, created_at)
               VALUES ('dead.mailbox@example.com','hard_bounce','Permanent 5.1.1 account does not exist',datetime('now'))" || exit 1
code=$(post "dead.mailbox@example.com" "203.0.113.77")
check "suppressed submit HTTP status" 200 "$code"
check "suppressed submit renders the SAME success page (no bounce oracle)" 1 \
  "$(grep -c 'Check your inbox' "$BASEDIR/body.html")"
post "still.fine@example.com" "203.0.113.77" >/dev/null

# A forged webhook must not be able to add addresses to the never-mail list.
FORGED=$(curl -s -o "$BASEDIR/hook.txt" -w '%{http_code}' --max-time 10 -X POST \
  "http://127.0.0.1:$PORT/api/email-events" -H 'content-type: application/json' \
  --data '{"type":"message.bounced","data":{"recipient":"victim@example.com","bounceType":"Permanent"}}')
halt
check "verification sends to the suppressed address" 0 "$(sent_to 'dead.mailbox@example.com')"
check "an unsuppressed address from the SAME IP still sends" 1 "$(sent_to 'still.fine@example.com')"
check "no pending row minted for it (nothing left to expire and retry)" 0 \
  "$(num "SELECT COUNT(*) AS n FROM subscribers WHERE email='dead.mailbox@example.com'" n)"
check "recorded as suppressed" 1 \
  "$(num "SELECT COUNT(*) AS n FROM subscribe_attempts WHERE outcome='suppressed'" n)"
check "forged webhook delivery refused (not 200)" "refused" \
  "$([ "$FORGED" = 200 ] && echo accepted || echo refused)"
echo "    forged delivery -> HTTP $FORGED $(cat "$BASEDIR/hook.txt")"
check "forged body wrote no suppression" 0 \
  "$(num "SELECT COUNT(*) AS n FROM subscribe_suppressions WHERE email='victim@example.com'" n)"
echo

echo "=============================================================="
echo " E. The legitimate path still works end to end"
echo "=============================================================="
boot legit || exit 1
post "confirms.fine@example.com" "203.0.113.55" >/dev/null
halt
TOKEN=$(str "SELECT token FROM subscribers WHERE email='confirms.fine@example.com'" token)
echo "  token: $TOKEN"
boot legit2 "INSERT INTO subscribers (token,email,expires_at,created_at,updated_at)
             VALUES ('$TOKEN','confirms.fine@example.com',datetime('now','+7 days'),datetime('now'),datetime('now'))" || exit 1
curl -s --max-time 10 "http://127.0.0.1:$PORT/verify/$TOKEN" > "$BASEDIR/verify.html"
check "GET /verify shows a confirm BUTTON, does not accept (link scanners GET)" 0 \
  "$(grep -c 'All set to receive updates' "$BASEDIR/verify.html")"
curl -s --max-time 10 -X POST "http://127.0.0.1:$PORT/verify/$TOKEN" > "$BASEDIR/verify2.html"
check "POST /verify accepts the subscription" 1 \
  "$(grep -c 'All set to receive updates' "$BASEDIR/verify2.html")"
curl -s --max-time 10 -X POST "http://127.0.0.1:$PORT/unsubscribe/$TOKEN" > "$BASEDIR/unsub.html"
check "MiniSubscribe form carries the honeypot too" 1 \
  "$(grep -c 'name="subscribe_note"' "$BASEDIR/unsub.html")"
halt
check "accepted_at was set by the verify link" 1 \
  "$(num 'SELECT COUNT(*) AS n FROM subscribers WHERE accepted_at IS NOT NULL' n)"
echo

echo "=============================================================="
echo " RESULT: $pass passed, $fail failed"
echo "=============================================================="
[ "$fail" -eq 0 ]
