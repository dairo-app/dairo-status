/** Health-checker glue: the monitor list the external checker probes, and the /ingest
 *  endpoint it POSTs results back to. Ingest upserts live status, rolls up daily uptime,
 *  opens/resolves auto-incidents on status transitions, and notifies subscribers. */
import type { Context } from "hono";

import type { Env } from "../types";
import { notifySubscribers } from "../email/notify";

type Ctx = Context<{ Bindings: Env }>;

type IngestResult = {
  monitorId: number;
  status: "active" | "degraded" | "error";
  code: number;
  latencyMs: number;
};

type IngestBody = { checkedAt: string; results: IngestResult[] };

/** Constant-time-ish equality that first rejects on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** GET /api/monitors — the active probe targets for the external health checker. */
export async function handleMonitors(c: Ctx) {
  const rows = await c.env.DB.prepare(
    "SELECT id, url, method FROM monitors WHERE active = 1 AND deleted_at IS NULL",
  ).all<{ id: number; url: string; method: string }>();
  const list = (rows.results ?? []).map((m) => ({
    id: Number(m.id),
    url: String(m.url),
    method: String(m.method),
    timeoutMs: 45000,
  }));
  return c.json(list);
}

/** POST /ingest — apply a batch of checker results (bearer-authenticated). */
export async function handleIngest(c: Ctx) {
  const token = c.env.INGEST_TOKEN;
  const header = c.req.header("Authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(provided, token)) return c.text("unauthorized", 401);

  const body = await c.req.json<IngestBody>();
  const results = body.results ?? [];
  const now = new Date().toISOString();
  const day = new Date(body.checkedAt).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  // Transitions worth telling subscribers about, dispatched after the loop.
  const notifications: { kind: "opened" | "resolved"; monitorId: number; name: string }[] = [];

  for (const r of results) {
    const mid = Number(r.monitorId);
    const status = r.status;

    // a) Upsert the monitor's live status.
    await c.env.DB.prepare(
      "INSERT INTO monitor_status (monitor_id,status,last_checked_at,last_code,last_latency_ms) VALUES (?,?,?,?,?) ON CONFLICT(monitor_id) DO UPDATE SET status=excluded.status,last_checked_at=excluded.last_checked_at,last_code=excluded.last_code,last_latency_ms=excluded.last_latency_ms",
    )
      .bind(mid, status, body.checkedAt, r.code, r.latencyMs)
      .run();

    // b) Roll the check into today's uptime bucket (error counts against ok).
    const ok = status === "error" ? 0 : 1;
    await c.env.DB.prepare(
      "INSERT INTO uptime_daily (monitor_id,day,ok,total) VALUES (?,?,?,1) ON CONFLICT(monitor_id,day) DO UPDATE SET ok=ok+excluded.ok, total=total+excluded.total",
    )
      .bind(mid, day, ok)
      .run();

    // c) Reconcile the auto-incident against the new status.
    const open = await c.env.DB.prepare(
      "SELECT id FROM incidents WHERE monitor_id=? AND resolved_at IS NULL",
    )
      .bind(mid)
      .first<{ id: number }>();

    if (status === "error" && !open) {
      const name = await monitorName(c, mid);
      await c.env.DB.prepare(
        "INSERT INTO incidents (monitor_id,title,summary,status,started_at,auto,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
        .bind(
          mid,
          `${name} is unreachable`,
          "Automatically opened by the status checker.",
          "investigating",
          now,
          1,
          now,
          now,
        )
        .run();
      notifications.push({ kind: "opened", monitorId: mid, name });
    } else if (status !== "error" && open) {
      await c.env.DB.prepare(
        "UPDATE incidents SET resolved_at=?, status='resolved', updated_at=? WHERE id=?",
      )
        .bind(now, now, open.id)
        .run();
      notifications.push({ kind: "resolved", monitorId: mid, name: await monitorName(c, mid) });
    }
  }

  // Fire-and-forget: fan out subscriber emails without blocking the checker's response.
  if (notifications.length > 0) {
    c.executionCtx.waitUntil(
      (async () => {
        for (const n of notifications) {
          const comps = await c.env.DB.prepare("SELECT id FROM components WHERE monitor_id=?")
            .bind(n.monitorId)
            .all<{ id: number }>();
          const componentIds = (comps.results ?? []).map((x) => Number(x.id));
          const notification =
            n.kind === "opened"
              ? {
                  subject: "Dairo Status — investigating an issue",
                  heading: "We're investigating an issue",
                  badge: "Investigating",
                  badgeColor: "#b91c1c",
                  message: `${n.name} stopped responding; we're looking into it.`,
                  componentIds,
                }
              : {
                  subject: "Dairo Status — resolved",
                  heading: "Resolved",
                  badge: "Resolved",
                  badgeColor: "#15803d",
                  message: `${n.name} is responding normally again.`,
                  componentIds,
                };
          await notifySubscribers(c.env, notification);
        }
      })(),
    );
  }

  return c.json({ ok: true, applied: results.length });
}

/** The board-facing label for a monitor, falling back to its internal name. */
async function monitorName(c: Ctx, monitorId: number): Promise<string> {
  const mon = await c.env.DB.prepare("SELECT external_name,name FROM monitors WHERE id=?")
    .bind(monitorId)
    .first<{ external_name: string; name: string }>();
  return String(mon?.external_name ?? mon?.name ?? `Monitor ${monitorId}`);
}
