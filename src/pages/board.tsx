/** The status board: header, overall banner, per-component rows with uptime bars, and the
 *  recent-events feed. Rendered entirely server-side from the D1 board graph. */
import type { Component, Maintenance, Report, Status, StatusBoard } from "../types";
import {
  bannerLabel,
  componentLabel,
  Icon,
  ICONS,
  impactLabel,
  StatusIcon,
  statusText,
  statusVar,
  updateStatusLabel,
} from "../ui/status";
import { UptimeBar, uptimePercent } from "../ui/uptimebar";

/** Soft tint for a status (banner/event-card background). */
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

function Banner({ status }: { status: Status }) {
  return (
    <div
      class="flex items-center gap-3 border px-3 py-2 sm:px-4 sm:py-3"
      style={`background-color:${tint(status, 20)};border-color:${statusVar[status]}`}
    >
      <StatusIcon status={status} size={28} />
      <div class="flex flex-1 flex-wrap items-center justify-between gap-2">
        <span class="text-xl font-semibold">{bannerLabel[status]}</span>
        <span class="font-mono text-xs text-muted-foreground">{fmtUtc(new Date().toISOString())} (UTC)</span>
      </div>
    </div>
  );
}

/** An open report or active maintenance shown beneath the banner. */
function EventCard({
  href,
  status,
  title,
  message,
  meta,
}: {
  href: string;
  status: Status;
  title: string;
  message: string;
  meta: string;
}) {
  return (
    <a href={href} class="block border px-3 py-2.5 hover:opacity-90" style={`background-color:${tint(status, 8)};border-color:${statusVar[status]}`}>
      <div class="flex items-center justify-between gap-2">
        <span class="font-mono text-sm font-medium">{title}</span>
        <span class={`font-mono text-xs ${statusText[status]}`}>{meta}</span>
      </div>
      {message ? <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{message}</p> : null}
    </a>
  );
}

function ComponentCard({ c, board }: { c: Component; board: StatusBoard }) {
  const status = c.monitorStatus;
  const days = c.monitorId != null ? (board.uptime[c.monitorId] ?? []) : [];
  const pct = uptimePercent(days);
  const showUptime = board.page.showUptime && days.length > 0;

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-foreground truncate font-mono text-base font-medium leading-5">{c.name}</span>
          {c.description ? (
            <span class="text-muted-foreground" title={c.description}>
              <Icon path={ICONS.info} size={16} />
            </span>
          ) : null}
        </div>
        <div class="flex items-center gap-3">
          {showUptime && pct != null ? (
            <span class="text-foreground/80 font-mono text-sm leading-none">
              {(Math.floor(pct * 100) / 100).toFixed(pct >= 100 ? 0 : 2)}%
            </span>
          ) : (
            <span class={`font-mono text-sm leading-none ${statusText[status]}`}>{componentLabel[status]}</span>
          )}
          <StatusIcon status={status} size={13} />
        </div>
      </div>
      {showUptime ? (
        <div class="space-y-2">
          <UptimeBar days={days} />
          <div class="text-muted-foreground flex items-center justify-between font-mono text-xs leading-none">
            <span>{days.length} days ago</span>
            <span>Today</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Feed({ reports, maintenances }: { reports: Report[]; maintenances: Maintenance[] }) {
  const items: { date: string; node: unknown }[] = [];
  for (const r of reports) {
    const latest = r.updates[0];
    items.push({
      date: r.updatedAt,
      node: (
        <a href={`/events/report/${r.id}`} class="block border-b py-3 last:border-b-0 hover:opacity-90">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-sm font-medium">{r.title}</span>
            <span class="font-mono text-xs text-muted-foreground">{fmtUtc(r.updatedAt)} (UTC)</span>
          </div>
          {latest ? (
            <p class="mt-1 text-sm text-muted-foreground">
              <span class="font-medium text-foreground">{updateStatusLabel[latest.status] ?? latest.status}:</span>{" "}
              {latest.message}
            </p>
          ) : null}
        </a>
      ),
    });
  }
  for (const m of maintenances) {
    items.push({
      date: m.startAt,
      node: (
        <a href={`/events/maintenance/${m.id}`} class="block border-b py-3 last:border-b-0 hover:opacity-90">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-sm font-medium">Maintenance — {m.title}</span>
            <span class="font-mono text-xs text-muted-foreground">{fmtUtc(m.startAt)} (UTC)</span>
          </div>
          {m.message ? <p class="mt-1 text-sm text-muted-foreground">{m.message}</p> : null}
        </a>
      ),
    });
  }
  items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return (
    <section class="space-y-1">
      <div class="flex items-center justify-between">
        <h2 class="font-mono text-sm font-medium">Recent events</h2>
        <a href="/events" class="font-mono text-xs text-muted-foreground hover:text-foreground">
          History →
        </a>
      </div>
      {items.length === 0 ? (
        <p class="py-3 text-sm text-muted-foreground">No events in the last 7 days.</p>
      ) : (
        <div>{items.map((i) => i.node)}</div>
      )}
    </section>
  );
}

/** Active (open) reports + in-window maintenances to surface under the banner. */
function activeEvents(board: StatusBoard) {
  const now = Date.now();
  const cards: unknown[] = [];
  for (const r of board.reports) {
    if (r.status === "resolved") continue;
    const latest = r.updates[0];
    const status: Status = latest?.components.some((c) =>
      ["major_outage", "partial_outage"].includes(c.impact),
    )
      ? "error"
      : "degraded";
    cards.push(
      <EventCard
        href={`/events/report/${r.id}`}
        status={status}
        title={r.title}
        message={latest?.message ?? ""}
        meta={updateStatusLabel[latest?.status ?? ""] ?? "Investigating"}
      />,
    );
  }
  for (const m of board.maintenances) {
    if (Date.parse(m.startAt) <= now && now <= Date.parse(m.endAt)) {
      cards.push(
        <EventCard href={`/events/maintenance/${m.id}`} status="info" title={m.title} message={m.message} meta="Maintenance" />,
      );
    }
  }
  return cards;
}

export function Board({ board }: { board: StatusBoard }) {
  const events = activeEvents(board);
  const grouped = board.components.filter((c) => c.groupId == null);
  return (
    <div class="flex flex-col gap-8">
      <div>
        <h1 class="text-lg font-semibold">{board.page.title}</h1>
        <p class="text-muted-foreground">{board.page.description}</p>
      </div>

      <Banner status={board.overall} />
      {events.length > 0 ? <div class="flex flex-col gap-2">{events}</div> : null}

      <div class="flex flex-col gap-5">
        {grouped.map((c) => (
          <ComponentCard c={c} board={board} />
        ))}
      </div>

      <hr class="border-border" />
      <Feed reports={board.reports} maintenances={board.maintenances} />
    </div>
  );
}
