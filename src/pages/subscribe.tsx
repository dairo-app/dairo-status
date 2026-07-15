/** Email subscription lifecycle: double opt-in subscribe → verify → manage → unsubscribe.
 *  Every action URL carries the subscriber's `token` (its capability key). Full handlers
 *  (POST) return their own <Layout>; the *Page components return inner content only — index.tsx
 *  wraps them in <Layout>. Server-rendered, JS-free, times shown in UTC.
 *
 *  Visuals mirror the board's empty-state / form-card language: a centered `StatusBlank`
 *  panel (bg-muted/30, title + mono description + outline "Go back" button) for result states,
 *  and a `FormCard` for the manage view. */
import type { Context } from "hono";
import type { Child } from "hono/jsx";

import type { Env, Page } from "../types";
import { Layout } from "../ui/layout";
import { loadPage } from "../data/db";
import { sendVerification } from "../email/notify";
import { Icon } from "../ui/status";

type Ctx = Context<{ Bindings: Env }>;

// ── Small icon set (lucide, currentColor). ─────────────────────────────────────────────
const ICN = {
  // lucide: inbox
  inbox:
    '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  // lucide: arrow-left
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  // lucide: check
  check: '<path d="M20 6 9 17l-5-5"/>',
} as const;

// ── Button chrome (mirrors the shared Button: base + variant + size). ──────────────────
const BTN_BASE =
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
const BTN_VARIANT: Record<string, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs",
  destructive:
    "bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 text-white shadow-xs",
  outline:
    "bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 border shadow-xs",
  ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
};
const BTN_SIZE: Record<string, string> = {
  default: "h-9 px-4 py-2 has-[>svg]:px-3",
  sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
};
function btn(variant: keyof typeof BTN_VARIANT, size: keyof typeof BTN_SIZE, extra = ""): string {
  return `${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]}${extra ? ` ${extra}` : ""}`;
}

// FormCard chrome (Card + form-card overrides, resolved).
const FORMCARD =
  "bg-card text-card-foreground flex flex-col border group relative w-full gap-4 overflow-hidden rounded-lg py-0 shadow-none";
const FORMCARD_HEADER =
  "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-4 pt-4";
const FORMCARD_FOOTER =
  "flex items-center gap-2 border-t px-4 pb-4 [.border-t]:pt-4 [&>:last-child]:ml-auto";

// ── Shared helpers ─────────────────────────────────────────────────────────────────────
/** Long date, no time (UTC) — "July 14, 2026", matching the manage footer's unsubscribed-on stamp. */
function fmtLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
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

// ── Component tracker graph (for the "subscribe to specific components" tree) ───────────
type TrackerComp = { id: number; name: string };
type MTracker =
  | { type: "group"; order: number; groupId: number; groupName: string; components: TrackerComp[] }
  | { type: "component"; order: number; component: TrackerComp };

/** The page's top-level components + groups (each with its members), ordered like the board. */
async function loadTrackers(env: Env, pageId: number): Promise<MTracker[]> {
  const [compRows, groupRows] = await Promise.all([
    env.DB.prepare(
      "SELECT id, name, sort_order, group_id FROM components WHERE page_id = ? ORDER BY sort_order ASC, id ASC",
    )
      .bind(pageId)
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT id, name, sort_order FROM component_groups WHERE page_id = ? ORDER BY sort_order ASC",
    )
      .bind(pageId)
      .all<Record<string, unknown>>(),
  ]);

  const byGroup = new Map<number, TrackerComp[]>();
  const items: MTracker[] = [];
  for (const r of compRows.results ?? []) {
    const comp: TrackerComp = { id: Number(r.id), name: String(r.name) };
    const gid = r.group_id == null ? null : Number(r.group_id);
    if (gid == null) items.push({ type: "component", order: Number(r.sort_order), component: comp });
    else {
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid)!.push(comp);
    }
  }
  for (const g of groupRows.results ?? []) {
    const gid = Number(g.id);
    items.push({
      type: "group",
      order: Number(g.sort_order),
      groupId: gid,
      groupName: String(g.name),
      components: byGroup.get(gid) ?? [],
    });
  }
  return items.sort((a, b) => a.order - b.order);
}

/** Parse the stored `component_ids` JSON into a lookup set (empty ⇒ whole-page subscription). */
function selectedComponentIds(componentIds: string): Set<number> {
  try {
    const ids = JSON.parse(componentIds);
    if (Array.isArray(ids)) return new Set(ids.map((x) => Number(x)).filter((n) => Number.isInteger(n)));
  } catch {
    /* whole page */
  }
  return new Set();
}

// ── Presentational building blocks ─────────────────────────────────────────────────────
/** The page shell every lifecycle view sits in: the page title/description header (as on the
 *  board) followed by the status-content slot. */
function Frame({ page, children }: { page: Page | null; children: Child }) {
  return (
    <div class="flex flex-col gap-8">
      <div>
        <h1 class="text-foreground text-lg leading-none font-semibold">{page?.title ?? "Status"}</h1>
        {page?.description ? <p class="text-muted-foreground">{page.description}</p> : null}
      </div>
      <div class="flex flex-col gap-3">{children}</div>
    </div>
  );
}

/** The centered empty-state panel used for every result view. */
function StatusBlank({ children }: { children: Child }) {
  return (
    <div class="bg-muted/30 flex flex-col items-center justify-center gap-2.5 rounded-lg border px-3 py-2 text-center sm:px-8 sm:py-6">
      {children}
    </div>
  );
}

function BlankContent({ children }: { children: Child }) {
  return <div class="space-y-1">{children}</div>;
}

function BlankTitle({ children, class: cls }: { children: Child; class?: string }) {
  return <div class={cls ? `font-medium ${cls}` : "font-medium"}>{children}</div>;
}

function BlankDescription({ children }: { children: Child }) {
  return <div class="text-muted-foreground font-sans text-sm">{children}</div>;
}

/** Outlined Button-as-link CTA (the empty-state "Go back" / "Manage" action). */
function BlankLink({ href, children }: { href: string; children: Child }) {
  return (
    <a href={href} class={btn("outline", "sm", "text-foreground")}>
      {children}
    </a>
  );
}

/** Horizontal rule (Separator, my-2) between the toggle row and the component tree. */
function Separator() {
  return <div data-slot="separator" role="none" class="bg-border my-2 h-px w-full shrink-0" />;
}

/** A real, submittable component checkbox (square via brand radius 0) styled like the shared
 *  Checkbox — the tick reveals via `peer-checked`. `nested` indents members under their group. */
function ComponentCheckbox({ comp, checked, nested }: { comp: TrackerComp; checked: boolean; nested?: boolean }) {
  const id = `pc-${comp.id}`;
  return (
    <div class={`flex items-center gap-2 ${nested ? "pl-6" : "px-4"}`}>
      <span class="relative inline-flex size-4 shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          name="pageComponents"
          value={String(comp.id)}
          checked={checked}
          class="peer border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 checked:border-primary checked:bg-primary absolute inset-0 size-4 shrink-0 appearance-none rounded-none border bg-transparent shadow-xs outline-none transition-shadow focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Icon
          path={ICN.check}
          size={14}
          cls="text-primary-foreground pointer-events-none relative opacity-0 peer-checked:opacity-100"
        />
      </span>
      <label for={id} class="flex items-center gap-2 text-sm leading-none font-medium select-none">
        {comp.name}
      </label>
    </div>
  );
}

/** A group's tri-state header checkbox (all / some / none of its members selected). Reflective
 *  only — members are the submittable inputs — so it's a static square mirroring the shared Checkbox. */
function GroupCheckbox({ state, name }: { state: "checked" | "indeterminate" | "unchecked"; name: string }) {
  return (
    <div class="flex items-center gap-2">
      <span
        data-slot="checkbox"
        data-state={state}
        class="peer border-input data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:bg-input/30 inline-flex size-4 shrink-0 items-center justify-center rounded-none border shadow-xs"
      >
        {state !== "unchecked" ? (
          <span class="flex items-center justify-center text-current">
            <Icon path={ICN.check} size={14} cls="size-3.5" />
          </span>
        ) : null}
      </span>
      <label class="flex items-center gap-2 text-sm leading-none font-medium select-none">{name}</label>
    </div>
  );
}

/** Empty-state shown inside the reveal when the page has no components to scope to. */
function NoComponentsBlank() {
  return (
    <div class="bg-muted/30 flex flex-col items-center justify-center gap-2.5 rounded-lg border px-4 py-2 text-center sm:px-8 sm:py-6">
      <div class="font-medium">No components to subscribe to</div>
      <div class="text-muted-foreground font-sans text-sm">
        This status page has no components to subscribe to.
      </div>
    </div>
  );
}

/** The component tree revealed under "Subscribe to specific components": groups (with a tri-state
 *  header + indented members) and standalone components, or the empty-state block. */
function ComponentTree({ trackers, selected }: { trackers: MTracker[]; selected: Set<number> }) {
  if (trackers.length === 0) return <NoComponentsBlank />;
  return (
    <>
      {trackers.map((tracker) => {
        if (tracker.type === "group") {
          const ids = tracker.components.map((c) => c.id);
          const all = ids.length > 0 && ids.every((id) => selected.has(id));
          const some = ids.some((id) => selected.has(id));
          const state = all ? "checked" : some ? "indeterminate" : "unchecked";
          return (
            <div class="flex flex-col gap-2 px-4">
              <GroupCheckbox state={state} name={tracker.groupName} />
              {tracker.components.map((c) => (
                <ComponentCheckbox comp={c} checked={selected.has(c.id)} nested />
              ))}
            </div>
          );
        }
        return <ComponentCheckbox comp={tracker.component} checked={selected.has(tracker.component.id)} />;
      })}
    </>
  );
}

/** A compact re-subscribe form — styled to match the header's "Get updates" email tab. */
function MiniSubscribe() {
  return (
    <form method="post" action="/api/subscribe" class="flex w-full flex-col gap-2 sm:flex-row">
      <input
        type="email"
        name="email"
        required
        placeholder="subscribe@me.com"
        class="border-input bg-background focus:ring-ring w-full border px-2 py-1.5 text-sm outline-none focus:ring-1 sm:flex-1"
      />
      <button
        type="submit"
        class="bg-primary text-primary-foreground h-8 shrink-0 px-3 text-sm font-medium hover:opacity-90"
      >
        Subscribe
      </button>
    </form>
  );
}

/** The "check your inbox" success panel (mirrors the email-tab success block). */
function CheckInbox({ title, children }: { title: string; children: Child }) {
  return (
    <StatusBlank>
      <Icon path={ICN.inbox} size={16} cls="shrink-0" />
      <BlankContent>
        <BlankTitle>{title}</BlankTitle>
        <BlankDescription>{children}</BlankDescription>
        <BlankLink href="/">Back to status page</BlankLink>
      </BlankContent>
    </StatusBlank>
  );
}

// ── 1. Subscribe (POST /api/subscribe) ─────────────────────────────────────────────────
export async function handleSubscribe(c: Ctx): Promise<Response> {
  const page = await loadPage(c.env);
  if (!page) return c.notFound();

  const wrap = (body: Child) =>
    c.html(
      <Layout env={c.env} page={page} title="Subscribe">
        <Frame page={page}>{body}</Frame>
      </Layout>,
    );

  const form = await c.req.parseBody();
  const email = String(form.email ?? "").trim().toLowerCase();

  if (!isValidEmail(email)) {
    return wrap(
      <StatusBlank>
        <BlankContent>
          <BlankTitle class="text-destructive">That doesn't look like an email</BlankTitle>
          <BlankDescription>
            Please go back and enter a valid email address to subscribe to updates.
          </BlankDescription>
          <BlankLink href="/">Go back</BlankLink>
        </BlankContent>
      </StatusBlank>,
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
      <StatusBlank>
        <BlankContent>
          <BlankTitle class="text-success">You're already subscribed</BlankTitle>
          <BlankDescription>
            {email} already gets an email whenever something changes. Every one of those emails has
            an unsubscribe link if you want to stop.
          </BlankDescription>
          <BlankLink href="/">Go back</BlankLink>
        </BlankContent>
      </StatusBlank>,
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
      <CheckInbox title="Check your inbox!">
        We already sent a confirmation link to {email}. Click it to finish subscribing — it can take
        a minute to arrive, so remember to look in spam.
      </CheckInbox>,
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
    <CheckInbox title="Check your inbox!">
      We sent a confirmation link to {email}. Validate your email to receive updates and you are all
      set — the link expires in 7 days. If it doesn't arrive, check your spam folder.
    </CheckInbox>,
  );
}

// ── 2. Verify (GET /verify/:token → inner content) ─────────────────────────────────────
export async function VerifyPage({ env, token }: { env: Env; token: string }) {
  const page = await loadPage(env);
  const sub = await loadSubscriber(env, token);

  const frame = (body: Child) => <Frame page={page}>{body}</Frame>;

  if (!sub) {
    return frame(
      <StatusBlank>
        <BlankContent>
          <BlankTitle class="text-destructive">This link is not valid</BlankTitle>
          <BlankDescription>
            This confirmation link doesn't match any subscription — it may have already been used.
          </BlankDescription>
          <BlankLink href="/">Go back</BlankLink>
        </BlankContent>
      </StatusBlank>,
    );
  }

  // Cancelled subscriptions can't be re-confirmed with an old link.
  if (sub.unsubscribedAt) {
    return frame(
      <StatusBlank>
        <BlankContent>
          <BlankTitle>This subscription was cancelled</BlankTitle>
          <BlankDescription>
            You unsubscribed this address. Subscribe again to start getting updates.
          </BlankDescription>
          <MiniSubscribe />
        </BlankContent>
      </StatusBlank>,
    );
  }

  // Idempotent: confirming an already-confirmed link just shows success.
  if (sub.acceptedAt) {
    return frame(
      <StatusBlank>
        <BlankContent>
          <BlankTitle class="text-success">You're already subscribed</BlankTitle>
          <BlankDescription>
            This address is confirmed — you'll get an email when something changes.
          </BlankDescription>
          <div class="flex justify-center gap-2">
            <BlankLink href="/">Go back</BlankLink>
            <BlankLink href={`/manage/${sub.token}`}>Manage</BlankLink>
          </div>
        </BlankContent>
      </StatusBlank>,
    );
  }

  // Not yet accepted and the link has lapsed → expired.
  if (sub.expiresAt && Date.parse(sub.expiresAt) < Date.now()) {
    return frame(
      <StatusBlank>
        <BlankContent>
          <BlankTitle>This confirmation link has expired</BlankTitle>
          <BlankDescription>
            Confirmation links are valid for 7 days. Subscribe again to get a fresh one.
          </BlankDescription>
          <MiniSubscribe />
        </BlankContent>
      </StatusBlank>,
    );
  }

  // Confirm: activate the subscription and clear the expiry.
  const now = nowIso();
  await env.DB.prepare(
    "UPDATE subscribers SET accepted_at = ?, expires_at = NULL, updated_at = ? WHERE token = ?",
  )
    .bind(now, now, sub.token)
    .run();

  return frame(
    <StatusBlank>
      <BlankContent>
        <BlankTitle class="text-success">All set to receive updates to {sub.email}!</BlankTitle>
        <div class="flex justify-center gap-2">
          <BlankLink href="/">Go back</BlankLink>
          <BlankLink href={`/manage/${sub.token}`}>Manage</BlankLink>
        </div>
      </BlankContent>
    </StatusBlank>,
  );
}

// ── 3. Manage (GET /manage/:token → inner content; POST /manage/:token) ────────────────
export async function ManagePage({ env, token }: { env: Env; token: string }) {
  const page = await loadPage(env);
  const sub = await loadSubscriber(env, token);

  const frame = (body: Child) => <Frame page={page}>{body}</Frame>;

  if (!sub) {
    return frame(
      <StatusBlank>
        <BlankContent>
          <BlankTitle class="text-destructive">This link is not valid</BlankTitle>
          <BlankDescription>This management link doesn't match any subscription.</BlankDescription>
          <BlankLink href="/">Go back</BlankLink>
        </BlankContent>
      </StatusBlank>,
    );
  }

  // The component tree the "subscribe to specific components" reveal offers, plus the current
  // selection. specific = scoped to a subset (⇒ reveal opens at rest); [] ⇒ whole page.
  const selected = selectedComponentIds(sub.componentIds);
  const trackers = page ? await loadTrackers(env, page.id) : [];
  const specific = selected.size > 0;
  const unsubscribed = Boolean(sub.unsubscribedAt);

  // Destructive "Unsubscribe" control: a link while active, a disabled button once unsubscribed.
  const unsubscribeCls = btn(
    "ghost",
    "sm",
    "text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/20 dark:hover:bg-destructive/10",
  );

  return frame(
    <div class="flex flex-col gap-4">
      <div class="flex w-full flex-row items-center justify-between gap-2 py-0.5">
        <a href="/" class={btn("ghost", "sm", "text-muted-foreground")}>
          <Icon path={ICN.arrowLeft} size={16} /> Back
        </a>
      </div>
      <div class={FORMCARD}>
        <div class={FORMCARD_HEADER}>
          <div class="leading-none font-semibold">{sub.email}</div>
          <div class="text-muted-foreground text-sm">
            Manage your subscription to receive updates on the status page.
          </div>
        </div>
        <div class="px-0">
          <form
            id="manage-subscription-form"
            method="post"
            action={`/manage/${sub.token}`}
            class="flex flex-col gap-2"
          >
            {/* Native <details> gives the toggle-revealed component tree without any JS; the
                square checkbox mirrors the open state via `group-open`. */}
            <details open={specific} class="group/spec flex flex-col gap-2">
              <summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <div class="flex items-center gap-2 px-4">
                  <span
                    data-slot="checkbox"
                    class="peer border-input group-open/spec:border-primary group-open/spec:bg-primary group-open/spec:text-primary-foreground dark:bg-input/30 inline-flex size-4 shrink-0 items-center justify-center rounded-none border shadow-xs"
                  >
                    <span class="hidden items-center justify-center text-current group-open/spec:flex">
                      <Icon path={ICN.check} size={14} cls="size-3.5" />
                    </span>
                  </span>
                  <span class="flex items-center gap-2 text-sm leading-none font-medium select-none">
                    Subscribe to specific components
                  </span>
                </div>
              </summary>
              <Separator />
              <ComponentTree trackers={trackers} selected={selected} />
            </details>
          </form>
        </div>
        <div class={FORMCARD_FOOTER}>
          <div class="text-muted-foreground text-sm">
            {unsubscribed ? (
              <span class="text-destructive">Unsubscribed on {fmtLongDate(sub.unsubscribedAt!)}</span>
            ) : null}
          </div>
          <div class="flex flex-row gap-2">
            {unsubscribed ? (
              <button type="button" disabled class={unsubscribeCls}>
                Unsubscribe
              </button>
            ) : (
              <a href={`/unsubscribe/${sub.token}`} class={unsubscribeCls}>
                Unsubscribe
              </a>
            )}
            <button
              type="submit"
              form="manage-subscription-form"
              disabled={unsubscribed}
              class={btn("outline", "sm")}
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>,
  );
}

/** Persist the subscriber's component scope from the manage form, then return to the view. */
export async function handleManage(c: Ctx): Promise<Response> {
  const token = c.req.param("token") ?? "";
  const sub = await loadSubscriber(c.env, token);
  if (sub && !sub.unsubscribedAt) {
    const form = await c.req.parseBody({ all: true });
    const raw = form.pageComponents;
    const values = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    const ids = [
      ...new Set(values.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)),
    ];
    const now = nowIso();
    await c.env.DB.prepare(
      "UPDATE subscribers SET component_ids = ?, updated_at = ? WHERE token = ?",
    )
      .bind(JSON.stringify(ids), now, token)
      .run();
  }
  return c.redirect(`/manage/${token}`, 303);
}

// ── 4. Unsubscribe (GET /unsubscribe/:token → inner content; POST /unsubscribe/:token) ──
export async function UnsubscribePage({ env, token }: { env: Env; token: string }) {
  const page = await loadPage(env);
  const sub = await loadSubscriber(env, token);

  const frame = (body: Child) => <Frame page={page}>{body}</Frame>;

  if (!sub) {
    return frame(
      <StatusBlank>
        <BlankContent>
          <BlankTitle class="text-destructive">Invalid or expired link</BlankTitle>
          <BlankDescription>
            This unsubscribe link is no longer valid. You may have already unsubscribed.
          </BlankDescription>
          <BlankLink href="/">Go back</BlankLink>
        </BlankContent>
      </StatusBlank>,
    );
  }

  if (sub.unsubscribedAt) {
    return frame(
      <StatusBlank>
        <BlankContent>
          <BlankTitle>You're already unsubscribed</BlankTitle>
          <BlankDescription>
            {maskEmail(sub.email)} won't get any more emails from this status page.
          </BlankDescription>
          <BlankLink href="/">Go back</BlankLink>
        </BlankContent>
      </StatusBlank>,
    );
  }

  return frame(
    <StatusBlank>
      <BlankContent>
        <BlankTitle>Unsubscribe from notifications</BlankTitle>
        <BlankDescription>
          You are about to unsubscribe {maskEmail(sub.email)} from {page?.title ?? "this page"} status
          updates.
        </BlankDescription>
        <div class="flex justify-center gap-2">
          <BlankLink href={`/manage/${sub.token}`}>Cancel</BlankLink>
          <form method="post" action={`/unsubscribe/${sub.token}`}>
            <button type="submit" class={btn("destructive", "sm")}>
              Unsubscribe
            </button>
          </form>
        </div>
      </BlankContent>
    </StatusBlank>,
  );
}

export async function handleUnsubscribe(c: Ctx): Promise<Response> {
  const page = await loadPage(c.env);
  if (!page) return c.notFound();

  const wrap = (body: Child) =>
    c.html(
      <Layout env={c.env} page={page} title="Unsubscribe">
        <Frame page={page}>{body}</Frame>
      </Layout>,
    );

  const token = c.req.param("token") ?? "";
  const sub = await loadSubscriber(c.env, token);
  if (!sub) {
    return wrap(
      <StatusBlank>
        <BlankContent>
          <BlankTitle class="text-destructive">Invalid or expired link</BlankTitle>
          <BlankDescription>
            This unsubscribe link is no longer valid. You may have already unsubscribed.
          </BlankDescription>
          <BlankLink href="/">Go back</BlankLink>
        </BlankContent>
      </StatusBlank>,
    );
  }

  const now = nowIso();
  await c.env.DB.prepare(
    "UPDATE subscribers SET unsubscribed_at = ?, expires_at = NULL, updated_at = ? WHERE token = ?",
  )
    .bind(now, now, token)
    .run();

  return wrap(
    <StatusBlank>
      <BlankContent>
        <BlankTitle class="text-success">Successfully unsubscribed</BlankTitle>
        <BlankDescription>
          {maskEmail(sub.email)} won't get any more email notifications from {page.title}. Changed
          your mind? Subscribe again below.
        </BlankDescription>
        <MiniSubscribe />
      </BlankContent>
    </StatusBlank>,
  );
}
