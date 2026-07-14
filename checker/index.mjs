// Dairo Status — health prober (AWS Lambda, nodejs20.x, ESM).
//
// Runs on a 2-minute schedule (EventBridge). It has NO product access and NO AWS SDK —
// it only speaks HTTP:
//   1. GET  MONITORS_URL          -> the list of things to probe (served by the Worker from D1)
//   2. probe each monitor's URL   -> measure reachability + latency
//   3. POST INGEST_URL            -> hand the results back to the Worker, which upserts D1
//
// Everything here uses the runtime's global `fetch` / `AbortController` / `performance`.
// Zero dependencies, zero build step: the file is the deployment artifact.

// ── Configuration (from Lambda environment variables) ────────────────────────────────
const INGEST_URL = process.env.INGEST_URL; // e.g. https://status.dairo.app/ingest
const INGEST_TOKEN = process.env.INGEST_TOKEN; // shared bearer secret the Worker checks
const MONITORS_URL = process.env.MONITORS_URL; // e.g. https://status.dairo.app/api/monitors
const DEFAULT_TIMEOUT_MS = Number(process.env.DEFAULT_TIMEOUT_MS) || 45000;

/**
 * Fetch the monitor list from the Worker. Accepts either a bare JSON array or an object
 * wrapping it under `monitors` / `data`, so the checker survives small envelope changes.
 * @returns {Promise<Array<{id:number,url:string,method?:string,timeoutMs?:number}>>}
 */
async function loadMonitors() {
  const res = await fetch(MONITORS_URL, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`monitors fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body?.monitors ?? body?.data ?? []);
  // Only probe rows that actually carry a URL.
  return list.filter((m) => m && m.url);
}

/**
 * Probe a single monitor. Resolves to the /ingest result row for it.
 * Never rejects — a network error / timeout becomes an `error` result with code 0.
 * @param {{id:number,url:string,method?:string,timeoutMs?:number}} monitor
 */
async function probe(monitor) {
  const timeoutMs = Number(monitor.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const method = monitor.method || "GET";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const start = performance.now();
  try {
    const res = await fetch(monitor.url, {
      method,
      redirect: "follow",
      signal: controller.signal,
    });
    // Latency = time to response headers (fetch resolves before the body arrives).
    const latencyMs = Math.round(performance.now() - start);

    // Drain and discard the body so the socket is freed and can be reused.
    try {
      if (res.body) await res.body.cancel();
      else await res.arrayBuffer();
    } catch {
      /* body already gone — nothing to free */
    }

    // "up" = any non-error HTTP class. There is no `degraded` config today, so a reachable
    // endpoint is `active` and everything else (incl. 4xx/5xx) is `error`.
    const up = res.status >= 200 && res.status < 400;
    return {
      monitorId: monitor.id,
      status: up ? "active" : "error",
      code: res.status || 0,
      latencyMs,
    };
  } catch (err) {
    // Network failure, DNS failure, or the abort timer fired.
    const latencyMs = Math.round(performance.now() - start);
    return {
      monitorId: monitor.id,
      status: "error",
      code: 0,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ship the probe results back to the Worker's /ingest endpoint.
 * @param {Array<object>} results
 * @returns {Promise<number>} the ingest HTTP status
 */
async function postResults(results) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${INGEST_TOKEN}`,
    },
    body: JSON.stringify({
      checkedAt: new Date().toISOString(),
      results,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ingest failed: ${res.status} ${res.statusText} ${text}`.trim());
  }
  return res.status;
}

// ── Lambda entrypoint ─────────────────────────────────────────────────────────────────
export const handler = async () => {
  if (!INGEST_URL || !INGEST_TOKEN || !MONITORS_URL) {
    throw new Error("missing env: INGEST_URL, INGEST_TOKEN and MONITORS_URL are required");
  }

  const monitors = await loadMonitors();

  // Probe every monitor concurrently — one slow target must not delay the others.
  const results = await Promise.all(monitors.map(probe));

  const ingestStatus = await postResults(results);

  const up = results.filter((r) => r.status === "active").length;
  const summary = {
    ok: true,
    monitors: results.length,
    up,
    down: results.length - up,
    ingestStatus,
    checkedAt: new Date().toISOString(),
  };
  console.log("checker run:", JSON.stringify(summary));
  return summary;
};
