# Master Port Plan — WPR Front Debugging Tool (modernized port)

> **Source of truth for behavior (legacy):** `../wpr-front-debugging-tool-legacy` @ v2.2.4 (WXT 0.19.11 + React 18.3.1).
> **Target:** this repo (WXT 0.21.4 installed + SolidJS ^1.9.15 installed + TypeScript strict, Node 24, pnpm).
> Every fact below was verified by reading the legacy source or its built output (`.output/chrome-mv3/`) on 2026-08-31 — file paths are cited so claims can be re-checked. §1.4 re-verified against the npm registry on 2026-10-06 (Kobalte ratified; versions refreshed).

---

## TL;DR

Port the **entire** legacy extension — 8 entrypoint surfaces, 2 content scripts (isolated + MAIN world), a 13-check WP Rocket detection engine, Known Conflicts DB syncing, Side-by-Side compare, undefined-references finder, WP Rocket Diagnoser support, popup option-toggling, options page, context menus, devtools sidebar pane, and the Exclusion Builder — across **12 ordered phases (P0–P11)**.

Ordering logic: **foundations → shared contracts/engine → data producers (background, content scripts) → data consumers (devtools panel, popup, options) → independent satellite (exclusion builder) → hardening/release.** Each phase is independently verifiable and ends with all quality gates green.

Non-negotiable direction on every ported feature:

- **Faster & lighter** — verified legacy baselines (see §1) become hard budgets: e.g. isolated content script ≤ 60 KB raw (legacy 119 KB), panel JS ≤ 600 KB hard / ~350 KB target (legacy ~1.6 MB). Fine-grained SolidJS reactivity, single-pass detection, lazy/heavy-dep loading, no animation/router/toast libraries.
- **More secure** — runtime validation at every boundary (messages, storage, page DOM data), least-privilege manifest with documented `host_permissions` (legacy had none — see §1), no untrusted string → HTML anywhere, capped error-word capture.
- **More reliable** — fixes for real legacy bugs found during this audit (stuck single-flight flag in the KC updater, hook-order violation in DiagnoserPage, unresolved Promise when a page has no scripts, wrong `window.open` arg, dead search next/prev protocol, dead 50-error cap, mislabeled "Lazyload" badge on the Preloaded page — all listed in §6).
- **Better UI, categorically** — a purpose-built Kobalte + Tailwind v4 design system (dark-first, devtools-compact density, light mode, keyboard-complete, `prefers-reduced-motion`-aware) replacing legacy's shadcn/framer-motion look; virtualized resource lists; real JSON tree instead of syntax-highlighted dumps; inline regex validation in the Exclusion Builder; skeleton loaders; empty/error states everywhere.

Estimated flow: P0–P1 foundations (1 unit), P2–P4 producers (1–2 units), P5–P7 the devtools panel (2–3 units), P8–P10 satellites (1–2 units), P11 release (1 unit). Phases P2/P3/P4 can proceed in parallel after P1; P8–P10 in parallel after their stated deps.

---

## 1. Verified facts this plan is built on

### 1.1 Legacy inventory (what must reach parity)

Entrypoints (`entrypoints/`):

| Legacy surface            | File(s)                                                                                                    | What it does                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background`              | `index.ts`, `RequestInterceptor.ts`, `knownConflictsBackground.ts`, `setContextMenus.ts`                   | Captures main-frame response headers via `webRequest.onResponseStarted` (per-tab map); hourly KC-DB alarm update from `https://mega.wp-rocket.me/support/kc/known-conflicts.json` (+ onStartup + context-menu manual trigger); 4 context-menu items (Side-by-Side, PSI Side-by-Side, Exclusion Builder, Update KC DB) |
| `devtools`                | `main.ts`                                                                                                  | Creates panel "WPR FDT legacy" → `fdt.html`; `panel.onSearch` → `devToolsSearch` messages; Elements sidebar pane "WPR Lazyload" that evals a static expression against `$0` on selection change; sends `processPageData` on load                                                                                      |
| `fdt` (→ `panel/`)        | `App.tsx`, `main.tsx`, 8 page files, 4 shared components, `components/diagnoser/*` (7 cards + utils/types) | Hash-routed (wouter) panel: Detections, Diagnoser (General/Optimizations tabs), JavaScript, Lazyload, Preloaded Resources, Undefined References; fetch/error/empty states; DevTools-search integration; lazy syntax highlighting via `useLazyLoad` (IntersectionObserver)                                             |
| `exclusion-builder`       | `App.tsx`, `pages/ExclusionBuilder/ExclusionsBuilderPage.tsx`, `utils.ts`, `override-notice.html`          | Unlisted page; File System Access API (`showOpenFilePicker`, text/html, readwrite); 4 exclusion textareas (Delay JS, Defer JS, ALR, Lazyload); per-feature apply-or-fully-disable switches; writes modified HTML back to the file; injects "overwritten page" notice script+styles into the saved HTML                |
| `options`                 | `App.tsx`                                                                                                  | One section "Improvements", one toggle (`wp-dashboard-dbugger-entry`); save to `sync:options`                                                                                                                                                                                                                         |
| `popup`                   | `App.tsx`, `main.tsx`, `pages/activate-deactivate-options.tsx`                                             | `main.tsx` sends `processPageData` to the tab's CS on open (warm-up); fetches `getWPRDetections` for active tab; 12 switches (Cache + 11 options); Apply/Reset rewrites Diagnoser URL params via `chrome.tabs.update`; fixed 320×576 px                                                                               |
| `isolatedWord.content.ts` | wires 4 modules                                                                                            | `document_start`, all http/https                                                                                                                                                                                                                                                                                      |
| `mainWord.content.ts`     | `undefinedReferencesCapture`                                                                               | `document_start`, `world: 'MAIN'`                                                                                                                                                                                                                                                                                     |

Non-entrypoint logic:

| Module              | File                                                                                   | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content data hub    | `content-scripts/devtoolsContentScript.ts`                                             | On `DOMContentLoaded`: serializes page HTML, fetches headers from background, tells devtools to reload. On demand (`processPageData`): `DOMParser`-parses the **serialized** HTML (not live DOM), runs all 13 detection checks + preloaded-resources + diagnoser JSON extraction (`jsonrepair`), sets `wpr.present = true` if any optimization (except `defer_all_js`/`wpr` itself) is present; serves `getFDTData` / `getWPRDetections` / `getDiagnoserData`; relays error words and `allScriptsLoaded`    |
| Detection engine    | `lib/wprDetection.util.ts`                                                             | 13 pure checks (`wpr`, `remove_unused_css`, `async_css`, `delay_js`, `defer_all_js`, `lazyload`, `lazyload_iframes`, `lazyload_css_bg_img`, `rocket_above_the_fold_optimization`, `minify_css`, `minify_js`, `preload_links`, `rocket_cdn`) + `checkPreloadedResourced`; regex footprints (meta generator version, `this.v=` DelayJS version, `cache/min/N/` URLs, `.rocketcdn.me` dns-prefetch); 24-entry `LAZYLOAD_EXCLUSIONS_LIST`                                                                       |
| Error capture       | `content-scripts/undefinedReferencesCapture.ts`                                        | MAIN world; `error` + `unhandledrejection`; regex-extracts undefined identifiers (`ReferenceError: X is not defined`, `Cannot read properties of undefined (reading 'X')`, `TypeError: X is not a function` → last path segment); 500 ms debounced batches via document `CustomEvent` (`detail.words`); `Script error.` → `__EXTERNAL_ORIGIN_ERROR__` sentinel dispatched as `detail.word` (singular) — **which the isolated receiver ignores, so the sentinel never reaches devtools in legacy** (bug #21) |
| Known Conflicts UI  | `content-scripts/known-conflicts/index.ts` + HTML/CSS                                  | Two modes: HelpScout `secure.helpscout.net/conversation/*` (SPA; MutationObserver + debounced re-scan, URL-change tracking) and WP admin `plugins.php` (plugin titles scan); fixed-position badge (bottom-left) with shadow-DOM list of conflicts (name, summary, link)                                                                                                                                                                                                                                     |
| Side-by-Side        | `content-scripts/sideBySide/index.ts` + HTML/CSS                                       | Full-page overlay with cached/bypassed iframes (`?nowprocket=1`); refresh-per-side + close; on `pagespeed.web.dev` with `?wpr-sbs=<url>`: auto-opens two PSI analyses for cached vs bypassed; context menu `openSideBySidePerformance` opens PSI with `wpr-sbs`                                                                                                                                                                                                                                             |
| Improvements        | `content-scripts/improvements.ts`                                                      | Option-gated; on `load`, appends "WPR D-bugger" entry (`#wp-admin-bar-d-bugger` → `/wp-admin/tools.php?page=wprockettoolset`) to WP admin bar `#wp-admin-bar-wp-rocket-default`                                                                                                                                                                                                                                                                                                                             |
| Contracts/constants | `Globals.ts`, `Types.ts`, `lib/storage.ts`, `lib/optionNamesMap.util.ts` + 2 JSON maps | 22 message channels (11 used — see below), `WPRDetections`/`PreloadedResources` in `Types.ts` (+ `FDTData`/`DiagnoserData` exported from `content-scripts/devtoolsContentScript.ts`), `sync:options` + `local:known-conflicts-db` (embedded JSON fallback), option → human-name maps (44 entries: 39 + 5)                                                                                                                                                                                                   |

**Dead legacy code (do not port):** 11 unused channels (`devToolsFDTTabId`, `getAllPageData`, `getKnownConflictsDB`, `popupGetDetections`, `newErrorOnPage`, `sendPageData`, `pageLoaded`, `wakeUpContentScript`, `printDataInConsole`, `toggleRUCSSTester`, `getFreshPageHTML` — verified by grep; 22 defined, 11 used), the **`lib/known-conflicts-db.json` duplicate** (44,904 B / 133 entries — dead; `lib/storage.ts` imports `@/known-conflicts-db.json?raw`, i.e. the **root** file, 46,700 B / 137 entries; the two copies have content-diverged), `errors`/`LIMIT` counter in the MAIN-world capture, the document-CustomEvent hop (`CustomEvents`) replaced by the window bridge, commented-out options section and `SomeOptionsCard`.

### 1.2 Legacy manifest (verified from built `.output/chrome-mv3/manifest.json`)

- `permissions: ["contextMenus", "webRequest", "storage", "alarms", "tabs"]`, `minimum_chrome_version: "120"`.
- **No `host_permissions` at all** — despite `webRequest` listeners for `http(s)://*/*`. Per Chrome's webRequest docs, listeners only receive events for URLs covered by host permissions, so header capture likely only works incidentally or not at all; the port declares `host_permissions: ["http://*/*", "https://*/*"]` explicitly (P2 verifies and documents the difference).
- Content scripts: both `document_start`, matches `http://*/* + https://*/*`, MAIN-world variant declared with `world: "MAIN"`.

### 1.3 Verified legacy size/perf baselines → port budgets (hard)

| Surface                                              | Legacy (measured)                                    | Port budget (hard)                                                                                                                                                 | Stretch                                        |
| ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Isolated content script                              | 119 KB raw / 34 KB gzip (`isolatedWord.js`)          | **≤ 60 KB raw / ≤ 20 KB gzip**                                                                                                                                     | ≤ 45 KB                                        |
| MAIN-world content script                            | 1.5 KB                                               | ≤ 2 KB                                                                                                                                                             | —                                              |
| Background                                           | 17 KB raw                                            | ≤ 25 KB raw                                                                                                                                                        | —                                              |
| Panel JS (main chunk)                                | ~1.6 MB (`chunks/fdt-*.js` 1,576 KB + shared chunks) | **≤ 600 KB**                                                                                                                                                       | ≤ 350 KB (excluding lazy shiki grammar chunks) |
| Popup / Options / Exclusion-builder JS               | small (≤ 60 KB total)                                | ≤ 50 KB each                                                                                                                                                       | —                                              |
| Page-processing time (content-script detection pass) | logged by legacy (`Took: X ms`)                      | **≥ 30 % faster median** on the fixture corpus (§5); new log format `[WPR FDT] Page data processed in X ms` — benchmarks compare _elapsed values_, not log strings | —                                              |

Also: shared KC-DB JSON chunk (legacy 56 KB incl. storage util) must load only where needed — content scripts get it via storage/background, never statically embedded (this alone removes ~45 KB from the CS bundle).

### 1.4 Stack decisions (verified current on 2026-08-31)

| Area                | Decision                                                                                                                                                                                                                                                                      | Rationale / evidence                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Messaging           | **`@webext-core/messaging` v4** (`defineExtensionMessaging` for runtime contexts incl. devtools/popup/background with tab-targeted `sendMessage(type, data, tabId)`; `defineWindowMessaging` from the **`@webext-core/messaging/page` subpath** for the MAIN↔ISOLATED bridge) | v4.0.0 released 2026-07-25 (drops polyfill, uses `chrome` global); WXT 0.21 has **no** built-in messaging util (verified: no `wxt/utils/messaging` in installed dist). Contract map lives in `lib/messaging/` |
| Storage             | WXT `storage.defineItem` (auto-imported; verified in `.wxt/types/imports.d.ts`)                                                                                                                                                                                               | Already the CLAUDE.md convention; legacy used the same underlying lib                                                                                                                                         |
| Styling             | **Tailwind CSS v4** (`@theme` tokens, CSS-first config)                                                                                                                                                                                                                       | Current major; removes tailwind.config/PostJS setup legacy needed                                                                                                                                             |
| Headless UI         | **`@kobalte/core` 0.13.x** wrapped by our own `components/ui/*`                                                                                                                                                                                                               | 0.13.14 is current stable (2026-10-06; Solid-authored, lighter dep graph than Zag-based Ark UI; ratified vs Ark UI 5.39.3); its Solid-2.0 migration PR is not merged — do not jump majors mid-port            |
| Icons               | `lucide-solid`, latest stable at install (1.52.0 at re-verification; tree-shakable)                                                                                                                                                                                           | Direct Solid equivalent of legacy `lucide-react`                                                                                                                                                              |
| Syntax highlighting | **shiki 4.5.0 fine-grained bundle** (JS + JSON langs, one dark theme), dynamic-imported, panel-only                                                                                                                                                                           | Replaces `react-syntax-highlighter`; only loads when a code block is on screen                                                                                                                                |
| JSON viewing        | Custom `JsonValue` tree component                                                                                                                                                                                                                                             | Replaces JSON-in-syntax-highlighter dumps; renders real trees with collapsible nodes                                                                                                                          |
| Animation           | CSS transitions/keyframes only (`prefers-reduced-motion` respected)                                                                                                                                                                                                           | Replaces framer-motion (large React-only dep)                                                                                                                                                                 |
| Panel routing       | ~30-line hash router on a Solid signal                                                                                                                                                                                                                                        | Replaces wouter; fixed 6-page app needs no router dep; hash keeps tab across reloads (parity)                                                                                                                 |
| Toasts              | Small custom store + `components/ui/toast.tsx`                                                                                                                                                                                                                                | Replaces react-hot-toast                                                                                                                                                                                      |
| Virtualization      | `@tanstack/solid-virtual` (verify latest at install) for lists > 100 rows                                                                                                                                                                                                     | Image-heavy pages produce thousands of rows; legacy rendered all                                                                                                                                              |
| JSON repair         | Keep `jsonrepair` (latest v3), **dynamic-import** inside the content-script diagnoser parser                                                                                                                                                                                  | Parity with legacy tolerance for malformed diagnoser JSON, without taxing the CS bundle                                                                                                                       |
| Testing             | Vitest + `@solidjs/testing-library` + happy-dom; colocated `*.test.ts`; adds the `test` gate to CLAUDE.md                                                                                                                                                                     | CLAUDE.md defers the test gate to "when the test runner exists" — P0 adds it                                                                                                                                  |
| Devtools APIs       | `browser.devtools.*` from `@wxt-dev/browser` — **verified typed** (devtools.panels/inspectedWindow incl. onSearch)                                                                                                                                                            | No fallback shim needed                                                                                                                                                                                       |

### 1.5 Target entrypoint layout (WXT conventions, fixed by CLAUDE.md)

```
entrypoints/
  background/            # index.ts + headers.ts + known-conflicts.ts + context-menus.ts
  devtools/              # panel registration + Elements sidebar pane
  panel/                 # fdt.html successor — the devtools panel (app shell + pages/)
  popup/  options/  exclusion-builder/
  isolated.content.ts    # data hub + known conflicts + side-by-side + improvements
  main-world.content.ts  # undefined-references capture
lib/
  messaging/  storage/  detection/  diagnostics/  known-conflicts/  side-by-side/
  exclusions/  options-map/  wp-rocket/   # domain modules, self-contained, colocated data
components/  components/ui/               # shared Solid components + design-system primitives
utils/                                    # generic pure helpers
```

---

## 2. Architecture (target data flow)

```
                         ┌────────────────────────────── background (SW) ─────────────────────────────┐
                         │  headers: webRequest.onResponseStarted → per-tab cache (cap, onRemoved GC) │
                         │  KC DB: alarms(60m) + onStartup + manual → fetch → validate → local:storage│
                         │  context menus → messages to CS(tabId) / open exclusion-builder tab        │
                         └──────▲──────────────────────────────────────────────────▲───────────────────┘
                                │ runtime messaging                                │
┌── MAIN world CS ─┐  window   │ ┌───────────────────────── isolated CS ───────────┴───────────────────┐ │
│ error capture    │ messenger │ │ data hub: serialize HTML on DOMContentLoaded → headers → notify     │ │
│ (regex extract,  ├───────────┼─▶ devtools; lazy process on demand; serve FDT/detections/diagnoser  │ │
│  dedupe, cap 50) │ (validated│ │ known-conflicts UI (shadow root); side-by-side UI (shadow root);    │ │
└──────────────────┘  batches) │ │ improvements (D-bugger menu entry)                                  │ │
                               └──────────▲──────────────────▲──────────────────────────────────────┘ │
                                          │ tab messaging    │
                    ┌─────────────────────┴───┐   ┌──────────┴─────────┐   ┌──────────────────────┐
                    │ devtools page → panel   │   │ popup (active tab) │   │ options (sync store) │
                    │ onSearch next/prev push │   │ toggles + apply    │   │ improvements         │
                    │ Elements sidebar pane   │   │ Diagnoser params   │   └──────────────────────┘
                    └─────────────────────────┘   └────────────────────┘
   exclusion-builder (unlisted page): pure lib/exclusions engine + FSA file IO (+ FF fallback)
```

Rules baked into this architecture:

- **The content script never holds page-derived state that outlives its context** — every listener/observer registers through `ContentScriptContext` and cleans up via `ctx.onInvalidated`.
- **Everything crossing a boundary is validated** (message payloads, storage reads, KC DB entries, error words) by unit-tested guards in the owning module.
- **Heavy work is lazy:** detection runs on demand (parity), `jsonrepair` and shiki load via dynamic import, virtualization kicks in past 100 rows.
- **No embedded 45 KB JSON in content scripts** (KC DB is owned by background; CS reads storage, background seeds it if empty).

---

## 3. Phase order & dependency graph

```
P0 Foundations ──► P1 Domain & contracts ──┬─► P2 Background ──┐
                                           ├─► P3 Isolated CS ─┼─► P5 Panel shell & design system
                                           └─► P4 MAIN-world CS┘        │
                                                                        ├─► P6 Panel pages ─► P7 Diagnoser
                                                                        ├─► P8 Popup
                                                                        ├─► P9 Options
                                                                        └─► P10 Exclusion Builder
                                     P6..P10 ─► P11 Hardening & release
```

| Phase      | Depends on                                            | Parallelizable with              |
| ---------- | ----------------------------------------------------- | -------------------------------- |
| P0         | —                                                     | —                                |
| P1         | P0                                                    | —                                |
| P2, P3, P4 | P1                                                    | each other                       |
| P5         | P0, P1 (mockable data; real verification needs P3/P4) | P2–P4 (with mocked data)         |
| P6         | P5 (+P3 for live data)                                | P7 (after P6 shell), P8, P9, P10 |
| P7         | P6, P1 (diagnoser parser)                             | P8, P9, P10                      |
| P8         | P1, P3 (detections), P5 (design system)               | P9, P10                          |
| P9         | P1, P5                                                | P8, P10                          |
| P10        | P1 (engine is standalone), P5                         | P6–P9                            |
| P11        | all                                                   | —                                |

Ordering rationale: contracts before consumers (P1 first prevents rework); producers before panel so the panel is verified against real data, not mocks alone; panel shell before pages so pages share one navigation/loading/search skeleton; popup/options/builder last among features because they are small satellites; hardening last so it audits the real surface area.

---

## 4. Cross-cutting conventions (enforced in every phase)

1. **TSDoc everywhere, `why` over `what`** — per CLAUDE.md; no JSDoc types in `.ts`.
2. **Strict types, no `any`** — legacy's `DiagnoserData = { noRocketData: any }` becomes a real discriminated type in P1 (verified against the diagnoser plugin's JSON shape; unknown fields stay `unknown` and are narrowed at render).
3. **Solid, not React** — no destructured props; components run once; `createMemo` for derived lists; `For`/`Show`/`Dynamic`.
4. **Error model** — "couldn't run at all" throws typed errors (e.g. `InvalidExclusionError`); "operation failed" returns a result the UI branches on; every `browser.*` call checks rejections; best-effort side work (e.g. devtools notify) never masks primary failures.
5. **Validation helpers** are per-module pure functions with tests — no schema library in content-script bundles.
6. **Naming** — ports keep user-facing strings identical unless listed as an enhancement (e.g. "Excluded by FDT legacy" → "Excluded by FDT"); internal names follow WXT layout above.
7. **Logging** — single `lib/logger` prefix `[WPR FDT]`; page-processing keeps a timing log (new format, see §1.3) so manual comparisons stay possible; no logging of page content or sensitive data.
8. **Commit / docs** — Conventional Commits; CLAUDE.md updated whenever a phase adds scripts, deps, permissions, or surfaces (each phase file lists exactly which updates).

---

## 5. Verification methodology (applies to all phases)

1. **Fixture corpus (P1):** capture real-world HTML from WP Rocket test sites (cached, uncached, `?nowprocket`, DelayJS old/new type variants, ALR, minify, CPCSS, PSI pages) into `lib/detection/fixtures/`. The 13 detection functions run against every fixture in tests; snapshots pin behavior; the port's output must match legacy's algorithm on the corpus (a one-off comparison harness ports legacy `wprDetection.util.ts` as a test-only reference — never shipped).
2. **Side-by-side extension comparison:** load legacy build + new build together; on each fixture page assert identical detections (script lists, counts, versions, headers-derived cards) and compare the timing logs.
3. **Manual checklists per phase** (each phase file) including Firefox spot-checks for every phase touching content scripts or file APIs (`pnpm dev:firefox`).
4. **Budget checks:** after each producer/consumer phase, `pnpm build` + measure `du -k` per surface against §1.3; regressions block the phase.
5. **Security pass per phase:** enumerate every new boundary (message type, storage key, DOM injection) and confirm a validator exists + is tested.
6. **Improvement enforcement (how "better than legacy" is made fail-able):** the headline claims are not aspirations — each has a mechanism that can fail:
   - **Speed (≥ 30 % median):** automated bench harness (`pnpm bench:detection`, P1) times the port engine against the test-only legacy reference over the whole fixture corpus and asserts the ratio; a scripted real-page protocol (P11) cross-checks in a real browser.
   - **Size:** `pnpm check:budgets` (P0) measures every built surface (raw + gzip) against the §1.3 table and exits non-zero on breach; each building phase runs it (its checklist names the surfaces it owns).
   - **Dependency bans:** eslint `no-restricted-imports` blocks `framer-motion`/`wouter`/`react-hot-toast`/`react-syntax-highlighter` (P0); P11 diffs `pnpm ls --depth 0` against the §1.4 stack table.
   - **Test coverage:** vitest coverage thresholds on `lib/**` + `utils/**` fail `pnpm test` below the bar (P0).
   - **UI:** axe 0-violations, keyboard-only checklists, automated long-task gate on a committed 5,000-row fixture (P6), grep gates for motion-token and palette-token usage (P11).
   - **Per-phase enhancements:** P11 re-audits every phase's _Explicit enhancements_ list item-by-item (DELIVERED / DEFERRED / DROPPED + evidence) — a phase cannot pass having shipped parity-only work silently.

---

## 6. Legacy bugs & quirks found in this audit (fix during the owning phase)

| #   | Bug (verified in source)                                                                                                                                                                                                         | Owning phase                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | `knownConflictsBackground.updateKnownConflictsDB` sets `updating = true` and only resets it on success — any failed/empty fetch leaves updates permanently disabled until SW restart                                             | P2                                         |
| 2   | No `host_permissions` in legacy manifest, yet `webRequest` listeners target all http/https (headers feature is at risk / undocumented)                                                                                           | P2                                         |
| 3   | Context-menu `sendMessage(...).catch((e) => e)` swallows errors into an unused value                                                                                                                                             | P2                                         |
| 4   | `DiagnoserPage` calls `useState` after a conditional early return (Rules-of-Hooks violation)                                                                                                                                     | P7 (obsolete pattern; noted for parity)    |
| 5   | `ServerInfoCard` colors the Server Load badge using `serverInfo !== null` (always true) instead of `serverLoad !== null`                                                                                                         | P7                                         |
| 6   | `loadJSResourcesContent` (Undefined References) never resolves when the page has zero script resources (last-index callback trick), and pushes per-callback with a fragile index check                                           | P6                                         |
| 7   | `UndefinedReferencesFinderPage` keeps module-level mutable state (`allScriptAssets`, `referencesDefinitions`, `setReadyInterval`) shared across mounts; interval leaks                                                           | P6                                         |
| 8   | `DevToolsSearch` protocol defines `nextSearchResult`/`previousSearchResult` but pages ignore them (only `performSearch` handled)                                                                                                 | P6 (implement)                             |
| 9   | Preloaded Resources page labels the feature badge "Lazyload" (copy bug)                                                                                                                                                          | P6                                         |
| 10  | `ResourceItem` typo "Trucated," and expandability measured via `clientHeight === scrollHeight` after render (layout thrash)                                                                                                      | P6                                         |
| 11  | `undefinedReferencesCapture` declares `errors`/`LIMIT = 50` but never increments/errors-check uses `getTheWord`'s dead branch                                                                                                    | P4 (implement real cap)                    |
| 12  | Known Conflicts opens links with `window.open(url, '__blank')` — second arg is a window _name_; should be `_blank`                                                                                                               | P3                                         |
| 13  | Known Conflicts injects DB-provided strings via `innerHTML` (names/summaries) — our server data, but must be text-rendered anyway                                                                                                | P3                                         |
| 14  | `checkLazyLoad` runs `outerHTML.includes()` × 23 exclusion patterns for **every** image (24-entry list minus `data-lazy-src`), though the UI only shows reasons for non-lazyloaded images                                        | P1 (halve work, keep output shape)         |
| 15  | Popup toggles are `<input>` + `<span onClick>` — not keyboard accessible; `handleToggle` on label vs input inconsistent                                                                                                          | P8                                         |
| 16  | Options page "Saving…" is a fake 1000 ms `setTimeout`; errors swallowed without detail                                                                                                                                           | P9                                         |
| 17  | `WPRDetectionsPage`/pages use module-level `runAnimations` flags to suppress re-entry animations (React remount hack)                                                                                                            | P6 (CSS-on-mount instead)                  |
| 18  | `App.tsx` (panel) holds `bouncer` timeout outside effect cleanup discipline; search state reset on location change handled in second effect                                                                                      | P6 (Solid-native)                          |
| 19  | Side-by-Side `refresh` assigns `iframe.src = iframe.src` (no-op-ish reload), and modal open/close uses `setTimeout(10)` animation hacks                                                                                          | P3                                         |
| 20  | RequestInterceptor header map grows per tab until `onRemoved`; no cap (browsers with hundreds of tabs)                                                                                                                           | P2 (cap + GC)                              |
| 21  | MAIN-world capture dispatches the `__EXTERNAL_ORIGIN_ERROR__` sentinel as `detail.word` (singular, unbuffered) but the isolated receiver only reads `detail.words` (array) — cross-origin "Script error." never reaches devtools | P4 (route the sentinel through the bridge) |
| 22  | Undefined References renders inline-script definitions as broken links: the asset is named `'In an Inline Script.'` but the renderer compares `def === 'Inline Script'` (never true) → `<a href="In an Inline Script.">`         | P6 (render inline entries as chips)        |
| 23  | `OptimizationInfoItem`: the expanded-JSON block condition is `Array.isArray(v) \|\| (longString && expanded)` — arrays always render expanded, so the chevron toggle is a no-op for them                                         | P7 (consistent collapse via `json-value`)  |
| 24  | `useLazyLoad`'s IntersectionObserver is never disconnected (`TODO` in source) — leaks one observer per rendered code block                                                                                                       | P5 (observer util with cleanup)            |

---

## 7. Risk register

| Risk                                                                      | Mitigation                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@webext-core/messaging` v4's `chrome`-global vs WXT's `browser` interop  | P0 spike: one message round-trip (bg ↔ CS ↔ devtools) before P1 contracts are finalized                                        |
| Chrome MV3 `webRequest` needs host permissions (legacy gap)               | Declared in P0 manifest with why-comment; P2 verifies header capture on real pages                                             |
| Devtools contexts are flaky messaging peers (panel reloads on navigation) | Keep legacy's reload-on-`DOMContentLoaded` flow; panel treats "no content script" as a first-class error state with retry (P5) |
| `showOpenFilePicker` unsupported in Firefox                               | P10 ships an `<input type="file">` + download fallback (feature-detected)                                                      |
| Kobalte minor churn during the port                                       | Pin exact minor; wrap in `components/ui/*` so surface code never imports Kobalte directly                                      |
| Shiki bundle bloat in panel                                               | Fine-grained bundle, 2 languages, 1 theme, dynamic import, virtualized rows; budget check per phase                            |
| Parity drift from "improvements"                                          | Every enhancement lists its parity delta explicitly in the phase file; fixture corpus + side-by-side run guard detections      |
