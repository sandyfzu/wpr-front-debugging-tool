# Phase 5 — Devtools entrypoint, panel app shell & design system

**Depends on:** P0 (design tokens), P1 (contracts). Real-data verification needs P3/P4. **Effort:** L. **Parallelizable with:** P2–P4 (mock data first).

## Goal

Register the devtools panel + Elements sidebar pane, and build the panel's application shell and the shared design-system components that P6–P10 consume. This is the phase that makes the UI categorically better: a purpose-built, compact, keyboard-complete devtools design system.

## Legacy reference

- `entrypoints/devtools/main.ts` — `chrome.devtools.panels.create('WPR FDT legacy', 'icon/32.png', 'fdt.html')`; `panel.onSearch` → `devToolsSearch` messages to devtools target with inspected `tabId`; `createSidebarPane('WPR Lazyload')` in Elements: static eval expression against `$0` (lazyload detected / imageLoaded / excludedReasonsFound / src) set via `setObject`, re-eval on `onSelectionChanged`; sends `processPageData` at startup.
- `entrypoints/fdt/main.tsx` + `App.tsx` — hash router (wouter), fetch-state machine (`isLoading/isError/isOk` symbols) around `getFdtData`, live updates via `allScriptsLoaded` + `undefinedReferencesUpdated` + debounced `devToolsSearch`; `reloadDevTools` → `window.location.reload()`; menu = 6 items (Detections `/`, DiagnoserPage, JavaScriptPage, LazyLoadPage, PreloadedResourcesPage, UndefinedReferencesFinderPage); `pages/Fetching.tsx`, `pages/Error.tsx`, `components/app/devtools/{FetchingComponent,NothingToShow,menu}`.
- Visual baseline (to replace): gray-950 gradient bg, gray-800 cards, blue accents, framer-motion entrance animations, lucide icons, shadcn primitives.

## Tasks

### 1. `entrypoints/devtools/` (registration page)

- [ ] `defineUnlistedScript`-style devtools entry (`main.ts`): create panel `WPR FDT` (icon `icon/32.png`, target `panel.html`) + Elements sidebar pane `WPR Lazyload` (parity: same pane name, same evaluated object shape `{ lazyloadDetected, imageLoaded | excludedReasonsFound, src }` / `{ please: 'Select an IMG element' }`), re-eval on selection change + initial eval (parity).
- [ ] Use `browser.devtools` from `@wxt-dev/browser` — **verified typed** (devtools.panels / inspectedWindow incl. `onSearch`); no shim needed.
- [ ] The lazyload sidebar expression (parity): legacy already builds its eval string from `LAZYLOAD_EXCLUSIONS_LIST` (the duplication is only the runtime stringified copy inside the eval — unavoidable for `inspectedWindow.eval`); the port keeps the same architecture with one hygiene improvement: generate the embedded array via `JSON.stringify(...)` instead of legacy's hand-rolled `reduce` string concatenation (correct quoting, same constant as single source). Eval string is a static constant (no untrusted input; documented).
- [ ] `panel.onSearch` → `panelSearch` messages (typed protocol) with `{ action, queryString }` for **all four** actions (perform/cancel/next/prev — fixes dead protocol, master #8).
- [ ] **Startup warm-up (parity):** the devtools page sends `processPageData` to the inspected tab's CS on load (legacy `main.ts:5-7`), so data is ready when the panel is first opened (the CS also processes lazily on first data request — this is a warm-up, not a requirement).

### 2. `entrypoints/panel/` — app shell

- [ ] `panel.html` + `main.tsx` mounting the Solid app; global CSS = P0 theme.
- [ ] **Hash router (~30 lines, `lib`-quality util colocated in the entrypoint):** `createHashRoute()` returning a signal of the current route (default `detections`), `navigate()`, `<a>`-friendly; preserves parity behavior (hash survives reloads, tab restored) without wouter.
- [ ] **Data layer (`use-fdt-data.ts`):** on mount → `sendMessage('getFdtData', undefined, inspectedTabId)` (tab targeted from devtools context); states `fetching / error / ready` (typed discriminated store, not symbol hack); subscribes to pushes (`allScriptsLoaded`, `undefinedReferencesUpdated`) updating signals granularly; `panelSearch` handling: **250 ms debounce — intentional delta from legacy's 400 ms** (snappier search; listed per the master §4.6 delta rule) → `searchQuery` signal + match navigation signals (`next/prev` increment a cursor — consumed by P6 pages, completing master #18's cleanup of the legacy bouncer); retry button on error (enhancement over legacy's dead-end error page).
- [ ] On `notifyPanelReload` (from CS `DOMContentLoaded`) → `window.location.reload()` (parity).
- [ ] App layout: sticky header (WPR rocket mark + tab nav with icons + keyboard arrows/Home/End, ARIA tablist), main content region with `aria-live` for state changes; route switching via `<Show>` + `Dynamic` (no animation lib; CSS fade/slide on mount only, `prefers-reduced-motion` respected — replaces the `runAnimations` module-flag hack, master #17).

### 3. `components/ui/` — design system primitives (Kobalte-backed; Kobalte never imported outside `components/ui/`)

- [ ] `button.tsx` (variants: primary/secondary/ghost/danger; sizes sm/md; loading state) · `icon-button.tsx`
- [ ] `card.tsx` (surface levels, optional header/footer slots) · `badge.tsx` + `status-badge.tsx` (ok/warn/error/info/neutral — the single source of status colors)
- [ ] `tabs.tsx` (Kobalte Tabs; used by Diagnoser + panel nav) · `tooltip.tsx` · `switch.tsx` (Kobalte; keyboard-complete — fixes legacy popup pattern) · `textarea.tsx` · `input.tsx` · `scroll-area.tsx` (styled native overflow + thin scrollbar; no JS scrolling)
- [ ] `toast.tsx` + `lib`-free toast store (`components/ui/toast-store.ts` — Solid store, `toast.success/error/info`)
- [ ] `empty-state.tsx` (icon + title + description + optional action) · `error-state.tsx` (with retry slot) · `skeleton.tsx` (shimmer)
- [ ] `page-header.tsx` (title + subtitle + actions) · `key-value.tsx` (dense label/value row — the Diagnoser cards' workhorse) · `copy-button.tsx` (clipboard + toast)
- [ ] `code-block.tsx` (shiki 4 fine-grained: dynamic import, `javascript` + `json`, one dark theme; line-wrap toggle; **lazy-render on intersection** via `@solid-primitives/intersection-observer` or a 10-line observer util — parity of legacy's `useLazyLoad`, measured without layout thrash, and **the observer is disconnected on cleanup/`ctx.onInvalidated` — fixes master #24**, the legacy observer leak; falls back to `<pre>` before shiki loads so content is never hidden)
- [ ] `json-value.tsx` — recursive JSON renderer (primitives inline; arrays/objects collapsible with count badges; search-highlight aware) — replaces JSON-dumped-through-syntax-highlighter (Diagnoser + filters)
- [ ] `virtual-list.tsx` — `@tanstack/solid-virtual` wrapper (verify latest) with overscan; used by resource lists (P6) and any list > 100 rows
- [ ] `filter-bar.tsx` — filter chips (single-select, keyboard, counts) + search input (used by JS/Lazyload/Preloaded pages; replaces legacy `FilterButtonsBar` + ad-hoc search)
- [ ] Every primitive: TSDoc, `class` merging via `cn()`, focus-visible rings, disabled/loading states, `data-*` hooks for tests.

### 4. Panel page scaffolding consumed by P6

- [ ] `panel/routes.ts` — route ids + labels + icons (Detections, Diagnoser, JavaScript, Lazyload, Preloaded Resources, **Undefined References** — intentional copy delta: legacy's menu says "Undefined Reference" singular, fixed here; tracked in the P11 copy sweep).
- [ ] `panel/state/` — the store singletons (data, search) with typed selectors; pages never touch messaging directly.

## Explicit enhancements over legacy

- Full design system (tokens, light-ready, compact density, a11y-complete) vs per-page hardcoded Tailwind.
- Search next/prev implemented end-to-end; retry on error; toasts; copy buttons; virtualization; skeleton loaders; reduced-motion; keyboard-complete nav.
- Panel nav with icons + arrow-key navigation; route store; zero router dep.

## Tests

- Hash router util (navigate/back/reload parsing).
- `use-fdt-data` store with mocked messaging (fetching→ready, error+retry, push updates, search debounce + cursor math).
- Primitives: happy-dom render tests for the stateful ones (tabs switch, switch toggle, toast queue, filter-bar select + counts, **`json-value` collapse/expand + primitive rendering**, **`code-block` observer cleanup — an unmounted block's IntersectionObserver is disconnected (master #24)**). Visual primitives get render-snapshot-lite tests only (no pixel tests).

## Verification checklist

- [ ] Gates green; panel bundle measured (main chunk ≤ 600 KB hard; shiki excluded until P6).
- [ ] Manual: open DevTools → "WPR FDT" panel appears; without a WP Rocket page shows fetching → error/retry path (CS missing) gracefully; with P3 landed: ready state + all 6 tabs navigable, hash deep-link survives reload; Elements sidebar shows lazyload info for `$0` on an IMG vs non-IMG.
- [ ] Manual: Ctrl/Cmd+F in the panel triggers `panelSearch` (typing streams debounced into the store); Escape cancels.
- [ ] Keyboard-only pass: nav reachable, focus visible, ARIA tabs semantics valid (axe devtools run on panel page).
- [ ] `pnpm dev:firefox` smoke: devtools page + panel load.

## Docs to update

CLAUDE.md: add `panel/`, `devtools/` surfaces to structure section when landed (it already names them — verify wording matches final names).
