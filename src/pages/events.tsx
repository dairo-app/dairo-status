/** The events history: a two-column timeline of incident reports and maintenance windows,
 *  plus the single-event detail views. Segmented Reports/Maintenances tabs (driven by the
 *  shared data-tabs engine in ui/layout), a left date aside (absolute on lg), and a fully
 *  expanded update timeline with colored dots, connector lines, dashed-underline impacts and
 *  monospace messages. Pure server-rendered — no hooks, no hydration. */
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import type { Env, Maintenance, Page, Report, ReportUpdate } from "../types";
import { Icon, impactLabel, updateStatusLabel } from "../ui/status";

// ── Local icon paths (not in the shared set) ──────────────────────────────────────────
const CHECK = '<path d="M20 6 9 17l-5-5"/>';
const ARROW_LEFT = '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>';
// lucide: copy — the detail-header "Copy Link" button.
const COPY_ICON =
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>';

// ── Button chrome (mirrors the shared cva `buttonVariants`, kept local to this file) ──
const BTN_BASE =
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
const BTN_OUTLINE =
  "bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 border shadow-xs";

// ── Impact color + ordering (mirrors the worst-impact comparison in the source) ───────
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

// ── UTC date formatting (matches the source's Intl calls) ─────────────────────────────
function rawDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    timeZone: "UTC",
  });
}
function rawDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
function rawDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function rawTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "numeric",
    timeZone: "UTC",
  });
}
/** Timestamps render in UTC; the suffix tells viewers which zone. */
const fmtDateTime = (iso: string) => `${rawDateTime(iso)} (UTC)`;

/** date-fns formatDistanceStrict, replicated (UTC worker → no DST normalization needed). */
function distStrict(a: string | Date, b: string | Date, addSuffix = false): string {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  const diff = da.getTime() - db.getTime();
  const comparison = diff < 0 ? -1 : diff > 0 ? 1 : 0;
  const left = comparison > 0 ? db : da;
  const right = comparison > 0 ? da : db;
  const ms = right.getTime() - left.getTime();
  const minutes = ms / 60000;

  let count: number;
  let word: string;
  if (minutes < 1) {
    count = Math.round(ms / 1000);
    word = "second";
  } else if (minutes < 60) {
    count = Math.round(minutes);
    word = "minute";
  } else if (minutes < 1440) {
    count = Math.round(minutes / 60);
    word = "hour";
  } else if (minutes < 43200) {
    count = Math.round(minutes / 1440);
    word = "day";
  } else if (minutes < 525600) {
    count = Math.round(minutes / 43200);
    if (count === 12) {
      count = 1;
      word = "year";
    } else {
      word = "month";
    }
  } else {
    count = Math.round(minutes / 525600);
    word = "year";
  }
  let result = `${count} ${word}${count === 1 ? "" : "s"}`;
  if (addSuffix) result = comparison > 0 ? `in ${result}` : `${result} ago`;
  return result;
}

/** Start/end range parts, collapsing to time-only or full-day where the source does. The
 *  `to` side always carries the "(UTC)" suffix; the `from` side never does. */
function dateRangeParts(fromIso: string, toIso: string): { from: string; to: string } {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const sameDay =
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth() &&
    from.getUTCDate() === to.getUTCDate();
  const isFromStartDay =
    from.getUTCHours() === 0 &&
    from.getUTCMinutes() === 0 &&
    from.getUTCSeconds() === 0 &&
    from.getUTCMilliseconds() === 0;
  const isToEndDay =
    to.getUTCHours() === 23 &&
    to.getUTCMinutes() === 59 &&
    to.getUTCSeconds() === 59 &&
    to.getUTCMilliseconds() === 999;
  if (sameDay) return { from: rawDateTime(fromIso), to: `${rawTime(toIso)} (UTC)` };
  if (isFromStartDay && isToEndDay)
    return { from: rawDateFull(fromIso), to: `${rawDateFull(toIso)} (UTC)` };
  return { from: rawDateTime(fromIso), to: `${rawDateTime(toIso)} (UTC)` };
}

// ── Timestamp hover card (rich variant: local-TZ / UTC / relative rows) ───────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => (n < 10 ? "0" : "") + n;
/** SSR fallback for the hover-card value: "LLL dd, y HH:mm:ss" in UTC (the client script
 *  re-fills the local-TZ + relative rows, mirroring the source's rich StatusTimestamp). */
function rawDateTimeFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCDate())}, ${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

// Fills every timestamp hover card: local-TZ time + timezone label + live relative time
// (re-rendered each second), matching the rich StatusTimestamp. Additive; runs after the
// timeline markup exists in the DOM.
const TS_HOVER_SCRIPT = `(function(){try{var M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];function p(n){return(n<10?'0':'')+n;}function f(d){return M[d.getMonth()]+' '+p(d.getDate())+', '+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());}function rel(d){var s=Math.round((Date.now()-d.getTime())/1000),neg=s<0,a=Math.abs(s),U=[['year',31536000],['month',2592000],['day',86400],['hour',3600],['minute',60],['second',1]];for(var i=0;i<U.length;i++){var v=Math.floor(a/U[i][1]);if(v>=1||i===U.length-1){var w=v+' '+U[i][0]+(v!==1?'s':'');return neg?'in '+w:w+' ago';}}return 'now';}var tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';function tick(){document.querySelectorAll('[data-tshc]').forEach(function(c){var ms=+c.getAttribute('data-ts-ms');if(!ms)return;var d=new Date(ms);var lo=c.querySelector('[data-ts-local]');if(lo)lo.textContent=f(d);var la=c.querySelector('[data-ts-tzlabel]');if(la)la.textContent=tz;var r=c.querySelector('[data-ts-rel]');if(r)r.textContent=rel(d);});}tick();setInterval(tick,1000);}catch(e){}})();`;

// Clicking a row copies its value; the copy glyph is revealed on row hover.
const TS_ROW_COPY = "var v=this.querySelector('[data-tsval]');if(v&&navigator.clipboard)navigator.clipboard.writeText(v.textContent)";

/** One row of the timestamp hover card: muted label + mono value with a hover-revealed copy icon. */
function TsHoverRow({
  label,
  valueKind,
  labelDynamic,
  value,
}: {
  label: string;
  valueKind: "local" | "utc" | "rel";
  labelDynamic?: boolean;
  value: string;
}) {
  return (
    <span class="group/tsr flex items-center justify-between gap-4 text-sm" onclick={TS_ROW_COPY}>
      {labelDynamic ? (
        <span class="text-muted-foreground" data-ts-tzlabel="">
          {label}
        </span>
      ) : (
        <span class="text-muted-foreground">{label}</span>
      )}
      <span class="flex items-center gap-1 truncate font-sans">
        <span class="invisible group-hover/tsr:visible">
          <Icon path={COPY_ICON} size={12} />
        </span>
        {valueKind === "local" ? (
          <span data-tsval="" data-ts-local="">
            {value}
          </span>
        ) : valueKind === "utc" ? (
          <span data-tsval="" data-ts-utc="">
            {value}
          </span>
        ) : (
          <span data-tsval="" data-ts-rel="">
            {value}
          </span>
        )}
      </span>
    </span>
  );
}

/** Wraps a timeline timestamp in a CSS hover-card trigger (mirrors the rich StatusTimestamp):
 *  the trigger keeps the surrounding mono styling; the popover lists local-TZ / UTC / relative. */
function TimestampHover({ iso, children }: { iso: string; children: Child }) {
  const utc = rawDateTimeFull(iso);
  const ms = new Date(iso).getTime();
  return (
    <span class="group/ts relative inline-block" data-tshc="" data-ts-ms={String(ms)}>
      <span>{children}</span>
      <span class="bg-popover text-popover-foreground absolute top-full left-0 z-10 mt-1 hidden w-auto flex-col gap-1 rounded-md border p-2 shadow-md outline-hidden group-hover/ts:flex">
        <TsHoverRow label="UTC" valueKind="local" labelDynamic value={utc} />
        <TsHoverRow label="UTC" valueKind="utc" value={utc} />
        <TsHoverRow label="Relative" valueKind="rel" value="—" />
      </span>
    </span>
  );
}

// ── Markdown → HTML (server-side; mirrors the source's remark/rehype ProcessMessage) ──
const MD_A = "focus-visible:ring-ring/50 rounded-sm underline outline-none focus-visible:ring-[3px]";
const MD_UL = "marker:text-muted-foreground/50 list-inside list-disc";
const MD_OL = "marker:text-muted-foreground/50 list-inside list-decimal";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline markdown on an already-escaped string: code, links, bold, italic. Code spans and
 *  links are stashed so their contents aren't re-formatted. */
function mdInline(s: string): string {
  const tokens: string[] = [];
  // NOTE: stash() wraps each index in an invisible U+E000 (private-use) sentinel — it can't
  // occur in the already-escaped text, so restoring never collides with real digits.
  const stash = (html: string) => `${tokens.push(html) - 1}`;
  s = s.replace(/`([^`]+)`/g, (_m, c) => stash(`<code>${c}</code>`));
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, text, url) => stash(`<a target="_blank" rel="noreferrer" class="${MD_A}" href="${url}">${text}</a>`),
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  s = s.replace(/(\d+)/g, (_m, i) => tokens[Number(i)]);
  return s;
}

/** Minimal CommonMark-ish block renderer (headings, lists, blockquotes, paragraphs). All
 *  text is HTML-escaped first, so the raw() emit is injection-safe. */
function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const isUl = (l: string) => /^\s*[-*+]\s+/.test(l);
  const isOl = (l: string) => /^\s*\d+\.\s+/.test(l);
  const isQuote = (l: string) => /^\s*>\s?/.test(l);
  const isHead = (l: string) => /^(#{1,6})\s+/.test(l);
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      html += `<h${lvl}>${mdInline(escapeHtml(h[2].trim()))}</h${lvl}>`;
      i++;
      continue;
    }
    if (isQuote(line)) {
      const buf: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      html += `<blockquote>${mdInline(escapeHtml(buf.join(" ")))}</blockquote>`;
      continue;
    }
    if (isUl(line)) {
      const items: string[] = [];
      while (i < lines.length && isUl(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      html += `<ul class="${MD_UL}">${items.map((it) => `<li>${mdInline(escapeHtml(it))}</li>`).join("")}</ul>`;
      continue;
    }
    if (isOl(line)) {
      const items: string[] = [];
      while (i < lines.length && isOl(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      html += `<ol class="${MD_OL}">${items.map((it) => `<li>${mdInline(escapeHtml(it))}</li>`).join("")}</ol>`;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isHead(lines[i]) &&
      !isQuote(lines[i]) &&
      !isUl(lines[i]) &&
      !isOl(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    html += `<p>${mdInline(escapeHtml(para.join("\n")))}</p>`;
  }
  return html;
}

// ── Small building blocks ─────────────────────────────────────────────────────────────
const BADGE_SECONDARY =
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] [&>svg]:pointer-events-none [&>svg]:size-3 bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90 border-transparent";

/** Secondary badge (affected-component chips + the relative date badge). */
function AffectedBadge({ name }: { name: string }) {
  return <span class={`${BADGE_SECONDARY} text-[10px]`}>{name}</span>;
}

/** Left-column date: short date + a relative-distance badge (info-tinted when future). */
function EventDate({ iso }: { iso: string }) {
  const isFuture = new Date(iso).getTime() > Date.now();
  const distance = distStrict(iso, new Date(), true);
  return (
    <div class="flex gap-2 lg:flex-col">
      <div class="text-foreground font-medium">{rawDateShort(iso)}</div>{" "}
      <span
        class={`${BADGE_SECONDARY} text-[10px] ${
          isFuture ? "bg-info text-background dark:text-foreground" : ""
        }`}
      >
        {distance}
      </span>
    </div>
  );
}

/** Date aside — inline above the content on mobile, absolutely offset to the left on lg. */
function EventAside({ iso }: { iso: string }) {
  return (
    <div class="border border-transparent lg:absolute lg:top-0 lg:-left-32 lg:h-full">
      <div class="lg:sticky lg:top-0 lg:left-0">
        <EventDate iso={iso} />
      </div>
    </div>
  );
}

/** Resolved indicator shown next to a report title — a hover tooltip (mirrors the source's
 *  Radix Tooltip: a trigger button wrapping the badge + a styled "Report resolved" bubble). */
function TitleCheck() {
  return (
    <div class="flex items-center pl-1">
      <button type="button" aria-label="Report resolved" class="group relative inline-flex">
        <div class="border-success/20 bg-success/10 text-success rounded-full border p-0.5">
          <Icon path={CHECK} size={12} cls="size-3 shrink-0" />
        </div>
        <span
          role="tooltip"
          class="bg-primary text-primary-foreground pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 hidden w-fit -translate-x-1/2 rounded-md px-3 py-1.5 text-xs text-balance whitespace-nowrap group-hover:block"
        >
          Report resolved
        </span>
      </button>
    </div>
  );
}

/** Colored status dot for a timeline row (color comes from the group's data-variant). */
function TimelineDot() {
  return (
    <div class="bg-muted size-2.5 shrink-0 rounded-full group-data-[variant=resolved]:bg-success group-data-[variant=monitoring]:bg-info group-data-[variant=identified]:bg-warning group-data-[variant=investigating]:bg-destructive group-data-[variant=maintenance]:bg-info" />
  );
}

/** Vertical connector between timeline rows (same color mapping as the dot). */
function TimelineSeparator() {
  return (
    <div
      data-orientation="vertical"
      class="bg-border shrink-0 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px mx-auto flex-1 group-data-[variant=resolved]:bg-success group-data-[variant=monitoring]:bg-info group-data-[variant=identified]:bg-warning group-data-[variant=investigating]:bg-destructive group-data-[variant=maintenance]:bg-info"
    />
  );
}

/** Worst-impact label with a CSS hover card listing every component's explicit impact. */
function ImpactLabel({ changes }: { changes: { name: string; impact: string }[] }) {
  const worst = worstImpact(changes.map((c) => c.impact));
  return (
    <span class="group/impact relative inline-block">
      <button
        type="button"
        class={`decoration-muted-foreground/30 hover:decoration-muted-foreground/60 font-sans text-xs font-medium underline decoration-dashed underline-offset-4 ${impactText[worst]}`}
      >
        {impactLabel[worst] ?? worst}
      </button>
      <span class="bg-popover text-popover-foreground pointer-events-none absolute top-full left-0 z-50 mt-1 hidden w-auto min-w-48 flex-col gap-1.5 border p-3 shadow-md group-hover/impact:flex">
        {changes.map((change) => (
          <span class="flex items-center justify-between gap-4 text-xs">
            <span class="truncate">{change.name}</span>
            <span class={`shrink-0 font-sans ${impactText[change.impact] ?? ""}`}>
              {impactLabel[change.impact] ?? change.impact}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** The monospace message block (or a dash when empty). */
function TimelineMessage({ message }: { message: string }) {
  return (
    <div class="text-muted-foreground py-1.5 font-sans text-sm">
      {message.trim() === "" ? (
        <span class="text-muted-foreground/70">-</span>
      ) : (
        <div class="prose dark:prose-invert prose-sm max-w-none">{raw(renderMarkdown(message))}</div>
      )}
    </div>
  );
}

// ── Report timeline ───────────────────────────────────────────────────────────────────
function ReportUpdateRow({
  update,
  names,
  duration,
  withSeparator,
  isLast,
}: {
  update: ReportUpdate;
  names: Record<number, string>;
  duration?: string;
  withSeparator: boolean;
  isLast: boolean;
}) {
  const changes = update.components.map((c) => ({
    name: names[c.componentId] ?? `#${c.componentId}`,
    impact: c.impact,
  }));
  return (
    <div data-variant={update.status} class="group">
      <div class="flex flex-row items-center justify-between gap-2">
        <div class="flex flex-row gap-4">
          <div class="flex flex-col">
            <div class="flex h-5 flex-col items-center justify-center">
              <TimelineDot />
            </div>
            {withSeparator ? <TimelineSeparator /> : null}
          </div>
          <div class={isLast ? "mb-0" : "mb-2"}>
            <div class="text-foreground text-sm font-medium">
              <span>{updateStatusLabel[update.status] ?? update.status}</span>{" "}
              {changes.length ? (
                <>
                  <span class="text-muted-foreground/70 mx-0.5">·</span>{" "}
                  <ImpactLabel changes={changes} />{" "}
                </>
              ) : null}
              <span class="text-muted-foreground/70 mx-0.5">·</span>{" "}
              <span class="text-muted-foreground font-sans text-xs">
                <TimestampHover iso={update.date}>{fmtDateTime(update.date)}</TimestampHover>
              </span>{" "}
              {duration ? (
                <span class="text-muted-foreground/70 font-sans text-xs">{duration}</span>
              ) : null}
            </div>
            <TimelineMessage message={update.message} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportTimeline({
  updates,
  names,
}: {
  updates: ReportUpdate[];
  names: Record<number, string>;
}) {
  const sorted = [...updates].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const startDate = sorted.length ? sorted[sorted.length - 1].date : "";
  return (
    <div class="text-muted-foreground text-sm">
      {sorted.map((update, index) => {
        let duration: string | undefined;
        if (index === 0) {
          const d = distStrict(startDate, update.date);
          if (d !== "0 seconds" && update.status === "resolved") duration = `(in ${d})`;
        } else {
          const d = distStrict(update.date, sorted[index - 1].date);
          duration = `(${d} earlier)`;
        }
        return (
          <ReportUpdateRow
            update={update}
            names={names}
            duration={duration}
            withSeparator={index !== sorted.length - 1}
            isLast={index === sorted.length - 1}
          />
        );
      })}
    </div>
  );
}

// ── Maintenance timeline (single, always-last entry) ──────────────────────────────────
function MaintenanceTimeline({ maintenance }: { maintenance: Maintenance }) {
  const duration = distStrict(maintenance.startAt, maintenance.endAt);
  const { from, to } = dateRangeParts(maintenance.startAt, maintenance.endAt);
  return (
    <div data-variant="maintenance" class="group">
      <div class="flex flex-row items-center justify-between gap-2">
        <div class="flex flex-row gap-4">
          <div class="flex flex-col">
            <div class="flex h-5 flex-col items-center justify-center">
              <TimelineDot />
            </div>
          </div>
          <div>
            <div class="text-foreground text-sm font-medium">
              <span>{maintenance.title}</span>{" "}
              <span class="text-muted-foreground/70">·</span>{" "}
              <span class="text-muted-foreground font-sans text-xs">
                <TimestampHover iso={maintenance.startAt}>{from}</TimestampHover>
                {" - "}
                <TimestampHover iso={maintenance.endAt}>{to}</TimestampHover>
              </span>{" "}
              {duration ? (
                <span class="text-muted-foreground/70 font-sans text-xs">{`(for ${duration})`}</span>
              ) : null}
            </div>
            <TimelineMessage message={maintenance.message} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Affected-component helpers ────────────────────────────────────────────────────────
/** Distinct component ids touched across a report's updates, mapped to display names. */
function reportAffected(report: Report, names: Record<number, string>): string[] {
  const seen = new Set<number>();
  const out: string[] = [];
  for (const u of report.updates) {
    for (const c of u.components) {
      if (!seen.has(c.componentId)) {
        seen.add(c.componentId);
        out.push(names[c.componentId] ?? `#${c.componentId}`);
      }
    }
  }
  return out;
}

/** Oldest update's date (the incident start), else the report's created time. */
function reportStart(report: Report): string {
  const sorted = [...report.updates].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return sorted.length ? sorted[sorted.length - 1].date : report.createdAt;
}

/** LEGACY: report marked resolved but its latest update isn't a resolved one. */
function reportResolvedOnly(report: Report): boolean {
  const sorted = [...report.updates].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return report.status === "resolved" && sorted[0]?.status !== "resolved";
}

// ── Empty state ───────────────────────────────────────────────────────────────────────
function BlankEvents({ title, description }: { title: string; description: string }) {
  return (
    <div class="bg-muted/30 flex flex-col items-center justify-center gap-2.5 rounded-lg border px-3 py-8 text-center sm:px-8 sm:py-12">
      <div class="space-y-1">
        <div class="font-medium">{title}</div>
        <div class="text-muted-foreground font-sans text-sm">{description}</div>
      </div>
    </div>
  );
}

// ── Event rows (shared by list + detail) ──────────────────────────────────────────────
const EVENT_CONTENT =
  "group -mx-3 -my-2 flex flex-col gap-2 rounded-lg border border-transparent px-3 py-2 data-[hoverable=true]:hover:border-border/50 data-[hoverable=true]:hover:bg-muted/50 data-[hoverable=true]:hover:cursor-pointer";

function ReportEvent({
  report,
  names,
  href,
  hoverable,
}: {
  report: Report;
  names: Record<number, string>;
  href?: string;
  hoverable: boolean;
}) {
  const affected = reportAffected(report, names);
  const content = (
    <div data-hoverable={hoverable ? "true" : "false"} class={EVENT_CONTENT}>
      <div class="font-medium inline-flex gap-1">
        {report.title}
        {reportResolvedOnly(report) ? <TitleCheck /> : null}
      </div>
      {affected.length > 0 ? (
        <div class="flex flex-wrap gap-1">
          {affected.map((name) => (
            <AffectedBadge name={name} />
          ))}
        </div>
      ) : null}
      <ReportTimeline updates={report.updates} names={names} />
    </div>
  );
  return (
    <div class="relative flex flex-col gap-2">
      <EventAside iso={reportStart(report)} />
      {href ? (
        <a href={href} class="rounded-lg">
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  );
}

function MaintenanceEvent({
  maintenance,
  names,
  href,
  hoverable,
  alwaysAffected,
}: {
  maintenance: Maintenance;
  names: Record<number, string>;
  href?: string;
  hoverable: boolean;
  alwaysAffected: boolean;
}) {
  const affected = maintenance.componentIds.map((id) => names[id] ?? `#${id}`);
  const showAffected = alwaysAffected || affected.length > 0;
  const content = (
    <div data-hoverable={hoverable ? "true" : "false"} class={EVENT_CONTENT}>
      <div class="font-medium">{maintenance.title}</div>
      {showAffected ? (
        <div class="flex flex-wrap gap-1">
          {affected.map((name) => (
            <AffectedBadge name={name} />
          ))}
        </div>
      ) : null}
      <MaintenanceTimeline maintenance={maintenance} />
    </div>
  );
  return (
    <div class="relative flex flex-col gap-2">
      <EventAside iso={maintenance.startAt} />
      {href ? (
        <a href={href} class="rounded-lg">
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  );
}

// ── Detail back link ──────────────────────────────────────────────────────────────────
function BackLink() {
  return (
    <div class="flex w-full flex-row items-center justify-between gap-2 py-0.5">
      <a
        href="/events"
        class="text-muted-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all outline-none has-[>svg]:px-2.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive disabled:pointer-events-none disabled:opacity-50"
      >
        <Icon path={ARROW_LEFT} size={16} />
        Back
      </a>
      <button
        type="button"
        onclick="navigator.clipboard&&navigator.clipboard.writeText(location.href);var b=this,c=b.querySelector('[data-copy]'),k=b.querySelector('[data-check]');if(c&&k){c.classList.add('hidden');k.classList.remove('hidden');clearTimeout(b._t);b._t=setTimeout(function(){c.classList.remove('hidden');k.classList.add('hidden');},2000);}"
        class={`${BTN_BASE} ${BTN_OUTLINE} size-8`}
      >
        <span data-copy>
          <Icon path={COPY_ICON} size={16} />
        </span>
        <span data-check class="hidden">
          <Icon path={CHECK} size={16} />
        </span>
        <span class="sr-only">Copy Link</span>
      </button>
    </div>
  );
}

// ── Page header (title + description) ─────────────────────────────────────────────────
function EventsHeader({ page }: { page: Page }) {
  return (
    <div class="@container/status-header">
      <div class="text-foreground text-lg leading-none font-semibold">{page.title}</div>
      <div class="text-muted-foreground">{page.description}</div>
    </div>
  );
}

const TAB_TRIGGER =
  "text-foreground focus-visible:border-ring focus-visible:outline-ring focus-visible:ring-ring/50 data-[active=true]:bg-background dark:text-muted-foreground dark:data-[active=true]:border-input dark:data-[active=true]:bg-input/30 dark:data-[active=true]:text-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[active=true]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

// ── Exports ───────────────────────────────────────────────────────────────────────────
export function EventsPage({
  page,
  reports,
  maintenances,
  names,
}: {
  env: Env;
  page: Page;
  reports: Report[];
  maintenances: Maintenance[];
  names: Record<number, string>;
}) {
  return (
    <div data-variant="success" class="group peer flex flex-col gap-8">
      <EventsHeader page={page} />
      <div class="flex flex-col gap-3">
        <div data-tabs class="flex flex-col gap-4">
          <div class="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]">
            <button type="button" data-tab="reports" data-active="true" class={TAB_TRIGGER}>
              Reports
            </button>
            <button type="button" data-tab="maintenances" data-active="false" class={TAB_TRIGGER}>
              Maintenances
            </button>
          </div>
          <div data-panel="reports" class="flex-1 outline-none">
            <div class="flex flex-col gap-4" role="feed" aria-label="Status events and updates">
              {reports.length > 0 ? (
                reports.map((report) => (
                  <ReportEvent
                    report={report}
                    names={names}
                    href={`/events/report/${report.id}`}
                    hoverable
                  />
                ))
              ) : (
                <BlankEvents title="No reports" description="There are no reports to display." />
              )}
            </div>
          </div>
          <div data-panel="maintenances" hidden class="flex-1 outline-none">
            <div class="flex flex-col gap-4" role="feed" aria-label="Status events and updates">
              {maintenances.length > 0 ? (
                maintenances.map((maintenance) => (
                  <MaintenanceEvent
                    maintenance={maintenance}
                    names={names}
                    href={`/events/maintenance/${maintenance.id}`}
                    hoverable
                    alwaysAffected={false}
                  />
                ))
              ) : (
                <BlankEvents
                  title="No maintenances found"
                  description="No maintenances found for this status page."
                />
              )}
            </div>
          </div>
        </div>
      </div>
      <script>{raw(TS_HOVER_SCRIPT)}</script>
    </div>
  );
}

export function ReportDetail({
  page,
  report,
  names,
}: {
  env: Env;
  page: Page;
  report: Report;
  names: Record<number, string>;
}) {
  return (
    <div data-variant="success" class="group peer flex flex-col gap-8">
      <EventsHeader page={page} />
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-4">
          <BackLink />
          <ReportEvent report={report} names={names} hoverable={false} />
        </div>
      </div>
      <script>{raw(TS_HOVER_SCRIPT)}</script>
    </div>
  );
}

export function MaintenanceDetail({
  page,
  maintenance,
  names,
}: {
  env: Env;
  page: Page;
  maintenance: Maintenance;
  names: Record<number, string>;
}) {
  return (
    <div data-variant="success" class="group peer flex flex-col gap-8">
      <EventsHeader page={page} />
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-4">
          <BackLink />
          <MaintenanceEvent maintenance={maintenance} names={names} hoverable={false} alwaysAffected />
        </div>
      </div>
      <script>{raw(TS_HOVER_SCRIPT)}</script>
    </div>
  );
}

/** In-page not-found state for a missing report/maintenance detail (mirrors the source's
 *  StatusBlankEvents rendered inside the full events chrome — header + blank card). */
export function EventNotFound({
  page,
  title,
  description,
}: {
  page: Page;
  title: string;
  description: string;
}) {
  return (
    <div data-variant="success" class="group peer flex flex-col gap-8">
      <EventsHeader page={page} />
      <div class="flex flex-col gap-3">
        <BlankEvents title={title} description={description} />
      </div>
    </div>
  );
}
