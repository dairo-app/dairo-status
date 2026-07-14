/** Events history + detail views. History is a tabbed timeline (Reports / Maintenances);
 *  details show a report's update timeline or a maintenance window. Matches the original:
 *  dated event cards, affected-component badges, resolved-check, mono meta. */
import type { Env, Maintenance, Page, Report, ReportUpdate, Status } from "../types";
import { Icon, ICONS, impactLabel, statusVar, updateStatusLabel } from "../ui/status";

type Names = Record<number, string>;

function fmtUtc(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

/** Map a report impact to a signal color. */
function impactStatus(impact: string): Status {
  if (impact === "major_outage" || impact === "partial_outage") return "error";
  if (impact === "degraded_performance") return "degraded";
  return "success";
}

function ImpactBadge({ impact, name }: { impact: string; name: string }) {
  const s = impactStatus(impact);
  return (
    <span
      class="inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-xs"
      style={`border-color:${statusVar[s]};color:${statusVar[s]}`}
      title={impactLabel[impact] ?? impact}
    >
      <span class="size-1.5" style={`background-color:${statusVar[s]}`} />
      {name}
    </span>
  );
}

function InfoBadge({ name }: { name: string }) {
  return (
    <span
      class="inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-xs"
      style={`border-color:${statusVar.info};color:${statusVar.info}`}
    >
      <span class="size-1.5" style={`background-color:${statusVar.info}`} />
      {name}
    </span>
  );
}

function AffectedRow({ updates, names }: { updates: ReportUpdate[]; names: Names }) {
  const rank: Record<string, number> = {
    operational: 0,
    degraded_performance: 1,
    partial_outage: 2,
    major_outage: 3,
  };
  const worst = new Map<number, string>();
  for (const u of updates) {
    for (const c of u.components) {
      const prev = worst.get(c.componentId);
      if (prev == null || (rank[c.impact] ?? 0) > (rank[prev] ?? 0)) worst.set(c.componentId, c.impact);
    }
  }
  if (worst.size === 0) return null;
  return (
    <div class="flex flex-wrap gap-1">
      {[...worst.entries()].map(([id, impact]) => (
        <ImpactBadge impact={impact} name={names[id] ?? `Component ${id}`} />
      ))}
    </div>
  );
}

function ResolvedCheck() {
  return (
    <span class="border-success/20 bg-success/10 text-success inline-flex items-center border p-0.5" title="Resolved">
      <Icon path="M20 6 9 17l-5-5" size={12} />
    </span>
  );
}

function ReportCard({ report, names }: { report: Report; names: Names }) {
  const latest = report.updates[0];
  const resolved = report.status === "resolved";
  return (
    <div class="relative flex flex-col gap-2">
      <a
        href={`/events/report/${report.id}`}
        class="hover:border-border/50 hover:bg-muted/50 -mx-3 -my-2 flex flex-col gap-2 border border-transparent px-3 py-2 transition-colors"
      >
        <div class="text-muted-foreground font-mono text-xs">{fmtUtc(report.updatedAt)} (UTC)</div>
        <div class="inline-flex items-center gap-1.5 font-medium">
          {report.title}
          {resolved ? <ResolvedCheck /> : null}
        </div>
        <AffectedRow updates={report.updates} names={names} />
        {latest ? (
          <p class="text-muted-foreground text-sm">
            <span class="text-foreground font-medium">{updateStatusLabel[latest.status] ?? latest.status}:</span>{" "}
            {latest.message}
          </p>
        ) : null}
      </a>
    </div>
  );
}

function MaintenanceCard({ m, names }: { m: Maintenance; names: Names }) {
  return (
    <div class="relative flex flex-col gap-2">
      <a
        href={`/events/maintenance/${m.id}`}
        class="hover:border-border/50 hover:bg-muted/50 -mx-3 -my-2 flex flex-col gap-2 border border-transparent px-3 py-2 transition-colors"
      >
        <div class="text-muted-foreground font-mono text-xs">
          {fmtUtc(m.startAt)} → {fmtUtc(m.endAt)} (UTC)
        </div>
        <div class="font-medium">{m.title}</div>
        {m.componentIds.length > 0 ? (
          <div class="flex flex-wrap gap-1">
            {m.componentIds.map((id) => (
              <InfoBadge name={names[id] ?? `Component ${id}`} />
            ))}
          </div>
        ) : null}
        {m.message ? <p class="text-muted-foreground text-sm">{m.message}</p> : null}
      </a>
    </div>
  );
}

const TAB_LABEL =
  "text-muted-foreground flex-1 cursor-pointer border-b-2 border-transparent px-3 py-2 text-center text-sm font-medium";

export function EventsPage({
  reports,
  maintenances,
  names,
}: {
  env: Env;
  page: Page;
  reports: Report[];
  maintenances: Maintenance[];
  names: Names;
}) {
  return (
    <div class="flex flex-col gap-4">
      <input type="radio" name="ev-tab" id="ev-reports" class="peer/reports hidden" checked />
      <input type="radio" name="ev-tab" id="ev-maint" class="peer/maint hidden" />
      <div class="flex w-full max-w-xs border-b">
        <label for="ev-reports" class={`${TAB_LABEL} peer-checked/reports:text-foreground peer-checked/reports:border-foreground`}>
          Reports
        </label>
        <label for="ev-maint" class={`${TAB_LABEL} peer-checked/maint:text-foreground peer-checked/maint:border-foreground`}>
          Maintenances
        </label>
      </div>

      <div class="hidden flex-col gap-4 peer-checked/reports:flex">
        {reports.length > 0 ? (
          reports.map((r) => <ReportCard report={r} names={names} />)
        ) : (
          <p class="text-muted-foreground py-6 text-sm">No reports yet.</p>
        )}
      </div>
      <div class="hidden flex-col gap-4 peer-checked/maint:flex">
        {maintenances.length > 0 ? (
          maintenances.map((m) => <MaintenanceCard m={m} names={names} />)
        ) : (
          <p class="text-muted-foreground py-6 text-sm">No maintenance scheduled.</p>
        )}
      </div>
    </div>
  );
}

export function ReportDetail({ report, names }: { env: Env; page: Page; report: Report; names: Names }) {
  return (
    <div class="flex flex-col gap-6">
      <div class="flex flex-col gap-1">
        <a href="/events" class="text-muted-foreground hover:text-foreground font-mono text-xs">← Events</a>
        <h1 class="inline-flex items-center gap-2 text-lg font-semibold">
          {report.title}
          {report.status === "resolved" ? <ResolvedCheck /> : null}
        </h1>
      </div>
      <div class="flex flex-col gap-6 border-l pl-5">
        {report.updates.map((u) => {
          const s: Status = u.status === "resolved" ? "success" : u.status === "monitoring" ? "info" : "error";
          return (
            <div class="relative flex flex-col gap-2">
              <span class="absolute top-1 -left-[26px] size-2.5 rounded-full" style={`background-color:${statusVar[s]}`} />
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-mono text-sm font-medium" style={`color:${statusVar[s]}`}>
                  {updateStatusLabel[u.status] ?? u.status}
                </span>
                <span class="text-muted-foreground font-mono text-xs">{fmtUtc(u.date)} (UTC)</span>
              </div>
              {u.message ? <p class="text-sm">{u.message}</p> : null}
              {u.components.length > 0 ? (
                <div class="flex flex-wrap gap-1">
                  {u.components.map((c) => (
                    <ImpactBadge impact={c.impact} name={names[c.componentId] ?? `Component ${c.componentId}`} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MaintenanceDetail({
  maintenance,
  names,
}: {
  env: Env;
  page: Page;
  maintenance: Maintenance;
  names: Names;
}) {
  return (
    <div class="flex flex-col gap-6">
      <div class="flex flex-col gap-1">
        <a href="/events" class="text-muted-foreground hover:text-foreground font-mono text-xs">← Events</a>
        <h1 class="text-lg font-semibold">{maintenance.title}</h1>
      </div>
      <div
        class="flex items-center gap-2 border px-3 py-2 font-mono text-sm"
        style={`border-color:${statusVar.info};background-color:color-mix(in oklab, ${statusVar.info} 8%, transparent)`}
      >
        <Icon path={ICONS.clock} size={14} />
        {fmtUtc(maintenance.startAt)} → {fmtUtc(maintenance.endAt)} (UTC)
      </div>
      {maintenance.message ? <p class="text-sm leading-relaxed">{maintenance.message}</p> : null}
      {maintenance.componentIds.length > 0 ? (
        <div class="flex flex-col gap-2">
          <span class="text-muted-foreground font-mono text-xs">Affected</span>
          <div class="flex flex-wrap gap-1">
            {maintenance.componentIds.map((id) => (
              <InfoBadge name={names[id] ?? `Component ${id}`} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
