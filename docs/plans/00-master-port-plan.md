# Master Port Plan — WPR Front Debugging Tool (modernized port)

> **Behavioral source:** `../wpr-front-debugging-tool-legacy` v2.2.5 (`v2.2.5`, HEAD; WXT 0.19.11/React 18.3.1). The 2026-08-31 audit used v2.2.4; its on-disk zip is stale. v2.2.5's WordPress-7.x KC selector fix is included.
> **Target at audit:** WXT 0.21.4, SolidJS ^1.9.15, strict TypeScript, Node 24, pnpm. Current installed versions/layout/conventions: [AGENTS.md](../../AGENTS.md), lockfile.
> Facts were source/build-verified 2026-08-31. The 2026-10-06 re-audit re-read source/output/history, re-verified §1, refreshed registry versions/ratified Kobalte (§1.4), added bugs #25–#50, and committed §8. The same-day full `wpr-inspector` v4.1.1 audit verified §9/P11–P14 selectors, regexes, strings, and registry versions for `wp-rocket-scripts`.

## TL;DR

Port the complete first baseline plus [`wp-media/wpr-inspector`](https://github.com/wp-media/wpr-inspector) v4.1.1: all extension surfaces, detection, KC syncing, SBS, undefined references, Diagnoser, popup/options, menus/sidebar, Builder, meta detection, on-page strip, RUCSS, and runtime tools. **Port behavior, improve it, never copy structures.**

Execution: foundations/contracts → producers → P4.1–P4.3 browser infrastructure → P16 comparison → panel/satellites → P11–P14 integration → P14.5 coverage/tooling → P14.6 external tests → deferred P7 Diagnoser → P5J header/nav redesign → P15. §3 owns exact dependencies. P17 SBS panel home is optional/decision-gated. Each feature has local browser suites `X.1`; all phases end with gates and their verification checklist green.

Non-negotiable improvements:

- **Faster/lighter:** measured budgets (§1.3), fine-grained Solid, shared detection scans, lazy heavy work, no animation/router/toast libraries.
- **Safer:** validated message/storage/DOM boundaries, justified least-privilege permissions, no untrusted string-to-HTML, bounded error capture.
- **Reliable:** fix §6's verified defects rather than preserve bugs for parity.
- **Better UI:** Kobalte/Tailwind tokens, compact DevTools density, System/Dark/Light everywhere, keyboard/reduced-motion support, virtual lists, real JSON trees, inline regex errors, real-wait skeletons, complete empty/error states.
- **Useful extensions:** badge/report/summary/headers/exclusion bridge/attribute inventory/KC freshness/CI, each with an owner and verification (§8).

P1.1 precedes consumers because a beacon shared by four Priority-Elements features cannot prove any one is applied. P5 shipped as P5A–P5I (2026-10-12/13); only P5J retains its terminal slot. P6 executes as P6A–P6G, parallelizable with P8/P9; P10 is parked. [07c](./07c-phase-6g-search-and-polish.md) splits P6G into .1–.10 (2026-10-16), keeping next/previous search one complete slice and P6.1's close-out unchanged. [README](./README.md) owns the status register; phase files own receipts, including the shipped P4/P16 rounds and early P12A.

Original rough effort: P0–P1.1 one unit; P2–P4 1–2; P4 infrastructure 1–2; P8–P10 1–2; P11–P14 two; P14.5 1–2; P15 one. These estimates do not override dependencies, gates, or parked/decision-gated scope.

## 1. Verified facts this plan is built on

### 1.1 Legacy inventory (what must reach parity)

Paths below refer to the first behavioral source. Phase files retain detailed inventories/contracts.

- **Background (P2):** `entrypoints/background/{index.ts,RequestInterceptor.ts,knownConflictsBackground.ts,setContextMenus.ts}`. Main-frame response headers via `webRequest.onResponseStarted`, per-tab map; KC update hourly/onStartup/manual from `https://mega.wp-rocket.me/support/kc/known-conflicts.json`; four menus: SBS, PSI SBS, Builder, KC refresh.
- **Devtools (P5A):** `entrypoints/devtools/main.ts`. Panel “WPR FDT legacy” → `fdt.html`; `onSearch` relay; “WPR Lazyload” Elements pane evaluates static `$0` expression on selection; startup `processPageData`.
- **Main UI (P5–P7):** `entrypoints/fdt/{App.tsx,main.tsx}`, eight page files, four shared components, seven Diagnoser cards + utils/types. Wouter hash routes: Detections, Diagnoser General/Optimizations, JavaScript, Lazyload, Preloaded, Undefined References. Fetch/error/empty states, DevTools search, viewport-gated highlighting via `useLazyLoad`/IntersectionObserver. Ported as `panel/`.
- **Builder (P10):** `entrypoints/exclusion-builder/{App.tsx,pages/ExclusionBuilder/ExclusionsBuilderPage.tsx,utils.ts,override-notice.html}`. Unlisted page; FSA `showOpenFilePicker` text/html readwrite; Delay JS/Defer JS/ALR/Lazyload exclusion fields and apply-or-disable switches; writes HTML and an overwritten-page script/style notice.
- **Options (P9):** `entrypoints/options/App.tsx`: Improvements section, `wp-dashboard-dbugger-entry` toggle → `sync:options`.
- **Popup (P8):** `entrypoints/popup/{App.tsx,main.tsx,pages/activate-deactivate-options.tsx}`: warm-up, active-tab detections, 12 switches (Cache + 11), Apply/Reset Diagnoser URL params through `chrome.tabs.update`; fixed 320×576.
- **Content entrypoints (P3/P4):** `isolatedWord.content.ts` wires four modules on http/https at `document_start`; `mainWord.content.ts` captures references at `document_start`, MAIN world.

Non-entrypoint behavior:

- **Data hub (P1/P3), `content-scripts/devtoolsContentScript.ts`:** DOMContentLoaded HTML snapshot → background headers → panel reload. `processPageData` parses serialized, not live HTML; runs 13 checks/preloads/`jsonrepair` Diagnoser extraction. Any optimization except `defer_all_js`/`wpr` implies `wpr.present`. Serves FDT/detections/Diagnoser, relays words/scripts-loaded.
- **Detection (P1), `lib/wprDetection.util.ts`:** `wpr`, `remove_unused_css`, `async_css`, `delay_js`, `defer_all_js`, `lazyload`, `lazyload_iframes`, `lazyload_css_bg_img`, `rocket_above_the_fold_optimization`, `minify_css`, `minify_js`, `preload_links`, `rocket_cdn`, plus `checkPreloadedResourced`. Generator version, DelayJS `this.v=`, `cache/min/N/`, `.rocketcdn.me` dns-prefetch; 24 lazyload exclusions.
- **Capture (P4), `content-scripts/undefinedReferencesCapture.ts`:** `error`/`unhandledrejection`; undefined/reading/not-a-function extraction (last path segment); deduped 500 ms document-CustomEvent batches (`detail.words`). `Script error.` dispatches `__EXTERNAL_ORIGIN_ERROR__` as singular `detail.word`, ignored by the receiver (#21).
- **KC UI (P3), `content-scripts/known-conflicts/index.ts` + HTML/CSS:** HelpScout conversations (SPA observer/debounce/URL tracking) or WP `plugins.php` title scans (`th` + `td.plugin-title.column-primary` since v2.2.5/WP 7.x); bottom-left shadow badge/list with names, summaries, links.
- **SBS (P3), `content-scripts/sideBySide/index.ts` + HTML/CSS:** cached/`?nowprocket=1` iframe overlay, per-side refresh/close; PSI `?wpr-sbs=<url>` opens cached/bypassed analyses; menu `openSideBySidePerformance` launches PSI carrying that param.
- **Improvements (P3), `content-scripts/improvements.ts`:** option-gated load-time “WPR D-bugger” (`#wp-admin-bar-d-bugger` → `/wp-admin/tools.php?page=wprockettoolset`) under `#wp-admin-bar-wp-rocket-default`.
- **Contracts (P1):** `Globals.ts`, `Types.ts`, `lib/storage.ts`, `lib/optionNamesMap.util.ts`, two JSON maps. 22 channels, 10 used; FDT/Diagnoser types exported from the hub, detections/preloads from `Types.ts`; synced options/local DB with embedded fallback; 44 option labels (39 + 5).

**Do not port dead material:** 11 unused channels (`devToolsFDTTabId`, `getAllPageData`, `getKnownConflictsDB`, `popupGetDetections`, `newErrorOnPage`, `sendPageData`, `pageLoaded`, `wakeUpContentScript`, `printDataInConsole`, `toggleRUCSSTester`, `getFreshPageHTML`) plus receive-only `getDiagnoserData` (data already in `getFDTData`). Dead DB duplicate `lib/known-conflicts-db.json` is 44,904 B/133 entries; the imported **root** snapshot is 46,700 B/137 (`@/known-conflicts-db.json?raw`), content-diverged. Also omit dead `errors`/`LIMIT`, replaced CustomEvents hop, commented options/`SomeOptionsCard`, unimported `components/ui/input.tsx`, empty/unimported `popup/App.css`, `assets/react.svg`, `fdt/styles.css`, `legacy/styles/{global,reset}.css` (only `switch.css` imported), unused `TabsContent`/`CardFooter`, radix dropdown-menu/popover/separator dependencies.

### 1.2 Legacy manifest (verified from built `.output/chrome-mv3/manifest.json` — built from v2.2.5 source; the on-disk 2.2.3/2.2.4 zips are stale)

- Permissions: `contextMenus`, `webRequest`, `storage`, `alarms`, `tabs`; Chrome floor 120.
- **No host permissions**, despite all-http/https `webRequest` listeners. Chrome requires host coverage; capture may work only incidentally/not at all. The port explicitly declares `http://*/*`, `https://*/*`; P2 verifies/documents the difference.
- Both content scripts match http/https at `document_start`; the page-world entry declares `world: "MAIN"`.

### 1.3 Verified legacy size/perf baselines → port budgets (hard)

Historical derivation targets; **`scripts/budgets.json` supersedes them**.

| Surface               | Measured source                          | Initial hard target         | Stretch                               |
| --------------------- | ---------------------------------------- | --------------------------- | ------------------------------------- |
| Isolated CS           | 122 KB raw / 35 gzip (`isolatedWord.js`) | 60 KB raw / 20 gzip         | 45 KB raw                             |
| MAIN CS               | 1.5 KB                                   | 2 KB                        | —                                     |
| Background            | 17.4 KB raw                              | 25 KB raw                   | —                                     |
| Panel main JS         | 1.61 MB (`fdt-*.js` 1,611 KB + shared)   | 600 KB                      | 350 KB, excluding lazy shiki grammars |
| Popup/options/Builder | ≤ 60 KB total                            | 50 KB each                  | —                                     |
| Detection processing  | Source logs `Took: X ms`                 | ≥ 30% faster fixture median | —                                     |

Compare elapsed values, not log strings: port timing is `[WPR FDT] Page data processed in X ms`. The opening isolated target was also described as 119 KB → 60 KB; the measured baseline above is authoritative. The source's ~56 KB KC JSON/storage chunk (~45 KB data) must not be embedded in content scripts; background owns the seed, consumers use storage/messaging.

P2–P4 legitimately re-derived MAIN 2 → 8 KB (mandated bridge exceeds 2), background 25 → 27 KiB (audit correctness), isolated 60 → 85 KiB raw/30 gzip (stack floor, still ~30% raw reduction). The server-owned seed asset moved 50 → 85 KiB on 2026-10-08 re-sync and tracks every release refresh. Later phase records explain later raises; P15 re-derives the whole table. Never silently nudge ceilings.

### 1.4 Stack decisions (verified current on 2026-08-31)

Audit-era choices (registry refresh 2026-10-06); installed versions/implementation refinements live in AGENTS.md/lockfile and owning phase receipts.

- **Messaging:** `@webext-core/messaging` v4.0.0 (released 2026-07-25, chrome global/no polyfill). `defineExtensionMessaging` for runtime contexts/tab-targeted `sendMessage(type, data, tabId)`; `defineWindowMessaging` from **`/page`** for MAIN↔isolated. WXT 0.21 has no `wxt/utils/messaging` (dist-verified). Contracts in `lib/messaging/`; peer `@types/chrome` as devDependency. P0 spike/P1 pin exact transport behavior.
- **Storage:** auto-imported WXT `storage.defineItem` (verified `.wxt/types/imports.d.ts`); same underlying library as source.
- **Styles:** Tailwind v4 CSS-first `@theme`, replacing Tailwind/PostCSS config.
- **Headless UI:** Kobalte 0.13.x behind `components/ui/*`; 0.13.14 stable 2026-10-06, ratified against Ark UI 5.39.3 (Zag dependency cost); unmerged Solid-2 migration, no major jump.
- **Icons:** tree-shakable `lucide-solid`, latest stable at install (1.52.0 at re-verification), replacing `lucide-react`; later per-icon import requirement in AGENTS.md.
- **Highlighting:** fine-grained shiki 4.5.0, JS/JSON, light/dark pair, lazy/on-screen; replaces `react-syntax-highlighter`. Later worker ownership is recorded in P6/AGENTS.md.
- **JSON:** custom collapsible `JsonValue`, replacing highlighted dumps.
- **Motion:** CSS transitions/keyframes, reduced motion; no framer-motion.
- **Routing:** ~30-line Solid-signal hash router, preserving selected page without wouter for the fixed six-page baseline.
- **Toasts:** small store + `components/ui/toast.tsx`, no react-hot-toast.
- **Lists:** `@tanstack/solid-virtual` (verify latest at install); virtualize > 100 rows instead of thousands of DOM rows.
- **Repair:** latest jsonrepair v3, dynamic inside Diagnoser parser to avoid taxing CS startup; shipped IIFE limitation documented in P3.
- **Tests:** Vitest, Solid Testing Library, happy-dom, colocated `.test.ts`; P0 introduces the test gate then missing from AGENTS.md.
- **Devtools:** typed `browser.devtools.*` via `@wxt-dev/browser`, including panels/inspectedWindow/onSearch; no shim.

### 1.5 Target entrypoint layout (WXT conventions, fixed by AGENTS.md)

```text
entrypoints/
  background/            # wiring + headers, KC, menus
  devtools/              # panel registration, Elements pane
  panel/                 # shell/pages; replaces fdt.html
  popup/  options/  exclusion-builder/
  isolated.content.ts    # planned form; shipped folder form in P3
  main-world.content.ts  # reference capture
lib/
  messaging/  storage/  detection/  diagnostics/  known-conflicts/
  side-by-side/  exclusions/  options-map/  device-simulation/  wp-rocket/
components/  components/ui/
utils/
```

Self-contained domains, colocated data, generic pure utils; AGENTS.md owns the current tree (including the UA entrypoint pair).

### 1.6 Second behavioral baseline — wpr-inspector (verified 2026-10-06, full source read)

`../wpr-inspector` v4.1.1: Vite + `vite-plugin-web-extension`, vanilla JS, one `*://*/*` content script, no background/permissions/messaging. Host cookies/localStorage persist state; host console/shadow strip display output. §9 maps features to owners; P11–P14 retain full selectors/regexes/strings:

- `wpr-inspector/inspector.js`: generator `data-wpr-features` + footprints, fonts/dimensions/ALR/dead auto-fonts check, cache/exclusions, WordPress version → P11.
- `templates/inspector.html`, `css/`, `js/draggable.js`: state chips, cookie-persisted drag, Alt+H/Alt+0, host quirks → P12.
- `wpr-inspector/RUCSSTester.js`: strip styles, POST URL/unix timestamp/`&mobile`/`&home` with safelist-only body to `mega.wp-rocket.me/support/wpr-rucss-v2.php`, inject `#rucss_test_result_style` → P13.
- `wpr-inspector/BeaconTester.js` + inspector tools: harnessed BeaconManager ATF/LRC, PerformanceObserver LCP subparts, DJE `data-rocket-status`/grouped tables → P14.
- `popup.{html,js}`: “WPR Inspector UP and Running” placeholder, no controls; do not port (P8 already owns useful popup behavior).

Each phase records verified source defects/fixes. Do not port its production `extension.inIncognitoContext` gate: this is a full-time tool, not incognito-only.

## 2. Architecture (target data flow)

```text
MAIN capture ── validated window batches ──► isolated data hub
                                            │ snapshot/checks/Diagnoser
                                            │ errors/scripts-loaded
background ◄── tab/runtime messaging ────────┤
  headers: bounded per-tab cache + removal   ├──► devtools/panel
  KC: hourly/startup/manual fetch + seed     ├──► popup (active tab)
  menus: tab actions / Builder launch        └──► badge summary
  live-test fetch
isolated shadow UIs: KC, SBS, opt-in strip; triggered live-test executors
options: synced settings ──► all consumers
Builder: pure lib/exclusions + file I/O (FSA / Firefox fallback)
```

- CS page-derived state lives only for its context; listeners/observers clean up through `ContentScriptContext`/`ctx.onInvalidated`.
- Unit-tested owning-module guards validate every message/storage/DB/error-word boundary.
- Detection is **eager, single-flight at capture** (owner, 2026-10-08): badge/log work without panel; requests read cache. Release the snapshot after processing. Heavy repair/highlighting remains lazy where useful; lists virtualize past 100 rows.
- Never embed the ~45 KB KC seed in content scripts; background seeds, consumers read storage/messages.

## 3. Phase order & dependency graph

Critical sequence: **P0 → P1 → P1.1 → {P2 ∥ P3 ∥ P4} → {P4.1 ∥ P4.2} → P4.3 → P16 → P5A–P5I → P6/satellites → P11 → P12 → {P13 ∥ P14} → P14.5 → P14.6 → P7 → P5J → P15**. Early P12A does not move full P12. Dependencies below distinguish technical parallelism from the chosen release slot.

| Phase      | Depends on                                  | Parallel with                              |
| ---------- | ------------------------------------------- | ------------------------------------------ |
| P0         | —                                           | —                                          |
| P1         | P0                                          | —                                          |
| P1.1       | P1                                          | —                                          |
| P2–P4      | P1.1                                        | Each other                                 |
| P5A–P5I    | P0/P1; real checks need P3/P4               | P2–P4 with mocks                           |
| P6         | P5; live data P3                            | P8/P9/P10                                  |
| P7         | P6/P1 + rebuilt Diagnoser JSON              | Deferred after P14.6                       |
| P8         | P1/P3/P5                                    | P9/P10                                     |
| P9         | P1/P5                                       | P8/P10                                     |
| P10        | P1/P5; standalone engine                    | P6–P9; currently parked                    |
| P11        | P1/P1.1/P6                                  | Sequenced after P10                        |
| P12        | P11/P3/P5; toggles P8/P9 when present       | P13/P14 after P11                          |
| P13/P14    | P11/P12/P3/P5/P6                            | Each other after P12                       |
| P14.5      | P11–P14                                     | —                                          |
| P4.1       | Implemented P0–P4 coverage                  | P4.2/P5+                                   |
| P4.2       | —                                           | P4.1/P5+                                   |
| P4.3       | P4.1/P4.2                                   | P5 implementation                          |
| P16        | P1–P4, P4.3                                 | No other phase in its slot; A/B internally |
| P17        | P5/P6/P16                                   | Optional, decision-gated                   |
| X.1 suites | Own X + P4.1; site tests + P4.2             | With/after X                               |
| P14.6      | P4.1/P14.5 + owner site, else scope skip    | —                                          |
| P5J        | Shipped P5C/P5D/P5I; execute after P7/P14.6 | Last implementation, before P15            |
| P15        | All required phases                         | —                                          |

P14 adds P13's executor pattern; P12 strip hooks degrade gracefully until available. P17's one-line scope is a first-class panel home for SBS/mobile tools; write its phase doc only when scheduled. P5J's [06d decision](./06d-phase-5j-panel-topbar-redesign.md) (owner, 2026-10-13) keeps the icon rail interim.

Rationale: stabilize contracts/correct feature rows before consumers; verify producers against real pages; share shell before pages; satellites remain independent; merge both baselines into one registry/executor set; decide P14.5 upgrades against the current plugin; harden the final surface area last.

### Browser-test track (owner decision, 2026-10-08)

- **`X.Y` convention:** each feature's `X.1` suites automate only browser-observable checklist items, naming the assert source (page/SW via CDP/shadow probe/network); record manual remainder with reasons.
- **Retro first:** P4.1 harness + P4.2 Docker WP → P4.3 producer suites, including permanent header-wiring regression pin. Done 2026-10-09, three green full runs; caught/fixed headers-fetch race. Records: 05b–05d.
- **External last:** P14.6/15d needs the owner's external-service site; explicit scope skip if unavailable.
- **Local-only:** never e2e in CI; unit/coverage remains CI. Modern Chromium channel headless loads extensions; since 2026-10-11, headless is default and `E2E_HEADED=1` opts in (old headed-only/headless-shell premise superseded). Playwright cannot load Firefox extensions; record manual Firefox smokes per suite.

## 4. Cross-cutting conventions (enforced in every phase)

[AGENTS.md](../../AGENTS.md) owns operating rules; these are the port-specific commitments.

1. **TSDoc:** why, not just what; no JSDoc types in `.ts`.
2. **Strict types:** no `any`; replace Diagnoser's `{ noRocketData: any }` with validated plugin-shaped types, unknown fields narrowed at render.
3. **Solid:** no destructured props/React remount assumptions; components run once; derived lists via `createMemo`, `For`/`Show`/`Dynamic`.
4. **Errors:** invalid operation/invariants throw typed errors (e.g. `InvalidExclusionError`); failed operations return handled results. Handle every API rejection; side work never masks primary failures.
5. **Validation:** pure, tested per-module guards; no schema library in CS bundles.
6. **Strings:** preserve user-facing behavior/copy unless an enhancement is recorded (“Excluded by FDT legacy” → “Excluded by FDT”); feature naming rule 12 overrides parity. Internals follow WXT/intent-revealing names.
7. **Logging:** one `lib/logger` prefix `[WPR FDT]`, processing timing retained (§1.3), no sensitive/page-content logs.
8. **Commits/docs:** Conventional Commits when authorized; update AGENTS.md for scripts/deps/permissions/surfaces, setup README as needed; phase files identify updates.
9. **Single ownership:** constants/tables/regexes/selectors/types/helpers declared once by their domain. The test-only reference engine duplicates **control flow only**, importing `lib/wp-rocket/constants` vocabulary and type-only `lib/wp-rocket/types`; independent logic, shared vocabulary. P1 records the duplicated-constant cleanup.
10. **Reshape ports:** never mirror source types/layout/names; preserve behavior/user-facing strings, not structures.
11. **Uniform design:** P5's committed study binds later work; shadow-isolate page UIs. Shared tokens/status/attention and pre-render/live System(default)/Dark/Light appearance. The [UI/UX bar](../ui-ux-bar.md) (owner, 2026-10-14) alone declares layout/motion/states/keyboard/contrast/perf/copy/receipts; phases cite rule IDs. UI claims require axe AA, token-pair contrast, reduced-motion and isolation evidence.
12. **Plugin-native names:** every card/chip/subtitle/report/strip/popup/options string follows settings UI/KB, never invented OCI/ALR/LRC/DJE/RUCSS/CPCSS/SHGF/ATFO abbreviations. Detection keys follow plugin option/filter/meta IDs. Verified 2026-10-07:

    | Exact name                     | Plugin identifier                                 | KB article |
    | ------------------------------ | ------------------------------------------------- | ---------- |
    | Optimize critical images       | `rocket_above_the_fold_optimization`              | 1816       |
    | Automatic Lazy Rendering       | `rocket_lrc_optimization`                         | 1835       |
    | Preload fonts                  | `auto_preload_fonts` option                       | 1317       |
    | Preconnect to external domains | `rocket_preconnect_external_domains_optimization` | 1869       |
    | Priority Elements              | Beacon family                                     | 1841       |

    Settings casing is authoritative; each rendering phase verifies/extends the list against a real install and records deviations. Registration-source labels (2026-10-07 coverage audit): “Minify CSS files”, “Minify JavaScript files”, “Combine JavaScript files”, “Load JavaScript deferred”, “Delay JavaScript execution”, “Optimize CSS delivery”, “Enable for images / for CSS background images / for iframes and videos”, “Replace YouTube iframe with preview image”, “Add missing image dimensions”, “Self-host Google Fonts”, “Activate Preloading”, “Enable link preloading”, “Enable Content Delivery Network”, “Control Heartbeat”, “Performance Monitoring”, “User Cache”, menu “Mobile Cache”. KB titles such as “Remove Unused CSS”, “LazyLoad for images”, “Self-host Google Fonts”, “Prefetch DNS requests” are precedent. Correct inherited variants as committed copy fixes (#34), not optional enhancements.

## 5. Verification methodology (applies to all phases)

1. **P1 fixtures:** real cached/uncached/nowprocket, old/new DelayJS, ALR, minify, CPCSS, PSI HTML under `lib/detection/fixtures/`; each check × fixture with snapshots/reference parity. Reference code is test-only, never shipped; provenance stays here/P1, never code/comments.
2. **Real comparison:** load both extensions' builds; compare detections/lists/counts/versions/header cards and elapsed logs on the same fixture pages. Before each phase, re-check both sources' HEAD and update references; P15 repeats before release.
3. **Runtime checklist:** each phase records manual steps; content/file-API work includes Firefox (`pnpm dev:firefox`).
4. **Budgets:** producer/consumer phases run build/measure (`du -k` initially; committed `pnpm check:budgets` raw+gzip gate) against the living table; regression blocks completion.
5. **Security:** enumerate each new message/storage/DOM boundary; verify tested validators.
6. **Fail-able improvements:**
   - Speed: local `pnpm bench:detection` compares full fixture checks against independent reference, aggregate median ratio ≤ 0.70; P15 real-page protocol cross-checks. Machine-relative bench stays out of CI.
   - Size: `check:budgets` exits non-zero on breach; phase owns measured surfaces.
   - Dependencies: ESLint bans framer-motion/wouter/react-hot-toast/react-syntax-highlighter; P15 compares `pnpm ls --depth 0` with §1.4.
   - Coverage: `pnpm test` thresholds gate `lib/**`/`utils/**`.
   - UI: zero axe violations, keyboard checklist, P6 5,000-row long-task gate, motion/palette-token grep gates, hostile-CSS shadow-isolation audit (P12/P15), P5H → P12 strip conformance.
   - Enhancements: P15 labels every phase item and §8/§9 row DELIVERED/DEFERRED/DROPPED with evidence; no silent parity-only completion.
7. **CI:** P0 workflow runs compile/lint/format/test/build/budgets on PRs/main pushes (develop included in shipped P0); P15 adds Firefox build. Local completion also requires phase runtime checks and documentation updates.

## 6. Legacy bugs & quirks found in this audit (fix during the owning phase)

Numbers remain stable for cross-references; these describe source defects, not unresolved port status.

1. **P2:** `knownConflictsBackground.updateKnownConflictsDB` sets `updating=true`, clears only on success; empty/failed fetch disables updates until SW restart.
2. **P2:** missing host permissions despite all-http/https webRequest listeners; undocumented header risk.
3. **P2:** menu `.catch(e => e)` silently discards send failures.
4. **P7:** Diagnoser calls `useState` after conditional return (obsolete React hook violation).
5. **P7:** Server Load badge tests `serverInfo !== null` (always true), not `serverLoad`.
6. **P6:** `loadJSResourcesContent` never resolves for zero scripts; fragile last-index callback/push ordering.
7. **P6:** Undefined References module globals `allScriptAssets`/`referencesDefinitions`/`setReadyInterval` leak across mounts/intervals.
8. **P6:** pages ignore defined search next/previous actions; implement them.
9. **P6:** Preloaded badge says “Lazyload”.
10. **P6:** “Trucated,” typo; `clientHeight === scrollHeight` expand measurement thrashes layout.
11. **P4:** capture's `errors`/`LIMIT=50` never increments/enforces; dead `getTheWord` branch.
12. **P3:** KC `window.open(..., '__blank')` names a window instead of `_blank`.
13. **P3:** DB names/summaries rendered via `innerHTML`; use text despite server ownership.
14. **P1:** every image repeats `outerHTML.includes` for 23 exclusions (24 minus `data-lazy-src`); UI needs reasons only for non-lazyloaded images. Optimize with parity.
15. **P8:** input/span-click toggles inaccessible/inconsistently handled.
16. **P9:** fake 1000 ms “Saving…”; detail-free swallowed errors.
17. **P6:** module `runAnimations` flags suppress re-entry; replace React remount hack with CSS mount behavior.
18. **P6:** panel module `bouncer` lacks cleanup; second effect resets search on route change; use Solid-native ownership.
19. **P3:** iframe `src=src` refresh and timeout(10) animation hacks.
20. **P2:** uncapped per-tab header map until removal; bound/GC.
21. **P4:** sentinel dispatches singular `detail.word`, receiver reads plural `words`; restore cross-origin delivery through bridge.
22. **P6:** inline definition named “In an Inline Script.” compared with “Inline Script”, creating broken href; use chips.
23. **P7:** `Array.isArray(v) || (longString && expanded)` always expands arrays; use consistent `json-value` collapse.
24. **P5G:** `useLazyLoad` never disconnects IntersectionObserver (source TODO).
25. **P5C/P15:** authored `<link href="@/assets/common.css">` silently absent from built HTML/output; enforce built-output check/grep.
26. **P8:** outer `tabs.query().then()` lacks catch, hangs “Loading..”; leftover `console.log(data)`.
27. **P8:** post-render initialization flashes all-off; every toggle uses `id="option-name"`, no label association.
28. **P8:** fixed 320×576 body lacks scroll region; 12 rows/toolbars/footer clip.
29. **P6:** artificial 1000 ms result delay, typed/cleared as interval.
30. **P7:** long-string character length shown as item count; options ignores expand while filters honors it.
31. **P5C:** index × 0.02–0.1 s stagger delays tails; infinite idle/error/empty pulse; reduced motion ignored.
32. **P5C:** handlers register only after data resolves, dropping early searches; cancel/Esc no-op.
33. **P5/P6:** dead `bg-gray-750`/`hover:bg-gray-750` in four files, trailing-colon `min-h-[65px]:`.
34. **Owners/P15:** “ocurred” ×3, “Resouces”, Non-delayed vs Non-Deferred/internal “Non-delated”, double periods ~9, “in there are any”, “No Know conflict found”, garbled options label.
35. **P10:** HTMLFileEmpty laundered to SavingFileError, writable never closed/aborted on failure, reset can strand `working`, external edits overwritten without reread.
36. **P5A:** eval callback ignores exception, calls `setObject(undefined)`.
37. **P9:** load mutates module `sections`, no loading state/default-off flash.
38. **P7:** tabs triple-sourced (module/local/uncontrolled defaultValue; unused TabsContent) yet reload wipes state.
39. **P6:** magic status IDs 1000/1001/1002 mixed with indices; both-absent async CSS becomes “Optimize CSS Delivery”/not-active; preserve deliberately, key by detection ID.
40. **P5G:** observer keyed to non-reactive `elementRef.current`; initial null may never attach.
41. **P0/P4:** page-world CustomEvent.detail may be unreadable in Chromium isolated world, potentially killing the whole capture pipeline; spike/replace with postMessage.
42. **P1/P5C:** unscoped bare devtools endpoint is last-connect-wins; two panels receive wrong pushes; filter sender tab.
43. **P1:** registered but unsent `getDiagnoserData`; drop (already in FDT payload).
44. **P1:** raw DB-name regex interpolation fails on `C++`/parentheses; escape.
45. **P2:** headers use unvalidated `data.sender.tabId`/`Map.get(undefined)`; menu re-queries active tab instead of click's tab.
46. **P2:** import-time onStartup registration, unawaited boot calls, network/non-OK/JSON failures all laundered to null.
47. **P3:** every http/https DOMContentLoaded serializes and retains multi-MB HTML for page lifetime; release after processing.
48. **P3:** HS serializes/reparses whole document every 500 ms tick, leaks observer, reads DB only once; WP one-shot load misses late tables. Use live DOM/watch/bounded rescan.
49. **P3:** per-click transitionend listeners accumulate; reduced motion leaves hidden containers stuck; SBS shares pattern. State must not depend on transition.
50. **P3:** root-relative D-bugger link 404s on subdirectory WP; derive when possible/document fallback.
51. **P1.1 ✅:** bare shared beacon falsely asserts Optimize critical images (`{present:true,beacon:true}`), hides pending LRC/fonts/preconnect distinctions and disappears when all applied. Add dedicated beacon/per-feature evidence; remove OCI `beacon` field. Source injection requires ≥ 1 enabled feature missing its URL/device row.

## 7. Risk register

- **Messaging chrome-global/WXT interop:** P0 bg↔CS↔devtools spike before P1 finalizes contracts.
- **MV3 webRequest host coverage:** P0 justified permissions, P2 real-page capture.
- **Flaky devtools peers/navigation:** preserve reload-on-DOMContentLoaded behavior through P5C's soft-refresh implementation; explicit no-CS Retry state.
- **No Firefox FSA:** P10 feature-detected file-input/download fallback.
- **Kobalte churn:** pin minor, import only inside wrappers.
- **Shiki size:** fine-grained two-language/two-palette lazy bundle, virtual rows, phase budget checks; current worker refinement in AGENTS.md.
- **Improvement/parity drift:** explicit phase deltas, fixture/reference and real-build comparison.
- **Moving first baseline:** v2.2.4→2.2.5 WP-7.x fix proves drift; re-check HEAD each phase/P15.
- **Moving second baseline:** audited quoted strings + P15 HEAD check, explicit deviations.
- **wp-rocket-scripts churn:** 1.0.6→1.2.2 changed `_finalize`/`_saveFinalResultIntoDB`; one P14 internal adapter, exact pin/engine check/live verification.
- **RUCSS endpoint change/offline:** user-triggered typed failures, overlay unaffected, re-verify endpoint contract at build time.
- **Strip CS growth:** opt-in, P12 budget row, dynamic P14 beacon chunk keeps default cost bounded.
- **Badge navigation races:** clear on response start, set after processing; transient absence acceptable, stale state not.
- **Pending/applied/disabled confusion:** P1.1 evidence engine/view-model status composition and live pending/applied/mixed/disabled/bypass matrix; ineligible pending is normal, not error.
- **DNR inter-extension conflict/UA reduction:** documented `set`/last-installed ordering; verify UA tokens against plugin mobile decision on P4.2/P15; one-tab rules and visible requested state.
- **Scroll feedback/refresh conflict:** pure proportional mapping + rAF suppression, fresh metrics after refresh, honest degrade; P16.1 no-oscillation/cross-origin pins.

## 8. Extensions beyond parity (committed) & deliberate non-goals

P15 audits these and §9 as DELIVERED/DEFERRED/DROPPED with evidence, alongside phase enhancement lists.

- **Toolbar dot:** green cached/blue present-uncached/gray absent, transparent tile, unconditional restart-safe clears, `features.toolbarBadge`. Owners P1 protocol/P2 badge/P3 push/P9 toggle; `badge.test.ts` + nav matrix.
- **Console analysis:** info line after timing: honest applied/collecting/not-enabled states, counts/version/cache timestamp, no URL/src content. P3 `lib/detection/describe.ts`, reusable P6; `describe.test.ts` + console check.
- **Copy support report:** Detections markdown version/cache+timestamp/platform/server/optimizations/headers/undefined refs. P6; `buildSupportReport` golden.
- **Detections summary:** glanceable version/cache/platform/server. P6; selectors + visual check.
- **Response headers:** full captured main-frame `x-cache`/age/cache-control/etc. P6; render/manual.
- **Reference→exclusion bridge:** per-definition Copy as exclusion feeds Builder workflow. P6; unit/manual.
- **Elements inventory:** selected element's `data-rocket-*`/`data-wpr-*`, not IMG only. P5A; eval-builder test.
- **KC freshness:** Options last-update/Refresh now. P1 request/P2 serve/P9 UI; storage-meta/manual.
- **CI:** every gate per PR, both-browser build from P15. P0 workflow/P15 matrix; green run required to merge.
- **Appearance:** synced `appearance`: exactly System(default OS)/Dark/Light, explicit wins, `[data-theme]` before render, all open surfaces including injected UI live-update (owner, 2026-10-08); code uses light/dark highlighting. P0 resolver/tokens, P5C/P8/P9/P10 wiring, P12 strip, P9 selector; P9 checklist/all-surface/P15 screenshots.
- **SBS sync:** proportional differing-height mapping, default-on after owner 2026-10-11 change, overlay switch, per-side origin degrade; no PSI sync (unrelated structures). P16/P16.1; engine/harness/real-site checks.
- **SBS mobile:** overlay-only verified phone UA + fit-scaled 412×892 halves; one tab-document session DNR rule, in-half navigator shadow, both halves reload on session change, close/navigation restore tab, `wpr_mobile`/`wpr_desktop` evidence. Header switch, `· mobile` labels, “Generic Android phone” from profile; no PSI/mobile switch on Firefox. P16.2 (05g B1–B5, supersedes 05e generic per-tab design)/P16.3 (05h label); unit matrix, P4.2 echo/copy-flip round, 05h C3 device-tag browser rows.
- **SBS desktop:** default-on persisted `features.sbsDesktopWidth`, auto/sessionless only; iframe ≥ 1280 CSS px scaled to column, real media-query width, requests unchanged. Mobile hides/yields switch, return re-applies; layout-only flips do not reload; subfloor resize changes only transform. PSI untouched, Firefox supported without mobile capability. P16.4/05i D1–D4; fit/machine tests, matchMedia/token-stable squeeze/off-return, persistent-reload, yield/return browser pins; follow-ups cover reload keying and flavor-aware size gate.

**Non-goals:** i18n (support audience, English-first; revisit for public distribution), in-PSI split view (fragile SPA; keep two tabs), commands-API shortcuts (menus suffice), differential KC syncing (hourly ~46 KB full fetch simpler than diff infrastructure).

## 9. Second baseline: `wp-media/wpr-inspector` (phases P11–P14)

Apply §4's behavior-only/reshape/single-owner/no-code-provenance rules to the v4.1.1 source (§1.6). Feature ownership and acceptance:

- **P11:** meta/footprint registry precedence and source badge (`feature-meta.test.ts`, corpus, live comparison); strongest overlapping minify/RocketCDN/preload/CPCSS/DJE markers per P11 §3, fixture-pinned.
- **P11:** generator-meta layer over P1.1's ALR/auto-fonts/preconnect footprints; corrected `wpr_automatic_lazy_rendering`; add meta-only `self_hosted_fonts`/`image_dimensions`. Fixtures/live checks.
- **P11:** cached/excluded/amber unsure subtitles from already captured headers (no synchronous XHR), WordPress version in summary/report, both DelayJS version payload variants. View-model/header/version fixtures and report golden.
- **P12:** redesigned P5H strip, per-origin opt-in, extension storage, persisted drag, Alt+H only, full shadow isolation. Storage/strip tests, brief conformance, hostile-CSS/manual matrix. **P12A shipped early 2026-10-13** ([13a §7](./13a-phase-12a-inspector-strip-early-detections.md#7-shipped-the-p12a-implementation-round-2026-10-13)): KC-shell detections/context-menu opt-in/session-local drag P12A.5. Full P12 keeps its slot and owns persisted position/Alt+H/tools/P11 `hud` re-point; remaining audit in P12/P15.
- **P13:** panel `rucss-tester`, strip trigger, CS executor/background fetch, TEST MODE; fetch before strip. Pure tests + same-page source comparison.
- **P14:** panel beacon tester, dynamic `wp-rocket-scripts` subclass, no host mutation; validator/harness/live parity. LCP pure math/panel/optional cleaned highlight, golden/live checks. JS Runtime states classify `data-rocket-status`, including source-omitted Other group; classifier/delayed-page checks.

**Committed deviations:** no incognito-only gate; site opt-in, not blanket activation; extension persistence, not host cookies/localStorage; forms in panel, on-page triggers; remove strip as one element; no host-console detection/result dumps; validated background fetch; fetch-then-strip RUCSS; latest-pinned subclass, not prototype patch; suppress real `_finalize` writes; Alt+H only. Phase files own full verified defect lists.

**Do not port:** placeholder popup, Notion footer link, console.table/per-feature narration, ad-hoc `test_*.cjs`/`test_script.js` experiments. Their useful executed/failed script classification **does** land in P14.

## 10. P14.5 — Full feature coverage & new tooling (self-contained phase)

The [coverage audit](./audit-feature-coverage.md) checked WP Rocket `develop` 3.23.5.1 on 2026-10-07. [15b](./15b-phase-14-5-coverage-and-tooling.md) owns facts/design/tests and the **BUILD/DROP/DEFER gate before implementation**: mobile cache/DNS/Combine JS (not removed as originally assumed), stronger minify/async-CSS fingerprints, original DelayJS types, self-host-font corrections; ±cache diff, Assets matrix, hosting/cache headers, preload inventory, beacon instructions, RUCSS sizes, cache age. Mobile-UA snapshot deferred; speculation viewer rejected.

P16's live mobile **simulation**/SBS sync is distinct from the deferred background snapshot. P14.5 follows P14; §3 governs P14.6/P7/P5J/P15 afterward. Do not duplicate the detailed P14.5 plan here.
