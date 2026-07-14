/** The uptime tracker: one thin bar per day over the window. A fully-up day is a solid
 *  success bar; an outage day fills the bottom proportionally in red; a no-data day is muted.
 *  Hover/focus reveals a CSS-only card with the date and that day's uptime. */
import type { UptimeDay } from "../types";
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

function fmtPct(n: number): string {
  // Match the board's convention: two decimals, trimmed to a tidy "100%" / "99.98%".
  return `${(Math.floor(n * 100) / 100).toFixed(n >= 100 ? 0 : 2)}%`;
}

function fmtDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Bar({ day }: { day: UptimeDay }) {
  const noData = day.total === 0;
  const okPct = noData ? 0 : (day.ok / day.total) * 100;
  const errPct = 100 - okPct;
  const dayPct = noData ? null : okPct;

  const label = noData
    ? "No data"
    : errPct === 0
      ? "100% operational"
      : `${fmtPct(okPct)} · ${day.total - day.ok} failed of ${day.total}`;

  return (
    <div class="group relative flex h-full flex-1 flex-col justify-end overflow-hidden hover:opacity-80" tabindex={0}>
      {noData ? (
        <div style={`height:100%;background-color:${statusVar.empty}`} />
      ) : (
        <>
          {errPct > 0 ? (
            <div style={`height:${errPct}%;background-color:${statusVar.error}`} />
          ) : null}
          <div style={`height:${okPct}%;background-color:${statusVar.success}`} />
        </>
      )}
      {/* CSS-only hover card */}
      <div class="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-30 hidden min-w-40 -translate-x-1/2 border border-border bg-popover p-0 text-popover-foreground shadow-md group-hover:block group-focus:block">
        <div class="border-b border-border px-2.5 py-1.5 font-mono text-xs font-medium">{fmtDay(day.day)}</div>
        <div class="flex items-center justify-between gap-4 px-2.5 py-1.5 text-xs">
          <span class="flex items-center gap-1.5 text-muted-foreground">
            <span class="size-2.5" style={`background-color:${noData ? statusVar.empty : statusVar.success}`} />
            Uptime
          </span>
          <span class="font-mono">{dayPct == null ? "—" : fmtPct(dayPct)}</span>
        </div>
      </div>
    </div>
  );
}

export function UptimeBar({ days }: { days: UptimeDay[] }) {
  return (
    <div class="flex h-[50px] w-full items-end gap-px" role="img" aria-label="Uptime history">
      {days.map((d) => (
        <Bar day={d} />
      ))}
    </div>
  );
}
