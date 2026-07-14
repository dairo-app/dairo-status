/** The page shell: <head> (SEO + theme bootstrap), header nav, footer. Every route renders
 *  its body inside <Layout>. Kept framework-free — server-rendered HTML with two tiny inline
 *  scripts (theme + subscribe) so there is nothing to hydrate. */
import type { Child } from "hono/jsx";
import type { Env, Page } from "../types";
import { Icon, ICONS } from "./status";

type LayoutProps = {
  env: Env;
  page: Page;
  title?: string;
  description?: string;
  active?: "status" | "events";
  children: Child;
};

/** First letters of up to two title words — the brand fallback when there is no icon. */
function initials(title: string): string {
  return title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Runs before paint: applies stored/system theme so there's no flash.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

const THEME_TOGGLE = `function dsCycleTheme(){var cur=localStorage.getItem('theme')||'system';var next=cur==='light'?'dark':cur==='dark'?'system':'light';localStorage.setItem('theme',next);var d=next==='dark'||(next==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d);}`;

export function Layout({ env, page, title, description, active, children }: LayoutProps) {
  const pageTitle = title ? `${title} | Dairo Status` : `${page.title} | Status Page`;
  const desc = description ?? page.description;
  const home = page.homepageUrl || "/";
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{pageTitle}</title>
        <meta name="description" content={desc} />
        <meta name="robots" content={page.allowIndex ? "index, follow" : "noindex, nofollow"} />
        <link rel="canonical" href={env.PUBLIC_URL} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={desc} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <link
          rel="alternate"
          type="application/rss+xml"
          title="Dairo Status"
          href={`${env.PUBLIC_URL}/feed/rss`}
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body class="font-sans">
        <div class="flex min-h-screen flex-col gap-4">
          <Header page={page} active={active} home={home} env={env} />
          <main class="mx-auto flex w-full max-w-2xl flex-1 flex-col px-3 py-2">{children}</main>
          <Footer page={page} env={env} />
        </div>
        <script dangerouslySetInnerHTML={{ __html: THEME_TOGGLE }} />
      </body>
    </html>
  );
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <a
      href={href}
      class={`px-3 py-1 font-mono text-sm ${
        active ? "border border-border bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </a>
  );
}

function Header({
  page,
  active,
  home,
  env,
}: {
  page: Page;
  active?: "status" | "events";
  home: string;
  env: Env;
}) {
  return (
    <header class="w-full border-b">
      <nav class="mx-auto flex max-w-2xl items-center justify-between gap-3 px-3 py-2">
        <a href={home} class="flex size-8 items-center justify-center border border-border" aria-label={page.title}>
          {page.icon ? (
            <img src={page.icon} alt="" class="size-8" />
          ) : (
            <span class="font-mono text-sm font-medium">{initials(page.title)}</span>
          )}
        </a>
        <div class="flex items-center gap-1">
          <NavLink href="/" label="Status" active={active === "status"} />
          <NavLink href="/events" label="Events" active={active === "events"} />
        </div>
        <div class="flex min-w-[110px] items-center justify-end gap-2">
          <GetUpdates env={env} />
        </div>
      </nav>
    </header>
  );
}

/** A JS-free "Get updates" popover (native <details>) with the email form + feed links. */
export function GetUpdates({ env }: { env: Env }) {
  return (
    <details class="relative">
      <summary class="flex cursor-pointer list-none items-center gap-1.5 border border-border px-2 py-1 font-mono text-xs hover:bg-secondary">
        <Icon path={ICONS.bell} size={13} /> Get updates
      </summary>
      <div class="absolute right-0 z-20 mt-1 w-72 border border-border bg-popover p-3 shadow-md">
        <form method="post" action="/api/subscribe" class="flex flex-col gap-2">
          <p class="text-xs text-muted-foreground">Get an email when something changes.</p>
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            class="w-full border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <button type="submit" class="bg-primary px-2 py-1.5 text-sm text-primary-foreground hover:opacity-90">
            Subscribe
          </button>
        </form>
        <div class="mt-3 flex items-center gap-3 border-t border-border pt-2 font-mono text-xs text-muted-foreground">
          <a href="/feed/rss" class="flex items-center gap-1 hover:text-foreground">
            <Icon path={ICONS.rss} size={12} /> RSS
          </a>
          <a href="/feed/atom" class="hover:text-foreground">Atom</a>
          <a href="/feed/json" class="hover:text-foreground">JSON</a>
        </div>
      </div>
    </details>
  );
}

function Footer({ page, env }: { page: Page; env: Env }) {
  return (
    <footer class="w-full border-t">
      <div class="mx-auto flex max-w-2xl items-center justify-between gap-3 px-3 py-2">
        <a
          href="https://github.com/dairo-app/dairo-status"
          class="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          Open source — the code is yours to read →
        </a>
        <div class="flex items-center gap-3">
          <span
            class="flex items-center gap-1 font-mono text-xs text-muted-foreground"
            id="ds-tz"
          >
            <Icon path={ICONS.clock} size={12} />
            <span>UTC</span>
          </span>
          <button
            type="button"
            onclick="dsCycleTheme()"
            aria-label="Toggle theme"
            class="text-muted-foreground hover:text-foreground"
          >
            <Icon path={ICONS.moon} size={14} />
          </button>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.getElementById('ds-tz').lastElementChild.textContent=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch(e){}`,
          }}
        />
      </div>
    </footer>
  );
}
