# Phase 1 — Domain & contracts: `lib/` (types, messaging, storage, detection engine, data)

**Depends on:** P0. **Effort:** L. **Parallelizable:** none (everything consumes it).

## Goal

Build the pure, fully-tested core that every surface consumes: the typed message protocol, storage items, the complete WP Rocket detection engine (parity with legacy + faster), the option-name maps, and the Known Conflicts DB module. **No `browser.*` calls outside storage accessors**; everything else is functions-in → data-out.

## Legacy reference

- `Types.ts` — `WPRDetections` (13 keys + shapes), `PreloadedResources`, `DiagnoserRocketData`, `RocketDataOption`, `DevToolsSearch`.
- `Globals.ts` — `Channels` (22 defined, 11 used), `DiagnoserIDs`, `DELAYJS_SRC='data-rocket-src'`, `DelayJSScriptTypeOld='rocketlazyloadscript'` / `Current='text/rocketlazyloadscript'` + `isDelayJSType` + `delayJSScriptSelector()`, `FDTExcludedResource='data-wpr-fdt-excluded'`, `WPRDeferAttribute='data-rocket-defer'`, `LAZYLOAD_EXCLUSIONS_LIST` (**24** entries), `KnownPlatforms` (WP Engine: `X-Powered-By: WP Engine`; Kinsta: `X-Kinsta-Cache`; Hostinger: `Platform: hostinger`), `ExtensionAlarms`, `ExtensionContextMenuIds`, `WPROptions` map, `undefinedReferenceExternalError`, `CustomEvents` (dropped — replaced by the window bridge).
- `lib/wprDetection.util.ts` — the 13 checks + `checkPreloadedResourced` (full behavior in master §1.1; port 1:1 semantically).
- `content-scripts/devtoolsContentScript.ts` — orchestration shape (`processWPRDetections`, `processDiagnoserData`, "wpr.present if any optimization present" propagation) — the _logic_ lands here as pure functions; P3 wires it.
- `lib/storage.ts` — `sync:options` (`improvements['wp-dashboard-dbugger-entry']`, default true) + `local:known-conflicts-db` (embedded JSON fallback).
- `lib/optionNamesMap.util.ts` + `optionNamesMap.json` (39 entries) + `otherNamesMap.json` (5 entries) — `getRealOptionName`.
- **`known-conflicts-db.json` at the project root** (46,700 B, 137 entries) — this is the file legacy actually imports (`lib/storage.ts` uses `@/known-conflicts-db.json?raw` where `@` = project root). The `lib/` copy is a dead, content-diverged duplicate (133 entries) — do not port it.

## Deliverables

### 1. `lib/messaging/` — typed protocol + validators

- [ ] `protocol.ts` — single `ProtocolMap` for `defineExtensionMessaging`, one entry per legacy-used channel plus the new KC-DB request, renamed to intent-revealing names (map table in code comments noting the legacy channel):

  | New                          | Legacy                                         | Data → Return                                                                              |
  | ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
  | `getPageHeaders`             | `getPageHeaders`                               | `void` (CS → background; background resolves the tab via `sender`) → `PageHeaders \| null` |
  | `processPageData`            | `processPageData`                              | `void` (to tab) → `void`                                                                   |
  | `getFdtData`                 | `getFDTData`                                   | `void` (to tab) → `FdtData \| null`                                                        |
  | `getWprDetections`           | `getWPRDetections`                             | `void` (to tab) → `WprDetections \| null`                                                  |
  | `getDiagnoserData`           | `getDiagnoserData`                             | `void` (to tab) → `DiagnoserData \| null`                                                  |
  | `notifyPanelReload`          | `reloadDevTools`                               | CS → devtools, `void`                                                                      |
  | `undefinedReferencesUpdated` | same                                           | CS → devtools, `string[]` (validated)                                                      |
  | `allScriptsLoaded`           | `allScriptsLoaded`                             | CS → devtools, `boolean`                                                                   |
  | `panelSearch`                | `devToolsSearch`                               | devtools → panel, `PanelSearchAction` (perform/cancel/next/prev + query)                   |
  | `openSideBySide`             | same                                           | background → tab CS, `void`                                                                |
  | `openSideBySidePerformance`  | same                                           | background → tab CS, `void`                                                                |
  | `knownConflictsDbRequest`    | _(new — replaces the CS-embedded DB fallback)_ | CS → background, `void` → `KnownConflict[]`                                                |

  **TabId contract decision:** content scripts never pass a tabId — the background resolves it from `sender`; devtools/popup target tabs via `sendMessage(type, data, tabId)`. No `{ tabId }` payload exists anywhere in the protocol (removes the spoofable field entirely).

- [ ] `validate.ts` — boundary guards: `parseFdtData`, `parseWprDetections`, `parseDiagnoserData`, `parseErrorWords` (string[], ≤ 50 items, each ≤ 200 chars, printable), `parsePageHeaders` (`{name,value}[]`, name/value ≤ 512/4096 chars). Every guard: unit-tested valid/invalid/malicious inputs. Message data originating from the inspected page is **untrusted** (it encodes page content).
- [ ] `window-bridge.ts` — `defineWindowMessaging` channel **`undefinedReferenceBatch`** (the name P4 uses) for MAIN→ISOLATED error batches — **imported from the `@webext-core/messaging/page` subpath** (verified: the main entry does not export it), with the same `parseErrorWords` validation on the receiving side.

### 2. `lib/storage/`

- [ ] `options.ts` — `optionsStore = storage.defineItem<StoredOptions>('sync:options', fallback { improvements: { 'wp-dashboard-dbugger-entry': true } })` — keep the legacy option id verbatim as the canonical storage key (fresh install, so no migration concern; avoids id drift across P3/P9).
- [ ] `known-conflicts.ts` — `knownConflictsStore = storage.defineItem<KnownConflict[]>('local:known-conflicts-db', fallback: the **root** `known-conflicts-db.json`(137 entries) **only consumed by background** — single-bundle ownership rationale lives in P2 §3) +`lastUpdateMeta` via storage meta.
- [ ] Type the KC entry: `KnownConflict = { id: string; type: string; name: string; detection_pattern: string | null; summary: string | null; issue_description: string | null; url: string }` + `parseKnownConflicts` validator (P2 uses it on fetched JSON).

### 3. `lib/wp-rocket/` — constants + types

- [ ] `constants.ts` — port the exact constant set from `Globals.ts` **minus** channels/unused entries: diagnoser element IDs, DelayJS type values + `isDelayJSType` + `delayJSScriptSelector` (keep the excellent TSDoc), `FDT_EXCLUDED_RESOURCE`, `WPR_DEFER_ATTRIBUTE`, `DELAY_JS_SRC`, `LAZYLOAD_EXCLUSIONS_LIST` (as `as const` tuple, 24 entries), `KNOWN_PLATFORMS` typed (`{ name, headers: [{headerName, value?}] }[]`), `WPR_OPTIONS` keys, `UNDEFINED_REFERENCE_EXTERNAL_ERROR`, alarm name (`EXTENSION_ALARMS.updateKnownConflictsDb` → `'update-known-conflicts-db'`), context-menu ids (`EXTENSION_CONTEXT_MENU_IDS` — the 4 legacy ids), Diagnoser element ids.
- [ ] `types.ts` — port `WprDetections`, `PreloadedResources`, `FdtData`, `PageHeaders` (as `readonly { name: string; value?: string }[]`), `PanelSearchAction`. Every field documented.

### 4. `lib/detection/` — the engine (the heart of the port)

- [ ] `parse-page.ts` — `parsePage(html: string): ParsedPage` — `DOMParser` parse + **single-pass classification**: iterate `script` once collecting `{ srcAttr (raw getAttribute), resolvedSrc (property, may be absolute), type, isDelayType, deferAttr, wprDeferAttr, dataRocketSrc, text (FULL inline text — parity: legacy stores `script.innerText` in full; the JS page and the undefined-references definition search need it; only display truncates) }` and `link` once collecting `{ rel, href (property), as, dataRocketPreload }`. Legacy re-iterates full script/link arrays in 6 different checks; classification is computed once and reused. **Attribute vs property per check (parity-critical):** `delay_js`/`defer_all_js` use the raw `src` attribute (`getAttribute`), `minify_js` uses the resolved `script.src` property, `minify_css` uses the resolved `link.href` — `ParsedPage` carries both so each check reads exactly what legacy read. For attribute-only checks we avoid `outerHTML` string scans (see lazyload scoping below).
- [ ] `detect-wpr.ts` — `detectWpr(doc, parsed)`: meta-generator find predicate (`/wp\s*-?\s*rocket/i`, parity) + version extraction (regex parity: `/wp\s*-?\s*rocket[\/\s:;v=]*\s*([0-9]+(?:\.[0-9]+){0,3})/i`), "This website is like a Rocket" comment sibling walk, `Debug: cached` + `cached@ts` extraction. Pure — takes `Document` + classification, not live window.
- [ ] `detect-optimizations.ts` — the 12 remaining checks as pure functions over `ParsedPage`, each returning exactly the legacy shape:
  - RUCSS `style#wpr-usedcss`; CPCSS inline `wprRemoveCPCSS`; DelayJS (scripts array with `inline/src/content/delayed/deferred/deferredByWPR/fdtExcluded`, `delayedScripts` count, version via `this\.v\s*=\s*"([^"]+)"`); DeferJS (`script[data-rocket-defer]` srcs, `data-rocket-src` fallback); Lazyload (reverse scan for lazyload script URL regex `/(wp-rocket\/assets\/js\/lazyload\/.*\/lazyload(\.min)?\.js)/` + inline `window.lazyLoadOptions=...img[data-lazy-src]`; per-image detection with `data-lazy-src(-srcset)`; **image `src` fallback chain (parity):** `data-lazy-src` when lazyload-detected, else `data-src` ?? `src` ?? `''`; **enhancement, scoped (fixes master #14):** replace the 23 × `outerHTML.includes()` scan with structural checks **only where provably equivalent** — attribute _presence_ entries (`data-src`, `data-srcset`, `data-no-lazy`, `data-skip-lazy`, `fullurl`, …), quote-anchored class-prefix entries (`class="ls-l`, `class="ls-bg` — matched as **"class attribute value starts with"**, not classList substring: a class like `ls-lazy` must NOT match, exactly like legacy), and `img.loading === 'eager'` — while **keeping string matching for value-like entries** that can hide anywhere in the outer HTML (`skip-lazy`, `data-height-percentage`, `data-large_image`, `avia-bg-style-fixed`, `swatch-img`, `soliloquy-image`, `lazy-slider-img`, `image-compare__`, URL fragments). The parity harness (below) must assert identical outputs on every fixture — including two **adversarial fixtures**: a class attribute _containing_ `ls-l`/`skip-lazy` not at value start (e.g. `class="foo ls-lazy"`), and an exclusion token appearing inside an `src` URL — before the structural path ships; if any divergence resists fixing, ship the string-scan (parity wins over micro-optimization, documented).
  - [ ] `detect-preloaded-resources.ts` — parity port of `checkPreloadedResourced`.
  - [ ] `run-detection.ts` — orchestrator: runs all checks, applies the "wpr.present ||= any optimization (except `defer_all_js`, `wpr`)" propagation, times itself (`performance.now()`), returns `{ detections, preloadedResources, elapsedMs }`.
- [ ] `fixtures/` — 8–12 HTML files captured from real WP Rocket pages (variants: cached + debug comment, uncached, nowprocket, old+new DelayJS types, ALR, CPCSS vs RUCSS, minify, PSI, zero-scripts page). Each fixture gets an inline "expected" JSON snapshot.
- [ ] `reference/` — test-only TS copy of legacy `wprDetection.util.ts` (excluded from build via tsconfig exclude of `**/reference/**`; **its `@/Types`/`@/Globals` imports must be re-pointed at a local constants/types file** — it is verbatim _semantics_, not import paths) to assert port ≡ legacy on every fixture.

### 5. `lib/diagnostics/` — diagnoser parsing

- [ ] `extract.ts` — parity port of `processDiagnoserData`: find `#wpr-diagnoser-no-rocket-json-data` / `#wpr-diagnoser-rocket-json-data`, `jsonrepair` (dynamic import) → `JSON.parse`, typed results: `DiagnoserData = { noRocketData: NoRocketData | null; rocketData: RocketData | null }` with real types (`NoRocketData`: `wpr_plugin`, `get_rocket_option` (incl. `version`), `filters`, `server_info{server_load,web_server,php_memory_limit,wp_memory_limit,wp_max_memory_limit}`, `constants`, `preload_rucss_tasks`, `preload_rucss_parameters`, `querystrings`, `user_agent`, `imagify`, `wpr_diagnoser_version`; `RocketData`: `options: Record<string, RocketOptionEntry>`, `post_meta_excluded_options: Record<string, boolean>`). Validate with guards; unknown extra keys stay accessible via index signature `[key: string]: unknown` so future diagnoser plugin fields surface instead of breaking.

### 6. `lib/options-map/`

- [ ] Port the two JSON maps (verbatim data) + `getRealOptionName(option: string): string`; `optionNamesMap.json` loaded statically (small), single source, no legacy `try/catch` swallow — JSON is import-time validated by a unit test that iterates all keys (type `string`).

### 7. `lib/known-conflicts/`

- [ ] `match.ts` — pure matching: `findKnownConflicts(allText: string, db: KnownConflict[], mode: 'helpscout' | 'wp-admin'): KnownConflict[]` with exact legacy semantics (HS: `(^|- )(name)($| -)` lowercase regex; WP: lowercase `includes`), case-insensitive trim handling, skip entries without name+url. Unit tests with real-ish entries from the DB.

### 8. `lib/logger.ts`

- [ ] Typed logger with the `[WPR FDT]` prefix (master §4.7): levels (debug/info/warn/error), namespace tag per caller, `debug` silenced when `import.meta.env.MODE === 'production'` except the processing-timing line (kept for baseline comparison). Required by P2/P3 — created here so it is never invented ad hoc. Unit-tested (prefixing, level gating).

## Explicit enhancements over legacy

- Single-pass page classification (perf) + structural lazyload exclusion checks (perf) with parity harness.
- Real types everywhere (`DiagnoserData: any` → typed), validated boundaries (security).
- Fixtures + legacy-reference harness = regression-proof parity (reliability).
- KC DB + validators typed; dead channels/constants not ported.
- Detection functions decoupled from live `window`/`document` — they take parsed input, enabling all of them to be unit-tested (legacy tested nothing).

## Tests

- `lib/detection/*.test.ts` — every check × every fixture; parity assertions vs `reference/` on all fixtures (including the two adversarial lazyload fixtures above); perf smoke (each fixture < 25 ms in CI, no assertion on machine speed beyond a generous bound).
- **`lib/detection/bench/detection.bench.ts` (the automated ≥ 30 % enforcement, master §5.6):** warm up 3×, then run `run-detection()` **and** the `reference/` legacy engine over every fixture × 10 iterations; print a per-fixture median table (fixture | new ms | reference ms | ratio); assert **aggregate `median(new) ≤ 0.70 × median(reference)`** — wired as `pnpm bench:detection`, run in P3/P11; a perf regression fails the gate instead of being eyeballed.
- `lib/messaging/validate.test.ts` — all guards, including hostile inputs (oversized arrays/strings, wrong types, prototype-pollution keys like `__proto__`).
- `lib/diagnostics/extract.test.ts` — valid JSON, malformed JSON repaired, missing elements, wrong element contents.
- `lib/known-conflicts/match.test.ts` — HS + WP modes, punctuation variants, name/URL-less entries.
- `lib/options-map/*.test.ts` — every key maps to a non-empty string.
- `lib/storage/*.test.ts` — fallback shapes (using `fakeBrowser` + WXT storage).
- `lib/logger.test.ts` — prefix/levels/gating.

## Verification checklist

- [ ] All gates green (`compile/lint/format/test`).
- [ ] Fixture corpus committed (incl. the two adversarial lazyload fixtures); parity harness reports 0 diffs vs legacy reference; any intentional deltas are documented in `run-detection.ts` TSDoc.
- [ ] `pnpm bench:detection` run; its median table committed here — the ≥ 30 % aggregate target holds **automatically** (the assertion is in the bench).
- [ ] `pnpm build` shows detection/`lib` code is not yet bundled into any surface (or is, only via P3+ consumers).

## Docs to update

CLAUDE.md if directory layout diverges from §1.5 of master (it shouldn't).
