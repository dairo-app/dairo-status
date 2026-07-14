// Shared domain types for the status page. These mirror the D1 schema (db/schema.sql).

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  PAGE_SLUG: string;
  PUBLIC_URL: string;
  UPTIME_DAYS: string;
  INGEST_TOKEN?: string;
  DAIRO_API_KEY?: string;
};

/** The five visual states a component/page can be in. */
export type Status = "success" | "degraded" | "error" | "info" | "empty";

export type Page = {
  id: number;
  slug: string;
  title: string;
  description: string;
  icon: string;
  homepageUrl: string | null;
  contactUrl: string | null;
  allowIndex: boolean;
  showUptime: boolean;
  updatedAt: string;
};

export type Incident = {
  id: number;
  monitorId: number;
  title: string;
  summary: string;
  status: string;
  startedAt: string;
  resolvedAt: string | null;
};

/** A board row: a component with its monitor's live status and any open incident. */
export type Component = {
  id: number;
  name: string;
  description: string | null;
  order: number;
  groupId: number | null;
  monitorId: number | null;
  monitorStatus: Status; // live checker status, mapped to the visual scale
  openIncident: Incident | null;
};

export type ComponentGroup = { id: number; name: string; order: number };

export type ReportUpdate = {
  id: number;
  status: string;
  message: string;
  date: string;
  components: { componentId: number; impact: string }[];
};

export type Report = {
  id: number;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  updates: ReportUpdate[];
};

export type Maintenance = {
  id: number;
  title: string;
  message: string;
  startAt: string;
  endAt: string;
  componentIds: number[];
};

/** One day of the uptime bar. */
export type UptimeDay = {
  monitorId: number;
  day: string; // YYYY-MM-DD (UTC)
  ok: number;
  total: number;
};

/** The full page graph, assembled in one read. */
export type StatusBoard = {
  page: Page;
  components: Component[];
  groups: ComponentGroup[];
  reports: Report[];
  maintenances: Maintenance[];
  uptime: Record<number, UptimeDay[]>; // monitorId -> newest-last days
  overall: Status;
};
