# Phase 1 — Domain & contracts: `lib/` (types, messaging, storage, detection engine, data)

**Depends on:** P0. **Effort:** L. **Parallelizable:** none (everything consumes it).

## Goal

Build the pure, fully-tested core that every surface consumes: the typed message protocol, storage items, the complete WP Rocket detection engine (parity with legacy + faster), the option-name maps, and the Known Conflicts DB module. **No `browser.*` calls outside storage accessors**; everything else is functions-in → data-out.

## Legacy reference

- `Types.ts` — `WPRDetections` (13 keys + shapes), `PreloadedResources`, `DiagnoserRocketData`, `RocketDataOption`, `DevToolsSearch`.
- `Globals.ts` — `Channels` (22 defined, 10 used + 1 receive-only-dead `getDiagnoserData` — registered, never sent), `DiagnoserIDs`, `DELAYJS_SRC='data-rocket-src'`, `DelayJSScriptTypeOld='rocketlazyloadscript'` / `Current='text/rocketlazyloadscript'` + `isDelayJSType` + `delayJSScriptSelector()`, `FDTExcludedResource='data-wpr-fdt-excluded'`, `WPRDeferAttribute='data-rocket-defer'`, `LAZYLOAD_EXCLUSIONS_LIST` (**24** entries), `KnownPlatforms` (WP Engine: `X-Powered-By: WP Engine`; Kinsta: `X-Kinsta-Cache`; Hostinger: `Platform: hostinger`), `ExtensionAlarms`, `ExtensionContextMenuIds`, `WPROptions` map, `undefinedReferenceExternalError`, `CustomEvents` (dropped — replaced by the window bridge).
- `lib/wprDetection.util.ts` — the 13 checks + `checkPreloadedResourced` (full behavior in master §1.1; port 1:1 semantically).
- Legacy smells folded into this phase (each verified in source): duplicated `DELAYJS_SRC` (`Globals.ts` + a local re-declaration in the engine, whose old import sits commented out), copy-pasted reverse-loop lazyload detection (`checkLazyLoad` vs `checkLazyLoadIframes`), twin diagnoser JSON-extraction blocks, near-duplicate minify checks, the URL-pattern literal triplicated across entrypoints, dead defensive branches (`scripts?.push`, always-true `if (wprDetections.wpr)`, `?? ''` on the always-string `img.src`), typo'd exported names (`checkPreloadedResourced`, `containsLazloadScript`, `MessageBride`), dead type exports (`ChangeFields`, `DiagnoserRocketData`, `RocketDataOption`) — the port single-sources constants, classifies scripts/links once, extracts one JSON-repair helper, and renames every API intent-first.
- `content-scripts/devtoolsContentScript.ts` — orchestration shape (`processWPRDetections`, `processDiagnoserData`, "wpr.present if any optimization present" propagation) — the _logic_ lands here as pure functions; P3 wires it.
- `lib/storage.ts` — `sync:options` (`improvements['wp-dashboard-dbugger-entry']`, default true) + `local:known-conflicts-db` (embedded JSON fallback).
- `lib/optionNamesMap.util.ts` + `optionNamesMap.json` (39 entries) + `otherNamesMap.json` (5 entries) — `getRealOptionName`.
- **`known-conflicts-db.json` in the source repo's project root** (46,700 B, 137 entries; this repo commits the byte-identical file as `lib/known-conflicts/known-conflicts-db.json`, colocated with its owner module per AGENTS.md's data rule). The source repo's own `lib/` copy is a dead, content-diverged duplicate (133 entries) — not ported.

## Deliverables

### 1. `lib/messaging/` — typed protocol + validators

- [x] `protocol.ts` — single `ProtocolMap` for `defineExtensionMessaging`, one entry per source-repo-used channel (10 — `getDiagnoserData` is receive-only-dead there: registered, never sent; diagnoser data travels inside `getFdtData`, so it is not ported — master #43) plus the new KC-DB/badge/refresh requests (master §8), renamed to intent-revealing names (the channel mapping table lives in this document only — never in code comments; no-legacy rule in AGENTS.md). Shipped deltas vs the table: `processPageData` returns `boolean` (the handshake reads "processed or already processed"), and push rows are typed `(): true` — the library resolves the sender's promise with whatever the handler returns (including `undefined`), so the typed acknowledgement documents intent.

  | New                          | Legacy                                         | Data → Return                                                                                                          |
  | ---------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
  | `getPageHeaders`             | `getPageHeaders`                               | `void` (CS → background; background resolves the tab via `sender`) → `PageHeaders \| null`                             |
  | `processPageData`            | `processPageData`                              | `void` (to tab) → `boolean` (processed acknowledgement; the `void`-return row would leave senders reading `undefined`) |
  | `getFdtData`                 | `getFDTData`                                   | `void` (to tab) → `FdtData \| null`                                                                                    |
  | `getWprDetections`           | `getWPRDetections`                             | `void` (to tab) → `WprDetections \| null`                                                                              |
  | `notifyPanelReload`          | `reloadDevTools`                               | CS → devtools, `void`                                                                                                  |
  | `undefinedReferencesUpdated` | same                                           | CS → devtools, `string[]` (validated)                                                                                  |
  | `allScriptsLoaded`           | `allScriptsLoaded`                             | CS → devtools, `boolean`                                                                                               |
  | `panelSearch`                | `devToolsSearch`                               | devtools → panel, `PanelSearchAction` (perform/cancel/next/prev + query)                                               |
  | `openSideBySide`             | same                                           | background → tab CS, `void`                                                                                            |
  | `openSideBySidePerformance`  | same                                           | background → tab CS, `void`                                                                                            |
  | `getKnownConflictsDb`        | _(new — replaces the CS-embedded DB fallback)_ | CS → background, `void` → `KnownConflict[]`                                                                            |
  | `reportDetectionSummary`     | _(new — toolbar badge, master §8)_             | CS → background, `{ wprPresent, cached }` (validated) → `void`                                                         |
  | `updateKnownConflictsDb`     | _(new — options refresh, master §8)_           | options → background, `void` → `{ updatedAt: number } \| null`                                                         |

  **TabId contract decision:** content scripts never pass a tabId — the background resolves it from `sender`; devtools/popup target tabs via `sendMessage(type, data, tabId)`. No `{ tabId }` payload exists anywhere in the protocol (removes the spoofable field entirely).

  **Additive protocol policy:** later phases extend this map additively, never by editing established rows — the second baseline's live-test channels land in P13/P14 (`runRucssTest`, `fetchRucssShakenCss`, `runBeaconTest`, `runLcpAnalysis`, `getScriptRuntimeStatuses`), each addition shipping here with its payload validators + tests in the owning phase.

- [x] **Push tab-scoping (master #42):** pushes carry no tabId, but receivers must check the runtime sender's tabId — the devtools page ignores pushes whose sender tab ≠ `inspectedWindow.tabId` (with two devtools windows open, legacy's un-scoped pushes could reload the wrong panel). Documented in the protocol map so no consumer forgets.

- [x] `validate.ts` — boundary guards: `parseFdtData`, `parseWprDetections`, `parseDiagnoserData`, `parseErrorWords` (string[], ≤ 50 items, each ≤ 200 chars, printable), `parsePageHeaders` (`{name,value}[]`, name/value ≤ 512/4096 chars), `parseDetectionSummary` (exact `{ wprPresent: boolean; cached: boolean }`), `parseDbUpdateResult` (`{ updatedAt: number } | null`). Every guard: unit-tested valid/invalid/malicious inputs. Message data originating from the inspected page is **untrusted** (it encodes page content).
- [x] `window-bridge.ts` — `defineWindowMessaging` channel **`undefinedReferenceBatch`** (the name P4 uses) for MAIN→ISOLATED error batches — **imported from the `@webext-core/messaging/page` subpath** (verified: the main entry does not export it), with the same `parseErrorWords` validation on the receiving side.

### 2. `lib/storage/`

- [x] `options.ts` — `optionsStore = storage.defineItem<StoredOptions>('sync:options', fallback { improvements: { 'wp-dashboard-dbugger-entry': true } })` — keep the legacy option id verbatim as the canonical storage key (fresh install, so no migration concern; avoids id drift across P3/P9). Extend `StoredOptions` with the keys later phases consume: `appearance: 'system' | 'dark' | 'light'` (exactly these three; default `'system'` — the P9 appearance selector) and `features: { toolbarBadge: boolean }` (default `true` — the P2/P3 action badge, master §8); one shape owned here so P9's registry only renders keys that already exist.
- [x] `known-conflicts.ts` — `knownConflictsStore = storage.defineItem<KnownConflict[]>('local:known-conflicts-db', fallback: the **root** `known-conflicts-db.json`(137 entries) **only consumed by background** — single-bundle ownership rationale lives in P2 §3) +`lastUpdateMeta` via storage meta.
- [x] Type the KC entry: `KnownConflict = { id: string; type: string; name: string; detection_pattern: string | null; summary: string | null; issue_description: string | null; url: string }` + `parseKnownConflicts` validator (P2 uses it on fetched JSON). Field reality (verified across both DB copies): `detection_pattern` is `null` on 16/137 entries, `summary` on 1, `issue_description` is `""` on ~132 — the validator accepts null/empty but rejects entries without name+url.

### 3. `lib/wp-rocket/` — constants + types

- [x] `constants.ts` — port the exact constant set from `Globals.ts` **minus** channels/unused entries: diagnoser element IDs, DelayJS type values + `isDelayJSType` + `delayJSScriptSelector` (keep the excellent TSDoc), `FDT_EXCLUDED_RESOURCE`, `WPR_DEFER_ATTRIBUTE`, `DELAY_JS_SRC`, `LAZYLOAD_EXCLUSIONS_LIST` (as `as const` tuple, 24 entries), `KNOWN_PLATFORMS` typed (`{ name, headers: [{headerName, value?}] }[]`), `UNDEFINED_REFERENCE_EXTERNAL_ERROR`, alarm name (`EXTENSION_ALARMS.updateKnownConflictsDb` → `'update-known-conflicts-db'`), context-menu ids (`EXTENSION_CONTEXT_MENU_IDS` — the 4 legacy ids), Diagnoser element ids, `URL_PATTERNS: ['https://*/*', 'http://*/*']` (single-sourced here — legacy triplicated the literal across entrypoints). Now also the single declaring site for the whole footprint vocabulary the reference engine consumes (see Shipped deltas), and `WPR_OPTIONS` is dropped (the ids live in `lib/options-map`'s maps — `knownOptionIds()` is their accessor; a typed option registry ships with its first consumer, not speculatively).
- [x] `types.ts` — port `WprDetections`, `PreloadedResources`, `FdtData`, `PageHeaders` (as `readonly { name: string; value?: string }[]`), `PanelSearchAction`. Every field documented.

### 4. `lib/detection/` — the engine (the heart of the port)

- [x] `parse-page.ts` — `parsePage(html: string): ParsedPage` — `DOMParser` parse + **single-pass classification**: iterate `script` once collecting `{ srcAttr (raw getAttribute), resolvedSrc (property, may be absolute), type, isDelayType, deferAttr, wprDeferAttr, dataRocketSrc, text (FULL inline text — parity: legacy stores `script.innerText` in full; the JS page and the undefined-references definition search need it; only display truncates) }` and `link` once collecting `{ rel, href (property), as, dataRocketPreload }`. Legacy re-iterates full script/link arrays in 6 different checks; classification is computed once and reused. **Attribute vs property per check (parity-critical):** `delay_js`/`defer_all_js` use the raw `src` attribute (`getAttribute`), `minify_js` uses the resolved `script.src` property, `minify_css` uses the resolved `link.href` — `ParsedPage` carries both so each check reads exactly what legacy read. For attribute-only checks we avoid `outerHTML` string scans (see lazyload scoping below).
- [x] `detect-wpr.ts` — `detectWpr(doc, parsed)`: meta-generator find predicate (`/wp\s*-?\s*rocket/i`, parity) + version extraction (regex parity: `/wp\s*-?\s*rocket[\/\s:;v=]*\s*([0-9]+(?:\.[0-9]+){0,3})/i`), "This website is like a Rocket" comment sibling walk, `Debug: cached` + `cached@ts` extraction (timestamp via `parseInt(match, 10)` — legacy's radix-less `parseInt`, same result, explicit intent). Pure — takes `Document` + classification, not live window.
- [x] `detect-optimizations.ts` — the 12 remaining checks as pure functions over `ParsedPage`, each returning exactly the legacy shape:
  - RUCSS `style#wpr-usedcss`; CPCSS inline `wprRemoveCPCSS`; DelayJS (scripts array with `inline/src/content/delayed/deferred/deferredByWPR/fdtExcluded`, `delayedScripts` count, version via `this\.v\s*=\s*"([^"]+)"`); DeferJS (`script[data-rocket-defer]` srcs, `data-rocket-src` fallback); Lazyload (reverse scan for lazyload script URL regex `/(wp-rocket\/assets\/js\/lazyload\/.*\/lazyload(\.min)?\.js)/` + inline `window.lazyLoadOptions=...img[data-lazy-src]`; per-image detection with `data-lazy-src(-srcset)`; **image `src` fallback chain (parity):** `data-lazy-src` when lazyload-detected, else `data-src` ?? `src` ?? `''`; **enhancement, scoped (fixes master #14):** replace the 23 × `outerHTML.includes()` scan with structural checks **only where provably equivalent** — attribute _presence_ entries (`data-src`, `data-srcset`, `data-no-lazy`, `data-skip-lazy`, `fullurl`, …), quote-anchored class-prefix entries (`class="ls-l`, `class="ls-bg` — matched as **"class attribute value starts with"**, not classList substring: a class like `ls-lazy` must NOT match, exactly like legacy), and `img.loading === 'eager'` — while **keeping string matching for value-like entries** that can hide anywhere in the outer HTML (`skip-lazy`, `data-height-percentage`, `data-large_image`, `avia-bg-style-fixed`, `swatch-img`, `soliloquy-image`, `lazy-slider-img`, `image-compare__`, URL fragments). The parity harness (below) must assert identical outputs on every fixture — including two **adversarial fixtures**: a class attribute _containing_ `ls-l`/`skip-lazy` not at value start (e.g. `class="foo ls-lazy"`), and an exclusion token appearing inside an `src` URL — before the structural path ships; if any divergence resists fixing, ship the string-scan (parity wins over micro-optimization, documented).
  - [x] `detect-preloaded-resources` (parity port of `checkPreloadedResourced` — shipped inside `detect-optimizations.ts` alongside the other checks).
  - [x] `run-detection.ts` — orchestrator: runs all checks, applies the "wpr.present ||= any optimization (except `defer_all_js`, `wpr`)" propagation, times itself (`performance.now()`), returns `{ detections, preloadedResources, elapsedMs }`.
- [x] `fixtures/` — 8–12 HTML files captured from real WP Rocket pages (variants: cached + debug comment, uncached, nowprocket, old+new DelayJS types, ALR, CPCSS vs RUCSS, minify, PSI, zero-scripts page). Each fixture gets an inline "expected" JSON snapshot.
- [x] `reference/` — test-only TS copy of the source-repo engine's `lib/wprDetection.util.ts` (verbatim _semantics_ except the two normalizations its header documents — see the Shipped deltas). It is NOT excluded from type-checking (nothing hides behind the exemption) and linting keeps a single guard rule on it: it must never import the port's _logic_ modules, which would make the parity harness circular. Its data vocabulary (`lib/wp-rocket/constants`, values) and its record shapes (`lib/wp-rocket/types`, type-only — erased at runtime) are imported, not mirrored: the parity harness compares independent control flow over one shared vocabulary, and every record emitted here is compile-checked against the port's contracts.

### 5. `lib/diagnostics/` — diagnoser parsing

- [x] `extract.ts` — parity port of `processDiagnoserData`: find `#wpr-diagnoser-no-rocket-json-data` / `#wpr-diagnoser-rocket-json-data`, `jsonrepair` (dynamic import) → `JSON.parse`, typed results: `DiagnoserData = { noRocketData: NoRocketData | null; rocketData: RocketData | null }` with real types (`NoRocketData`: `wpr_plugin`, `get_rocket_option` (incl. `version`), `filters`, `server_info{server_load,web_server,php_memory_limit,wp_memory_limit,wp_max_memory_limit}`, `constants`, `preload_rucss_tasks`, `preload_rucss_parameters`, `querystrings`, `user_agent`, `imagify`, `wpr_diagnoser_version`; `RocketData`: `options: Record<string, RocketOptionEntry>`, `post_meta_excluded_options: Record<string, boolean>`). Validate with guards; unknown extra keys stay accessible via index signature `[key: string]: unknown` so future diagnoser plugin fields surface instead of breaking.

### 6. `lib/options-map/`

- [x] Port the two JSON maps (verbatim data) + `getRealOptionName(option: string): string`; `optionNamesMap.json` loaded statically (small), single source, no legacy `try/catch` swallow — JSON is import-time validated by a unit test that iterates all keys (type `string`).

### 7. `lib/known-conflicts/`

- [x] `match.ts` — pure matching: `findKnownConflicts(allText: string, db: KnownConflict[], mode: 'helpscout' | 'wp-admin'): KnownConflict[]` with exact legacy semantics (HS: `(^|- )(name)($| -)` lowercase regex — **escape regex metacharacters in the interpolated name** (a name like `C++` silently never matches in legacy, master #44; normal names assert unchanged parity); WP: lowercase `includes`), case-insensitive trim handling, skip entries without name+url. Unit tests with real-ish entries from the DB.

### 8. `lib/logger.ts`

- [x] Typed logger with the `[WPR FDT]` prefix (master §4.7): levels (debug/info/warn/error), namespace tag per caller, `debug` silenced when `import.meta.env.MODE === 'production'` except the processing-timing line (kept for baseline comparison). Required by P2/P3 — created here so it is never invented ad hoc. Unit-tested (prefixing, level gating).

## Explicit enhancements over legacy

- Single-pass page classification (perf) + structural lazyload exclusion checks (perf) with parity harness.
- Real types everywhere (`DiagnoserData: any` → typed), validated boundaries (security).
- Fixtures + legacy-reference harness = regression-proof parity (reliability).
- KC DB + validators typed; dead channels/constants not ported.
- Detection functions decoupled from live `window`/`document` — they take parsed input, enabling all of them to be unit-tested (legacy tested nothing).
- Dead receive-only `getDiagnoserData` channel dropped (#43); pushes tab-scoped (#42); KC name-matching regex-escaped (#44); `StoredOptions` owns the option keys later phases consume (appearance, toolbar badge).

## Tests

- `lib/detection/*.test.ts` — every check × every fixture; parity assertions vs `reference/` on all fixtures (including the two adversarial lazyload fixtures above); a slowdown tripwire per fixture (generous bound — the tests-runner parser itself costs tens of milliseconds on multi-hundred-KB pages; the speed claim is enforced by the bench, not the tripwire).
- **`lib/detection/bench/detection.bench.test.ts` (the automated ≥ 30 % enforcement, master §5.6):** warm up 3×; then run the port's `runChecks()` **and** the `reference/` engine over every fixture × 10 alternating iterations; print a per-fixture median table (fixture | new ms | reference ms | ratio) with `--silent=false` via `pnpm bench:detection` (a standalone vitest config isolates the bench from CI discovery — the ratio is machine-relative); assert **aggregate checks-phase `median(new) ≤ 0.70 × median(reference)`** — a perf regression fails the gate instead of being eyeballed. Re-run in P3/P15.
- `lib/messaging/validate.test.ts` + `validate.paths.test.ts` — all guards, valid/hostile/boundary inputs (oversized arrays/strings, wrong types, prototype-pollution keys like `__proto__`, inclusive caps), plus every rejection arm driven by a minimal mutation.
- `lib/messaging/messaging.test.ts` — real round trips over the fake runtime (send → listener → response), the no-listener rejection contract, the `(): true` ack discipline, and the window-bridge namespace as a shared constant.
- `lib/diagnostics/extract.test.ts` — valid JSON, malformed JSON repaired, missing elements, wrong element contents.
- `lib/known-conflicts/match.test.ts` — HS + WP modes, punctuation variants, name/URL-less entries, metacharacter names, hostile scan text.
- `lib/options-map/*.test.ts` — every key maps to a non-empty string.
- `lib/storage/*.test.ts` — fallback shapes + corrupt-value degradation via validators (using `fakeBrowser` + WXT storage).
- `lib/logger.test.ts` + `logger.gating.test.ts` — prefix/levels/gating (debug silenced in production).

## Verification checklist

- [x] All gates green (`compile/lint/format/test`; 179 tests; coverage 94 % statements / 92 % branches / 100 % functions over `lib/**`+`utils/**`, thresholds 90 enforced incl. branches).
- [x] Fixture corpus committed: 11 real captured pages (wp-rocket.me home/blog/support + `?nowprocket` + the RocketCDN site + a PageSpeed Insights shell + five QA-suite scenario pages) + 3 crafted (the two adversarial lazyload fixtures + one all-features integration page); parity harness reports 0 diffs vs the reference implementation on all of them. Intentional deltas are documented below, not in code or TSDoc (no-legacy rule, AGENTS.md).
- [x] `pnpm bench:detection` run; medians below — the ≥ 30 % target holds **automatically** (the assertion is in the bench), on the checks phase (see the measured parse-dominance note).
- [x] `pnpm build` shows detection/`lib` code is not yet bundled into any surface (grep for an engine-only string in `.output/chrome-mv3` returns nothing).
- [x] Post-implementation adversarial audit (2026-10-07, three independent reviewers): contract validators hardened (empty-string delay records accepted instead of bricking the panel, uniform count/length caps with reject semantics — all enforced, fresh own-key rebuilds, lone-surrogate words rejected), the reference engine's two normalizations documented in its header, the timestamp guard restored to the reference truthiness (NaN impossible; the 0x delta pinned), speed gate moved out of CI discovery, snapshot write mode asserts parity before writing, seed row count pinned at 137, namespace constant exported and round-trip-tested, `improvements` reads keep unknown boolean ids and self-heal the dbugger entry, KC storage reads validated (`getKnownConflicts`), the seed frozen, the reference-dir eslint guard proven to fire (gitignore-syntax import ban), "no provenance in code" wording sweep over comments.
- [x] Confirmation pass (2026-10-07, independent re-verification): all fixes landed or fixed on the spot; new findings (delay-count cap unenforced, ineffective extglob ban pattern, false header claims, solid-js patch lag) fixed and gates re-run green.

## Shipped deltas (vs the plan text above)

- **Classification = shared element lists, not per-script records.** Profiling showed an eager 10-reads-per-script record build costs more than the repeated `querySelectorAll` scans; the shipped `parsePage` parses once and collects the `script`/`link` lists once, and every check reads exactly its reference fields from them. Same read pattern, minus the repeated document scans.
- **The lazyload exclusion scan keeps substring matching, but reads `outerHTML` once per image** instead of once per entry (23×→1× serializations). The "structural only-where-provable" plan turned out unprovable: serialization escaping analysis (attribute names embedding entry text, values embedding `&quot;`) admits adversarial divergences for every entry class, so parity won — the hoist is the shipped optimization, pinned by the adversarial fixtures.
- **Timestamp: reference-guard truthiness with an explicit radix.** An empty `cached@` suffix keeps `timeStamp: null` (the reference behavior — the original port assigned `NaN`); non-numeric suffixes normalize to null; the only remaining delta vs radix-less parseInt is `0x`-prefixed suffixes (16 vs 0 on `cached@0x10`) — hostile-only, accepted.
- **The reference engine carries two documented normalizations** (it is verbatim semantics except these, listed in its file header): `textContent` in place of `innerText` (identical for un-rendered documents; the test runner's `innerText` collapses whitespace non-conformantly), and `?? ''` after the lazyload `data-lazy-src` attribute (the source emits `null` where the port's `src: string` contract wants a string — a srcset-only image gets `''` in both). A one-off adversarial audit compiled the real source engine against the corpus: 13/14 fixtures field-identical, the 14th differing only in that documented `null`→`''` slot; P15 re-runs that compiled-diff protocol.
- **Falsiness gates kept verbatim** (`!getAttribute('src')` in the CPCSS and minify checks; an empty `src` attribute behaves exactly as the reference behaves). Same for the RUCSS selector (`style#wpr-usedcss`, also matching an SVG-embedded style element) and the minify-css rel comparison (case-preserved, as browser reflection is).
- **Two reference quirks preserved as-is** (found while auditing, kept for parity): deferred scripts hide their URLs in `data-rocket-src`, so the minify check misses them; and the Delay JS controller version is only read when presence is not yet set (a delayed script earlier in the document hides it).
- **Registry and record field order match the reference exactly** (top-level key order and the delay-script record's `delayed, inline, src|content, deferred, deferredByWPR, fdtExcluded`), so serialized payloads compare shape-for-shape, not just structurally.
- **Corpus variants not capturable live on 2026-10-07:** no reachable site served the current (`text/`-prefixed) Delay JS type, the CPCSS fallback, the CSS-background container ids, or a RocketCDN dns-prefetch hint. Those true branches are pinned by unit-test mini-documents instead; the corpus grows with any page this tool is later verified against.
- **Size-limit policy on validators** (uniform, generous, reject-not-truncate — see `LIMITS` in `lib/messaging/validate.ts`): counts (words 50, headers 256, delay 5,000, defer 5,000, images 5,000, preloaded 5,000 / 1,000, KC 500) and per-string caps (src/href/URLs 4096, inline content 512 KiB, KC fields 64–8192). Pages beyond a cap reject the row/guard wholesale — an accepted ceiling documented here; the fixture corpus's real worst cases (72 scripts, 54 images, 14.5 KB inline content, 5 preloaded rows) sit ≥ 65× below.
- **RocketCDN dns-prefetch matching is case-insensitive whole-value** (faithful to Chromium's CSS attribute rules for `rel`); the parity harness constrains fixtures to canonical markup because the test runner lacks that CSS case-insensitivity. The `minify_css` rel read is case-**preserved** (reflection keeps the attribute bytes) — both pinned by tests.
- **`KNOWN_PLATFORMS` ships as a frozen `ReadonlyMap<string, readonly KnownPlatformHeader[]>`** (the plan text sketched a `{name, headers}[]` array; the Map is the shape the header matcher consumes).
- **The processing-timing line is logged at `info` level** (visible in production builds — that is the point of keeping it; `debug` carries dev-only narration).
- **De-duplication pass (2026-10-07, owner-directed):** the reference engine mirrors no port code anymore — its footprint vocabulary (`DELAYJS_SRC`/`LAZYLOAD_EXCLUSIONS_LIST`/markers/patterns, which had already drifted name-wise) is imported from `lib/wp-rocket/constants`, and `reference/support-types.ts` is deleted in favor of the shared contract types (type-only). `lib/wp-rocket/constants.ts` is now the single declaring site for the whole footprint vocabulary (attribute names, controller/beacon markers, reserved ids, served-URL patterns, version/cache-comment markers, `extractWprVersion`), fed into the manifest's `host_permissions` too; `WPR_OPTIONS` (unused, drifting from the option-name maps) is dropped. Same-pass dedup elsewhere: the fixture corpus is single-sourced (`fixtures/corpus.ts`, used by both the snapshot gate and the bench), vitest runtime settings are shared (`vitest.shared.ts`), the lazyload reverse-scan loop is one helper for both lazyload checks, presence propagation is driven from the record's own keys, the bench reuses the port's parsed page (one parse per fixture), and the panel-search action ids are single-sourced next to their union (`PANEL_SEARCH_ACTIONS`). Verification: all gates re-run green; fixture parity (port ≡ reference ≡ reviewed snapshot) holds on all 14 fixtures; `pnpm bench:detection` ratio 0.44 vs the 0.70 ceiling.

## Runner-variance note (detection fixtures)

The fixture corpus runs under happy-dom, whose script parser differs from Chromium in one verified way: a script element whose text embeds `<` followed by a non-tag byte (e.g. `k<3` inside minified code) is dropped, along with markup following it until the next `</script>`. Real pages in the corpus contain such code (minified controllers, the PSI shell), so those snapshots' per-check counts reflect the runner's parse, not a real browser's. Parity (port ≡ reference ≡ snapshot) is runner-internal and therefore sound; absolute counts get re-verified by P15's scripted real-browser protocol, which is exactly why that protocol exists.

## Bench table (2026-10-07, checks phase, shipped `pnpm bench:detection` tool)

Per-fixture medians and the aggregate as printed by the committed tool (aggregates across runs: new ≈ 2.9–3.1 ms vs reference ≈ 5.0–7.1 ms, ratio 0.43–0.58 against the 0.70 ceiling — the assertion holds on every run; the exact numbers are machine-relative, treat them as samples). Individual fixtures below ~0.1 ms sit at timer-noise scale, so their ratios wobble; the aggregate is the asserted, stable quantity.

| fixture (aggregate share)                                                  | new ms   | reference ms | ratio    |
| -------------------------------------------------------------------------- | -------- | ------------ | -------- |
| me-home-cached                                                             | 0.57     | 1.32         | 0.43     |
| me-blog-alr                                                                | 0.33     | 0.58         | 0.57     |
| me-support-cdn                                                             | 0.56     | 0.75         | 0.75     |
| me-nowprocket                                                              | 0.66     | 1.35         | 0.49     |
| qa-llcssbg                                                                 | 0.07     | 0.04         | 1.68     |
| qa-llbg-single-colon                                                       | 0.05     | 0.04         | 1.38     |
| qa-llbg-double-colon                                                       | 0.04     | 0.03         | 1.10     |
| qa-elementor-overlay                                                       | 0.07     | 0.06         | 1.24     |
| qa-landing-page                                                            | 0.07     | 0.07         | 1.05     |
| rocketcdn-site                                                             | 0.18     | 0.46         | 0.40     |
| psi-shell                                                                  | 0.13     | 0.11         | 1.10     |
| synthetic-all-features                                                     | 0.07     | 0.08         | 0.94     |
| adversarial-lazyload-classes                                               | 0.07     | 0.14         | 0.49     |
| adversarial-exclusion-tokens                                               | 0.05     | 0.09         | 0.55     |
| **aggregate checks medians**                                               | **2.93** | **6.31**     | **0.46** |
| full-pass medians (transparency — the shared parse dominates both engines) | 47.2     | 54.5         | 0.87     |

## Docs to update

AGENTS.md if directory layout diverges from §1.5 of master (it doesn't — `lib/` matches; `bench:detection` was added to Commands).
