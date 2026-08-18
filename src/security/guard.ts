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

/** Per-IP cap: *attempts* per fixed hourly window. Generous enough for a human who
 *  fumbles the captcha or email a few times; fatal to a drip campaign. Counting attempts
 *  rather than sends is right here — the budget is spent by one caller on themselves. */
const IP_LIMIT = 5;

/** Global cap per hourly window — the circuit breaker that bounds worst-case damage to a
 *  shared sending domain no matter how the traffic is spread.
 *
 *  It counts **verification sends, not attempts** (LUK-42). Counting attempts made the
 *  endpoint trivially self-denying: the counter is consumed before Turnstile is verified, so
 *  20 junk POSTs an hour from anywhere — and production logged 18 caught bot submissions in
 *  four hours, so that volume is not hypothetical — would lock every legitimate visitor out
 *  of subscribing page-wide. A send cap has the property criterion 2 actually asks for: it
 *  bounds mail put on the wire, and failed bot traffic costs nothing.
 *
 *  20/hour against measured volume: Dairo's outbound ledger on 2026-07-27
 *  (`GET /v1/messages?direction=outbound&limit=100`) held 85 "Confirm your Dairo status
 *  subscription" sends across a 70.8-hour window — 1.20/hour mean, busiest single hour 5. So
 *  20 is ~17x the mean and 4x the observed peak, and that 85 already includes the abusive
 *  traffic this exists to stop, so genuine human volume is lower still. Deliberately loose:
 *  a real signup silently dropped is worse than 20 confirmation mails in the worst hour, which
 *  is not enough volume to move a domain's reputation. It is a three-day sample, not a
 *  seasonal one — revisit if the page is ever linked somewhere with real traffic. */
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

/** Per-caller gate, run on every subscribe attempt. Consumes one unit of `ip`'s hourly
 *  budget and reports whether the caller is still inside it. */
export async function checkSubscribeRateLimit(env: Env, ip: string): Promise<boolean> {
  return consume(env, `ip:${ip || "unknown"}`, IP_LIMIT);
}

/** The page-wide backstop, run **immediately before a verification send** and nowhere else.
 *
 *  Split out of `checkSubscribeRateLimit` deliberately: this budget is shared by every
 *  visitor, so anything that lets an unauthenticated caller spend it without producing mail
 *  turns the endpoint into its own denial of service. Consuming it here means only a real
 *  send costs a unit, and the excess is refused rather than queued — nothing retries it.
 *
 *  What an attacker with a botnet of distinct IPs still gets, stated honestly: Turnstile is
 *  the layer that stops them, and it is not unbreakable — token farms exist. If they get
 *  past it, the per-IP cap does nothing (every request is a fresh IP) and this cap is the
 *  only thing left. It holds: they can cause at most 20 confirmation mails an hour, to
 *  addresses of their choosing, indefinitely. That is a real residual — 480 unsolicited
 *  mails a day is not nothing — but it is bounded and well under the volume that moves a
 *  sending domain's reputation, which is the failure this exists to prevent. */
export async function reserveGlobalSend(env: Env): Promise<boolean> {
  return consume(env, "global", GLOBAL_LIMIT);
}
