/** Abuse guards for the public subscribe endpoint.
 *
 *  Added after the 2026-07-22 subscription-bombing wave (bots feeding harvested
 *  third-party addresses into the form, ~180 unsolicited confirmation emails,
 *  10% bounce rate + an abuse complaint against our sender reputation):
 *
 *  1. Cloudflare Turnstile — the form must carry a `cf-turnstile-response`
 *     token, verified server-side. Fails CLOSED when the secret is configured;
 *     if the secret is absent (local dev) the check is skipped.
 *  2. D1-backed rate limits — fixed-window counters per client IP plus a
 *     global circuit breaker, so even a Turnstile bypass or token farm cannot
 *     resume burning sender reputation at volume.
 */
import type { Env } from "../types";

/** Per-IP cap: attempts per fixed hourly window. Humans re-try once or twice. */
const IP_LIMIT = 3;
/** Global cap per hourly window — a circuit breaker far above organic volume
 *  (the whole pre-attack history saw ~2 signups per WEEK). */
const GLOBAL_LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000;

export type GuardVerdict = { ok: true } | { ok: false; reason: "rate_limited" | "captcha_failed" };

/** Verify the Turnstile token with Cloudflare. Missing/invalid token ⇒ false.
 *  Skipped (true) only when no secret is configured. */
export async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip || undefined }),
    });
    const outcome = (await response.json()) as { success?: boolean };
    return outcome.success === true;
  } catch {
    // Verification outage: fail closed — one bot wave already cost sender
    // reputation; a briefly-unsubscribable form is the cheaper failure.
    return false;
  }
}

/** Fixed-window counter in D1. Returns true when the caller is still within the
 *  limit (and consumes one attempt). */
async function consume(env: Env, key: string, limit: number): Promise<boolean> {
  const now = Date.now();
  const windowStart = new Date(now - (now % WINDOW_MS)).toISOString();
  // Reset the row when a new window began; otherwise increment.
  await env.DB.prepare(
    `INSERT INTO subscribe_rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
       window_start = excluded.window_start`,
  )
    .bind(key, windowStart)
    .run();
  const row = await env.DB.prepare("SELECT count FROM subscribe_rate_limits WHERE key = ?")
    .bind(key)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

/** Rate-limit gate for one subscribe attempt from `ip`. */
export async function checkSubscribeRateLimit(env: Env, ip: string): Promise<boolean> {
  const [ipOk, globalOk] = await Promise.all([
    consume(env, `ip:${ip || "unknown"}`, IP_LIMIT),
    consume(env, "global", GLOBAL_LIMIT),
  ]);
  return ipOk && globalOk;
}
