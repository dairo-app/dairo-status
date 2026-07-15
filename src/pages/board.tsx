/** The status board: header, overall banner (or per-event tabbed banner when events are open),
 *  the ordered component/group list with uptime bars, a separator, and the recent-events feed.
 *  Rendered entirely server-side from the D1 board graph — nothing to hydrate. Mirrors the
 *  original page (Status → StatusHeader / StatusBanner(Tabs) / StatusComponent(Group) / StatusFeed)
 *  1:1; dynamic status tints use inline color-mix since Tailwind needs static color classes. */
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import type {
  Component,
  ComponentGroup,
  Maintenance,
  Report,
  ReportUpdate,
  Status,
  StatusBoard,
} from "../types";
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
import { UptimeBar, uptimePercent, withDayEvents } from "../ui/uptimebar";

type Solid = Exclude<Status, "empty">;

// ── formatting helpers (all UTC, to match the original's "(UTC)" suffix) ──────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** SimpleTimestamp default render: "Jul 14, 2026 16:56 (UTC)". */
function fmtBannerTs(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCDate())}, ${d.getUTCFullYear()} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())} (UTC)`;
}

/** formatDateTime: "July 14, 4:56 PM". */
function fmtDateTimeUTC(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    timeZone: "UTC",
  });
}

/** formatTime: "4:56 PM". */
function fmtTimeUTC(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "numeric", timeZone: "UTC" });
}

/** formatDate: "July 14, 2026". */
function fmtDateUTC(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** formatDateShort: "Jul 14, 2026". */
function fmtDateShortUTC(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
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

/** formatDistanceStrict(date, now, { addSuffix: true }). */
function relative(date: Date): string {
  const diff = date.getTime() - Date.now();
  const dist = strictDistance(Math.abs(diff));
  return diff >= 0 ? `in ${dist}` : `${dist} ago`;
}

/** Two decimals, trimmed to a tidy "100%" / "99.98%" (matches the uptime bar). */
function fmtPct(n: number): string {
  return `${(Math.floor(n * 100) / 100).toFixed(n >= 100 ? 0 : 2)}%`;
}

/** Full UTC timestamp for the rich-timestamp hover card: "Jul 14, 2026 16:56:00". */
function fmtUtcFull(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCDate())}, ${d.getUTCFullYear()} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

// lucide: copy / check — the rich-timestamp hover card's copy affordance.
const COPY_ICON =
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>';
const CHECK_ICON = '<path d="M20 6 9 17l-5-5"/>';

// Copy the row's value, briefly flipping the copy glyph to a check; preventDefault/stopPropagation
// so a copy click inside an event-card link doesn't also navigate.
const COPY_ROW_JS = `event.preventDefault();event.stopPropagation();var v=this.querySelector('[data-ts-val]');if(v&&navigator.clipboard){navigator.clipboard.writeText(v.textContent);var s=this.querySelector('svg');if(s){var o=s.innerHTML;s.innerHTML='${CHECK_ICON}';setTimeout(function(){s.innerHTML=o;},1000);}}`;

/** One row of the rich-timestamp hover card: muted label + mono value with a hover copy icon. */
function RichTsRow({
  label,
  value,
  tzLabel,
  localVal,
  relVal,
}: {
  label: string;
  value: string;
  tzLabel?: boolean;
  localVal?: boolean;
  relVal?: boolean;
}) {
  return (
    <div class="group/row flex items-center justify-between gap-4 text-sm" onclick={COPY_ROW_JS}>
      <dt class="text-muted-foreground" data-rich-ts-tzlabel={tzLabel ? "" : undefined}>
        {label}
      </dt>
      <dd class="flex items-center gap-1 truncate font-mono">
        <span class="invisible group-hover/row:visible">
          <Icon path={COPY_ICON} size={12} />
        </span>
        <span
          data-ts-val
          data-rich-ts-local={localVal ? "" : undefined}
          data-rich-ts-rel={relVal ? "" : undefined}
        >
          {value}
        </span>
      </dd>
    </div>
  );
}

/** Rich timestamp (StatusTimestamp variant="rich"): the visible text is unchanged; hovering
 *  reveals a local / UTC / Relative card (each row click-to-copy). The board-root script below
 *  localizes every [data-rich-ts] on load (SSR falls back to UTC). */
function RichTs({ date, children }: { date: Date; children: Child }) {
  const utc = fmtUtcFull(date);
  return (
    <span data-rich-ts="" data-ts-ms={date.getTime()} class="group/ts relative inline-block">
      <span>{children}</span>
      <div class="bg-popover text-popover-foreground absolute top-full left-0 z-50 mt-1 hidden w-auto rounded-md border p-2 shadow-md outline-hidden group-hover/ts:block">
        <dl class="flex flex-col gap-1">
          <RichTsRow label="UTC" value={utc} tzLabel localVal />
          <RichTsRow label="UTC" value={utc} />
          <RichTsRow label="Relative" value="—" relVal />
        </dl>
      </div>
    </span>
  );
}

// Localizes every rich timestamp once on load — local time, timezone label, and relative-time
// rows (mirrors the footer clock's card). Appended once at the board root.
const RICH_TS_SCRIPT = `(function(){var M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];function p(n){return(n<10?'0':'')+n;}function f(d){return M[d.getMonth()]+' '+p(d.getDate())+', '+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());}var tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';document.querySelectorAll('[data-rich-ts]').forEach(function(el){var d=new Date(+el.getAttribute('data-ts-ms'));var lo=el.querySelector('[data-rich-ts-local]');if(lo)lo.textContent=f(d);var tl=el.querySelector('[data-rich-ts-tzlabel]');if(tl)tl.textContent=tz;var re=el.querySelector('[data-rich-ts-rel]');if(re){var s=Math.round((Date.now()-d.getTime())/1000),neg=s<0,a=Math.abs(s),U=[['year',31536000],['month',2592000],['day',86400],['hour',3600],['minute',60],['second',1]],r='now';for(var i=0;i<U.length;i++){var v=Math.floor(a/U[i][1]);if(v>=1||i===U.length-1){var w=v+' '+U[i][0]+(v!==1?'s':'');r=neg?'in '+w:w+' ago';break;}}re.textContent=r;}});})();`;

/** Colored dot/separator per report-update status (StatusEventTimelineDot mapping). */
const UPDATE_COLOR: Record<string, string> = {
  resolved: statusVar.success,
  monitoring: statusVar.info,
  identified: statusVar.degraded,
  investigating: statusVar.error,
  maintenance: statusVar.info,
};

// ── worst-impact label (StatusEventTimelineImpact) — same as events.tsx ImpactLabel ──
const IMPACT_ORDER = ["operational", "degraded_performance", "partial_outage", "major_outage"];
const impactText: Record<string, string> = {
  operational: "text-success",
  degraded_performance: "text-warning",
  partial_outage: "text-warning",
  major_outage: "text-destructive",
};

function worstImpact(impacts: string[]): string {
  let worst = "operational";
  for (const im of impacts) {
    if (IMPACT_ORDER.indexOf(im) > IMPACT_ORDER.indexOf(worst)) worst = im;
  }
  return worst;
}

/** Dashed-underline worst-impact label with a CSS hover card listing each component's impact. */
function ImpactLabel({ changes }: { changes: { name: string; impact: string }[] }) {
  const worst = worstImpact(changes.map((c) => c.impact));
  return (
    <span class="group/impact relative inline-block">
      <button
        type="button"
        class={`decoration-muted-foreground/30 hover:decoration-muted-foreground/60 font-mono text-xs font-medium underline decoration-dashed underline-offset-4 ${impactText[worst]}`}
      >
        {impactLabel[worst] ?? worst}
      </button>
      <span class="bg-popover text-popover-foreground pointer-events-none absolute top-full left-0 z-50 mt-1 hidden w-auto min-w-48 flex-col gap-1.5 border p-3 shadow-md group-hover/impact:flex">
        {changes.map((change) => (
          <span class="flex items-center justify-between gap-4 text-xs">
            <span class="truncate">{change.name}</span>
            <span class={`shrink-0 font-mono ${impactText[change.impact] ?? ""}`}>
              {impactLabel[change.impact] ?? change.impact}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

// ── shared timeline pieces (StatusEventTimeline*) ─────────────────────────────────────
function ReportUpdateEntry({
  update,
  withDot = true,
  withSeparator = true,
  isLast = false,
  duration,
  withImpact = false,
  nameById,
}: {
  update: ReportUpdate;
  withDot?: boolean;
  withSeparator?: boolean;
  isLast?: boolean;
  duration?: string;
  withImpact?: boolean;
  nameById?: Map<number, string>;
}) {
  const color = UPDATE_COLOR[update.status] ?? statusVar.empty;
  const date = new Date(update.date);
  const changes =
    withImpact && update.components.length
      ? update.components.map((c) => ({
          name: nameById?.get(c.componentId) ?? `#${c.componentId}`,
          impact: c.impact,
        }))
      : [];
  return (
    <div data-slot="status-event-timeline-report-update" data-variant={update.status} class="group">
      <div class="flex flex-row items-center justify-between gap-2">
        <div class="flex flex-row gap-4">
          {withDot ? (
            <div class="flex flex-col">
              <div class="flex h-5 flex-col items-center justify-center">
                <div class="size-2.5 shrink-0 rounded-full" style={`background-color:${color}`} />
              </div>
              {withSeparator ? (
                <div class="mx-auto w-px flex-1" style={`background-color:${color}`} />
              ) : null}
            </div>
          ) : null}
          <div class={isLast ? "mb-0" : "mb-2"}>
            <div data-slot="status-event-timeline-title" class="text-foreground text-sm font-medium">
              <span>{updateStatusLabel[update.status] ?? update.status}</span>{" "}
              {changes.length ? (
                <>
                  <span class="text-muted-foreground/70 mx-0.5">·</span>{" "}
                  <ImpactLabel changes={changes} />{" "}
                </>
              ) : null}
              <span class="text-muted-foreground/70 mx-0.5">·</span>{" "}
              <span class="text-muted-foreground font-mono text-xs">
                <RichTs date={date}>{`${fmtDateTimeUTC(date)} (UTC)`}</RichTs>
              </span>{" "}
              {duration ? (
                <span class="text-muted-foreground/70 font-mono text-xs">{duration}</span>
              ) : null}
            </div>
            <div
              data-slot="status-event-timeline-message"
              class="text-muted-foreground py-1.5 font-mono text-sm"
            >
              {update.message.trim() === "" ? (
                <span class="text-muted-foreground/70">-</span>
              ) : (
                <span>{update.message}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MaintenanceEntry({ m, withDot = true }: { m: Maintenance; withDot?: boolean }) {
  const from = new Date(m.startAt);
  const to = new Date(m.endAt);
  const range = maintRange(from, to);
  const dur = strictDistance(Math.abs(to.getTime() - from.getTime()));
  return (
    <div data-slot="status-event-timeline-maintenance" data-variant="maintenance" class="group">
      <div class="flex flex-row items-center justify-between gap-2">
        <div class="flex flex-row gap-4">
          {withDot ? (
            <div class="flex flex-col">
              <div class="flex h-5 flex-col items-center justify-center">
                <div class="size-2.5 shrink-0 rounded-full" style={`background-color:${statusVar.info}`} />
              </div>
            </div>
          ) : null}
          <div>
            <div data-slot="status-event-timeline-title" class="text-foreground text-sm font-medium">
              <span>{m.title}</span>{" "}
              <span class="text-muted-foreground/70">·</span>{" "}
              <span class="text-muted-foreground font-mono text-xs">
                <RichTs date={from}>{range.from}</RichTs>
                {" - "}
                <RichTs date={to}>{range.to}</RichTs>
              </span>{" "}
              {dur ? <span class="text-muted-foreground/70 font-mono text-xs">(for {dur})</span> : null}
            </div>
            <div
              data-slot="status-event-timeline-message"
              class="text-muted-foreground py-1.5 font-mono text-sm"
            >
              {m.message.trim() === "" ? (
                <span class="text-muted-foreground/70">-</span>
              ) : (
                <span>{m.message}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** formatDateRangeParts (UTC): collapses same-day and whole-day ranges. */
function maintRange(from: Date, to: Date): { from: string; to: string } {
  const sameDay =
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth() &&
    from.getUTCDate() === to.getUTCDate();
  if (sameDay) {
    return { from: fmtDateTimeUTC(from), to: `${fmtTimeUTC(to)} (UTC)` };
  }
  const isFromStart =
    from.getUTCHours() === 0 && from.getUTCMinutes() === 0 && from.getUTCSeconds() === 0;
  const isToEnd = to.getUTCHours() === 23 && to.getUTCMinutes() === 59 && to.getUTCSeconds() >= 59;
  if (isFromStart && isToEnd) {
    return { from: fmtDateUTC(from), to: `${fmtDateUTC(to)} (UTC)` };
  }
  return { from: fmtDateTimeUTC(from), to: `${fmtDateTimeUTC(to)} (UTC)` };
}

/** Full report timeline (StatusEventTimelineReport): newest-first, dots + durations. The feed
 *  passes updatesWithImpactChanges, so each update renders its worst-impact label + hover card. */
function ReportTimeline({ report, nameById }: { report: Report; nameById: Map<number, string> }) {
  const updates = [...report.updates].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const n = updates.length;
  return (
    <div data-slot="status-event-timeline-report" class="text-muted-foreground text-sm">
      {updates.map((u, i) => {
        let duration: string | undefined;
        if (i === 0) {
          const started = updates[n - 1];
          const d = strictDistance(Math.abs(Date.parse(u.date) - Date.parse(started.date)));
          if (d !== "0 seconds" && u.status === "resolved") duration = `(in ${d})`;
        } else {
          const prev = updates[i - 1];
          const d = strictDistance(Math.abs(Date.parse(u.date) - Date.parse(prev.date)));
          duration = `(${d} earlier)`;
        }
        return (
          <ReportUpdateEntry
            update={u}
            withDot
            withSeparator={i !== n - 1}
            isLast={i === n - 1}
            duration={duration}
            withImpact
            nameById={nameById}
          />
        );
      })}
    </div>
  );
}

// ── affected-component badges (StatusEventAffected + Badge secondary) ──────────────────
function Affected({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div data-slot="status-event-affected" class="flex flex-wrap gap-1">
      {names.map((n) => (
        <span
          data-slot="status-event-affected-badge"
          class="bg-secondary text-secondary-foreground inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap border border-transparent px-2 py-0.5 text-[10px] font-medium"
        >
          {n}
        </span>
      ))}
    </div>
  );
}

// ── overall / open-event banners (StatusBanner / StatusBannerTabs) ─────────────────────
/** Overall-banner background per status: 20% tint in light, 10% in dark (StatusBanner over
 *  StatusBannerContainer). Static classes so Tailwind emits them. */
const BANNER_BG: Record<Solid, string> = {
  success: "bg-success/20 dark:bg-success/10",
  degraded: "bg-warning/20 dark:bg-warning/10",
  error: "bg-destructive/20 dark:bg-destructive/10",
  info: "bg-info/20 dark:bg-info/10",
};

/** Tab-panel event-banner background per status: 5% tint in light, 10% in dark
 *  (StatusBannerContainer). */
const PANEL_BANNER_BG: Record<Solid, string> = {
  success: "bg-success/5 dark:bg-success/10",
  degraded: "bg-warning/5 dark:bg-warning/10",
  error: "bg-destructive/5 dark:bg-destructive/10",
  info: "bg-info/5 dark:bg-info/10",
};

function Banner({ status }: { status: Status }) {
  const bg = status === "empty" ? "" : BANNER_BG[status];
  return (
    <div
      data-slot="status-banner"
      data-status={status}
      class={`group/status-banner flex items-center gap-3 overflow-hidden rounded-lg border px-3 py-2 sm:px-4 sm:py-3 ${bg}`}
      style={`border-color:${statusVar[status]}`}
    >
      <StatusIcon status={status} size={28} inner={16} />
      <div class="flex flex-1 flex-wrap items-center justify-between gap-2">
        <div class="text-xl font-semibold">{bannerLabel[status]}</div>
        <div class="text-muted-foreground decoration-muted-foreground/30 font-mono text-xs underline decoration-dashed underline-offset-4">
          {fmtBannerTs(new Date())}
        </div>
      </div>
    </div>
  );
}

/** Active-tab background per status (static classes so Tailwind emits them). */
const TAB_BG: Record<Solid, string> = {
  success: "bg-success/50 data-[active=true]:bg-success",
  degraded: "bg-warning/50 data-[active=true]:bg-warning",
  error: "bg-destructive/50 data-[active=true]:bg-destructive",
  info: "bg-info/50 data-[active=true]:bg-info",
};

function BannerTabs({ events }: { events: OpenEvent[] }) {
  return (
    <div data-tabs data-slot="status-banner-tabs" class="flex flex-col gap-0">
      <div class="w-full overflow-x-auto rounded-t-lg">
        <div
          role="tablist"
          class="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-t-lg border-none p-0"
        >
          {events.map((e, i) => (
            <button
              type="button"
              role="tab"
              data-tab={e.key}
              data-active={i === 0 ? "true" : "false"}
              class={`text-foreground data-[active=true]:text-background dark:text-foreground dark:data-[active=true]:text-background focus-visible:border-ring focus-visible:outline-ring focus-visible:ring-ring/50 inline-flex h-9 flex-1 cursor-pointer items-center justify-center whitespace-nowrap border-none px-2 py-1 font-mono text-sm font-medium transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 focus-visible:ring-inset ${TAB_BG[e.status]}`}
            >
              {e.name}
            </button>
          ))}
        </div>
      </div>
      {events.map((e, i) => (
        <div data-panel={e.key} hidden={i !== 0} class="-mx-3">
          <a
            href={e.href}
            class="focus-visible:ring-ring/50 block rounded-lg text-inherit no-underline outline-none focus-visible:ring-[3px]"
          >
            <div
              data-slot="status-banner"
              data-status={e.status}
              class={`group/status-banner overflow-hidden rounded-lg border ${PANEL_BANNER_BG[e.status]}`}
              style={`border-color:${statusVar[e.status]}`}
            >
              <div class="flex flex-col gap-2 px-3 py-2 sm:px-4 sm:py-3">
                {e.kind === "report" ? (
                  <ReportUpdateEntry update={e.report.updates[0]} withDot={false} withSeparator={false} isLast />
                ) : (
                  <MaintenanceEntry m={e.m} withDot={false} />
                )}
                <Affected names={e.affected} />
              </div>
            </div>
          </a>
        </div>
      ))}
    </div>
  );
}

// ── components (StatusComponent / StatusComponentGroup) ────────────────────────────────
function DescriptionInfo({ text }: { text: string }) {
  return (
    <span class="group/desc relative inline-flex">
      <button type="button" aria-label="Details" class="inline-flex rounded-full">
        <Icon path={ICONS.info} size={16} cls="text-muted-foreground" />
      </button>
      <span class="bg-primary text-primary-foreground pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-30 hidden w-max max-w-[16rem] -translate-x-1/2 px-3 py-1.5 text-xs shadow-md group-hover/desc:block">
        {text}
      </span>
    </span>
  );
}

function ComponentCard({ c, board }: { c: Component; board: StatusBoard }) {
  const status = c.monitorStatus;
  const rawDays = c.monitorId != null ? (board.uptime[c.monitorId] ?? []) : [];
  // Attach this component's reports/maintenances/incident to each day so the uptime bar's
  // hover-card EVENT section renders (the plain ok/total fields still drive uptimePercent).
  const days = withDayEvents(rawDays, {
    componentId: c.id,
    reports: board.reports,
    maintenances: board.maintenances,
    incident: c.openIncident,
  });
  const pct = uptimePercent(days);
  const showUptime = board.page.showUptime;

  return (
    <div data-slot="status-component" data-variant={status} class="group/component space-y-2">
      <div data-slot="status-component-header" class="flex items-center justify-between">
        <div data-slot="status-component-header-left" class="flex items-center gap-2">
          <div
            data-slot="status-component-title"
            class="text-foreground truncate font-mono text-base leading-5 font-medium"
          >
            {c.name}
          </div>
          {c.description ? <DescriptionInfo text={c.description} /> : null}
        </div>
        <div data-slot="status-component-header-right" class="flex items-center gap-3">
          {showUptime ? (
            <>
              <div
                data-slot="status-component-uptime"
                class="text-foreground/80 font-mono text-sm leading-none"
              >
                {pct != null ? fmtPct(pct) : ""}
              </div>
              <StatusIcon status={status} size={12.5} />
            </>
          ) : (
            <div
              data-slot="status-component-status"
              class={`font-mono text-sm leading-none ${statusText[status]}`}
            >
              {componentLabel[status]}
            </div>
          )}
        </div>
      </div>
      <div data-slot="status-component-body" class="space-y-2">
        <UptimeBar days={days} />
        <div
          data-slot="status-component-footer"
          class="text-muted-foreground flex flex-row items-center justify-between font-mono text-xs leading-none"
        >
          <div>{days.length > 0 ? `${days.length} day${days.length !== 1 ? "s" : ""} ago` : "-"}</div>
          <div>Today</div>
        </div>
      </div>
    </div>
  );
}

function Group({ item, board }: { item: GroupTracker; board: StatusBoard }) {
  const status = aggregate(item.comps);
  const open = status === "error" || status === "degraded" || status === "info";
  return (
    <div>
      <details
        open={open}
        data-slot="status-component-group"
        class="bg-muted/50 hover:border-border/50 open:border-border/50 open:bg-muted/50 -mx-3 rounded-lg border border-transparent"
      >
        <summary
          data-slot="status-component-group-trigger"
          data-variant={status}
          aria-label={`Toggle ${item.g.name} status details`}
          class="group/component flex w-full cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 font-mono font-medium [&::-webkit-details-marker]:hidden"
        >
          {item.g.name}
          <div class="flex items-center gap-2">
            <span class={`font-mono text-sm leading-none ${statusText[status]}`}>
              {componentLabel[status]}
            </span>
            <StatusIcon status={status} size={12.5} />
          </div>
        </summary>
        <div
          data-slot="status-component-group-content"
          class="border-border/50 flex flex-col gap-3 overflow-hidden border-t px-3 py-2"
        >
          {item.comps.map((c) => (
            <ComponentCard c={c} board={board} />
          ))}
        </div>
      </details>
    </div>
  );
}

// ── recent events feed (StatusFeed) ───────────────────────────────────────────────────
function EventAside({ date }: { date: Date }) {
  const isFuture = date.getTime() > Date.now();
  return (
    <div
      data-slot="status-event-aside"
      class="border border-transparent lg:absolute lg:top-0 lg:-left-32 lg:h-full"
    >
      <div class="lg:sticky lg:top-0 lg:left-0">
        <div data-slot="status-event-date" class="flex gap-2 lg:flex-col">
          <div class="text-foreground font-medium">{fmtDateShortUTC(date)}</div>{" "}
          <span
            class={`inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap border border-transparent px-2 py-0.5 text-[10px] font-medium ${
              isFuture ? "bg-info text-background dark:text-foreground" : "bg-secondary text-secondary-foreground"
            }`}
          >
            {relative(date)}
          </span>
        </div>
      </div>
    </div>
  );
}

function BlankEvents() {
  return (
    <div class="bg-muted/30 flex flex-col items-center justify-center gap-2.5 rounded-lg border px-3 py-8 text-center sm:px-8 sm:py-12">
      <div class="space-y-1">
        <div class="font-medium">No recent notifications</div>
        <div class="text-muted-foreground font-mono text-sm">
          There have been no reports within the last 7 days.
        </div>
      </div>
      <div class="border-border/70 text-muted-foreground hover:border-border hover:text-foreground mt-2 inline-flex items-center justify-center rounded-md border px-3 py-1.5 font-mono text-sm">
        <a href="/events" class="text-inherit no-underline">
          View events history
        </a>
      </div>
    </div>
  );
}

type FeedItem =
  | { kind: "report"; key: string; start: number; report: Report; affected: string[] }
  | { kind: "maintenance"; key: string; start: number; m: Maintenance };

function Feed({ board }: { board: StatusBoard }) {
  const nameById = new Map(board.components.map((c) => [c.id, c.name]));
  const items: FeedItem[] = [
    ...board.reports
      .filter((r) => r.updates.length > 0)
      .map<FeedItem>((r) => ({
        kind: "report",
        key: `report-${r.id}`,
        start: Date.parse(r.updates[r.updates.length - 1].date),
        report: r,
        affected: reportAffected(r, nameById),
      })),
    ...board.maintenances.map<FeedItem>((m) => ({
      kind: "maintenance",
      key: `maintenance-${m.id}`,
      start: Date.parse(m.startAt),
      m,
    })),
  ].sort((a, b) => b.start - a.start);

  if (items.length === 0) return <BlankEvents />;

  return (
    <>
      <div
        data-slot="status-event-group"
        role="feed"
        aria-label="Status events and updates"
        class="flex flex-col gap-4"
      >
        {items.map((it) => {
          if (it.kind === "report") {
            const r = it.report;
            return (
              <div data-slot="status-event" class="relative flex flex-col gap-2">
                <EventAside date={new Date(it.start)} />
                <a
                  href={`/events/report/${r.id}`}
                  class="focus-visible:ring-ring/50 block rounded-lg text-inherit no-underline outline-none focus-visible:ring-[3px]"
                >
                  <div class="group hover:border-border/50 hover:bg-muted/50 -mx-3 -my-2 flex flex-col gap-2 rounded-lg border border-transparent px-3 py-2 hover:cursor-pointer">
                    <div data-slot="status-event-title" class="font-medium">
                      {r.title}
                    </div>
                    <Affected names={it.affected} />
                    <ReportTimeline report={r} nameById={nameById} />
                  </div>
                </a>
              </div>
            );
          }
          const m = it.m;
          return (
            <div data-slot="status-event" class="relative flex flex-col gap-2">
              <EventAside date={new Date(it.start)} />
              <a
                href={`/events/maintenance/${m.id}`}
                class="focus-visible:ring-ring/50 block rounded-lg text-inherit no-underline outline-none focus-visible:ring-[3px]"
              >
                <div class="group hover:border-border/50 hover:bg-muted/50 -mx-3 -my-2 flex flex-col gap-2 rounded-lg border border-transparent px-3 py-2 hover:cursor-pointer">
                  <div data-slot="status-event-title" class="font-medium">
                    {m.title}
                  </div>
                  <MaintenanceEntry m={m} withDot />
                </div>
              </a>
            </div>
          );
        })}
      </div>
      <a
        href="/events"
        class="focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 text-foreground mx-auto mt-4 inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium whitespace-nowrap no-underline shadow-xs transition-all outline-none focus-visible:ring-[3px] has-[>svg]:px-2.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
      >
        View events history
      </a>
    </>
  );
}

// ── data derivation ───────────────────────────────────────────────────────────────────
type ComponentTracker = { order: number; type: "component"; c: Component };
type GroupTracker = { order: number; type: "group"; g: ComponentGroup; comps: Component[] };
type Tracker = ComponentTracker | GroupTracker;

/** Ordered list of top-level components and groups (each with its members). */
function buildTrackers(board: StatusBoard): Tracker[] {
  const byGroup = new Map<number, Component[]>();
  const items: Tracker[] = [];
  for (const c of board.components) {
    if (c.groupId == null) items.push({ order: c.order, type: "component", c });
    else {
      if (!byGroup.has(c.groupId)) byGroup.set(c.groupId, []);
      byGroup.get(c.groupId)!.push(c);
    }
  }
  for (const g of board.groups) {
    items.push({ order: g.order, type: "group", g, comps: byGroup.get(g.id) ?? [] });
  }
  return items.sort((a, b) => a.order - b.order);
}

/** Worst-wins aggregate for a group header. */
function aggregate(comps: Component[]): Status {
  const s = comps.map((c) => c.monitorStatus);
  if (s.includes("error")) return "error";
  if (s.includes("degraded")) return "degraded";
  if (s.includes("info")) return "info";
  if (s.length && s.every((x) => x === "empty")) return "empty";
  return "success";
}

/** Signal color for an open report (from its latest update's worst impact). */
function reportStatus(r: Report): Solid {
  const latest = r.updates[0];
  let s: Solid = "degraded";
  for (const c of latest?.components ?? []) {
    if (c.impact === "major_outage" || c.impact === "partial_outage") return "error";
    if (c.impact === "degraded_performance") s = "degraded";
  }
  return s;
}

function reportAffected(r: Report, nameById: Map<number, string>): string[] {
  const ids = new Set<number>();
  for (const u of r.updates) for (const c of u.components) ids.add(c.componentId);
  return [...ids].map((id) => nameById.get(id) ?? `Component ${id}`);
}

type OpenEvent = {
  key: string;
  href: string;
  name: string;
  status: Solid;
  affected: string[];
  start: number;
} & ({ kind: "report"; report: Report } | { kind: "maintenance"; m: Maintenance });

/** Open reports + in-window maintenances, newest-first, for the tabbed banner. */
function openEvents(board: StatusBoard): OpenEvent[] {
  const nameById = new Map(board.components.map((c) => [c.id, c.name]));
  const now = Date.now();
  const out: OpenEvent[] = [];
  for (const r of board.reports) {
    if (r.status === "resolved" || r.updates.length === 0) continue;
    out.push({
      kind: "report",
      key: `report-${r.id}`,
      href: `/events/report/${r.id}`,
      name: r.title,
      status: reportStatus(r),
      affected: reportAffected(r, nameById),
      start: Date.parse(r.updatedAt),
      report: r,
    });
  }
  for (const m of board.maintenances) {
    if (Date.parse(m.startAt) <= now && now <= Date.parse(m.endAt)) {
      out.push({
        kind: "maintenance",
        key: `maintenance-${m.id}`,
        href: `/events/maintenance/${m.id}`,
        name: m.title,
        status: "info",
        affected: m.componentIds.map((id) => nameById.get(id) ?? `Component ${id}`),
        start: Date.parse(m.startAt),
        m,
      });
    }
  }
  return out.sort((a, b) => b.start - a.start);
}

// ── page ──────────────────────────────────────────────────────────────────────────────
export function Board({ board }: { board: StatusBoard }) {
  const events = openEvents(board);
  const trackers = buildTrackers(board);
  return (
    <div class="flex flex-col gap-6">
      <div data-slot="status" data-variant={board.overall} class="group peer flex flex-col gap-8">
        <div data-slot="status-header" class="@container/status-header">
          <div data-slot="status-title" class="text-foreground text-lg leading-none font-semibold">
            {board.page.title}
          </div>
          <div data-slot="status-description" class="text-muted-foreground">
            {board.page.description}
          </div>
        </div>

        {events.length > 0 ? (
          <div data-slot="status-content" class="flex flex-col gap-3">
            <BannerTabs events={events} />
          </div>
        ) : (
          <Banner status={board.overall} />
        )}

        {trackers.length > 0 ? (
          <div data-slot="status-content" class="flex flex-col gap-5">
            {trackers.map((t) =>
              t.type === "component" ? <ComponentCard c={t.c} board={board} /> : <Group item={t} board={board} />,
            )}
          </div>
        ) : null}

        <div role="none" class="bg-border h-px w-full shrink-0" />

        <div data-slot="status-content" class="flex flex-col gap-3">
          <Feed board={board} />
        </div>
      </div>
      <script>{raw(RICH_TS_SCRIPT)}</script>
    </div>
  );
}
