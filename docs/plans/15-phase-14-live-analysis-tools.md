# Phase 14 — Live analysis tools (beacon tester, LCP breakdown, script runtime view)

**Depends on:** P11, P12 (strip chips), P3, P5, P6 (JS page extension), P13 (executor + protocol patterns to reuse). **Effort:** M. **Parallelizable:** none within the set (builds on the executor patterns P13 established).

## Goal

Port the inspector source's three runtime-analysis behaviors on top of this extension's architecture:

1. **Beacon tester** — runs the real WP Rocket beacon (`wp-rocket-scripts`) in a test harness: analyzes above-the-fold/LCP-candidate images (ATF) and lazy-render candidates (LRC) on demand, without waiting for plugin conditions, without writing anything to the host page, and with results shown in the panel as browsable tables.
2. **LCP analysis** — the largest-contentful-paint sub-parts breakdown (TTFB / resource load delay / resource load time / element render delay) computed from buffered performance entries, on demand, with an optional temporary element highlight.
3. **Script runtime view** — the `data-rocket-status`-aware Delay-JS breakdown (executed / failed / not delayed per live script) plus source-grouping (themes / plugins / inline), rendered on the JavaScript page instead of the host console.

All three of these run live in the inspected tab (content script side), triggered from the panel and the strip's tool chips.

## Reference (wpr-inspector, verified on 2026-10-06 by full-source read)

- `wpr-inspector/BeaconTester.js` and `wpr-inspector/inspector.js` (`getGroupedScripts` / `getAllScripts` / `getLCPElements`).
- **Beacon tester**: imports `BeaconManager` from `wp-rocket-scripts` — package pinned **1.0.6**; the npm package's current latest is **1.2.2** (verified 2026-10-06 via the registry): the API moved — beacons gained `preload_fonts` + `preconnect_external_domain`; `_saveFinalResultIntoDB` now POSTs `getResults()` from each sub-beacon; `_finalize` now mutates the page's gate script (`document.querySelector('[data-name="wpr-wpr-beacon"]')` + `setAttribute('beacon-completed','true')`, which **throws when the tag is absent**); LCP results shape still `this.lcpBeacon.performanceImages` / LRC `this.lrcBeacon.lazyRenderElements`, also exposed via `getResults()` (verified in the 1.2.2 sources).
- Test-mode patches (verbatim mechanics, applied by prototype mutation in the source):
  `_getGeneratedBefore → () => false` (suppresses the admin-ajax "already generated?" POST — the config's `ajax_url/nonce/url` are placeholders and never real endpoints),
  `_handleInfiniteLoop → () => this._finalize()` (the 10 s watchdog finalizes), `_finalize` → log + `clearTimeout(this.infiniteLoopId)`,
  `_saveFinalResultIntoDB` → console dump: ATF `performanceImages.filter(obj => Object.keys(obj).includes("type"))` + LRC `lazyRenderElements` as `console.table` under `"%cLCP/ATF:"` / `"%cLRC:"`.
- Config shape (defaults): `ajax_url: 'admin-ajax.php'`, `nonce: 'nonce'`, `url: 'the_url'`, `is_mobile: false`, `elements: ['img','video','picture','p','main','div','li','svg']` — consumed as a selector list by `document.querySelectorAll(this.config.elements)` (verified in `src/BeaconLcp.js`), `width_threshold: 1600`, `height_threshold: 700`, `debug: true`, `status: { atf, lrc }`, `lrc_threshold: 1800`.
- UI: config form (`#wpr_ins_lcp_mobile` checkbox — **sticky**: set true once, never reset; `#wpr_ins_height_threshold`/`#wpr_ins_width_threshold` numbers; `#wpr_ins_lcp_test_elements` textarea), per-run validation requiring at least one of the `atf`/`lrc` checkboxes; module-singleton config object persists between runs; results land only in the host console.
- **LCP breakdown** (`getLCPElements` in the inspector source): two `largest-contentful-paint` PerformanceObservers with `buffered: true`; first lists candidates deduped by `startTime`, `console.dir` each, paints candidates with `style.border = "5px dotted lime"` (never cleaned); the second computes the sub-parts exactly — `ttfb = navEntry.responseStart`; `lcpRequestStart = max(ttfb, lcpResEntry?.requestStart || lcpResEntry?.startTime || 0)`; `lcpResponseEnd = max(lcpRequestStart, lcpResEntry?.responseEnd || 0)`; `lcpRenderTime = max(lcpResponseEnd, lcpEntry?.startTime || 0)`; four `performance.measure` calls with `clearMeasures` per part; the duration table prints `% of LCP` as `Math.round((1000 * dur) / lcpRenderTime) / 10 + '%'`.
- **Script runtime view** (`getAllScripts`): skips `ld+json` scripts; a script is "delayed" when `type === 'text/rocketlazyloadscript'` **or** it carries `data-rocket-status`; source = `data-rocket-src ?? src`, `data:text/javascript;base64…` → `[Inline Script converted to Base64]`; preview = first 80 chars of text; results via `console.table`. The companion ad-hoc `test_script.js` (in the repo root, the tool's experiment lineage) classifies further against `data-rocket-status` values `executed`/`failed`.
- **Script grouping** (`getGroupedScripts`): `script[src*="Themes" i]`, `script[src*="Plugins" i]`, `script:not([src])` → three `console.table`s; a script with a `src` that matches neither path lands in **no group at all** (silently dropped).

## Source quirks fixed in this phase (verified in the source)

| #   | Quirk in the inspector source                                                                                                                                                                            | Fix here                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Prototype mutation of the module-global `BeaconManager` class (`BeaconManager.prototype._x = …`) — global side effects on the imported module                                                            | Harness subclasses the class; instances only                                                                                                                                                         |
| 2   | Beacon config is a **module-singleton** whose `is_mobile` sticks `true` after one checked run, and thresholds/elements persist across runs                                                               | Config built fresh from the validated store on every run                                                                                                                                             |
| 3   | At least the 1.2.2 package's real `_finalize` mutates the host page (`beacon-completed` on the gate script; throws when the tag is missing)                                                              | Harness `_finalize` only cancels the watchdog; the host page is never touched                                                                                                                        |
| 4   | Results surface exclusively as `console.table` on the host page                                                                                                                                          | Panel tables first-class; host console stays silent (outcome also mirrored to status copy)                                                                                                           |
| 5   | LCP observers pile up per trigger (two new observers per click, never disconnected) and highlight borders are never reverted                                                                             | One buffered observe → compute → disconnect; highlight is opt-in, reverted after 5 s and on context invalidation, original `border` value restored                                                   |
| 6   | `getAllScripts` mutates live script nodes with expando properties (`executeInfo`, `classesString`) and silently drops `src`-carrying scripts that match neither Themes nor Plugins (`getGroupedScripts`) | Plain records, no DOM writes; explicit "Other" group                                                                                                                                                 |
| 7   | `ld+json` scripts skipped via `outerHTML.includes`                                                                                                                                                       | Shown as `structured-data` kind instead of skipped                                                                                                                                                   |
| 8   | 1.0.6 pinned dep, API drifts untracked (verified: 1.2.2 changed `_finalize`/`_saveFinalResultIntoDB`)                                                                                                    | Latest stable pinned exact; a thin harness adapter isolates every API touchpoint; the adapter is the only file allowed to depend on package internals (listed here, so upgrades are a one-file diff) |

## Tasks

### 1. Dependency: `wp-rocket-scripts`

- [ ] Add `wp-rocket-scripts` at latest stable (**1.2.2** at plan time — engines/peer check at install; never 1.0.6). License/format verified before adding (`type: module`, ESM sources; bundle via Vite — measured, not assumed).
- [ ] Bundle discipline: dynamic import inside the executor (`await import('wp-rocket-scripts')`) → its own chunk (~26 KB minified, measured); the baseline isolated-CS budget is untouched; the chunk gets its own budget row (≤ 30 KB raw).

### 2. `lib/performance/` — pure cores (all unit-tested)

- [ ] `lcp-breakdown.ts` — `computeLcpBreakdown({ navigation, resources, lcpEntries })`: the exact max-chain math above; sub-part output `{ name, durationMs, percentOfLcp }` with the percent model byte-parity (`Math.round(1000*dur)/lcpRenderTime/10` as a `x.y%` string); missing resource entry → empty lead (`load delay`/`load time` zero — parity via the max-chain); zero-LCP guard (`Entry.renderTime` absent → typed unsupported result); handles text-node LCP (`element: null`) and multiple same-URL resources (first match — parity).
- [ ] `beacon-config.ts` — `buildBeaconConfig(config: StoredBeaconConfig): BeaconManagerConfig` (thresholds ≥ 1, `elements` string list validated — split via P13's shared line-list parser (trim/dedupe semantics shared, not re-derived), `status` boolean map, `debug: true` always); fixture-adversarial inputs rejected with named reasons.
- [ ] `beacon-results.ts` — `parseBeaconTestResult(raw: unknown)` boundary validator: `{ atf: { src, type, label, … }[], lrc: string[] }` with item caps (500 each) and string length caps (host-page-derived → untrusted); unknown extra keys preserved read-only for the renderer.
- [ ] `script-status.ts` — `classifyLiveScript(record)` → `{ kind: 'structured-data' \| 'script', status: 'delayed-executed' \| 'delayed-failed' \| 'delayed-pending' \| 'not-delayed', sourceGroup: 'theme' \| 'plugin' \| 'inline' \| 'other', src, preview, classes, id }`; `data-rocket-status === 'executed' / 'failed'` → those statuses, other values → `delayed-pending` with the raw value in the payload (source-value task: confirm the shipped value set from a real delayed page + the plugin source before locking labels); grouping via case-insensitive substring of the source (`themes` / `plugins`), inline when no `src`, else `other` (fixes the silently-dropped group).

### 3. Executors + protocol (isolated content script side)

- [ ] Protocol rows (validators + tests per P1 patterns): `runBeaconTest` (panel/strip → tab CS → `BeaconTestOutcome`), `runLcpAnalysis` (→ `LcpAnalysisOutcome`), `getScriptRuntimeStatuses` (→ validated record list, capped 1000).
- [ ] **Beacon executor**: build config from the store → validation requiring `atf ∥ lrc` (the source's user-facing validation message parity: "Please select at least one beacon option to test") → subclass harness (§2 of the quirks — overrides only `_getGeneratedBefore`, `_handleInfiniteLoop`, `_finalize`, `_saveFinalResultIntoDB`; every other method untouched) → `init()` → results resolve the pending run promise; the run promise carries an outer 15 s guard → typed `timeout` outcome with partial results (the source's watchdog finalizes silently and the table only prints if `_saveFinalResultIntoDB` fires — our timeout outcome always answers).
- [ ] Preconditions surfaced, not hidden: the beacon's screen-size check and `isPageScrolled` bail are reported verbatim in the outcome (`bailout: reason`) so a user knows why nothing ran (the source silently logged).

### 4. Panel pages

- [ ] **Beacon test** route (`panel/routes.ts` row; navigation registry-driven): config form — "LCP" + "LRC" switches (labels parity), thresholds (defaults 1600/700/1800), "Element selectors" textarea (help: passed to `querySelectorAll` — the real search semantics), mobile switch (non-sticky — quirk #2 fixed); Run button with the same running/success/error state machine as P13; results below: ATF images table (src/type/label columns) + LRC list, virtualized past 100 rows, search-integrated.
- [ ] **LCP analysis** route: run button; output = candidates list (element descriptor built safe: tag/id/limited classlist/source URL + `startTime` — never raw `outerHTML`) + the four sub-parts table + total LCP line; "Highlight LCP element" switch (default off — session-only state): paints the current best candidate dotted (5 px dotted lime — parity visual) with original value restore after 5 s and on invalidation; unsupported-browsers outcome (feature-detect `largest-contentful-paint` in `PerformanceObserver.supportedEntryTypes`) is an explicit state, not a silent zero table.
- [ ] **JavaScript page runtime section** (additive, P6-owned file structure): a "Runtime states" card strip + filter rows (Delayed executed / Delayed failed / Delayed pending / Not delayed; source-group chips Theme / Plugins / Inline / Other) + per-row fields (id, source, classes, preview, status chip) with the full-text expand (the source's 80-char preview becomes a row expansion); the section fetches live records on demand via `getScriptRuntimeStatuses` and labels itself "Live DOM state (not the snapshot passed to detection)" — a distinction users must never have to reverse-engineer.

### 5. Strip hooks (P12 contract)

- [ ] The three strip tool chips call these same protocol executors (config from the tester stores; first-run tooltip when no config exists). Outcomes mirror to the strip banner.

### 6. Field CWV view (owner-committed 2026-10-12)

- [ ] The Performance page also renders the page's **field Core Web Vitals** — LCP/CLS/INP collected via `PerformanceObserver` (buffered) through one pure reducer over entry types — shown next to the LCP breakdown: "what the visitor actually measured" beside "why". Each metric degrades explicitly to a typed unavailable state when its entry type/API is unsupported (the capability rule — never a half-working feature).
- [ ] Tests: the collector reducer (golden fixture: entries JSON → `{ lcp, cls, inp }` with per-metric unavailable mapping).

## Explicit enhancements over the inspector source

- Results as first-class panel tables (host console silent) — searching, virtualization, exports where P6 infra already exists.
- **Field CWV view (owner-committed 2026-10-12)** — the visitor-experienced LCP/CLS/INP beside the probe results, per-metric unavailable states.
- Latest-dep harness with an adapter seam (upgrades local); subclass discipline; host-page DOM untouched by the main harness path; config validated + non-sticky; explicit bail/timeout/unsupported outcomes; LCP highlight with cleanup + border restore; script runtime as a browsable, filterable, expanded-text view with an exact `Other` group and a `structured-data` kind; base64-inline scripts labeled (parity kept).
- All four `wp-rocket-scripts` beacon channels (`atf`/`lrc` orthogonal now; `preload_fonts`/`preconnect_external_domain` accepted in the config schema but gated behind a flagged "results verified on a real site" task before their tables ship — no speculative UI).

## Tests

- `lcp-breakdown.test.ts` — golden math fixture (committed from a real page capture once: navigation + resources + LCP entries JSON); matrix: no resource entry, text-node LCP, duplicated startTimes, timeline boundaries (`%` rounding cases).
- `beacon-config.test.ts` — threshold/element/status validation, sticky-mobile regression test (two builds → clean config each time), element-list parsing through the shared line-list parser (whitespace/duplicate cases).
- `beacon-results.test.ts` — validator matrix incl. caps; renderer classification for `type`-keyed items (the ATF filter parity).
- `script-status.test.ts` — classifier matrix (type-attr, `data-rocket-status` values, base64 marker, ld+json, groupings incl. the Other-never-dropped guarantee, preview cap).
- Executor integration: subclass harness doubles (fake module) prove patches applied only to instances; watchdog timeout path answers with partial + explicit state.

## Verification checklist

- [ ] Gates green; `pnpm check:budgets` — beacon chunk row recorded; content-script baseline unchanged (dynamic import verified by network trace: no beacon bytes load until a run).
- [ ] Real-site parity: run all three tools on a tested WP Rocket site alongside the inspector build in dev mode — ATF/LRC counts and LCP sub-parts comparable (known allowed deltas: our no-console-output and cleanup decisions; record any depth differences here).
- [ ] Beacon run leaves **no host artifacts**: no `beacon-completed` attribute set on any page element (dom-check in the checklist), no console logs from the harness path (verify before/after state of `[data-name="wpr-wpr-beacon"]` when present).
- [ ] LCP highlight: border applied → reverted exactly (style diff check before/after); the host page never carries our CSS.
- [ ] JS runtime section: statuses match `data-rocket-status` ground truth on a delayed page (delay deliberate page: interact to trigger Delay JS, then re-run the view — the data flips from pending to executed, the UI reflects it deterministically).
- [ ] Firefox: LCP analysis — supported-entry check outcome verified (record the state for the current FF version); beacon tools run with the same chunk-splitting behavior; script runtime view identical.

## Docs to update

AGENTS.md (new runtime dependency `wp-rocket-scripts` + its harness-adapter constraint; `lib/performance/` in the layout table); README (dependency list rationale); master plan §9 row states.
