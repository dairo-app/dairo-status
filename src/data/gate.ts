/** Honeypot + audit trail for POST /api/subscribe.
 *
 *  The double opt-in confirmation mail is sent *before* any proof of humanity, so anyone who
 *  can POST the form can make status@dairo.app mail an arbitrary address. That is what pushed
 *  the inbox to an 11% bounce rate (LUK-32/LUK-42) — and `dairo.app` is a shared sending
 *  domain, so the reputation damage lands on every Dairo customer.
 *
 *  The gate is deliberately split across two modules, because two runs built two halves of it
 *  and they were collapsed rather than left to duplicate each other (LUK-42):
 *
 *    ../security/guard.ts  Turnstile + the per-IP and global counters — the load-bearing
 *                          caller-keyed controls.
 *    this file             the honeypot constant, the client-IP helper, and the
 *                          `subscribe_attempts` audit trail.
 *
 *  There is exactly ONE rate limiter, in `guard.ts`. This module used to carry a second,
 *  rolling-window one counting rows in the same table it writes; it was removed. Two limiters
 *  over one endpoint means two sets of thresholds to reason about and neither authoritative.
 *
 *  What `subscribe_attempts` is for: forensics, not enforcement. Every decision is written
 *  there and echoed to the console, so a throttle is visible in `wrangler tail` and an abuse
 *  burst can be reconstructed afterwards — which is how we know the honeypot alone caught 18
 *  bot submissions in production in the four hours after it shipped.
 */
import type { Env } from "../types";

/** The honeypot input's name, shared by every subscribe form.
 *
 *  Deliberately NOT one of the WHATWG autocomplete tokens (`company`, `nickname`, `url`, …):
 *  Chrome fills those from a saved address profile even with `autocomplete="off"`, which
 *  would lock real people out of subscribing. A name the browser has no opinion about is
 *  filled by scripts and nothing else.
 *
 *  Kept alongside Turnstile rather than replaced by it: the honeypot needs no JavaScript,
 *  costs no subrequest, and rejects the naive scripted POST before we spend a Turnstile
 *  verification on it. Turnstile is the control that matters; this is the cheap pre-filter. */
export const HONEYPOT_FIELD = "subscribe_note";

/** How long attempt rows are kept. Long enough to investigate an abuse burst after the fact,
 *  short enough that the table stays small. */
const RETAIN_DAYS = 30;

const DAY_MS = 24 * 3600_000;

/** Why a submission did or didn't produce a verification send. Recorded verbatim in D1.
 *  Mirrors `SubscribeOutcome["state"]` in ../pages/subscribe.tsx, plus the two states the
 *  client is deliberately never shown (`honeypot`, `suppressed`). */
export type Outcome =
  | "sent"
  | "honeypot"
  | "captcha_failed"
  | "rate_limited"
  | "global_limited"
  | "invalid_email"
  | "already_subscribed"
  | "already_pending"
  | "suppressed";

/** Best-effort client IP.
 *
 *  In production Cloudflare sets `CF-Connecting-IP` at the edge and overwrites any
 *  client-supplied value, so it cannot be spoofed. `X-Forwarded-For` is only ever consulted
 *  under `wrangler dev`, where the CF header is absent — it is never reached in production,
 *  which is what keeps the spoofable header from weakening the limit.
 *
 *  An unidentifiable client buckets under "unknown", i.e. all of them share one allowance.
 *  That is the conservative direction: it can throttle, never over-permit. */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf?.trim()) return cf.trim();
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}

/** a***@domain — attempt logs are operational, not a second copy of the subscriber list. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email ? `${email[0]}***` : "(empty)";
  return `${email[0]}***${email.slice(at)}`;
}

/** Record one submission's outcome, and prune rows past the retention window in the same
 *  round trip. Never throws: an audit-table failure must not cost a real subscriber their
 *  confirmation mail. */
export async function recordAttempt(
  env: Env,
  attempt: { ip: string; email: string; outcome: Outcome },
): Promise<void> {
  const now = new Date();
  const line = `subscribe: outcome=${attempt.outcome} ip=${attempt.ip} email=${maskEmail(attempt.email)}`;
  if (attempt.outcome === "global_limited") {
    // The page-wide send cap tripping means someone is list-bombing us right now.
    console.error(`${line} — GLOBAL verification-send cap reached; sending suspended this hour`);
  } else if (
    attempt.outcome === "rate_limited" ||
    attempt.outcome === "captcha_failed" ||
    attempt.outcome === "honeypot"
  ) {
    console.warn(line);
  } else {
    console.log(line);
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO subscribe_attempts (ip, email, outcome, created_at) VALUES (?, ?, ?, ?)",
      ).bind(attempt.ip, attempt.email, attempt.outcome, now.toISOString()),
      env.DB.prepare("DELETE FROM subscribe_attempts WHERE created_at < ?").bind(
        new Date(now.getTime() - RETAIN_DAYS * DAY_MS).toISOString(),
      ),
    ]);
  } catch (err) {
    console.error("subscribe: attempt log failed", err instanceof Error ? err.message : String(err));
  }
}
