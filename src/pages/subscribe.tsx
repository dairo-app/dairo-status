/** Email subscription lifecycle: double opt-in subscribe → verify → manage → unsubscribe.
 *  Every action URL carries the subscriber's `token` (its capability key). Full handlers
 *  (POST) return their own <Layout>; the *Page components return inner content only — index.tsx
 *  wraps them in <Layout>. Server-rendered, JS-free, times shown in UTC. */
import type { Context } from "hono";
import type { Child } from "hono/jsx";

import type { Env, Status } from "../types";
import { Layout } from "../ui/layout";
import { loadPage } from "../data/db";
import { sendVerification } from "../email/notify";
import { Icon, ICONS, statusText, statusVar } from "../ui/status";

type Ctx = Context<{ Bindings: Env }>;

// ── Small icon set for the lifecycle panels (lucide, currentColor). ────────────────────
const ICN = {
  mailOpen:
    '<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
  mailCheck:
    '<path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/><path d="m16 19 2 2 4-4"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  bellOff:
    '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
  clock: ICONS.clock,
} as const;

// ── Shared helpers ─────────────────────────────────────────────────────────────────────
/** Soft tint for a status color — the same idiom the board uses. */
function tint(status: Status, pct = 12): string {
  return `color-mix(in oklab, ${statusVar[status]} ${pct}%, transparent)`;
}

function fmtUtc(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

const nowIso = () => new Date().toISOString();

/** A permissive email check — enough to reject typos, not to be an RFC validator. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** a***@domain — never render a subscriber's full address on the manage/unsubscribe views. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  return `${email[0]}***${email.slice(at)}`;
}

type SubRow = {
  id: number;
  token: string;
  email: string;
  componentIds: string;
  acceptedAt: string | null;
  unsubscribedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

async function loadSubscriber(env: Env, token: string): Promise<SubRow | null> {
  const row = await env.DB.prepare("SELECT * FROM subscribers WHERE token = ? LIMIT 1")
    .bind(token)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: Number(row.id),
    token: String(row.token),
    email: String(row.email),
    componentIds: String(row.component_ids ?? "[]"),
    acceptedAt: (row.accepted_at as string) ?? null,
    unsubscribedAt: (row.unsubscribed_at as string) ?? null,
    expiresAt: (row.expires_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** How many components this subscription covers ([] = whole page). */
function scopeLabel(componentIds: string): string {
  try {
    const ids = JSON.parse(componentIds);
    if (Array.isArray(ids) && ids.length > 0) {
      return `${ids.length} selected component${ids.length === 1 ? "" : "s"}`;
    }
  } catch {
    /* fall through to whole-page */
  }
  return "the whole status page";
}

// ── Presentational building blocks ─────────────────────────────────────────────────────
/** The single lifecycle card: a tinted status header with a body/actions slot. */
function Panel({
  tone,
  icon,
  title,
  children,
}: {
  tone: Status;
  icon: string;
  title: string;
  children?: Child;
}) {
  return (
    <div class="flex flex-1 flex-col justify-center py-6">
      <div
        class="flex flex-col gap-4 border px-4 py-5 sm:px-5"
        style={`background-color:${tint(tone)};border-color:${statusVar[tone]}`}
      >
        <div class="flex items-start gap-3">
          <span class={`mt-0.5 shrink-0 ${statusText[tone]}`}>
            <Icon path={icon} size={24} />
          </span>
          <h1 class="text-lg font-semibold leading-tight">{title}</h1>
        </div>
        {children ? <div class="flex flex-col gap-3 pl-9">{children}</div> : null}
      </div>
    </div>
  );
}

function Lead({ children }: { children: Child }) {
  return <p class="text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

/** Quiet link back to the board. */
function BackLink() {
  return (
    <a href="/" class="font-mono text-xs text-muted-foreground hover:text-foreground">
      ← Back to status page
    </a>
  );
}

/** A compact re-subscribe form (offered when a link is stale/cancelled). */
function MiniSubscribe() {
  return (
    <form method="post" action="/api/subscribe" class="flex flex-col gap-2 sm:flex-row">
      <input
        type="email"
        name="email"
        required
        placeholder="you@example.com"
        class="w-full border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring sm:flex-1"
      />
      <button
        type="submit"
        class="bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
      >
        Subscribe
      </button>
    </form>
  );
}

// ── 1. Subscribe (POST /api/subscribe) ─────────────────────────────────────────────────
export async function handleSubscribe(c: Ctx): Promise<Response> {
  const page = await loadPage(c.env);
  if (!page) return c.notFound();

  const wrap = (body: Child) =>
    c.html(
      <Layout env={c.env} page={page} title="Subscribe">
        {body}
      </Layout>,
    );

  const form = await c.req.parseBody();
  const email = String(form.email ?? "").trim().toLowerCase();

  if (!isValidEmail(email)) {
    return wrap(
      <Panel tone="error" icon={ICN.xCircle} title="That doesn't look like an email">
        <Lead>Please go back and enter a valid email address to subscribe to updates.</Lead>
        <BackLink />
      </Panel>,
    );
  }

  // Already an active subscriber → nothing to do.
  const active = await c.env.DB.prepare(
    "SELECT id FROM subscribers WHERE email = ? AND accepted_at IS NOT NULL AND unsubscribed_at IS NULL LIMIT 1",
  )
    .bind(email)
    .first();
  if (active) {
    return wrap(
      <Panel tone="success" icon={ICN.checkCircle} title="You're already subscribed.">
        <Lead>
          <span class="font-mono text-foreground">{email}</span> already gets an email whenever
          something changes. Every one of those emails has an unsubscribe link if you want to stop.
        </Lead>
        <BackLink />
      </Panel>,
    );
  }

  // A pending, unexpired confirmation is already out → don't send a second one.
  const pending = await c.env.DB.prepare(
    "SELECT id FROM subscribers WHERE email = ? AND accepted_at IS NULL AND expires_at > ? LIMIT 1",
  )
    .bind(email, nowIso())
    .first();
  if (pending) {
    return wrap(
      <Panel tone="info" icon={ICN.mailCheck} title="We already sent a confirmation link">
        <Lead>
          Check the inbox for <span class="font-mono text-foreground">{email}</span> and click the
          link to confirm. It can take a minute to arrive — remember to look in spam.
        </Lead>
        <BackLink />
      </Panel>,
    );
  }

  // New pending subscription: mint a token, store it, send the double opt-in email.
  const token = crypto.randomUUID();
  const now = nowIso();
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO subscribers (token, email, component_ids, expires_at, created_at, updated_at)
     VALUES (?, ?, '[]', ?, ?, ?)`,
  )
    .bind(token, email, expires, now, now)
    .run();

  await sendVerification(c.env, email, token);

  return wrap(
    <Panel tone="info" icon={ICN.mailOpen} title="Check your inbox to confirm">
      <Lead>
        We sent a confirmation link to <span class="font-mono text-foreground">{email}</span>. Click
        it to finish subscribing — the link expires in 7 days. If it doesn't arrive, check your spam
        folder.
      </Lead>
      <BackLink />
    </Panel>,
  );
}

// ── 2. Verify (GET /verify/:token → inner content) ─────────────────────────────────────
export async function VerifyPage({ env, token }: { env: Env; token: string }) {
  const sub = await loadSubscriber(env, token);

  if (!sub) {
    return (
      <Panel tone="error" icon={ICN.xCircle} title="This link is not valid.">
        <Lead>
          This confirmation link doesn't match any subscription — it may have already been used.
        </Lead>
        <BackLink />
      </Panel>
    );
  }

  // Cancelled subscriptions can't be re-confirmed with an old link.
  if (sub.unsubscribedAt) {
    return (
      <Panel tone="degraded" icon={ICN.bellOff} title="This subscription was cancelled.">
        <Lead>You unsubscribed this address. Subscribe again to start getting updates.</Lead>
        <MiniSubscribe />
      </Panel>
    );
  }

  // Idempotent: confirming an already-confirmed link just shows success.
  if (sub.acceptedAt) {
    return (
      <Panel tone="success" icon={ICN.checkCircle} title="You're already subscribed.">
        <Lead>
          This address is confirmed — you'll get an email when something changes. You can
          <a href={`/manage/${sub.token}`} class="mx-1 underline hover:text-foreground">
            manage your subscription
          </a>
          any time.
        </Lead>
      </Panel>
    );
  }

  // Not yet accepted and the link has lapsed → expired.
  if (sub.expiresAt && Date.parse(sub.expiresAt) < Date.now()) {
    return (
      <Panel tone="degraded" icon={ICN.clock} title="This confirmation link has expired.">
        <Lead>Confirmation links are valid for 7 days. Subscribe again to get a fresh one.</Lead>
        <MiniSubscribe />
      </Panel>
    );
  }

  // Confirm: activate the subscription and clear the expiry.
  const now = nowIso();
  await env.DB.prepare(
    "UPDATE subscribers SET accepted_at = ?, expires_at = NULL, updated_at = ? WHERE token = ?",
  )
    .bind(now, now, sub.token)
    .run();

  return (
    <Panel tone="success" icon={ICN.checkCircle} title="You're subscribed.">
      <Lead>
        You'll get an email when something changes. You can
        <a href={`/manage/${sub.token}`} class="mx-1 underline hover:text-foreground">
          manage your subscription
        </a>
        or unsubscribe any time.
      </Lead>
    </Panel>
  );
}

// ── 3. Manage (GET /manage/:token → inner content; POST /manage/:token) ────────────────
export async function ManagePage({ env, token }: { env: Env; token: string }) {
  const sub = await loadSubscriber(env, token);

  if (!sub) {
    return (
      <Panel tone="error" icon={ICN.xCircle} title="This link is not valid.">
        <Lead>This management link doesn't match any subscription.</Lead>
        <BackLink />
      </Panel>
    );
  }

  const masked = maskEmail(sub.email);

  if (sub.unsubscribedAt) {
    return (
      <Panel tone="degraded" icon={ICN.bellOff} title="This subscription is inactive.">
        <Lead>
          <span class="font-mono text-foreground">{masked}</span> was unsubscribed on{" "}
          {fmtUtc(sub.unsubscribedAt)} (UTC). Subscribe again to start getting updates.
        </Lead>
        <MiniSubscribe />
      </Panel>
    );
  }

  const confirmed = sub.acceptedAt != null;
  const tone: Status = confirmed ? "success" : "info";
  const icon = confirmed ? ICN.checkCircle : ICN.mailCheck;
  const title = confirmed ? "Manage your subscription" : "Confirm your subscription";

  return (
    <Panel tone={tone} icon={icon} title={title}>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-sm">
        <dt class="text-muted-foreground">Email</dt>
        <dd class="text-foreground">{masked}</dd>
        <dt class="text-muted-foreground">Scope</dt>
        <dd class="text-foreground">{scopeLabel(sub.componentIds)}</dd>
        <dt class="text-muted-foreground">Status</dt>
        <dd class={statusText[tone]}>{confirmed ? "Active" : "Awaiting confirmation"}</dd>
        {confirmed ? (
          <>
            <dt class="text-muted-foreground">Since</dt>
            <dd class="text-foreground">{fmtUtc(sub.acceptedAt!)} (UTC)</dd>
          </>
        ) : null}
      </dl>
      {confirmed ? (
        <Lead>You get an email whenever something changes.</Lead>
      ) : (
        <Lead>Check your inbox for the confirmation link to activate these updates.</Lead>
      )}
      <div class="flex items-center gap-3 pt-1">
        <a
          href={`/unsubscribe/${sub.token}`}
          class="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-sm hover:bg-secondary"
        >
          <Icon path={ICN.bellOff} size={14} /> Unsubscribe
        </a>
        <BackLink />
      </div>
    </Panel>
  );
}

/** View-only manage endpoint: any POST simply returns to the manage view. */
export async function handleManage(c: Ctx): Promise<Response> {
  return c.redirect(`/manage/${c.req.param("token")}`, 303);
}

// ── 4. Unsubscribe (GET /unsubscribe/:token → inner content; POST /unsubscribe/:token) ──
export async function UnsubscribePage({
  env,
  token,
}: {
  env: Env;
  token: string;
}) {
  const sub = await loadSubscriber(env, token);

  if (!sub) {
    return (
      <Panel tone="error" icon={ICN.xCircle} title="This link is not valid.">
        <Lead>This unsubscribe link doesn't match any subscription.</Lead>
        <BackLink />
      </Panel>
    );
  }

  if (sub.unsubscribedAt) {
    return (
      <Panel tone="info" icon={ICN.bellOff} title="You're already unsubscribed.">
        <Lead>
          <span class="font-mono text-foreground">{maskEmail(sub.email)}</span> won't get any more
          emails from this status page.
        </Lead>
        <BackLink />
      </Panel>
    );
  }

  return (
    <Panel tone="degraded" icon={ICN.bellOff} title="Unsubscribe from updates?">
      <Lead>
        Stop sending status emails to{" "}
        <span class="font-mono text-foreground">{maskEmail(sub.email)}</span>? You can subscribe
        again at any time.
      </Lead>
      <div class="flex items-center gap-3 pt-1">
        <form method="post" action={`/unsubscribe/${sub.token}`}>
          <button
            type="submit"
            class="bg-destructive px-3 py-1.5 font-mono text-sm text-white hover:opacity-90"
          >
            Yes, unsubscribe
          </button>
        </form>
        <a
          href={`/manage/${sub.token}`}
          class="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          Keep my subscription
        </a>
      </div>
    </Panel>
  );
}

export async function handleUnsubscribe(c: Ctx): Promise<Response> {
  const page = await loadPage(c.env);
  if (!page) return c.notFound();

  const wrap = (body: Child) =>
    c.html(
      <Layout env={c.env} page={page} title="Unsubscribe">
        {body}
      </Layout>,
    );

  const token = c.req.param("token") ?? "";
  const sub = await loadSubscriber(c.env, token);
  if (!sub) {
    return wrap(
      <Panel tone="error" icon={ICN.xCircle} title="This link is not valid.">
        <Lead>This unsubscribe link doesn't match any subscription.</Lead>
        <BackLink />
      </Panel>,
    );
  }

  const now = nowIso();
  await c.env.DB.prepare(
    "UPDATE subscribers SET unsubscribed_at = ?, expires_at = NULL, updated_at = ? WHERE token = ?",
  )
    .bind(now, now, token)
    .run();

  return wrap(
    <Panel tone="success" icon={ICN.bellOff} title="You've been unsubscribed.">
      <Lead>
        <span class="font-mono text-foreground">{maskEmail(sub.email)}</span> won't get any more
        emails from this status page. Changed your mind? Subscribe again below.
      </Lead>
      <MiniSubscribe />
    </Panel>,
  );
}
