/** The uptime tracker: a row of one thin bar per day. Each bar is a vertical stack of
 *  proportional segments colored by status — a fully-up day is a single success segment,
 *  an outage day is success on top with a proportional error segment at the bottom, and a
 *  no-data day is a muted full-height segment. Hover or focus a bar to reveal a CSS-only
 *  card (side top) with the date, that day's per-status request breakdown, and any events.
 *  Framework-free: no JS, the card is a group-hover/group-focus reveal. Mirrors the original
 *  StatusBar (StatusBarItem / StatusBarCard / StatusBarContent / StatusBarEvent) 1:1. */
import type { Incident, Maintenance, Report, Status, UptimeDay } from "../types";
import { statusVar } from "./status";

/** Aggregate uptime % across the window (days with no checks are ignored). */
export function uptimePercent(days: UptimeDay[]): number | null {
  let ok = 0;
  let total = 0;
  for (const d of days) {
    ok += d.ok;
    total += d.total;
  }
  if (total === 0) return null;
  return (ok / total) * 100;
}

/** Per-status label for a hover-card breakdown row (StatusBarContent requestStatus map). */
const requestStatusLabel: Record<Status, string> = {
  success: "Normal",
  degraded: "Degraded",
  error: "Error",
  info: "Maintenance",
  empty: "No Data",
};

/** Compact request counts: "532", "1.2k", "3.4M" (mirrors the original formatNumber). */
function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return `${num}`;
}

/** "Jan 15, 2024" in UTC — matches the original's short-date card header. */
function fmtDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Overlap (ms) of an event window with a given UTC day; an open event (to=null) runs to now. */
function eventMsInDay(from: string | null, to: string | null, dayStr: string): number {
  if (!from) return 0;
  const dayStart = Date.parse(`${dayStr}T00:00:00Z`);
  const dayEnd = dayStart + MS_PER_DAY - 1;
  const start = Math.max(Date.parse(from), dayStart);
  const end = Math.min(to ? Date.parse(to) : Date.now(), dayEnd);
  return Math.max(0, end - start);
}

/** Summed overlap of a set of events within the day, capped at 24h (getTotalEventsDurationMs). */
function totalEventMs(events: DayEvent[], dayStr: string): number {
  let total = 0;
  for (const ev of events) total += eventMsInDay(ev.from, ev.to, dayStr);
  return Math.min(total, MS_PER_DAY);
}

/** The day's event-derived color (setDataByType's eventStatus): incidents → error, else the
 *  worst active report color, else maintenance → info, else none. Report DayEvents already
 *  carry their per-day color (floored to degraded/error). */
function dayEventStatus(events: DayEvent[]): "error" | "degraded" | "info" | undefined {
  if (events.some((e) => e.type === "incident")) return "error";
  const reportColors = events.filter((e) => e.type === "report").map((e) => e.status);
  if (reportColors.includes("error")) return "error";
  if (reportColors.includes("degraded")) return "degraded";
  if (events.some((e) => e.type === "maintenance")) return "info";
  return undefined;
}

/** Downtime-only event day (createErrorOnlyBarData): the error slice takes its true proportion
 *  of the day and the rest is operational green. */
function errorOnlyBar(errorMs: number): { status: Status; height: number }[] {
  const errHeight = (Math.min(errorMs, MS_PER_DAY) / MS_PER_DAY) * 100;
  return [
    { status: "success", height: 100 - errHeight },
    { status: "error", height: errHeight },
  ];
}

/** Mixed event day (createProportionalBarData): downtime keeps its real share of the day;
 *  maintenance/degraded "highlight" slices split the remaining (non-error) space. */
function proportionalBar(
  segments: { status: Status; count: number }[],
): { status: Status; height: number }[] {
  const errorMs = segments.filter((s) => s.status === "error").reduce((a, s) => a + s.count, 0);
  const errHeight = (Math.min(errorMs, MS_PER_DAY) / MS_PER_DAY) * 100;
  const remaining = Math.max(0, 100 - errHeight);
  const highlight = segments.filter((s) => s.status !== "error");
  const highlightTotal = highlight.reduce((a, s) => a + s.count, 0);
  return segments.map((s) => {
    if (s.status === "error") return { status: s.status, height: errHeight };
    return {
      status: s.status,
      height: highlightTotal > 0 ? (s.count / highlightTotal) * remaining : remaining / highlight.length,
    };
  });
}

/** Top-to-bottom segments for one day's bar (heights are percentages). Faithful port of the
 *  original setDataByType (barType "absolute"): a day with incidents/reports/maintenance is
 *  painted from event DURATIONS (downtime at its true scale, maintenance/degraded as highlight
 *  slices); an ordinary day is the proportional success/degraded/error split of the day's
 *  request counts — no minimum floor, so downtime shows at its real size, exactly as before. */
function daySegments(day: UptimeDay & { events?: DayEvent[] }): { status: Status; height: number }[] {
  const events = day.events ?? [];

  if (dayEventStatus(events)) {
    const maintenances = events.filter((e) => e.type === "maintenance");
    const degradedReports = events.filter((e) => e.type === "report" && e.status === "degraded");
    const errorEvents = events.filter(
      (e) => e.type === "incident" || (e.type === "report" && e.status === "error"),
    );
    const segs = [
      { status: "info" as Status, count: totalEventMs(maintenances, day.day) },
      { status: "degraded" as Status, count: totalEventMs(degradedReports, day.day) },
      { status: "error" as Status, count: totalEventMs(errorEvents, day.day) },
    ].filter((s) => s.count > 0);
    if (segs.length === 1 && segs[0].status === "error") return errorOnlyBar(segs[0].count);
    if (segs.length > 0) return proportionalBar(segs);
  }

  if (day.total === 0) return [{ status: "empty", height: 100 }];
  const errCount = Math.max(0, day.total - day.ok);
  const segs = [
    { status: "success" as Status, count: day.ok },
    { status: "error" as Status, count: errCount },
  ].filter((s) => s.count > 0);
  if (segs.length === 0) return [{ status: "success", height: 100 }];
  return segs.map((s) => ({ status: s.status, height: (s.count / day.total) * 100 }));
}

/** The day's request breakdown rows (requests cardType): a "N reqs" row per non-zero status
 *  bucket in success → error order; an empty day yields one row tinted by the day's event color
 *  (or "No Data"). Mirrors createRequestEntries + entriesToRequestCardData. */
function dayCard(day: UptimeDay & { events?: DayEvent[] }): { status: Status; value: string }[] {
  if (day.total === 0) return [{ status: dayEventStatus(day.events ?? []) ?? "empty", value: "" }];
  const err = Math.max(0, day.total - day.ok);
  const rows: { status: Status; value: string }[] = [];
  if (day.ok > 0) rows.push({ status: "success", value: `${formatNumber(day.ok)} reqs` });
  if (err > 0) rows.push({ status: "error", value: `${formatNumber(err)} reqs` });
  if (rows.length === 0) rows.push({ status: "success", value: `${formatNumber(day.ok)} reqs` });
  return rows;
}

// ── event rendering (StatusBarEvent) ──────────────────────────────────────────────────
// The day's events are carried as an optional field on each day so the section renders
// verbatim once the data layer attaches per-day incidents/reports/maintenances.
type DayEvent = {
  id: number | string;
  name: string;
  type: "incident" | "report" | "maintenance";
  from: string | null;
  to: string | null;
  isAggregated?: boolean;
  /** Overrides the type-derived dot color (e.g. the day's worst report impact). */
  status?: Exclude<Status, "empty">;
};

// ── per-day event derivation (getEvents + setDataByType event bundling) ────────────────
// Mirrors the original: build the component's report/maintenance/incident events once,
// then for each UTC day slice the events that fall on it — reports with a dot color
// floored to the day's worst impact (degraded unless the day is a full error), plus
// maintenances and incidents (bundled into a single "Downtime (N incidents)" row when
// more than four land on the same day). Attached by the board so the card's EVENT
// section renders verbatim; without this the whole events path is dead.
type Impact = "operational" | "degraded_performance" | "partial_outage" | "major_outage";
const IMPACT_ORDER: Impact[] = [
  "operational",
  "degraded_performance",
  "partial_outage",
  "major_outage",
];

/** Project an impact onto the bar palette (impactToStatusType). */
function impactToStatusType(impact: Impact): "success" | "degraded" | "error" {
  if (impact === "major_outage") return "error";
  if (impact === "operational") return "success";
  return "degraded";
}

/** Worst (highest-ordered) impact across a set; empty ⇒ operational (worstImpact). */
function worstImpact(impacts: Impact[]): Impact {
  let worst: Impact = "operational";
  for (const i of impacts) {
    if (IMPACT_ORDER.indexOf(i) > IMPACT_ORDER.indexOf(worst)) worst = i;
  }
  return worst;
}

type ImpactInterval = { from: Date; to: Date | null; impact: Impact };

/** A component's event with the intervals needed for per-day report coloring. */
type CompEvent = {
  id: number;
  name: string;
  from: Date;
  to: Date | null;
  type: "maintenance" | "incident" | "report";
  impactIntervals?: ImpactInterval[];
};

/** Per-component impact change-points across a report's updates (buildComponentImpactIntervals). */
function componentImpactIntervals(report: Report, componentId: number): ImpactInterval[] {
  const sorted = [...report.updates].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id - b.id,
  );
  const intervals: ImpactInterval[] = [];
  for (const u of sorted) {
    for (const row of u.components) {
      if (row.componentId !== componentId) continue;
      const last = intervals[intervals.length - 1];
      if (last && last.to === null) last.to = new Date(u.date);
      intervals.push({ from: new Date(u.date), to: null, impact: row.impact as Impact });
    }
  }
  return intervals;
}

/** clampOpenIntervals — close still-open intervals at the event's end so day math stays in-window. */
function clampOpen(intervals: ImpactInterval[], to: Date | null): ImpactInterval[] {
  if (to === null) return intervals;
  return intervals.map((iv) => (iv.to === null ? { ...iv, to } : iv));
}

/** getEvents (scoped to one component): its maintenances, open incident, and reports. */
function buildComponentEvents(
  componentId: number,
  reports: Report[],
  maintenances: Maintenance[],
  incident: Incident | null,
): CompEvent[] {
  const events: CompEvent[] = [];

  for (const m of maintenances) {
    if (!m.componentIds.includes(componentId)) continue;
    events.push({
      id: m.id,
      name: m.title,
      from: new Date(m.startAt),
      to: new Date(m.endAt),
      type: "maintenance",
    });
  }

  if (incident) {
    events.push({
      id: incident.id,
      name: "Downtime",
      from: new Date(incident.startedAt),
      to: incident.resolvedAt ? new Date(incident.resolvedAt) : null,
      type: "incident",
    });
  }

  for (const r of reports) {
    const sorted = [...r.updates].sort(
      (a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id - b.id,
    );
    if (sorted.length === 0) continue;
    if (!sorted.some((u) => u.components.some((c) => c.componentId === componentId))) continue;
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const intervals = componentImpactIntervals(r, componentId);
    const hasImpacts = intervals.length > 0;
    const to =
      r.status === "resolved"
        ? new Date(last.date)
        : last.status === "resolved" || last.status === "monitoring"
          ? new Date(last.date)
          : null;
    events.push({
      id: r.id,
      name: r.title,
      from: new Date(first.date),
      to,
      type: "report",
      impactIntervals: hasImpacts ? clampOpen(intervals, to) : undefined,
    });
  }

  return events;
}

/** True when the event's window overlaps the given UTC day (isDateWithinEvent). */
function isDateWithinEvent(date: Date, e: CompEvent): boolean {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  const evEnd = e.to ?? new Date();
  return e.from.getTime() <= end.getTime() && evEnd.getTime() >= start.getTime();
}

/** Worst report impact on one UTC day; null ⇒ legacy report with no impact rows. */
function reportDayImpact(e: CompEvent, date: Date): Impact | null {
  if (!e.impactIntervals) return null;
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  const overlapping = e.impactIntervals.filter((iv) => {
    const ivEnd = iv.to ?? new Date();
    return iv.from.getTime() <= end.getTime() && ivEnd.getTime() >= start.getTime();
  });
  return worstImpact(overlapping.map((iv) => iv.impact));
}

/** Worst projected report color for one day; legacy events stay degraded (reportEventDayStatus). */
function reportDayStatus(e: CompEvent, date: Date): "success" | "degraded" | "error" {
  const impact = reportDayImpact(e, date);
  return impact === null ? "degraded" : impactToStatusType(impact);
}

const iso = (d: Date) => d.toISOString();

/** Attach the reports/maintenances/incidents that fall on each UTC day to the day objects,
 *  so <UptimeBar days={...}> can render the card's EVENT section. Mirrors setDataByType's
 *  per-day `events` slice (reports floored to degraded/error, maintenances, bundled incidents).
 *  uptimePercent / day counts still read the plain ok/total fields, so callers can pass the
 *  result straight through. */
export function withDayEvents(
  days: UptimeDay[],
  opts: {
    componentId: number;
    reports: Report[];
    maintenances: Maintenance[];
    incident: Incident | null;
  },
): (UptimeDay & { events: DayEvent[] })[] {
  const compEvents = buildComponentEvents(
    opts.componentId,
    opts.reports,
    opts.maintenances,
    opts.incident,
  );
  if (compEvents.length === 0) return days.map((d) => ({ ...d, events: [] }));

  return days.map((d) => {
    const date = new Date(`${d.day}T00:00:00Z`);
    const within = compEvents.filter((e) => isDateWithinEvent(date, e));
    const reports = within.filter((e) => e.type === "report");
    const maintenances = within.filter((e) => e.type === "maintenance");
    const incidents = within.filter((e) => e.type === "incident");

    const bundledIncidents: DayEvent[] =
      incidents.length > 4
        ? [
            {
              id: -1,
              name: `Downtime (${incidents.length} incidents)`,
              type: "incident",
              from: iso(new Date(Math.min(...incidents.map((i) => i.from.getTime())))),
              to: iso(new Date(Math.max(...incidents.map((i) => (i.to ?? new Date()).getTime())))),
              isAggregated: true,
              status: "error",
            },
          ]
        : incidents.map((i) => ({
            id: i.id,
            name: i.name,
            type: "incident" as const,
            from: iso(i.from),
            to: i.to ? iso(i.to) : null,
            status: "error" as const,
          }));

    const events: DayEvent[] = [
      // row dot follows the day's worst impact; floors at degraded so an operational-only
      // slice never renders a green row (mirrors the calendar).
      ...reports.map((e) => ({
        id: e.id,
        name: e.name,
        type: "report" as const,
        from: iso(e.from),
        to: e.to ? iso(e.to) : null,
        status: (reportDayStatus(e, date) === "error" ? "error" : "degraded") as Exclude<
          Status,
          "empty"
        >,
      })),
      ...maintenances.map((e) => ({
        id: e.id,
        name: e.name,
        type: "maintenance" as const,
        from: iso(e.from),
        to: e.to ? iso(e.to) : null,
        status: "info" as const,
      })),
      ...bundledIncidents,
    ];

    return { ...d, events };
  });
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "July 14, 4:56 PM" (UTC). */
function fmtDateTimeUTC(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    timeZone: "UTC",
  });
}

/** "4:56 PM" (UTC). */
function fmtTimeUTC(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "numeric", timeZone: "UTC" });
}

/** "July 14, 2026" (UTC). */
function fmtDateUTC(d: Date): string {
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** formatDateRange (UTC) with the "(UTC)" suffix — Since/Until/same-day collapse. */
function formatDateRange(from: Date | null, to: Date | null): string {
  const sameDay =
    from &&
    to &&
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth() &&
    from.getUTCDate() === to.getUTCDate();
  const isFromStart =
    !!from && from.getUTCHours() === 0 && from.getUTCMinutes() === 0 && from.getUTCSeconds() === 0;
  const isToEnd =
    !!to && to.getUTCHours() === 23 && to.getUTCMinutes() === 59 && to.getUTCSeconds() >= 59;

  let range: string;
  if (sameDay && from && to) {
    range =
      from.getTime() === to.getTime()
        ? fmtDateTimeUTC(from)
        : `${fmtDateTimeUTC(from)} - ${fmtTimeUTC(to)}`;
  } else if (from && to) {
    range =
      isFromStart && isToEnd
        ? `${fmtDateUTC(from)} - ${fmtDateUTC(to)}`
        : `${fmtDateTimeUTC(from)} - ${fmtDateTimeUTC(to)}`;
  } else if (to) {
    range = `Until ${fmtDateTimeUTC(to)}`;
  } else if (from) {
    range = `Since ${fmtDateTimeUTC(from)}`;
  } else {
    return "All time";
  }
  return `${range} (UTC)`;
}

/** date-fns formatDistanceStrict — largest whole unit, rounded. */
function strictDistance(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} second${s !== 1 ? "s" : ""}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m !== 1 ? "s" : ""}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h !== 1 ? "s" : ""}`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d !== 1 ? "s" : ""}`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} month${mo !== 1 ? "s" : ""}`;
  const y = Math.round(mo / 12);
  return `${y} year${y !== 1 ? "s" : ""}`;
}

/** Event duration span text: "ongoing" / "across 3 days" / "2 hours" (or hidden). */
function eventDuration(from: Date | null, to: Date | null, isAggregated?: boolean): string | null {
  if (!from) return null;
  if (!to) return "ongoing";
  const dur = strictDistance(Math.abs(to.getTime() - from.getTime()));
  if (isAggregated) return `across ${dur}`;
  if (dur === "0 seconds") return null;
  return dur;
}

function EventRow({ e }: { e: DayEvent }) {
  if (!e.from) return null;
  const from = new Date(e.from);
  const to = e.to ? new Date(e.to) : null;
  const status =
    e.status ?? (e.type === "incident" ? "error" : e.type === "report" ? "degraded" : "info");
  const dur = eventDuration(from, to, e.isAggregated);
  const node = (
    <div class="group relative text-sm" data-slot="status-bar-event">
      {/* spacer so the absolutely-positioned name row can truncate to the card width */}
      <div class="h-4 w-full" />
      <div class="text-muted-foreground hover:text-foreground absolute inset-0">
        <div class="flex items-center gap-2">
          <div
            class="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={`background-color:${statusVar[status]}`}
          />
          <div class="truncate">{e.name}</div>
        </div>
      </div>
      <div class="text-muted-foreground mt-1 text-xs">
        {formatDateRange(from, to)}{" "}
        <span class="text-muted-foreground/70 ml-1.5 font-mono">{dur}</span>
      </div>
    </div>
  );
  if (e.type === "report" || e.type === "maintenance") {
    return (
      <a
        href={`/events/${e.type}/${e.id}`}
        class="focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-[3px] text-inherit no-underline"
      >
        {node}
      </a>
    );
  }
  return node;
}

// ── card + bar ────────────────────────────────────────────────────────────────────────
/** Horizontal alignment of the hover card, clamped at the row edges so first/last bars'
 *  cards don't clip past the container (approximating Radix's collision flip). */
function cardPosition(edge: "first" | "last" | "mid"): string {
  // origin-* makes the zoom emanate from the bar edge nearest the card, like Radix's
  // side=top transform-origin (bottom-center, or the flipped corner at the row edges).
  if (edge === "first") return "left-0 translate-x-0 origin-bottom-left";
  if (edge === "last") return "right-0 left-auto translate-x-0 origin-bottom-right";
  return "left-1/2 -translate-x-1/2 origin-bottom";
}

function Bar({ day, index, edge }: { day: UptimeDay; index: number; edge: "first" | "last" | "mid" }) {
  const bar = daySegments(day);
  const rows = dayCard(day);
  const events = (day as UptimeDay & { events?: DayEvent[] }).events ?? [];

  return (
    <div
      class="group/bar focus-visible:ring-ring/50 relative flex h-full flex-1 cursor-pointer flex-col outline-none focus-visible:ring-[2px] aria-pressed:opacity-80"
      tabindex={0}
      role="button"
      data-slot="status-bar-item"
      aria-label={`Day ${index + 1} status`}
    >
      {/* Only the bar visuals dim on hover/focus; the card (scoped to THIS bar) stays crisp. */}
      <div class="flex h-full w-full flex-col overflow-hidden group-hover/bar:opacity-80 group-focus-within/bar:opacity-80">
        {bar.map((segment) => (
          <div
            class="w-full transition-all"
            style={`height:${segment.height}%;background-color:${statusVar[segment.status]}`}
          />
        ))}
      </div>
      {/* CSS-only hover card (side top), scoped to THIS bar's named group so hovering one bar
          never reveals its siblings' cards. Fades/zooms/slides in like the original. */}
      <div
        class={`pointer-events-none absolute bottom-[calc(100%+4px)] ${cardPosition(edge)} z-50 w-auto min-w-40 translate-y-2 scale-95 border bg-popover p-0 text-popover-foreground opacity-0 shadow-md transition group-hover/bar:pointer-events-auto group-hover/bar:translate-y-0 group-hover/bar:scale-100 group-hover/bar:opacity-100 group-focus-within/bar:pointer-events-auto group-focus-within/bar:translate-y-0 group-focus-within/bar:scale-100 group-focus-within/bar:opacity-100`}
      >
        <div data-slot="status-bar-card" class="font-sans">
          <div class="p-2 text-xs">{fmtDay(day.day)}</div>
          {rows.length > 0 ? (
            <>
              <div class="bg-border h-px w-full shrink-0" />
              <div class="space-y-1 p-2 text-sm">
                {rows.map((row) => (
                  <div class="flex items-baseline gap-4" data-slot="status-bar-content">
                    <div class="flex items-center gap-2">
                      <div
                        class="h-2.5 w-2.5 rounded-sm"
                        style={`background-color:${statusVar[row.status]}`}
                      />
                      <div class="text-sm">{requestStatusLabel[row.status]}</div>
                    </div>
                    <div class="text-muted-foreground ml-auto font-mono text-xs tracking-tight">
                      {row.value}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {events.length > 0 ? (
            <>
              <div class="bg-border h-px w-full shrink-0" />
              <div class="p-2">
                {events.map((e) => (
                  <EventRow e={e} />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function UptimeBar({ days }: { days: UptimeDay[] }) {
  return (
    <div
      class="flex h-[50px] w-full items-end gap-px"
      data-slot="status-bar"
      role="toolbar"
      aria-label="Status tracker"
    >
      {days.map((d, i) => (
        <Bar
          day={d}
          index={i}
          edge={i === 0 ? "first" : i === days.length - 1 ? "last" : "mid"}
        />
      ))}
    </div>
  );
}
