# Dairo Status

The public status page for **Dairo** — email infrastructure for AI agents. Live at
[status.dairo.app](https://status.dairo.app).

Built from the ground up on Cloudflare: a single **Worker** (Hono + server-side JSX) renders
the page directly from **D1**, so there is no server to cold-start. Health checks run on a
schedule and POST their results to the Worker's `/ingest` endpoint; everything the page shows
— live component status, 45-day uptime bars, auto-incidents, operator reports, scheduled
maintenance, RSS/Atom/JSON feeds, and email subscriptions — is read from D1.

## Stack

- **Cloudflare Workers** — hosting + server-side rendering (Hono, `hono/jsx`)
- **Cloudflare D1** — SQLite datastore (`db/schema.sql`)
- **Tailwind CSS v4** — the brand theme (square corners, monospace, four signal colors)
- The health prober runs externally and pushes results to `/ingest`

## Layout

```
db/schema.sql     D1 schema
src/app.css       Tailwind entry + brand theme tokens
src/index.tsx     Worker entry — routes + layout
src/ui/           status system (colors/labels/icons) + shared components
src/pages/        board, events, subscription pages
src/data/         D1 data-access layer
src/feeds/        RSS / Atom / JSON
src/email/        subscriber verification + incident notifications
checker/          the external health prober
migration/        one-time data import
```

## Develop

```
npm install
npm run css              # build the stylesheet
wrangler d1 create dairo-status   # then paste the id into wrangler.toml
npm run db:local         # apply the schema locally
npm run dev              # wrangler dev
```

## Deploy

```
npm run deploy
```
