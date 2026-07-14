/** Worker entry: routing + the base layout. Page bodies live in ./pages, feeds in ./feeds,
 *  subscription/ingest logic in their own modules. The whole page renders from D1 on each
 *  request — there is no build-time HTML and nothing to hydrate. */
import { Hono } from "hono";

import type { Env } from "./types";
import { Layout } from "./ui/layout";
import { Board } from "./pages/board";
import { loadBoard, loadMaintenance, loadPage, loadReport, listMaintenances, listReports } from "./data/db";
import { EventsPage, MaintenanceDetail, ReportDetail } from "./pages/events";
import { buildFeed } from "./feeds/feed";
import { handleIngest } from "./data/ingest";
import {
  handleSubscribe,
  ManagePage,
  handleManage,
  UnsubscribePage,
  handleUnsubscribe,
  VerifyPage,
} from "./pages/subscribe";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.text("ok"));

// ── Status board ────────────────────────────────────────────────────────────────────
app.get("/", async (c) => {
  const board = await loadBoard(c.env);
  if (!board) return c.text("Status page not configured", 503);
  return c.html(
    <Layout env={c.env} page={board.page} active="status">
      <Board board={board} />
    </Layout>,
  );
});

// ── Events history + detail ───────────────────────────────────────────────────────────
app.get("/events", async (c) => {
  const page = await loadPage(c.env);
  if (!page) return c.notFound();
  const [reports, maintenances] = await Promise.all([listReports(c.env, 90), listMaintenances(c.env, 90)]);
  return c.html(
    <Layout env={c.env} page={page} active="events" title="Events">
      <EventsPage env={c.env} page={page} reports={reports} maintenances={maintenances} />
    </Layout>,
  );
});

app.get("/events/report/:id", async (c) => {
  const page = await loadPage(c.env);
  const report = await loadReport(c.env, Number(c.req.param("id")));
  if (!page || !report) return c.notFound();
  return c.html(
    <Layout env={c.env} page={page} active="events" title={report.title}>
      <ReportDetail env={c.env} page={page} report={report} />
    </Layout>,
  );
});

app.get("/events/maintenance/:id", async (c) => {
  const page = await loadPage(c.env);
  const maintenance = await loadMaintenance(c.env, Number(c.req.param("id")));
  if (!page || !maintenance) return c.notFound();
  return c.html(
    <Layout env={c.env} page={page} active="events" title={maintenance.title}>
      <MaintenanceDetail env={c.env} page={page} maintenance={maintenance} />
    </Layout>,
  );
});

// ── Feeds ─────────────────────────────────────────────────────────────────────────────
app.get("/feed/:type", async (c) => {
  const type = c.req.param("type");
  if (!["rss", "atom", "json"].includes(type)) return c.notFound();
  const page = await loadPage(c.env);
  if (!page) return c.notFound();
  const [reports, maintenances] = await Promise.all([listReports(c.env, 90), listMaintenances(c.env, 90)]);
  return buildFeed(c.env, page, type as "rss" | "atom" | "json", reports, maintenances);
});

// ── Subscriptions ─────────────────────────────────────────────────────────────────────
app.post("/api/subscribe", handleSubscribe);

app.get("/verify/:token", async (c) => {
  const page = await loadPage(c.env);
  if (!page) return c.notFound();
  return c.html(
    <Layout env={c.env} page={page} title="Confirm subscription">
      <VerifyPage env={c.env} token={c.req.param("token")} />
    </Layout>,
  );
});

app.get("/manage/:token", async (c) => {
  const page = await loadPage(c.env);
  if (!page) return c.notFound();
  return c.html(
    <Layout env={c.env} page={page} title="Manage subscription">
      <ManagePage env={c.env} token={c.req.param("token")} />
    </Layout>,
  );
});
app.post("/manage/:token", handleManage);

app.get("/unsubscribe/:token", async (c) => {
  const page = await loadPage(c.env);
  if (!page) return c.notFound();
  return c.html(
    <Layout env={c.env} page={page} title="Unsubscribe">
      <UnsubscribePage env={c.env} token={c.req.param("token")} />
    </Layout>,
  );
});
app.post("/unsubscribe/:token", handleUnsubscribe);

// ── Ingest (health checker → D1) ──────────────────────────────────────────────────────
app.post("/ingest", handleIngest);

export default app;
