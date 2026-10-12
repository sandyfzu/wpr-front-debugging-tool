# Phase 5 — Devtools entrypoint, panel app shell & design system

**Depends on:** P0 (design tokens), P1 (contracts). Real-data verification needs P3/P4. **Effort:** L — executed as the nine sub-phases below. **Parallelizable with:** P2–P4 (mock data first).

## Goal

Register the devtools panel + Elements sidebar pane, and build the panel's application shell and the shared design-system components that P6–P10 consume. This is the phase that makes the UI categorically better: a purpose-built, compact, keyboard-complete devtools design system.

**UX studies happen here, at design time (user requirement, enforced):** before any shell/page/component code is written, this phase produces a committed UX study — user-journey map for the three real personas (support engineer diagnosing "is WP Rocket caching this page?", QA engineer verifying an optimization after a change, developer inspecting scripts/references), a usability-heuristics audit of the planned information architecture, an interaction-load budget per task ("How many clicks/keystrokes to the answer?" — e.g. _open panel → see cached-or-not_ must be ≤ 1 interaction), and an information-hierarchy decision per page (what's glanceable, what's one click deep, what's hidden until needed). The study's decisions are recorded in `docs/plans/` and bind the P6–P12 implementations; a task later than P5 cannot contradict them without revising the study first. **Study: [`06a-phase-5-ux-study.md`](./06a-phase-5-ux-study.md) — committed 2026-10-12, this phase's first deliverable; its `UX-D1…D14` decisions bind every sub-phase below (traceability rule: 06a §11).**

## Legacy reference

- `entrypoints/devtools/main.ts` — `chrome.devtools.panels.create('WPR FDT legacy', 'icon/32.png', 'fdt.html')`; `panel.onSearch` → `devToolsSearch` messages to devtools target with inspected `tabId`; `createSidebarPane('WPR Lazyload')` in Elements: static eval expression against `$0` (lazyload detected / imageLoaded / excludedReasonsFound / src) set via `setObject`, re-eval on `onSelectionChanged`; sends `processPageData` on load. The eval callback ignores its `isException` argument — a failed eval calls `setObject(undefined)` (master #36).
- `entrypoints/fdt/main.tsx` + `App.tsx` — hash router (wouter), fetch-state machine (`isLoading/isError/isOk` symbols) around `getFdtData`, live updates via `allScriptsLoaded` + `undefinedReferencesUpdated` + debounced `devToolsSearch`; `reloadDevTools` → `window.location.reload()`; menu = 6 items (Detections `/`, DiagnoserPage, JavaScriptPage, LazyLoadPage, PreloadedResourcesPage, UndefinedReferencesFinderPage); `pages/Fetching.tsx`, `pages/Error.tsx`, `components/app/devtools/{FetchingComponent,NothingToShow,menu}`. All message handlers register only inside the `getFDTData` promise's `.then` — searches arriving before data resolves are dropped, and `cancelSearch` (Esc) is a no-op, so stale filters persist until navigation (master #32).
- Visual baseline (to replace): gray-950 gradient bg, gray-800 cards, blue accents, framer-motion entrance animations (unbounded `delay: index * 0.02–0.1 s` stagger — long-list tails animate seconds late — and infinite pulse loops on idle/error/empty states, `prefers-reduced-motion` ignored — master #31), lucide icons, shadcn primitives, hardcoded per-page palettes bypassing the token file. Build-hygiene fact (master #25): legacy's `<link rel="stylesheet" href="@/assets/common.css">` is **silently dropped from the built HTML** (verified in `.output/chrome-mv3` — no such asset exists), so its styles never shipped — verify built HTML, never source HTML.

## Sub-phase structure

**TL;DR:** the phase ships as nine independently implementable, reviewable, and committable sub-phases. Execution: **{P5A ∥ P5B ∥ P5H} → P5C → P5D → {P5E ∥ P5F} → P5I**, with **P5G** riding anywhere after P5B. Every block ends with its own gates green (`compile`/`lint`/`format:check`/`test`) plus its checklist; **P5I** closes the phase (budgets, built-output, the full manual matrix) and hands the browser-observable rows to P5.1 ([`06b`](./06b-phase-5-1-panel-shell-suites.md)).

| Sub-phase                                         | Scope                                                                                                                                                | Depends on   | Parallelizable with   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------- |
| **P5A** — Devtools entrypoint & sidebar pane      | panel + Elements sidebar registration, eval builder + hardening, `panel.onSearch` wiring, warm-up, stub panel page                                   | P1 (done)    | P5B, P5G, P5H         |
| **P5B** — Design-system core primitives           | `components/ui/` wave 1 (shell-facing) + `@kobalte/core`/`lucide-solid` installs                                                                     | P0 (done)    | P5A, P5H              |
| **P5C** — Panel shell core                        | boot + theme-before-mount, hash router, routes registry + stores, data layer (protocol fixes), soft refresh, layout base with a provisional flat nav | P5A, P5B     | P5G, P5H              |
| **P5D** — Adaptive grouped navigation             | the nav's two morphologies, groups, tooltips, live-state items                                                                                       | P5C          | P5G, P5H              |
| **P5E** — Keyboard-first layer                    | focus-on-route-switch, command palette + matcher, `?` shortcuts overlay, Esc semantics                                                               | P5D          | P5F                   |
| **P5F** — Glanceable status bar                   | selectors + strip, segment navigation, stale marker, glanceability contract                                                                          | P5C, P5D     | P5E                   |
| **P5G** — Content-surface primitives              | `components/ui/` wave 2 (page-facing) + `shiki`/`@tanstack/solid-virtual` installs                                                                   | P5B          | P5C–P5F, P5H          |
| **P5H** — Strip design brief & isolation standard | the strip's visual spec (P12 consumes it) + conformance pass over P3's injected UIs                                                                  | P0 (done)    | every other sub-phase |
| **P5I** — Cold-start budget & phase close-out     | perf marks + the budgets timing row + script support, bundle + built-output checks, final manual matrix, design-craft pass, P5.1 handoff             | P5C–P5F, P5G | —                     |

Decomposition rationale: the blocks split at independently verifiable seams — **A** is the only devtools-owned surface; **B/G** split the design system by weight (lightweight shell-facing vs. heavy page-facing, each carrying its own dependency installs); **C** is the minimal working skeleton; **D/E/F** are three separable header-region capabilities (nav shape, keyboard layer, status answers) whose tests and manual passes don't overlap; **H** is the design-doc deliverable the study leaves open (06a §"Still open in P5"); **I** is the measurement + close-out that must see the finished shell.

---

## P5A — Devtools entrypoint & Elements sidebar pane

**Depends on:** P1 (done). **Parallelizable with:** P5B, P5G, P5H.

Registers the devtools panel and the Elements sidebar pane — the surfaces every later block assumes. Until the real shell exists, the panel target is a stub `panel.html` (a minimal Solid mount) that P5C replaces wholesale; registration wiring, not UI, is this block's work.

- [x] Devtools entry (`entrypoints/devtools/index.html` + colocated `main.ts` — WXT folder form, verified: `devtools/index.html` maps to entrypoint type `devtools` and the built manifest carries `devtools_page: devtools.html`): panel `WPR FDT` (icon `icon/32.png`, target `panel.html`) + Elements sidebar pane `WPR Lazyload` (parity: same pane name, same evaluated object shape `{ lazyloadDetected, imageLoaded | excludedReasonsFound, src }`), re-eval on selection change + initial eval (parity). Both created with the callback form (the promise forms are Chrome 151/152+ features, this manifest floors at 145), `runtime.lastError` read inside each callback. Done — `main.ts` is thin registration (three independent guarded steps: panel, sidebar, warm-up) + global uncaught handlers; the stub `panel.html` mounts Solid (placeholder, P5C replaces). Manual: the panel/pane appearing in open DevTools is the browser check (remains for the manual matrix).
- [x] **Sidebar-pane hardening + extension (master #36 + §8):** the eval callback handles its `isException`/`isError` argument — a failed eval logs and `setObject`s `{ evalError }` instead of `undefined`; a non-object result gets the same treatment (all pinned in the result-mapper tests). For non-IMG selections, instead of a dead end, report the element's WP Rocket attribute inventory (`data-rocket-src`, `data-rocket-defer`, a DelayJS `type` value as `type=<value>`, `data-wpr-lazyrender`, `data-wpr-fdt-excluded`, `data-lazy-src`(-srcset)) as `{ rocketAttributes: [...] }`, `{ please: 'Select an element' }` only when nothing applies (copy delta from legacy, tracked in the P15 copy sweep). Non-element selections (text nodes, no selection) fall back too — the inventory branch is element-only by construction. Same static-eval architecture — the string embeds no untrusted input. Done — `sidebar-eval.ts` (builder + mapper, 17 tests running the expression against real happy-dom elements through a `$0`-scoped Function).
- [x] Use `browser.devtools` via WXT's auto-imported `browser` — **verified typed against the installed `@wxt-dev/browser@0.3.4`**: `panels.create` (callback + promise var.), `panels.elements.createSidebarPane`, `elements.onSelectionChanged`, `ExtensionPanel.onSearch(action, queryString?)`, `inspectedWindow.{tabId, eval}` incl. its `EvaluationExceptionInfo` union; `runtime.lastError` read in every callback-style suffix. No shim needed. (The port's panel/pane wiring types the seam it needs — `SearchEventSource` — so tests inject panel doubles without dragging the full API namespace in.)
- [x] The lazyload sidebar expression (parity architecture): the eval string embeds the exclusion array via `JSON.stringify(LAZYLOAD_EXCLUSIONS_LIST)` (replaces the hand-rolled reduce-concat — quoting proven by a test running an IMG whose `class="ls-l slide"` must surface through the embedded copy; also pinned: the shipped expression contains the JSON of the full 24-entry list, and overlapping entries like `skip-lazy` + `class="skip-lazy"` both match, matching the engine's match-by-substring semantics). Attribute names interpolated from the one-declaring-site `lib/wp-rocket/constants`; the IMG-branch-only `data-ll-status` marker stays local to `sidebar-eval.ts`. Eval string is a static constant (no untrusted input; documented).
- [x] `panel.onSearch` → `panelSearch` messages (typed protocol) for **all four** actions — fixes the dead protocol, master #8. Delta note: the protocol row's `performSearch` payload field is `query` (not `queryString` — that is Chrome's own arg name), validated by the existing `parsePanelSearchAction`; local narrowing `toPanelSearchPayload` maps the raw event string against `PANEL_SEARCH_ACTIONS` and drops unknown actions with a warn. Sends are failure-aware: no-receiver (`No listeners`/`Could not establish connection`/`No response`) logs at debug (the expected case until P5C mounts the receiver), any other failure warns; a throwing receiver can never break the relay (receiver-crash test). The shell-side receiver lands in P5C.
- [x] **Startup warm-up (parity):** the devtools page sends tab-targeted `processPageData` to `browser.devtools.inspectedWindow.tabId` on load, expected no-receiver/CS-not-injected → caught at debug (the CS still processes lazily on first data request — warm-up, not a requirement). Manual: watching the send fire on a real devtools open remains for the manual matrix.

**Tests:** the sidebar-pane eval-expression builder (pure string function): IMG object, non-IMG attribute inventory, fallback shapes, and `JSON.stringify` quoting of the exclusion list. **Shipped:** `sidebar-eval.test.ts` (the expression executed against real happy-dom elements, plus the eval-result mapper) and `search-relay.test.ts` (action narrowing + relayed sends over the fake browser, no-receiver/unknown-action/receiver-crash paths).

**P5A receipts:** budgets gained the `devtools page JS` row (`chunks/devtools-*.js`/`devtools.js`, raw 24 KB; measured first build 8.9 KB raw / 3.3 KB gzip — no UI framework ships in this page, ceiling ≈ 2.7× for the plan's remaining devtools-side additions and exclusion-list growth; the whole-build backstop row still covers it). Built evidence: `.output/chrome-mv3/manifest.json` → `devtools_page: "devtools.html"`; `devtools.html` + `panel.html` both reference their emitted chunks. Firefox build green with the same `devtools_page`.

**Done when:** gates green; manual — open DevTools → the `WPR FDT` panel appears (stub content); the Elements sidebar shows the lazyload object for `$0` on an IMG, the rocket-attribute inventory on another element, and an error object on a failed eval (#36); the warm-up fires on devtools open; `panel.onSearch` emits all four `panelSearch` actions (log evidence until P5C's receiver).

---

## P5B — Design-system core primitives (`components/ui/`, wave 1)

**Depends on:** P0 (done — tokens, `utils/theme.ts`, `utils/cn.ts`). **Parallelizable with:** P5A, P5H.

The lightweight, shell-facing half of the design system — what P5C–P5F mount. **Dependencies installed here** (latest stable, `engines`/peer ranges verified at install; Kobalte pinned minor per master §1.4 + the risk register): `@kobalte/core`, `lucide-solid`. Kobalte is never imported outside `components/ui/`; AGENTS.md's dependency record is updated when they land.

- [x] `button.tsx` (variants: primary/secondary/ghost/danger; sizes sm/md; loading state) · `icon-button.tsx` — done 2026-10-12: `@kobalte/core@0.13.14` + `lucide-solid@1.55.0` installed (`latest` verified on the registry; peers `solid-js ^1.9.8` / `^1.4.7` ✓ against 1.9.16). Danger stays on the AA-verified `status-error-soft`/`status-error` pair (an error-token fill with white text fails 4.5:1 in dark); primary keeps `accent-strong` + a brightness-based hover (the lighter `accent` fill breaks contrast in dark).
- [x] `card.tsx` (surface levels, optional header/footer slots) · `badge.tsx` + `status-badge.tsx` (ok/warn/error/info/neutral — the single source of status colors, `UX-D7`) — done 2026-10-12: the vocabulary tables (`STATUS_*_CLASSES`, `STATUS_ICONS`) live in `status-badge.tsx`; the P0 contrast table already gates every status-text-on-soft pair in both palettes.
- [x] `tabs.tsx` (Kobalte Tabs; APG automatic activation) — **the one sub-navigation pattern** (`UX-D10`): every multi-view page (Diagnoser General/Optimizations; P14's Beacon ATF/LCP) uses it, never a bespoke per-page tab mechanism (legacy's triple-sourced tab state, master #38) · `tooltip.tsx` — done 2026-10-12: render tests pin click/controlled switching, automatic arrow activation with disabled-skip + wrap, lazy selection semantics, and the tooltip hover/focus opening with its described-by wiring.
- [x] `input.tsx` (the palette's and filter-bar's field) · `scroll-area.tsx` (styled native overflow + thin scrollbar; no JS scrolling) — done 2026-10-12; the scrollbar colors are token-driven (`var(--line-2/3)`), pure CSS.
- [x] `toast.tsx` + lib-free toast store (`components/ui/toast-store.ts` — Solid store, `toast.success/error/info`) — done 2026-10-12: queue tests pin the FIFO cap (6), dismiss-by-id, clear, per-tone default durations; render tests pin `status`/`alert` roles per tone, fake-timer auto-dismiss, hover/focus pausing, and the close control. Toast tones map onto the status vocabulary tokens (UX-D7).
- [x] `empty-state.tsx` (icon + title + description + optional action) · `error-state.tsx` (with retry slot — the `UX-D9` no-dead-ends pattern's owner) · `skeleton.tsx` (shimmer; rendered only for real waits — no theater, `UX-D6`) — done 2026-10-12: `onRetry` is a required prop (a dead end is a type error); reduced-motion is honored by the global token rule (no infinite idle loops from this set).
- [x] Every primitive: TSDoc, `class` merging via `cn()`, focus-visible rings, disabled/loading states, `data-*` hooks for tests. Compact devtools-grade density; hit areas never below the WCAG 2.5.8 floor (06a §5) — done 2026-10-12: `sm` buttons/icon buttons are exactly 24px (`h-6`/`size-6`), `md` 28px; Kobalte guard added to `eslint.config.js` (Kobalte banned outside `components/ui/`). Gates green; 50 component tests in 13 files, no missed P5C–P5F shell-facing requirement. NOTE for P5C+: happy-dom's `getComputedStyle().animationName` reads `""`, so solid-presence keeps _unselected tab panels_ and _closed tooltip portals_ mounted in tests — they unmount correctly in Chromium; assert selection state (`data-selected`/`aria-describedby`), not DOM removal.

**Tests:** happy-dom render tests for the stateful ones (tabs activation, toast queue). Visual primitives get render-snapshot-lite tests only (no pixel tests).

**Done when:** gates green; the set covers everything P5C–P5F mount — nothing shell-facing missing.

---

## P5C — Panel shell core

**Depends on:** P5A (the registered target + devtools wiring), P5B. **Parallelizable with:** P5G, P5H.

The working skeleton: boots palette-correct, routes, flows data, refreshes safely — with a provisional flat nav (registry-driven, labels only) so routing is verifiable; P5D morphs it without rework. Startup stays lean here — the cold-start measurement is P5I's.

- [ ] `panel.html` + `main.tsx` mounting the Solid app (replacing P5A's stub); global CSS = P0 theme; the shell resolves the stored appearance (system default / dark / light — P0 resolver) and sets `[data-theme]` on `<html>` before mount — no wrong-palette flash when the panel iframe loads (devtools re-attaches reload it).
- [ ] **Hash router (~30 lines, `lib`-quality util colocated in the entrypoint):** `createHashRoute()` returning a signal of the current route (default `detections`), `navigate()`, `<a>`-friendly; preserves parity behavior (hash survives reloads, tab restored) without wouter.
- [ ] **`panel/routes.ts` — the nav registry (one typed table):** route id, label, icon, group, `reserved` flag, optional live-state selector. Today's rows: Detections (Overview), JavaScript, Lazyload, Preloaded Resources (Inspect), **Undefined References** (Diagnose — intentional copy delta: legacy's menu says "Undefined Reference" singular, fixed here; tracked in the P15 copy sweep), Diagnoser (Diagnose, `reserved` — rendered as a **disabled nav row with a "returns with the Diagnoser plugin v2" tooltip** until P7 lands; the menu shape is final today, the swap-in is one flag flip). Future rows land additively with named owners: Headers & Cookies (P6, Inspect), RUCSS Tester (P13, Tools), Beacon & LCP (P14, Tools), Compare (P17 — decision-gated optional SBS panel home, Tools).
- [ ] **`panel/state/` — the store singletons** (data, search) with typed selectors; pages never touch messaging directly. The pure colocated utils live beside them (`entrypoints/panel/{nav,palette,status-bar}/`) and are added by the sub-phase that owns each (D/E/F).
- [ ] **Data layer (`use-fdt-data.ts`):** on mount → `sendMessage('getFdtData', undefined, inspectedTabId)` (tab targeted from devtools context); states `fetching / error / ready` (typed discriminated store, not symbol hack); subscribes to pushes (`allScriptsLoaded`, `undefinedReferencesUpdated`) updating signals granularly; `panelSearch` handling: **250 ms debounce — intentional delta from legacy's 400 ms** (snappier search; listed per the master §4.6 delta rule) → `searchQuery` signal + match navigation signals (`next/prev` increment a cursor — consumed by P6 pages, completing master #18's cleanup of the legacy bouncer); retry button on error (enhancement over legacy's dead-end error page). **Handler registration timing (master #32):** all message handlers (`panelSearch`, pushes, the reload notification — which now drives the soft refresh) register at mount — never inside the data promise's `.then` — so early searches are handled or dropped-with-log, never silently lost; `cancelSearch` clears query + cursor (legacy's Esc no-oped). **Push tab-scoping (master #42):** the panel ignores pushes whose sender tabId differs from `inspectedWindow.tabId` — with two devtools windows open, legacy's un-scoped pushes could reload the wrong panel. (Study rows: `UX-D4`, `UX-D3`.)
- [ ] **Soft refresh on `notifyPanelReload` (from CS `DOMContentLoaded`) — owner-committed delta (2026-10-12), replacing legacy's hard `window.location.reload()`:** the panel refetches `getFdtData` in place (store → `fetching` → `ready`), so route, scroll position, focus and sub-page state all survive the inspected tab's navigation — legacy rebuilt the whole UI on every navigation, the biggest felt jank in daily use. The parity trigger is kept (the CS still notifies on `DOMContentLoaded`); only the panel's reaction changes. A full reload remains the fallback for a contract/validation failure (logged, actionable). (Study row: `UX-D5`.)
- [ ] **App layout base:** sticky header (WPR rocket mark + the nav above), main content region with `aria-live` for state changes; route switching via `<Show>` + `Dynamic` (no animation lib; CSS fade/slide on mount only, `prefers-reduced-motion` respected — replaces the `runAnimations` module-flag hack, master #17). No per-index staggered entrances and no infinite idle-state loops (master #31); each page renders exactly one `h1` and headings never skip levels.

**Tests:** hash router util (navigate/back/reload parsing) · `use-fdt-data` store with mocked messaging (fetching→ready, error+retry, push updates, search debounce + cursor math) · `use-fdt-data` push tab-scoping: pushes from a foreign tab are ignored (master #42) · soft-refresh machine: the transition table — notify → refetch preserving route/scroll/focus; a contract-validation failure → hard-reload fallback flag · nav registry shape (groups, order, reserved row).

**Done when:** gates green; panel main chunk measured (≤ 600 KB hard; shiki excluded until P6); **built-output check (master #25)** — `panel.html` in `.output/chrome-mv3` references its emitted CSS; manual — on the P4.2 site: fetching skeleton → ready state; on a non-WPR page: graceful fetching → error/retry (CS missing); every nav row navigable (Diagnoser's row renders disabled with its tooltip), hash deep-link survives reload; navigating the inspected page soft-refreshes in place with route/scroll/focus preserved, and forcing a contract failure falls back to a full reload with a log; Ctrl/Cmd+F streams typed input debounced into the store and Escape clears filtering immediately; a second devtools window on another tab does not reload this one (master #42). AGENTS.md's structure wording verified against the landed names.

---

## P5D — Adaptive grouped navigation

**Depends on:** P5C. **Parallelizable with:** P5G, P5H.

- [ ] The nav becomes the registry's full consumer with two morphologies chosen by a **container-width query on the app root (CSS container queries — native in Tailwind v4; no JS resize listeners)**: app root ≥ 768 px (docked bottom, undocked) → **top tab bar**, horizontally grouped (Overview / Inspect / Diagnose / Tools), icon + label buttons, horizontal scroll on overflow; narrower (docked right) → **left icon rail** with group separators and the full name in a tooltip. **Mouse is first-class:** generous hit areas, tooltips carry label + live-state detail. (Study rows: `UX-D2`, `UX-D14`; frictions `F2`, `F17`.)
- [ ] **Items carry live state** where the owning page supplies a selector (e.g. Undefined References `N found`, JavaScript `delayed X/Y`, a fresh/stale data dot) — the nav is an information surface; legacy's was six bare labels with no state and no grouping. Reserved rows render disabled with their tooltip in both morphologies; the width → morphology rule is a pure function of container width.

**Tests:** the width → morphology rule as a pure function of container width; live-state selectors resolve against a fixture `fdtData`.

**Done when:** gates green; manual — all three docking geometries (docked bottom = grouped top bar, docked right = icon rail, undocked = free window): no overflow, no dead targets; nav live-state matches the pages; rows reachable by keyboard with visible focus.

---

## P5E — Keyboard-first layer (palette · focus · shortcuts)

**Depends on:** P5D. **Parallelizable with:** P5F.

- [ ] **Command palette, `Cmd/Ctrl+K`:** opens over the panel (focus-trapped, Esc closes); items = the nav registry's pages + an **action registry** (typed, pure): `Reload data`, `Export JSON`, `Toggle appearance` (cycles system/dark/light), `Open Exclusion Builder`, `Show keyboard shortcuts` — later phases add rows locally (`Copy report`, tool runs — P6/P13/P14). Matching is a pure fuzzy matcher (colocated `entrypoints/panel/palette/matcher.ts`, unit-tested): tokens score label + keywords, arrows navigate, Enter runs. A header button opens it for mouse users. (Study row: `UX-D3` — APG combobox keyboard map; friction `F16`.)
- [ ] **Focus management:** on every route switch (nav click, palette, deep-link) focus moves to the page's `h1` (`tabindex="-1"`, announced).
- [ ] **`?` shortcuts overlay:** a dismissable overlay listing all shortcuts (palette, search next/prev, Esc semantics, appearance cycle) — devtools users expect a shortcut surface, and it doubles as the palette's discoverability path. (Study row: `UX-D3`.)
- [ ] Esc semantics consistent shell-wide: Esc closes overlays; the search-Esc clearing is the data layer's single rule (P5C, `UX-D4`) — the two never diverge.

**Tests:** palette matcher: fuzzy scoring over label + keywords, empty query → registry order, action-row dispatch · focus-to-`h1` on route switch (render test) · `?` overlay opens/dismisses; Esc closes both overlay and palette.

**Done when:** gates green; manual — `Cmd/Ctrl+K` jumps to every page and runs an action; `?` lists the shortcuts; Esc closes both; a keyboard-only pass on the shell (nav reachable, focus visible, combobox semantics valid — axe run on the panel page).

---

## P5F — Glanceable status bar

**Depends on:** P5C (the data store), P5D (the header it sits under is final). **Parallelizable with:** P5E.

- [ ] **A persistent strip under the header, built from pure selectors over the data store:** WP Rocket present + version, cached-or-not + relative age, platform/server, data freshness (last fetch/push with a stale marker). Each segment navigates to its owning page. The personas' opening questions are answered at first paint; legacy made you open Detections and read the cards (frictions `F1`, `F18`). Boot renders it before any page data settles — "Not detected" rendered neutrally when WP Rocket is absent (matches the toolbar badge's gray). (Study row: `UX-D1`.)
- [ ] The **480 px glanceability contract** (`UX-D8`): the four segments fully visible without scroll at ≥ 480 px container width; 320–480 px wraps to a second row; nothing scrolls horizontally at any docking geometry.

**Tests:** status-bar selectors: present/version/cached-age/platform/freshness (+ stale marker) from a fixture `fdtData`.

**Done when:** gates green; manual — the status bar answers present/version/cached/freshness at first paint, untouched; each segment navigates to its page; the stale marker flips as data ages.

---

## P5G — Content-surface primitives (`components/ui/`, wave 2)

**Depends on:** P5B. **Parallelizable with:** P5C–P5F (and P5H).

The heavier, page-facing half — P6/P7/P8/P9/P13/P14's consumers. **Dependencies installed here** (latest stable, verified): `shiki`, `@tanstack/solid-virtual`, and `@solid-primitives/intersection-observer` if the code-block observer takes the primitive over a 10-line util. Kobalte rule as in P5B; AGENTS.md's dependency record updated when they land.

- [ ] `switch.tsx` (Kobalte; keyboard-complete — the fix owner for legacy's popup toggle pattern, master #15) · `textarea.tsx`
- [ ] `page-header.tsx` (title + subtitle + actions) · `key-value.tsx` (dense label/value row — the Diagnoser cards' workhorse) · `copy-button.tsx` (clipboard + toast)
- [ ] `code-block.tsx` (shiki 4 fine-grained: dynamic import, `javascript` + `json`, **light+dark theme pair** driven by the appearance hook so code follows the palette — no hardcoded-dark code surfaces; line-wrap toggle; **lazy-render on intersection** via `@solid-primitives/intersection-observer` or a 10-line observer util — parity of legacy's `useLazyLoad`, measured without layout thrash, and the observer is disconnected on cleanup — fixes master #24 + #40: legacy's observer was never disconnected **and** was keyed on a non-reactive `elementRef.current`, so it could fail to attach at all; falls back to `<pre>` before shiki loads so content is never hidden)
- [ ] `json-value.tsx` — recursive JSON renderer (primitives inline; arrays/objects collapsible with count badges; search-highlight aware) — replaces JSON-dumped-through-syntax-highlighter (Diagnoser + filters)
- [ ] `virtual-list.tsx` — `@tanstack/solid-virtual` wrapper (verify latest) with overscan; used by resource lists (P6) and any list > 100 rows (`UX-D10`)
- [ ] `filter-bar.tsx` — filter chips (single-select, keyboard, counts) + search input (used by JS/Lazyload/Preloaded pages; replaces legacy `FilterButtonsBar` + ad-hoc search); chips expose `aria-pressed` (legacy conveyed selection by background color only)

**Tests:** happy-dom render tests for the stateful ones (switch toggle, filter-bar select + counts, `json-value` collapse/expand + primitive rendering, `code-block` observer cleanup — an unmounted block's IntersectionObserver is disconnected, master #24). Visual primitives get render-snapshot-lite tests only (no pixel tests).

**Done when:** gates green; nothing P6 (or the later satellites) consumes missing.

---

## P5H — Strip design brief & injectable-UI isolation standard

**Depends on:** P0 (done), the committed study (06a). **Parallelizable with:** every other sub-phase.

- [x] **On-page-inspector strip design brief committed** (`docs/plans/06c-phase-5-strip-design-brief.md`): the chip/strip visual spec — grouped chips with the P0 status tokens incl. the amber attention state (`UX-D7` vocabulary); iconography per group; density + typography scale for a page-floating element; interaction states incl. hover/press/drag; entrance/motion spec under the motion tokens (`UX-D6` discipline); outcome-banner pattern for tool results; **palette: both, via the P0 tokens — the strip honors the stored appearance (system default / dark / light): the CS resolves it and sets `[data-theme]` on the strip container per the palette rule below**. The committed study constrains the brief's language, status vocabulary and interaction counts (`UX-D7`, `UX-D11`), not its visuals; those are decided here. P12 implements the brief and reports deviations, not designs ad hoc. **(Delivered 2026-10-12 as SB-D1…SB-D16 with a decision index (§17) tracing each to `UX-D`/`F`/master-§9 ids, a §16 deviations template P12 copies into its own doc, and the schema split recorded: §6 state matrix + §7 vocabulary boundary. One source correction verified during the pass: the baseline strip's z-index is `999999999` in its CSS, so `13` §Reference's `2147483647` figure is a doc error — noted in the brief's SB-D1; P12's agent should correct that line when it re-touches `13`.)**
- [x] **Isolation-standard conformance pass over the shipped injected UIs** (the standard lives in the section below, binding since this doc was authored): Known Conflicts + Side-by-Side (P3) verified — shadow-root only, adopted styles, and the palette rule honored **including live restyle** when the appearance setting changes. Gaps are fixed here when small (e.g. a shared live-theme utility if the live-update leg is missing) or recorded to their owner; never silently. **(Verified 2026-10-12: both UIs mount via `createShadowRootUi` + `mountShadowUi` (`known-conflicts/index.tsx`, `side-by-side/index.tsx`), entrypoint CSS ships as the token+feature stylesheet with the `:host{all:initial}` reset; built-output grep of `.output/chrome-mv3/content-scripts/isolated.css` = zero `@font-face`/`@property` blocks → WXT's document-level `<style>` path never fires; no un-scoped injection, no host-CSS reliance, no page-global style writes outside the documented overflow capture/restore and the sessionStorage continuity flag (threat-analyzed in the brief §18 notes). Found gap fixed here: the live-restyle leg was missing — `mountShadowUi` applied the stored appearance once, nothing watched it. Fix: `lib/storage/options.ts` `storedOptionsOrFallback` (the getOptions contract, shared with pushed writes) + `entrypoints/isolated.content/ui/live-theme.ts` (`followStoredAppearance` — apply + watch, apply-on-change only) behind the shared mount; both UIs inherit it, and P12's strip will too. Tests: `ui/live-theme.test.ts` (matrix + corrupt/absence degradation + stop-handle), `ui/mount.test.ts` (theme-before-render, live write over the real item, disposer stops the follow), `options.corrupt.test.ts` (or-fallback). Budgets re-checked green (96.0<97 raw, 33.7<34 gzip). Recorded edge, not fixed: an invalidation landing inside the async mount window leaks the just-armed watch + immature Solid tree as dead detached work (pre-existing, affects the tree before this fix equally); P12's mount-lifecycle work owns it.)**

**Tests:** none of its own (docs + verification); any conformance fix lands with the tests its change requires.

**Done when:** the brief is committed; conformance verified with evidence (or gaps recorded + fixed); gates still green.

---

## P5I — Cold-start budget & phase close-out

**Depends on:** P5C–P5F (shell complete), P5G (full-phase scope). Nothing parallel.

- [ ] **Panel cold-start perf budget (owner-committed 2026-10-12):** the shell emits `performance.mark`s (script start → shell interactive → first data state) and `scripts/budgets.json` gains a typed timing row — panel cold-start ≤ 500 ms on the harness fixture, `measuredBy` the P5.1 e2e spec (the budget script learns the row type — `check-budgets.mjs` + its test; bundle rows unchanged). "Faster than legacy" is a measured gate, not a claim. (Study rows: `UX-D13`, `UX-D6`.)
- [ ] **Phase close-out:** all gates; panel bundle re-measured (main chunk ≤ 600 KB hard); **built-output check (master #25):** every entrypoint HTML in `.output/chrome-mv3` references the emitted CSS — no silently dropped stylesheets (legacy dropped `common.css` on itself); **design-craft pass on the shell** (the standard P6/P12 will enforce back): spacing/alignment on a grid, one accent used semantically, no dead gradient decoration, headings/type ramp consistent, icons from one set at one size grid, motion only on the allowed tokens (`UX-D6`); `pnpm dev:firefox` smoke: devtools page + panel load; the **shell's composition demonstrably traces to the study** (spot-check two `UX-D` decisions live — `UX-D1` first-paint answers, `UX-D5` state survival).
- [ ] **Final manual matrix** — the accumulated per-block manual items re-run as one pass (regression check), then each P5.1 suite row annotates its enabling sub-phase: P5.1 automates what the harness allows (boot states, nav + deep-links, soft refresh, palette, status bar, search streaming, keyboard + axe, nav morphology, the cold-start row, the Elements sidebar rows), the rest records its manual reason.

**Done when:** the timing row recorded + asserted by P5.1's spec; every checklist line of the phase annotated "automated (P5.1)" or "manual (reason)"; gates green.

---

## Explicit enhancements over legacy

- Full design system (tokens, both palettes via the three-way appearance model, compact density, a11y-complete) vs per-page hardcoded Tailwind.
- **Committed UX studies at design time** (journey map, interaction-load budget, per-page information hierarchy) — the "better UI" claim is designed and recorded before build, not asserted after.
- **Strip design language owned with the panel** (one product, two surfaces); injectable-UI isolation standard = shadow-root everything page-facing.
- Search next/prev implemented end-to-end; retry on error; toasts; copy buttons; virtualization; skeleton loaders; reduced-motion; keyboard-complete nav.
- Panel nav with icons + arrow-key navigation; route store; zero router dep.
- **Adaptive grouped nav** (container-query morph: top tab bar / icon rail) with live-state items — vs legacy's flat, stateless menu.
- **Command palette (`Cmd/Ctrl+K`)** + **`?` shortcuts overlay** — keyboard-first navigation legacy never had.
- **Glanceable status bar** — the opening questions answered at first paint (0 interactions).
- **Soft refresh** — panel state survives inspected-page navigation (legacy: full reload on every navigation).
- **Cold-start budget** — panel startup is a measured gate, not an assertion.
- Sidebar pane: eval-failure handling (#36) + rocket-attribute inventory for any selected element (new capability); push messages tab-scoped (#42); no stagger storms or infinite idle loops (#31); built-HTML stylesheet check (#25).

## Injectable-UI isolation standard (binding for P12 + every current/future injected surface)

- [ ] **Every UI injected into a host page lives inside its own shadow root** — WXT `createShadowRootUi` + Solid components, styles via adopted stylesheet injected into that root only. No surface injects un-scoped `<style>`/`<link>` into the host document, no surface relies on host-page CSS (fonts excepted via explicit `@font-face` rules inside the shadow root), no host CSS leaks into the strip (shadow isolation gives this for free — verified, not assumed: the P12 checklist walks a hostile-CSS host page).
- [ ] The devtools panel, popup, options, exclusion-builder and tester pages are extension-owned documents (no host page) — they are exempt from shadow-rooting but still consume the shared tokens/design system.
- [ ] **Palette rule (binding for P3's overlays, the P12 strip, and future injected UI):** injected UIs render correctly in **both** palettes via the P0 tokens and honor the stored appearance (`system` default follows `prefers-color-scheme`; `dark`/`light` override): the owning content script resolves the stored value from `sync:options` (`appearance`) and sets `[data-theme]` on its shadow-root container. Extension-owned documents resolve the same value before mount. The P15 palette screenshots cover both modes of every surface.
- [ ] Known Conflicts (P3), Side-by-Side (P3), the on-page strip (P12) and any future injected UI implement this standard; the P15 audit greps for un-scoped injections (`document.head.append(style`, unscoped `adoptedStyleSheets` on `document`, etc.) as a release gate.

## Docs to update

AGENTS.md: the `panel/`, `devtools/` structure entries verified against the landed names when P5C does (it already names them); the dependency record updated when P5B/P5G install theirs; P5I re-verifies the whole file for the phase.
