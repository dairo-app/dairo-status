/** Events history + detail views. The history merges operator reports and scheduled
 *  maintenances into one reverse-chronological list; the detail views render a report's full
 *  update timeline or a maintenance window. Server-rendered from the D1 event tables. */
import type { Env, Maintenance, Page, Report, Status } from "../types";
import {
  Icon,
  ICONS,
  StatusIcon,
  impactLabel,
  statusText,
  statusVar,
  updateStatusLabel,
} from "../ui/status";

/** Soft tint for a status (badge/timeline background) — mirrors board.tsx. */
function tint(status: Status, pct = 15): string {
  return `color-mix(in oklab, ${statusVar[status]} ${pct}%, transparent)`;
}

function fmtUtc(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

/** Affected-component impact → visual status (matches the read-time derivation in db.ts). */
const impactStatus: Record<string, Status> = {
  operational: "success",
  degraded_performance: "degraded",
  partial_outage: "error",
  major_outage: "error",
};

/** Report update status → visual status, for coloring the timeline nodes. */
const updateStatus: Record<string, Status> = {
  investigating: "error",
  identified: "error",
  monitoring: "degraded",
  resolved: "success",
  maintenance: "info",
};

/** Back-to-history link shown atop the detail views. */
function BackLink() {
  return (
    <a
      href="/events"
      class="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      <span class="rotate-180">
        <Icon path={ICONS.chevronRight} size={13} />
      </span>
      Events
    </a>
  );
}

/** A small pill badge for one affected component's impact, tinted by its status. */
function ImpactBadge({ impact }: { impact: string }) {
  const status = impactStatus[impact] ?? "empty";
  return (
    <span
      class={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-xs ${statusText[status]}`}
      style={`background-color:${tint(status, 10)};border-color:${statusVar[status]}`}
    >
      <StatusIcon status={status} size={10} />
      {impactLabel[impact] ?? impact}
    </span>
  );
}

/** One row in the merged history list. */
function EventRow({
  href,
  title,
  label,
  status,
  date,
}: {
  href: string;
  title: string;
  label: string;
  status: Status;
  date: string;
}) {
  return (
    <a href={href} class="block border-b py-3 last:border-b-0 hover:opacity-90">
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 truncate font-mono text-sm font-medium">{title}</span>
        <span class="shrink-0 font-mono text-xs text-muted-foreground">{fmtUtc(date)} (UTC)</span>
      </div>
      <span class={`mt-1 inline-flex items-center gap-1.5 font-mono text-xs ${statusText[status]}`}>
        <StatusIcon status={status} size={10} />
        {label}
      </span>
    </a>
  );
}

/** History: reports + maintenances, newest first. */
export function EventsPage({
  env,
  page,
  reports,
  maintenances,
}: {
  env: Env;
  page: Page;
  reports: Report[];
  maintenances: Maintenance[];
}) {
  const items: { date: string; node: unknown }[] = [];

  for (const r of reports) {
    const latest = r.updates[0];
    const status = updateStatus[latest?.status ?? ""] ?? "empty";
    items.push({
      date: r.updatedAt,
      node: (
        <EventRow
          href={`/events/report/${r.id}`}
          title={r.title}
          label={updateStatusLabel[latest?.status ?? ""] ?? "Investigating"}
          status={status}
          date={r.updatedAt}
        />
      ),
    });
  }

  for (const m of maintenances) {
    items.push({
      date: m.startAt,
      node: (
        <EventRow
          href={`/events/maintenance/${m.id}`}
          title={`Maintenance — ${m.title}`}
          label="Maintenance"
          status="info"
          date={m.startAt}
        />
      ),
    });
  }

  items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return (
    <div class="flex flex-col gap-6">
      <div>
        <h1 class="font-mono text-lg font-semibold">Events</h1>
        <p class="text-muted-foreground">Past incidents and scheduled maintenance.</p>
      </div>
      {items.length === 0 ? (
        <p class="py-3 text-sm text-muted-foreground">No events yet.</p>
      ) : (
        <div>{items.map((i) => i.node)}</div>
      )}
    </div>
  );
}

/** Report detail: title + the full update timeline (newest first). */
export function ReportDetail({ env, page, report }: { env: Env; page: Page; report: Report }) {
  const latest = report.updates[0];
  const headStatus = updateStatus[latest?.status ?? ""] ?? "empty";

  return (
    <div class="flex flex-col gap-6">
      <BackLink />

      <div class="flex flex-col gap-2">
        <h1 class="font-mono text-lg font-semibold">{report.title}</h1>
        <span
          class={`inline-flex w-fit items-center gap-1.5 font-mono text-xs ${statusText[headStatus]}`}
        >
          <StatusIcon status={headStatus} size={11} />
          {updateStatusLabel[report.status] ?? report.status}
        </span>
      </div>

      <ol class="flex flex-col border-l border-border">
        {report.updates.map((u) => {
          const status = updateStatus[u.status] ?? "empty";
          return (
            <li class="relative pb-6 pl-5 last:pb-0">
              <span
                class="absolute -left-[7px] top-1 inline-flex size-3.5 items-center justify-center"
                style={`color:${statusVar[status]}`}
              >
                <StatusIcon status={status} size={13} />
              </span>
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span class={`font-mono text-sm font-medium ${statusText[status]}`}>
                  {updateStatusLabel[u.status] ?? u.status}
                </span>
                <span class="font-mono text-xs text-muted-foreground">{fmtUtc(u.date)} (UTC)</span>
              </div>
              {u.message ? <p class="mt-1 whitespace-pre-line text-sm">{u.message}</p> : null}
              {u.components.length > 0 ? (
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {u.components.map((c) => (
                    <ImpactBadge impact={c.impact} />
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Maintenance detail: title, scheduled window, message. */
export function MaintenanceDetail({
  env,
  page,
  maintenance,
}: {
  env: Env;
  page: Page;
  maintenance: Maintenance;
}) {
  return (
    <div class="flex flex-col gap-6">
      <BackLink />

      <div class="flex flex-col gap-2">
        <span class={`inline-flex w-fit items-center gap-1.5 font-mono text-xs ${statusText.info}`}>
          <StatusIcon status="info" size={11} />
          Scheduled maintenance
        </span>
        <h1 class="font-mono text-lg font-semibold">{maintenance.title}</h1>
      </div>

      <div
        class="flex items-center gap-2 border px-3 py-2 font-mono text-sm"
        style={`background-color:${tint("info", 10)};border-color:${statusVar.info}`}
      >
        <Icon path={ICONS.clock} size={14} cls={statusText.info} />
        <span>
          {fmtUtc(maintenance.startAt)} — {fmtUtc(maintenance.endAt)} (UTC)
        </span>
      </div>

      {maintenance.message ? (
        <p class="whitespace-pre-line text-sm">{maintenance.message}</p>
      ) : null}
    </div>
  );
}
