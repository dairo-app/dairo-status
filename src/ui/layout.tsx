/** The page shell: <head> (SEO + fonts + theme bootstrap), header nav, footer. Every route
 *  renders its body inside <Layout>. Framework-free — server-rendered HTML with a couple of
 *  tiny inline scripts (theme + popovers + tabs) so there is nothing to hydrate. Mirrors the
 *  original chrome: w-[150px] brand slot, button-chrome nav, tabbed "Get updates", theme menu. */
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

// Theme setter, popover auto-close, and a tiny segmented-tabs engine
// (data-tabs > data-tab buttons + data-panel sections).
const CLIENT_JS = `function dsSetTheme(t){try{localStorage.setItem('theme',t);var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}document.querySelectorAll('details[open]').forEach(function(el){el.open=false;});}
document.addEventListener('click',function(e){document.querySelectorAll('details[open]').forEach(function(el){if(!el.contains(e.target))el.open=false;});});
document.querySelectorAll('[data-tabs]').forEach(function(root){root.querySelectorAll('[data-tab]').forEach(function(btn){btn.addEventListener('click',function(){var t=btn.getAttribute('data-tab');root.querySelectorAll('[data-tab]').forEach(function(x){x.setAttribute('data-active',x.getAttribute('data-tab')===t?'true':'false');});root.querySelectorAll('[data-panel]').forEach(function(p){p.hidden=p.getAttribute('data-panel')!==t;});});});});`;

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
          <Footer env={env} page={page} />
        </div>
        <script>{raw(CLIENT_JS)}</script>
      </body>
    </html>
  );
}

// ── Shared button chrome (mirrors the original cva `buttonVariants`) ──────────────────
const BTN_BASE =
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
const BTN_OUTLINE =
  "bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 border shadow-xs";
const BTN_SECONDARY =
  "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-xs";
const BTN_GHOST = "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50";
const BTN_PRIMARY = "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs";
const SIZE_SM = "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5";
const SIZE_DEFAULT = "h-9 px-4 py-2 has-[>svg]:px-3";
const SIZE_ICON = "size-9";

// lucide: copy — used by the RSS/JSON feed copy-inputs.
const COPY_ICON =
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>';
// lucide: message-circle-more — the "Get in touch" contact button.
const GET_IN_TOUCH_ICON =
  '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>';
// lucide: menu — the mobile nav hamburger.
const MENU_ICON = '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>';
// lucide: x — the mobile menu sheet's close button.
const X_ICON = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';
// lucide: check — the subscribe-components checkbox tick.
const CHECK_ICON = '<path d="M20 6 9 17l-5-5"/>';

// The full-shadcn `Input` chrome, reproduced so the subscribe + copy fields match 1:1.
const INPUT_CLASS =
  "border-input selection:bg-primary selection:text-primary-foreground file:text-foreground placeholder:text-muted-foreground dark:bg-input/30 flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40";

// ── Header ────────────────────────────────────────────────────────────────────────────
function NavItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <li data-slot="status-page-header-nav-item">
      <a
        href={href}
        data-active={active ? "true" : undefined}
        class={`${BTN_BASE} ${SIZE_SM} ${active ? BTN_SECONDARY : BTN_GHOST} border ${active ? "border-input" : "border-transparent"}`}
      >
        {label}
      </a>
    </li>
  );
}

function Header({ page, active, env }: { page: Page; active?: "status" | "events"; env: Env }) {
  const home = page.homepageUrl || "/";
  const external = Boolean(page.homepageUrl);
  return (
    <header data-slot="status-page-header" class="bg-background sticky top-0 z-40 w-full border-b">
      <nav
        data-slot="status-page-header-content"
        class="mx-auto flex max-w-2xl items-center justify-between gap-3 px-3 py-2"
      >
        {/* Brand: fixed-width left slot with an outlined size-8 icon button. */}
        <div data-slot="status-page-header-brand" class="flex w-[150px] shrink-0">
          <div class="flex items-center justify-center">
            <a
              href={home}
              target={external ? "_blank" : undefined}
              rel={external ? "noreferrer" : undefined}
              class={`${BTN_BASE} ${BTN_OUTLINE} size-8 overflow-hidden`}
            >
              {page.icon ? (
                <img src={page.icon} alt={`${page.title} status page`} class="size-8" />
              ) : (
                <div class="flex size-8 items-center justify-center font-sans">{initials(page.title)}</div>
              )}
            </a>
          </div>
        </div>
        <ul data-slot="status-page-header-nav" class="hidden flex-row gap-0.5 md:flex">
          <NavItem href="/" label="Status" active={active === "status"} />
          <NavItem href="/events" label="Events" active={active === "events"} />
        </ul>
        <div
          data-slot="status-page-header-actions"
          class="flex min-w-[150px] items-center justify-end gap-2"
        >
          {page.contactUrl ? <GetInTouch href={page.contactUrl} /> : null}
          <GetUpdates env={env} />
          <NavMobile active={active} />
        </div>
      </nav>
    </header>
  );
}

/** Ghost size-8 icon button linking to the page's contact URL, with a hover tooltip. */
function GetInTouch({ href }: { href: string }) {
  return (
    <span class="group relative inline-flex">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        data-slot="status-page-get-in-touch-icon"
        class={`${BTN_BASE} ${BTN_GHOST} size-8`}
      >
        <Icon path={GET_IN_TOUCH_ICON} size={16} />
        <span class="sr-only">Get in touch</span>
      </a>
      <span
        role="tooltip"
        class="bg-primary text-primary-foreground pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 hidden w-fit -translate-x-1/2 rounded-md px-3 py-1.5 text-xs text-balance whitespace-nowrap group-hover:block"
      >
        Get in touch
        <span class="bg-primary absolute top-full left-1/2 z-50 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]" />
      </span>
    </span>
  );
}

/** md:hidden hamburger that drops a small menu of the two nav links (native <details>). */
function NavMobile({ active }: { active?: "status" | "events" }) {
  const link = (href: string, label: string, isActive: boolean) => (
    <li class="w-full">
      <a
        href={href}
        data-active={isActive ? "true" : undefined}
        class={`${BTN_BASE} ${SIZE_SM} ${isActive ? BTN_SECONDARY : BTN_GHOST} w-full justify-start`}
      >
        {label}
      </a>
    </li>
  );
  return (
    <details class="md:hidden">
      <summary
        class={`${BTN_BASE} ${BTN_SECONDARY} size-8 cursor-pointer border list-none [&::-webkit-details-marker]:hidden`}
      >
        <Icon path={MENU_ICON} size={16} />
        <span class="sr-only">Menu</span>
      </summary>
      <div
        data-slot="sheet-content"
        class="bg-background fixed inset-x-0 top-0 z-50 flex h-auto flex-col gap-4 border-b shadow-lg"
      >
        <div data-slot="sheet-header" class="flex flex-col gap-1.5 border-b p-4">
          <div data-slot="sheet-title" class="text-foreground font-semibold">
            Menu
          </div>
        </div>
        <div class="px-1 pb-4">
          <ul class="flex flex-col gap-1">
            {link("/", "Status", active === "status")}
            {link("/events", "Events", active === "events")}
          </ul>
        </div>
        <button
          type="button"
          onclick="this.closest('details').open=false"
          class="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
        >
          <Icon path={X_ICON} size={16} />
          <span class="sr-only">Close</span>
        </button>
      </div>
    </details>
  );
}

// ── Get updates ───────────────────────────────────────────────────────────────────────
/** The tabbed "Get updates" popover: Email (subscribe form), RSS, JSON. Native <details>
 *  trigger + the shared data-tabs engine for the panels. */
export function GetUpdates({ env }: { env: Env }) {
  const rssUrl = `${env.PUBLIC_URL}/feed/rss`;
  const atomUrl = `${env.PUBLIC_URL}/feed/atom`;
  const jsonUrl = `${env.PUBLIC_URL}/feed/json`;

  const tab =
    "text-foreground focus-visible:border-ring focus-visible:outline-ring focus-visible:ring-ring/50 data-[active=true]:bg-background dark:text-muted-foreground dark:data-[active=true]:border-input dark:data-[active=true]:bg-input/30 dark:data-[active=true]:text-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[active=true]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

  return (
    <details class="relative">
      <summary
        data-slot="status-updates-trigger"
        class={`${BTN_BASE} ${SIZE_SM} ${BTN_OUTLINE} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        Get updates
      </summary>
      <div
        data-slot="status-updates-content"
        class="bg-popover text-popover-foreground absolute right-0 z-50 mt-1 w-80 origin-top-right overflow-hidden rounded-md border shadow-md outline-hidden"
      >
        <div data-tabs class="flex flex-col gap-2">
          <div class="bg-muted text-muted-foreground inline-flex h-9 w-full items-center justify-center rounded-none border-b p-[3px]">
            <button type="button" data-tab="email" data-active="true" class={tab}>
              Email
            </button>
            <button type="button" data-tab="slack" class={tab}>
              Slack
            </button>
            <button type="button" data-tab="rss" class={tab}>
              RSS
            </button>
            <button type="button" data-tab="json" class={tab}>
              JSON
            </button>
          </div>

          {/* Email — description + native POST /api/subscribe form. */}
          <div data-panel="email" class="flex-1 flex flex-col gap-2 outline-none">
            <div class="flex flex-col gap-2 px-2 pt-2 pb-0">
              <div class="text-sm">Get email notifications whenever a report has been created or resolved</div>
              <form id="ds-email-form" method="post" action="/api/subscribe" class="flex flex-col gap-2">
                <input type="email" name="email" required placeholder="subscribe@me.com" class={INPUT_CLASS} />
                <label class="flex items-center gap-2 text-sm font-medium leading-none select-none">
                  <span class="relative inline-flex size-4 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      name="subscribeComponents"
                      class="peer border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 checked:border-primary checked:bg-primary absolute inset-0 size-4 shrink-0 appearance-none rounded-none border bg-transparent shadow-xs outline-none transition-shadow focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <Icon
                      path={CHECK_ICON}
                      size={14}
                      cls="text-primary-foreground pointer-events-none relative opacity-0 peer-checked:opacity-100"
                    />
                  </span>
                  Subscribe to specific components
                </label>
              </form>
            </div>
            <div class="bg-border h-px w-full shrink-0" />
            <div class="px-2 pb-2">
              <button
                type="submit"
                form="ds-email-form"
                class={`${BTN_BASE} ${SIZE_DEFAULT} ${BTN_PRIMARY} w-full`}
              >
                Subscribe
              </button>
            </div>
          </div>

          {/* Slack — the /feed slash command to paste into any channel (Slack's RSS app). */}
          <div data-panel="slack" hidden class="flex-1 outline-none">
            <div class="flex flex-col gap-2 px-2 py-2">
              <div class="text-sm">
                For status updates in Slack, paste the text below into any channel.
              </div>
              <CopyInput value={`/feed subscribe ${rssUrl}`} />
            </div>
          </div>

          {/* RSS — RSS + Atom feed URLs. */}
          <div data-panel="rss" hidden class="flex-1 outline-none">
            <div class="flex flex-col gap-2 px-2 py-2">
              <div class="text-sm">Get the RSS feed</div>
              <CopyInput value={rssUrl} />
            </div>
            <div class="bg-border h-px w-full shrink-0" />
            <div class="flex flex-col gap-2 px-2 py-2">
              <div class="text-sm">Get the Atom feed</div>
              <CopyInput value={atomUrl} />
            </div>
          </div>

          {/* JSON — JSON feed URL. */}
          <div data-panel="json" hidden class="flex-1 outline-none">
            <div class="flex flex-col gap-2 px-2 py-2">
              <div class="text-sm">Get the JSON updates</div>
              <CopyInput value={jsonUrl} />
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

/** Readonly URL field with a copy button. Copy reads the value directly — it does NOT select
 *  the text (no highlight) and the field can't take focus (no ring / box growth); the only
 *  feedback is the subtle copy→check glyph flip on the button. */
function CopyInput({ value }: { value: string }) {
  return (
    <div data-slot="status-updates-copy-input" class="relative w-full">
      {/* pointer-events-none + tabindex -1: pure display, so a click never focuses/selects it.
          pr-10 keeps the (long) value clear of the absolutely-positioned copy button. */}
      <input
        readonly
        tabindex={-1}
        value={value}
        class={`${INPUT_CLASS} pointer-events-none pr-10`}
      />
      <button
        type="button"
        onclick={`var b=this,i=b.parentNode.querySelector('input');if(navigator.clipboard){navigator.clipboard.writeText(i.value);}var s=b.querySelector('svg');if(s){var o=s.innerHTML;s.innerHTML='${CHECK_ICON}';setTimeout(function(){s.innerHTML=o;},1000);}`}
        class={`${BTN_BASE} ${BTN_OUTLINE} absolute top-1/2 right-2 size-6 -translate-y-1/2`}
      >
        <Icon path={COPY_ICON} size={16} />
        <span class="sr-only">Copy Link</span>
      </button>
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────────────
function Footer({ env: _env, page: _page }: { env: Env; page: Page }) {
  return (
    <footer data-slot="status-page-footer" class="w-full border-t">
      <div
        data-slot="status-page-footer-content"
        class="mx-auto flex max-w-2xl items-center justify-between gap-4 px-3 py-2"
      >
        {/* Open source — the code is yours to read (in place of a "powered by" badge). */}
        <div class="flex flex-col gap-0.5">
          <p class="text-muted-foreground/80 text-xs leading-none">
            <a
              href="https://github.com/dairo-app/dairo-status"
              target="_blank"
              rel="noreferrer"
              class="text-foreground focus-visible:ring-ring/50 rounded-sm font-medium outline-none focus-visible:ring-[3px]"
            >
              Open source — the code is yours to read →
            </a>
          </p>
        </div>
        <div data-slot="status-page-footer-actions" class="flex items-center gap-2">
          <ThemeSwitcher />
        </div>
      </div>
    </footer>
  );
}

// ── Theme switcher ────────────────────────────────────────────────────────────────────
/** A single click-toggle (no menu): one click flips light ⇄ dark. The icon reflects the
 *  currently rendered mode — sun in light (click → dark), moon in dark (click → light) —
 *  via the `.dark` class the toggle sets, so it updates instantly with no re-render. */
function ThemeSwitcher() {
  return (
    <button
      type="button"
      data-slot="status-theme-switcher"
      onclick="dsSetTheme(document.documentElement.classList.contains('dark')?'light':'dark')"
      class={`${BTN_BASE} ${BTN_GHOST} ${SIZE_ICON} cursor-pointer`}
    >
      <Icon path={ICONS.sun} size={16} cls="dark:hidden" />
      <Icon path={ICONS.moon} size={16} cls="hidden dark:block" />
      <span class="sr-only">Toggle theme</span>
    </button>
  );
}
