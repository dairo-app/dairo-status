// Hand-rolled syndication feeds (no npm dependency). Renders the same report + maintenance
// events shown on the board as RSS 2.0, Atom 1.0, or JSON Feed 1.1. All text is XML-escaped
// and every timestamp is UTC.
import type { Env, Maintenance, Page, Report } from "../types";
import { updateStatusLabel } from "../ui/status";

type FeedType = "rss" | "atom" | "json";

/** One normalized syndication item, source date kept as an ISO string. */
type FeedItem = {
  link: string;
  title: string;
  description: string;
  date: string;
};

const CONTENT_TYPE: Record<FeedType, string> = {
  rss: "application/rss+xml; charset=utf-8",
  atom: "application/atom+xml; charset=utf-8",
  json: "application/feed+json; charset=utf-8",
};

/** Escape text for inclusion in XML character data or attributes. */
function xml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Parse a date defensively, falling back to now for anything unparseable. */
function toDate(iso: string): Date {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? new Date() : new Date(t);
}

/** RFC-822 date for RSS pubDate/lastBuildDate (e.g. "Mon, 14 Jul 2026 12:00:00 GMT"). */
function rfc822(iso: string): string {
  return toDate(iso).toUTCString();
}

/** RFC-3339 / ISO-8601 date for Atom and JSON Feed. */
function rfc3339(iso: string): string {
  return toDate(iso).toISOString();
}

/** Flatten reports + maintenances into feed items, newest first. */
function collectItems(env: Env, reports: Report[], maintenances: Maintenance[]): FeedItem[] {
  const items: FeedItem[] = [];

  for (const r of reports) {
    const statusLabel = updateStatusLabel[r.status] ?? r.status;
    const description = r.updates
      .map((u) => `${updateStatusLabel[u.status] ?? u.status}: ${u.message}.`)
      .join("\n");
    items.push({
      link: `${env.PUBLIC_URL}/events/report/${r.id}`,
      title: `${statusLabel} - ${r.title}`,
      description,
      date: r.updatedAt,
    });
  }

  for (const m of maintenances) {
    items.push({
      link: `${env.PUBLIC_URL}/events/maintenance/${m.id}`,
      title: `Maintenance - ${m.title}`,
      description: m.message,
      date: m.startAt,
    });
  }

  items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return items;
}

function buildRss(env: Env, page: Page, items: FeedItem[], now: string, copyright: string): string {
  const self = `${env.PUBLIC_URL}/feed/rss`;
  const entries = items
    .map(
      (it) =>
        `    <item>\n` +
        `      <title>${xml(it.title)}</title>\n` +
        `      <link>${xml(it.link)}</link>\n` +
        `      <guid isPermaLink="true">${xml(it.link)}</guid>\n` +
        `      <description>${xml(it.description)}</description>\n` +
        `      <pubDate>${rfc822(it.date)}</pubDate>\n` +
        `    </item>`,
    )
    .join("\n");

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
    `  <channel>\n` +
    `    <title>${xml(page.title)}</title>\n` +
    `    <link>${xml(env.PUBLIC_URL)}</link>\n` +
    `    <description>${xml(page.description)}</description>\n` +
    `    <language>en</language>\n` +
    `    <copyright>${xml(copyright)}</copyright>\n` +
    `    <generator>Dairo Status</generator>\n` +
    `    <lastBuildDate>${rfc822(now)}</lastBuildDate>\n` +
    `    <atom:link href="${xml(self)}" rel="self" type="application/rss+xml"/>\n` +
    (entries ? entries + "\n" : "") +
    `  </channel>\n` +
    `</rss>\n`
  );
}

function buildAtom(env: Env, page: Page, items: FeedItem[], now: string, copyright: string): string {
  const self = `${env.PUBLIC_URL}/feed/atom`;
  const entries = items
    .map((it) => {
      const when = rfc3339(it.date);
      return (
        `  <entry>\n` +
        `    <title>${xml(it.title)}</title>\n` +
        `    <id>${xml(it.link)}</id>\n` +
        `    <link href="${xml(it.link)}"/>\n` +
        `    <updated>${when}</updated>\n` +
        `    <published>${when}</published>\n` +
        `    <summary>${xml(it.description)}</summary>\n` +
        `  </entry>`
      );
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">\n` +
    `  <title>${xml(page.title)}</title>\n` +
    `  <subtitle>${xml(page.description)}</subtitle>\n` +
    `  <id>${xml(env.PUBLIC_URL)}</id>\n` +
    `  <link href="${xml(env.PUBLIC_URL)}"/>\n` +
    `  <link href="${xml(self)}" rel="self" type="application/atom+xml"/>\n` +
    `  <updated>${rfc3339(now)}</updated>\n` +
    `  <generator>Dairo Status</generator>\n` +
    `  <rights>${xml(copyright)}</rights>\n` +
    (entries ? entries + "\n" : "") +
    `</feed>\n`
  );
}

function buildJson(env: Env, page: Page, items: FeedItem[], copyright: string): string {
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: page.title,
    description: page.description,
    home_page_url: env.PUBLIC_URL,
    feed_url: `${env.PUBLIC_URL}/feed/json`,
    language: "en",
    authors: [{ name: "Dairo Status" }],
    _dairo: { copyright },
    items: items.map((it) => {
      const when = rfc3339(it.date);
      return {
        id: it.link,
        url: it.link,
        title: it.title,
        content_text: it.description,
        date_published: when,
        date_modified: when,
      };
    }),
  };
  return JSON.stringify(feed, null, 2);
}

/** Build a syndication feed of report + maintenance events in the requested format. */
export function buildFeed(
  env: Env,
  page: Page,
  type: FeedType,
  reports: Report[],
  maintenances: Maintenance[],
): Response {
  const items = collectItems(env, reports, maintenances);
  const now = new Date().toISOString();
  const copyright = `Copyright ${new Date().getUTCFullYear()} Dairo`;

  let body: string;
  if (type === "atom") body = buildAtom(env, page, items, now, copyright);
  else if (type === "json") body = buildJson(env, page, items, copyright);
  else body = buildRss(env, page, items, now, copyright);

  return new Response(body, { headers: { "content-type": CONTENT_TYPE[type] } });
}
