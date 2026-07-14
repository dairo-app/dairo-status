/** Subscriber email — verification + incident notifications. Dairo runs email infrastructure
 *  for AI agents, so the status page sends its own mail through the Dairo API (one dogfooded
 *  transport, swappable in one place). Email failures are logged, never thrown: a broken
 *  mailer must never break a page render or a checker ingest. */
import type { Env } from "../types";

const FROM = "Dairo Status <status@dairo.app>";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The single transport. Everything routes through here. */
async function sendEmail(env: Env, msg: { to: string; subject: string; html: string }): Promise<void> {
  if (!env.DAIRO_API_KEY) {
    console.error("email skipped — DAIRO_API_KEY is not set");
    return;
  }
  try {
    const res = await fetch("https://api.dairo.app/v1/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.DAIRO_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [msg.to], subject: msg.subject, html: msg.html }),
    });
    if (!res.ok) {
      console.error(`email send failed (${res.status}): ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    console.error("email send threw", err instanceof Error ? err.message : String(err));
  }
}

type HtmlOpts = {
  heading: string;
  badge: string;
  badgeColor: string;
  body: string;
  publicUrl: string;
  ctaUrl?: string;
  ctaLabel?: string;
  token?: string;
};

/** The branded email body — a centered white card, a coloured status badge, a CTA button, and
 *  (for notifications) a manage/unsubscribe footer keyed by the subscriber's token. */
export function emailHtml(opts: HtmlOpts): string {
  const cta = opts.ctaUrl ?? opts.publicUrl;
  const ctaLabel = opts.ctaLabel ?? "View status page";
  const footer = opts.token
    ? `<tr><td style="padding:20px 32px;border-top:1px solid #eee;color:#888;font-size:12px;font-family:-apple-system,Helvetica,Arial,sans-serif">
        You're subscribed to Dairo status updates.
        <a href="${esc(opts.publicUrl)}/manage/${esc(opts.token)}" style="color:#888">Manage</a> ·
        <a href="${esc(opts.publicUrl)}/unsubscribe/${esc(opts.token)}" style="color:#888">Unsubscribe</a>
      </td></tr>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f4f4;padding:32px 0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#fff;border:1px solid #e5e5e5">
      <tr><td style="padding:32px 32px 0">
        <div style="text-transform:uppercase;letter-spacing:.18em;color:#555;font-size:12px;font-weight:700">Dairo Status</div>
        <div style="margin:16px 0 4px"><span style="display:inline-block;text-transform:uppercase;font-size:11px;font-weight:700;letter-spacing:.06em;color:#fff;background:${esc(opts.badgeColor)};padding:3px 8px">${esc(opts.badge)}</span></div>
        <h1 style="margin:12px 0 8px;font-size:19px;line-height:1.3">${esc(opts.heading)}</h1>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#333">${esc(opts.body)}</p>
        <a href="${esc(cta)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;font-size:14px">${esc(ctaLabel)}</a>
      </td></tr>
      <tr><td style="height:24px"></td></tr>
      ${footer}
    </table>
  </td></tr></table>
  </body></html>`;
}

/** Double opt-in confirmation. */
export async function sendVerification(env: Env, to: string, token: string): Promise<void> {
  const html = emailHtml({
    heading: "Confirm your subscription",
    badge: "Confirm",
    badgeColor: "#111",
    body: "Click below to start receiving Dairo status updates. If you didn't request this, you can ignore this email.",
    publicUrl: env.PUBLIC_URL,
    ctaUrl: `${env.PUBLIC_URL}/verify/${token}`,
    ctaLabel: "Confirm subscription",
  });
  await sendEmail(env, { to, subject: "Confirm your Dairo status subscription", html });
}

type Notification = {
  subject: string;
  heading: string;
  badge: string;
  badgeColor: string;
  message: string;
  componentIds: number[];
};

/** Fan a status change out to every active subscriber whose scope matches. */
export async function notifySubscribers(env: Env, opts: Notification): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT token, email, component_ids FROM subscribers WHERE accepted_at IS NOT NULL AND unsubscribed_at IS NULL",
  ).all<{ token: string; email: string; component_ids: string }>();

  for (const sub of rows.results ?? []) {
    let scope: number[] = [];
    try {
      scope = JSON.parse(sub.component_ids || "[]");
    } catch {
      scope = [];
    }
    // Empty scope = whole page; otherwise the change must touch a followed component.
    const matches = scope.length === 0 || opts.componentIds.some((id) => scope.includes(id));
    if (!matches) continue;

    const html = emailHtml({
      heading: opts.heading,
      badge: opts.badge,
      badgeColor: opts.badgeColor,
      body: opts.message,
      publicUrl: env.PUBLIC_URL,
      token: sub.token,
    });
    await sendEmail(env, { to: sub.email, subject: opts.subject, html });
  }
}
