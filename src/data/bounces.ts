/** Dairo webhook receiver — the feedback path that fills the suppression list.
 *
 *  POST /api/email-events. Dairo calls this whenever a message we sent bounces or is marked as
 *  spam; we turn those into rows in `subscribe_suppressions` so the address is never mailed
 *  again. Without this, the suppression list only ever grows by hand.
 *
 *  Signature scheme (docs.dairo.app/webhooks/webhooks): `X-Dairo-Signature: v1=<hex>` is the
 *  HMAC-SHA256 of the raw body, keyed on `hex(sha256(signingSecret))` — the hex digest of the
 *  secret, NOT the secret itself, because Dairo stores only that hash. This is the one place
 *  Dairo departs from the Stripe/Svix convention, and getting it wrong fails silently as a
 *  401 on every delivery.
 */
import type { Context } from "hono";

import type { Env } from "../types";

/** Deliveries older than this are refused — a captured request can't be replayed later. */
const MAX_SKEW_S = 300;

/** Add an address to the never-mail list and retire any subscription it still holds.
 *
 *  Both halves matter: the suppression stops the *send*, and unsubscribing the row stops the
 *  address reappearing in `notifySubscribers`' fan-out and stops a stale pending row keeping
 *  it in limbo. `INSERT OR IGNORE` keeps the first-recorded reason, which is the one that
 *  actually happened — a redelivered webhook must not overwrite `hard_bounce` with something
 *  softer.
 *
 *  Idempotent by construction, which is why this receiver needs no event-ID dedupe table:
 *  replaying an at-least-once delivery converges on the same state. */
async function suppress(
  env: Env,
  entry: { email: string; reason: "hard_bounce" | "complaint"; detail: string },
): Promise<void> {
  const email = entry.email.trim().toLowerCase();
  if (!email) return;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO subscribe_suppressions (email, reason, detail, created_at) VALUES (?, ?, ?, ?)",
    ).bind(email, entry.reason, entry.detail.slice(0, 500), now),
    env.DB.prepare(
      "UPDATE subscribers SET unsubscribed_at = ?, updated_at = ? WHERE email = ? AND unsubscribed_at IS NULL",
    ).bind(now, now, email),
  ]);
  console.warn(`suppressed ${email} (${entry.reason})`);
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Length-independent, value-constant-time string compare. Workers has no
 *  `crypto.timingSafeEqual`, so this is the manual equivalent: always walk the full expected
 *  string and accumulate differences with OR rather than returning early. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `v1=<hex hmac>` over the raw body, keyed on the hex sha256 of the signing secret. */
async function expectedSignature(secret: string, rawBody: string): Promise<string> {
  const enc = new TextEncoder();
  const signingKey = hex(await crypto.subtle.digest("SHA-256", enc.encode(secret)));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `v1=${hex(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)))}`;
}

type DairoEvent = {
  id?: string;
  type?: string;
  data?: {
    recipient?: string;
    to?: string[];
    bounceType?: string; // Permanent | Transient | Undetermined
    bounceSubType?: string;
    diagnosticCode?: string;
    complaintFeedbackType?: string;
  };
};

export async function handleEmailEvents(c: Context<{ Bindings: Env }>): Promise<Response> {
  const secret = c.env.DAIRO_WEBHOOK_SECRET;
  if (!secret) {
    // Unconfigured is a 503, not a 200: a silent accept would let Dairo believe the feedback
    // loop is healthy while every bounce is dropped on the floor.
    console.error("email-events: DAIRO_WEBHOOK_SECRET not set — refusing delivery");
    return c.text("webhook not configured", 503);
  }

  // Read the raw bytes exactly as sent. Parsing and re-serialising changes them and breaks
  // verification, so the JSON parse happens only after the signature is checked.
  const raw = await c.req.text();

  const signature = c.req.header("x-dairo-signature") ?? "";
  if (!safeEqual(signature, await expectedSignature(secret, raw))) {
    console.warn("email-events: invalid signature");
    return c.text("invalid signature", 401);
  }

  const ts = Number(c.req.header("x-dairo-timestamp"));
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_S) {
    console.warn("email-events: stale timestamp");
    return c.text("stale timestamp", 401);
  }

  let event: DairoEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return c.text("bad json", 400);
  }

  const data = event.data ?? {};
  const recipient = data.recipient ?? data.to?.[0] ?? "";

  // No dedupe table: `suppress()` is idempotent, so an at-least-once redelivery of the same
  // event converges on the same state. Dedupe would only save a write.
  if (event.type === "message.bounced" && recipient) {
    // Only a *permanent* failure is terminal. A Transient bounce means the remote server
    // refused this attempt, not that the mailbox is dead — suppressing on it would silently
    // blacklist addresses over a transient MTA problem. (Note that Transient bounces here do
    // still carry 5.x.x SMTP codes, so keying on "5." rather than on bounceType would sweep
    // them in by mistake. Whether Transient should be terminal is LUK-32 criterion 4, which
    // is deliberately not settled here.)
    if (data.bounceType === "Permanent") {
      await suppress(c.env, {
        email: recipient,
        reason: "hard_bounce",
        detail: `Permanent ${data.bounceSubType ?? "General"}: ${data.diagnosticCode ?? ""}`,
      });
    } else {
      console.warn(`email-events: ${data.bounceType} bounce for ${recipient} — not suppressing`);
    }
  } else if (event.type === "message.complained" && recipient) {
    await suppress(c.env, {
      email: recipient,
      reason: "complaint",
      detail: data.complaintFeedbackType ?? "Complaint feedback loop",
    });
  }

  return c.text("ok");
}
