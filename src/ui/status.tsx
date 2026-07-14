/** The status vocabulary: colors, human labels, and icons. Shared by every view so the
 *  board, banner, and feed stay visually consistent. */
import { raw } from "hono/html";
import type { Status } from "../types";

/** CSS variable backing each status color (used inline for bar segments / dots). */
export const statusVar: Record<Status, string> = {
  success: "var(--success)",
  degraded: "var(--warning)",
  error: "var(--destructive)",
  info: "var(--info)",
  empty: "var(--muted)",
};

/** Tailwind text-color class per status. */
export const statusText: Record<Status, string> = {
  success: "text-success",
  degraded: "text-warning",
  error: "text-destructive",
  info: "text-info",
  empty: "text-muted-foreground",
};

/** Tailwind background-color class per status (solid). */
export const statusBg: Record<Status, string> = {
  success: "bg-success",
  degraded: "bg-warning",
  error: "bg-destructive",
  info: "bg-info",
  empty: "bg-muted",
};

/** Big banner message for the overall page status. */
export const bannerLabel: Record<Status, string> = {
  success: "All Systems Operational",
  degraded: "Degraded Performance",
  error: "Partial Outage",
  info: "Maintenance",
  empty: "No Data",
};

/** Short label for a single component row. */
export const componentLabel: Record<Status, string> = {
  success: "Operational",
  degraded: "Degraded",
  error: "Outage",
  info: "Maintenance",
  empty: "No Data",
};

/** Impact wording used on report/maintenance affected-component badges. */
export const impactLabel: Record<string, string> = {
  operational: "Operational",
  degraded_performance: "Degraded performance",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
};

/** Report/incident update statuses. */
export const updateStatusLabel: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
  maintenance: "Maintenance",
};

const ICON_PATHS: Record<Status, string> = {
  // lucide: check
  success: '<path d="M20 6 9 17l-5-5"/>',
  // lucide: triangle-alert
  degraded:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  // lucide: alert-circle
  error:
    '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  // lucide: wrench
  info: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  empty: '<circle cx="12" cy="12" r="10"/>',
};

/** A status icon inside a filled square (the small dot on each row, or the banner badge).
 *  `inner` overrides the glyph size (the banner uses a 16px glyph in a 28px circle to match
 *  `size-7 [&>svg]:size-4`; otherwise the glyph is size*0.72, matching the 12.5→9 component dot). */
export function StatusIcon({
  status,
  size = 12.5,
  inner,
}: { status: Status; size?: number; inner?: number }) {
  const innerSize = inner ?? Math.round(size * 0.72 * 10) / 10;
  return (
    <span
      class={`inline-flex shrink-0 items-center justify-center rounded-full text-background ${statusBg[status]}`}
      style={`width:${size}px;height:${size}px`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={innerSize}
        height={innerSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {raw(ICON_PATHS[status])}
      </svg>
    </span>
  );
}

/** A bare lucide-style icon (stroke, currentColor). */
export function Icon({ path, size = 16, cls = "" }: { path: string; size?: number; cls?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
    >
      {raw(path)}
    </svg>
  );
}

export const ICONS = {
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  laptop:
    '<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"/><path d="M20.054 15.987H3.946"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
} as const;
