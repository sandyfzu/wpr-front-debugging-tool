# WPR Front Debugging Tool

Browser extension that shows how the [WP Rocket](https://wp-rocket.me) WordPress plugin treats the page in the current tab, and lets you try changes on that page without touching the site. Built for the people who support and tune WP Rocket sites. Current version: `version` in [`package.json`](package.json); Chromium-based browsers first (Manifest V3), Firefox second (Manifest V2).

## Features

- **Detections** (DevTools → WPR FDT): whether WP Rocket serves the page and from cache, which optimizations it applies (Remove Unused CSS, Delay JavaScript execution, Load JavaScript deferred, LazyLoad, Minify, CDN, Preload, …) with the evidence for each, response headers, cookies and known plugin/theme conflicts; **Copy report** for support tickets.
- **Inspect lists**: the page's JavaScript (incl. live **Runtime states**), stylesheets, lazyloaded elements, preloaded resources and undefined references — filters, search, a detail pane with highlighted code.
- **Exclusion Builder**: try Delay JavaScript execution, Load JavaScript deferred and LazyLoad for images exclusions on the live page, or simulate those features on a page served without them (Apply / Reset / Stop; the session lasts across the tab's pages).
- **RUCSS Tester**: run WP Rocket's Remove Unused CSS on the page and see the result until it reloads.
- **Beacon Tester** and **LCP & Vitals**: run WP Rocket's own beacon with every site side effect removed, and break down this visit's Largest Contentful Paint and Core Web Vitals.
- **Side By Side**: the cached page next to its cache-bypassed version (desktop or mobile), or both in PageSpeed Insights.
- **On the page**: a draggable detection widget, a status dot on the toolbar icon (green: served from cache, blue: active but not cached, grey: not detected), and a **command palette** (Alt/⌥+K by default, a toolbar click or the right-click menu) listing every on-page action.
- **What's new** page, opened once after an update that announces one. System / Light / Dark appearance on every surface, injected UIs included.

## Screenshots

Pending — produced by the shared capture script (real shipped UI on the local docker site, light + dark): Detections panel, Exclusion Builder overlay, command palette, RUCSS Tester, Beacon Tester, options page.

## Install

Store listings are pending. To load a build: `pnpm build` → `chrome://extensions` → Developer mode → Load unpacked → `.output/chrome-mv3`; Firefox: `pnpm build:firefox` → `about:debugging` → **This Firefox** → **Load Temporary Add-on…** → pick any file in `.output/firefox-mv2` (a temporary add-on is removed when Firefox restarts). Minimum versions: Chrome 145, Firefox 150 (`wxt.config.ts`).

## Development

Node 24 (`.nvmrc`) and the pnpm version pinned in `packageManager`.

```bash
pnpm install --frozen-lockfile
pnpm dev                 # dev build + watch → load .output/chrome-mv3 unpacked (pnpm dev:firefox)
pnpm compile && pnpm lint && pnpm format:check && pnpm test   # types, eslint, prettier, unit tests + coverage
pnpm build && pnpm build:firefox && pnpm check:budgets && pnpm check:html   # builds + size/HTML gates
pnpm zip                 # store zip → .output/ (pnpm zip:firefox also writes the AMO sources zip)
pnpm test:e2e            # browser tier, local only (tests/e2e/README.md); local WP site: docs/local-site-runbook.md
```

Every script, the stack and the repository rules: [`AGENTS.md`](AGENTS.md). Store copy, permission justifications and assets: [`store/`](store/). Icons: edit `branding/icon.svg` (size table `lib/branding/icons.ts`), then `pnpm icons` and `pnpm store:assets`.

## Architecture

[WXT](https://wxt.dev) + [SolidJS](https://solidjs.com) + TypeScript strict + Tailwind CSS v4; Vitest + Playwright. Dependency direction `entrypoints/` → `components/` → `lib/` → `utils/` (lint-enforced).

| Concern                | Owning code                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces               | `entrypoints/` (background, devtools + panel, options, content scripts, on-demand overlays, What's new)                               |
| WP Rocket detection    | `lib/detection/` (vocabulary + footprints: `lib/wp-rocket/`)                                                                          |
| Messages / storage     | `lib/messaging/` (typed contracts, boundary validation) · `lib/storage/` (typed items)                                                |
| Exclusion Builder      | `lib/exclusion-builder/` (engine) · `lib/exclusion-session/` (interception) · [runbook](AGENTS.md#exclusion-builder-sessions-runbook) |
| Feature simulation     | `lib/wp-rocket-simulation/` (parity with the real plugin: `pnpm parity:wp-rocket`)                                                    |
| Live tools             | `lib/rucss-tester/`, `lib/beacon-test/`, `lib/lcp-analysis/`, `lib/web-vitals/`, `lib/script-runtime/`                                |
| Design tokens / UI kit | `assets/css/tokens.css`, `assets/css/theme.css` · `components/ui/` · bar: [`docs/ui-ux-bar.md`](docs/ui-ux-bar.md)                    |
| Release notes          | `lib/release-notes/`                                                                                                                  |

## Privacy

- **Leaves the browser only on a user command:** RUCSS Tester Run → the page address (no fragment or credentials), the Mobile/Home choices and the safelist to WP Rocket's RUCSS service (`lib/rucss-tester/endpoint.ts`; no cookies, no page content); Side By Side Performance → the address opened in PageSpeed Insights (`pagespeed.web.dev`). On Firefox each asks the optional `browsingActivity` data permission first (`lib/data-consent/`).
- **Downloads without user data:** the Known Conflicts list (`apps.wpr-support.com`) and WP Rocket's latest exclusion list (`b.rucss.wp-rocket.me`), the Known Conflicts list fetched on every hourly check, at browser start and on a manual update; the exclusion list checked hourly and refreshed 24 h after its last success; JSON data, validated, never executed.
- **Everything else stays local:** no analytics or telemetry. Options and per-site widget choices sit in the browser's sync storage (they roam with the user's own browser sync); exclusion sets, widget positions, panel layout, tool settings and the cached data files in local storage; builder sessions in session storage. Page data is shown in the tool or logged under `[WPR FDT]` in masked shapes (counts, versions — never markup, scripts or full addresses; a builder session page's origin + path at most). The live tools send nothing: the Beacon Tester runs the bundled `wp-rocket-scripts` beacon without asking or saving anything on the site.

Full store disclosure: [`store/listing.md`](store/listing.md#data-use--privacy-fields).

## Known limitation: Firefox scrollbars

Firefox follows the platform's scrollbar behavior: with auto-hide on, bars can vanish at idle. Scroll, or focus a region and use the arrow keys, to reveal them; on macOS, **System Settings → Appearance → Show scroll bars → Always** keeps them visible. The extension never changes this setting.
