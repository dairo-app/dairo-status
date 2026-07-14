// The D1 data-access layer. Every view reads the board through here, so the read-time
// status derivation lives in one place.
import type {
  Component,
  ComponentGroup,
  Env,
  Incident,
  Maintenance,
  Page,
  Report,
  ReportUpdate,
  Status,
  StatusBoard,
  UptimeDay,
} from "../types";

const bool = (v: unknown) => v === 1 || v === true;

/** Map the checker's monitor status string to the visual scale. */
function toStatus(raw: string | null): Status {
  if (raw === "error") return "error";
  if (raw === "degraded") return "degraded";
  if (raw === "active" || raw === "success") return "success";
  return "empty";
}

export async function loadPage(env: Env): Promise<Page | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM pages WHERE slug = ? LIMIT 1",
  )
    .bind(env.PAGE_SLUG)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: String(row.description ?? ""),
    icon: String(row.icon ?? ""),
    homepageUrl: (row.homepage_url as string) ?? null,
    contactUrl: (row.contact_url as string) ?? null,
    allowIndex: bool(row.allow_index),
    showUptime: bool(row.show_uptime),
    updatedAt: String(row.updated_at),
  };
}

/** Daily uptime rows for the given monitors over the last `days` (newest-last), gap-filled. */
export async function getUptime(
  env: Env,
  monitorIds: number[],
  days: number,
): Promise<Record<number, UptimeDay[]>> {
  const out: Record<number, UptimeDay[]> = {};
  if (monitorIds.length === 0) return out;

  const since = new Date(Date.now() - (days - 1) * 86400000);
  const sinceDay = since.toISOString().slice(0, 10);
  const placeholders = monitorIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT monitor_id, day, ok, total FROM uptime_daily
     WHERE monitor_id IN (${placeholders}) AND day >= ?
     ORDER BY day ASC`,
  )
    .bind(...monitorIds, sinceDay)
    .all<Record<string, unknown>>();

  const byMonitor = new Map<number, Map<string, UptimeDay>>();
  for (const r of rows.results ?? []) {
    const mid = Number(r.monitor_id);
    if (!byMonitor.has(mid)) byMonitor.set(mid, new Map());
    byMonitor.get(mid)!.set(String(r.day), {
      monitorId: mid,
      day: String(r.day),
      ok: Number(r.ok),
      total: Number(r.total),
    });
  }

  // Emit a full contiguous window per monitor; missing days are no-data.
  for (const mid of monitorIds) {
    const found = byMonitor.get(mid) ?? new Map<string, UptimeDay>();
    const series: UptimeDay[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      series.push(found.get(day) ?? { monitorId: mid, day, ok: 0, total: 0 });
    }
    out[mid] = series;
  }
  return out;
}

async function openIncidents(env: Env): Promise<Map<number, Incident>> {
  const rows = await env.DB.prepare(
    "SELECT * FROM incidents WHERE resolved_at IS NULL",
  ).all<Record<string, unknown>>();
  const map = new Map<number, Incident>();
  for (const r of rows.results ?? []) {
    map.set(Number(r.monitor_id), {
      id: Number(r.id),
      monitorId: Number(r.monitor_id),
      title: String(r.title),
      summary: String(r.summary ?? ""),
      status: String(r.status),
      startedAt: String(r.started_at),
      resolvedAt: (r.resolved_at as string) ?? null,
    });
  }
  return map;
}

/** Reports touched in the last `days`, with their update timeline + affected components. */
export async function listReports(env: Env, days = 7): Promise<Report[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const reports = await env.DB.prepare(
    "SELECT * FROM reports WHERE page_id = (SELECT id FROM pages WHERE slug=?) AND updated_at >= ? ORDER BY updated_at DESC",
  )
    .bind(env.PAGE_SLUG, since)
    .all<Record<string, unknown>>();
  const result: Report[] = [];
  for (const rp of reports.results ?? []) {
    result.push(await hydrateReport(env, rp));
  }
  return result;
}

export async function loadReport(env: Env, id: number): Promise<Report | null> {
  const rp = await env.DB.prepare("SELECT * FROM reports WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  return rp ? hydrateReport(env, rp) : null;
}

async function hydrateReport(env: Env, rp: Record<string, unknown>): Promise<Report> {
  const updates = await env.DB.prepare(
    "SELECT * FROM report_updates WHERE report_id = ? ORDER BY date DESC",
  )
    .bind(rp.id)
    .all<Record<string, unknown>>();
  const hydrated: ReportUpdate[] = [];
  for (const u of updates.results ?? []) {
    const comps = await env.DB.prepare(
      "SELECT component_id, impact FROM report_update_components WHERE report_update_id = ?",
    )
      .bind(u.id)
      .all<Record<string, unknown>>();
    hydrated.push({
      id: Number(u.id),
      status: String(u.status),
      message: String(u.message ?? ""),
      date: String(u.date),
      components: (comps.results ?? []).map((c) => ({
        componentId: Number(c.component_id),
        impact: String(c.impact),
      })),
    });
  }
  return {
    id: Number(rp.id),
    title: String(rp.title),
    status: String(rp.status),
    createdAt: String(rp.created_at),
    updatedAt: String(rp.updated_at),
    updates: hydrated,
  };
}

export async function listMaintenances(env: Env, days = 7): Promise<Maintenance[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await env.DB.prepare(
    "SELECT * FROM maintenances WHERE page_id = (SELECT id FROM pages WHERE slug=?) AND end_at >= ? ORDER BY start_at DESC",
  )
    .bind(env.PAGE_SLUG, since)
    .all<Record<string, unknown>>();
  const result: Maintenance[] = [];
  for (const m of rows.results ?? []) result.push(await hydrateMaintenance(env, m));
  return result;
}

export async function loadMaintenance(env: Env, id: number): Promise<Maintenance | null> {
  const m = await env.DB.prepare("SELECT * FROM maintenances WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  return m ? hydrateMaintenance(env, m) : null;
}

async function hydrateMaintenance(
  env: Env,
  m: Record<string, unknown>,
): Promise<Maintenance> {
  const comps = await env.DB.prepare(
    "SELECT component_id FROM maintenance_components WHERE maintenance_id = ?",
  )
    .bind(m.id)
    .all<Record<string, unknown>>();
  return {
    id: Number(m.id),
    title: String(m.title),
    message: String(m.message ?? ""),
    startAt: String(m.start_at),
    endAt: String(m.end_at),
    componentIds: (comps.results ?? []).map((c) => Number(c.component_id)),
  };
}

function maintenanceActive(m: Maintenance, now: number): boolean {
  return Date.parse(m.startAt) <= now && now <= Date.parse(m.endAt);
}

/** Read-time status of one component: open incident > checker degraded > report impact >
 *  active maintenance > operational. */
function componentStatus(
  c: Component,
  reports: Report[],
  maintenances: Maintenance[],
  now: number,
): Status {
  if (c.openIncident) return "error";
  if (c.monitorStatus === "error") return "error";
  if (c.monitorStatus === "degraded") return "degraded";
  // Latest impact from an unresolved report affecting this component.
  for (const r of reports) {
    if (r.status === "resolved") continue;
    const latest = r.updates[0];
    const hit = latest?.components.find((x) => x.componentId === c.id);
    if (hit) {
      if (hit.impact === "major_outage" || hit.impact === "partial_outage") return "error";
      if (hit.impact === "degraded_performance") return "degraded";
    }
  }
  for (const m of maintenances) {
    if (maintenanceActive(m, now) && m.componentIds.includes(c.id)) return "info";
  }
  return "success";
}

function overallStatus(statuses: Status[]): Status {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.includes("info")) return "info";
  if (statuses.length && statuses.every((s) => s === "empty")) return "empty";
  return "success";
}

/** Assemble the whole board in one pass. */
export async function loadBoard(env: Env): Promise<StatusBoard | null> {
  const page = await loadPage(env);
  if (!page) return null;
  const now = Date.now();
  const days = Number(env.UPTIME_DAYS || "45");

  const [compRows, groupRows, incidents, reports, maintenances] = await Promise.all([
    env.DB.prepare(
      `SELECT c.*, ms.status AS monitor_status
       FROM components c LEFT JOIN monitor_status ms ON ms.monitor_id = c.monitor_id
       WHERE c.page_id = ? ORDER BY c.sort_order ASC, c.id ASC`,
    )
      .bind(page.id)
      .all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM component_groups WHERE page_id = ? ORDER BY sort_order ASC")
      .bind(page.id)
      .all<Record<string, unknown>>(),
    openIncidents(env),
    listReports(env, 7),
    listMaintenances(env, 7),
  ]);

  const components: Component[] = (compRows.results ?? []).map((r) => {
    const monitorId = r.monitor_id == null ? null : Number(r.monitor_id);
    return {
      id: Number(r.id),
      name: String(r.name),
      description: (r.description as string) ?? null,
      order: Number(r.sort_order),
      groupId: r.group_id == null ? null : Number(r.group_id),
      monitorId,
      monitorStatus: toStatus((r.monitor_status as string) ?? null),
      openIncident: monitorId != null ? (incidents.get(monitorId) ?? null) : null,
    };
  });

  // Resolve each component's derived status, then the page overall.
  const derived = new Map<number, Status>();
  for (const c of components) {
    derived.set(c.id, componentStatus(c, reports, maintenances, now));
  }
  for (const c of components) c.monitorStatus = derived.get(c.id)!;
  const overall = overallStatus([...derived.values()]);

  const groups: ComponentGroup[] = (groupRows.results ?? []).map((g) => ({
    id: Number(g.id),
    name: String(g.name),
    order: Number(g.sort_order),
  }));

  const monitorIds = components.map((c) => c.monitorId).filter((x): x is number => x != null);
  const uptime = page.showUptime ? await getUptime(env, monitorIds, days) : {};

  return { page, components, groups, reports, maintenances, uptime, overall };
}
