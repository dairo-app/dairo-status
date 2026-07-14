/** The page shell: <head> (SEO + fonts + theme bootstrap), header nav, footer. Every route
 *  renders its body inside <Layout>. Framework-free — server-rendered HTML with a couple of
 *  tiny inline scripts (theme + popovers) so there is nothing to hydrate. Matches the original
 *  chrome: w-[150px] brand slot, button-chrome nav, tabbed "Get updates", theme dropdown. */
import { raw } from "hono/html";
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
  return (
    title
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0))
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

// Runs before paint: applies stored/system theme so there's no flash.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

// Theme setter used by the footer dropdown + closes any open <details> popovers.
const CLIENT_JS = `function dsSetTheme(t){try{localStorage.setItem('theme',t);var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}document.querySelectorAll('details[open]').forEach(function(el){el.open=false;});}
document.addEventListener('click',function(e){document.querySelectorAll('details[open]').forEach(function(el){if(!el.contains(e.target))el.open=false;});});
try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;var n=document.getElementById('ds-tz-name');if(n&&tz)n.textContent=tz;}catch(e){}`;

export function Layout({ env, page, title, description, active, children }: LayoutProps) {
  const pageTitle = title ? `${title} | Dairo Status` : `${page.title} | Status Page`;
  const desc = description ?? page.description;
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
        <link rel="preload" href="/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="preload" href="/fonts/GeistMono-Variable.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="alternate" type="application/rss+xml" title="Dairo Status" href={`${env.PUBLIC_URL}/feed/rss`} />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <script>{raw(THEME_BOOTSTRAP)}</script>
      </head>
      <body class="bg-background text-foreground font-sans antialiased">
        <div class="flex min-h-screen flex-col gap-4">
          <Header page={page} active={active} env={env} />
          <main class="mx-auto flex w-full max-w-2xl flex-1 flex-col px-3 py-2">{children}</main>
          <Footer env={env} />
        </div>
        <script>{raw(CLIENT_JS)}</script>
      </body>
    </html>
  );
}

const NAV_BASE =
  "inline-flex h-8 items-center justify-center border px-3 text-sm font-medium transition-colors";

function NavItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <li>
      <a
        href={href}
        class={`${NAV_BASE} ${
          active
            ? "border-input bg-secondary text-secondary-foreground"
            : "text-foreground border-transparent hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        {label}
      </a>
    </li>
  );
}

function Header({ page, active, env }: { page: Page; active?: "status" | "events"; env: Env }) {
  const home = page.homepageUrl || "/";
  return (
    <header class="w-full border-b">
      <nav class="mx-auto flex max-w-2xl items-center justify-between gap-3 px-3 py-2">
        <div class="flex w-[150px] shrink-0">
          <a
            href={home}
            aria-label={page.title}
            class="border-input bg-background hover:bg-accent flex size-8 items-center justify-center overflow-hidden border transition-colors"
          >
            {page.icon ? (
              <img src={page.icon} alt="" class="size-8" />
            ) : (
              <span class="font-mono text-sm">{initials(page.title)}</span>
            )}
          </a>
        </div>
        <ul class="flex flex-row gap-0.5">
          <NavItem href="/" label="Status" active={active === "status"} />
          <NavItem href="/events" label="Events" active={active === "events"} />
        </ul>
        <div class="flex min-w-[150px] items-center justify-end gap-2">
          <GetUpdates env={env} />
        </div>
      </nav>
    </header>
  );
}

/** The tabbed "Get updates" popover: Email (subscribe form), RSS, JSON. Native <details> +
 *  CSS radio tabs, so it needs no JS to open or switch tabs. */
export function GetUpdates({ env }: { env: Env }) {
  return (
    <details class="group relative">
      <summary class="border-input bg-background hover:bg-accent flex h-8 cursor-pointer list-none items-center gap-1.5 border px-3 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden">
        <Icon path={ICONS.bell} size={14} />
        <span>Get updates</span>
      </summary>
      <div class="bg-popover text-popover-foreground absolute right-0 z-30 mt-1 w-80 border shadow-md">
        {/* CSS-only tabs via radio inputs */}
        <input type="radio" name="gu-tab" id="gu-email" class="peer/email hidden" checked />
        <input type="radio" name="gu-tab" id="gu-rss" class="peer/rss hidden" />
        <input type="radio" name="gu-tab" id="gu-json" class="peer/json hidden" />
        <div class="flex w-full border-b text-sm">
          <label for="gu-email" class="text-muted-foreground peer-checked/email:text-foreground peer-checked/email:border-foreground flex-1 cursor-pointer border-b-2 border-transparent px-3 py-2 text-center font-medium">
            Email
          </label>
          <label for="gu-rss" class="text-muted-foreground peer-checked/rss:text-foreground peer-checked/rss:border-foreground flex-1 cursor-pointer border-b-2 border-transparent px-3 py-2 text-center font-medium">
            RSS
          </label>
          <label for="gu-json" class="text-muted-foreground peer-checked/json:text-foreground peer-checked/json:border-foreground flex-1 cursor-pointer border-b-2 border-transparent px-3 py-2 text-center font-medium">
            JSON
          </label>
        </div>
        <div class="hidden p-3 peer-checked/email:block">
          <p class="text-muted-foreground mb-2 text-xs leading-snug">
            Get an email whenever an incident is opened or resolved.
          </p>
          <form method="post" action="/api/subscribe" class="flex flex-col gap-2">
            <input
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              class="border-input bg-background focus:ring-ring w-full border px-2 py-1.5 text-sm outline-none focus:ring-1"
            />
            <button type="submit" class="bg-primary text-primary-foreground h-8 text-sm font-medium hover:opacity-90">
              Subscribe
            </button>
          </form>
        </div>
        <div class="hidden p-3 peer-checked/rss:block">
          <p class="text-muted-foreground mb-2 text-xs">Subscribe with any feed reader.</p>
          <FeedRow label="RSS" href={`${env.PUBLIC_URL}/feed/rss`} />
          <FeedRow label="Atom" href={`${env.PUBLIC_URL}/feed/atom`} />
        </div>
        <div class="hidden p-3 peer-checked/json:block">
          <p class="text-muted-foreground mb-2 text-xs">JSON Feed for programmatic access.</p>
          <FeedRow label="JSON" href={`${env.PUBLIC_URL}/feed/json`} />
        </div>
      </div>
    </details>
  );
}

function FeedRow({ label, href }: { label: string; href: string }) {
  return (
    <div class="border-input mt-1 flex items-center justify-between gap-2 border px-2 py-1.5">
      <span class="text-muted-foreground truncate font-mono text-xs">{href}</span>
      <a href={href} class="text-xs font-medium hover:underline">
        {label}
      </a>
    </div>
  );
}

function Footer({ env }: { env: Env }) {
  return (
    <footer class="w-full border-t">
      <div class="mx-auto flex max-w-2xl items-center justify-between gap-4 px-3 py-2">
        <a
          href="https://github.com/dairo-app/dairo-status"
          class="text-muted-foreground font-mono text-xs leading-none hover:text-foreground sm:text-sm"
        >
          Open source — the code is yours to read →
        </a>
        <div class="flex items-center gap-2">
          <span class="text-muted-foreground flex items-center gap-1 font-mono text-xs">
            <Icon path={ICONS.clock} size={12} />
            <span id="ds-tz-name">UTC</span>
          </span>
          <ThemeSwitcher />
        </div>
      </div>
    </footer>
  );
}

/** Light / Dark / System dropdown (native <details>). */
function ThemeSwitcher() {
  const item =
    "hover:bg-accent flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm";
  return (
    <details class="relative">
      <summary class="text-muted-foreground hover:text-foreground flex size-8 cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden">
        <Icon path={ICONS.moon} size={16} />
        <span class="sr-only">Toggle theme</span>
      </summary>
      <div class="bg-popover text-popover-foreground absolute right-0 bottom-9 z-30 w-36 border py-1 shadow-md">
        <button type="button" class={item} onclick="dsSetTheme('light')">
          <Icon path={ICONS.sun} size={15} /> Light
        </button>
        <button type="button" class={item} onclick="dsSetTheme('dark')">
          <Icon path={ICONS.moon} size={15} /> Dark
        </button>
        <button type="button" class={item} onclick="dsSetTheme('system')">
          <Icon path={ICONS.laptop} size={15} /> System
        </button>
      </div>
    </details>
  );
}
