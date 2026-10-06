# Phase 11 — Detection coverage expansion (second behavioral baseline)

**Depends on:** P1 (engine), P6 (Detections page renders from the registry). **Effort:** M. **Parallelizable:** none (P12 builds directly on this registry's HUD facet; P13/P14 consume the expanded statuses).

## Goal

Fold the second behavioral baseline — [`wp-media/wpr-inspector`](https://github.com/wp-media/wpr-inspector) @ v4.1.1 (`../wpr-inspector`) — into this extension's detection engine and Detections page: the `data-wpr-features` generator meta as a primary detection source, the four feature checks the first baseline lacks (`self_hosted_fonts`, `image_dimensions`, `alr`, `auto_preload_fonts`), page-cache context (exclusion markers from captured headers, "optimized but not cached" state), a WordPress version check, and Delay-JS version extraction from the minified class signature. Ported by behavior, improved and enhanced — never copied.

Everything lands additively in the P1 registry so the Detections page, the future on-page inspector (P12), and the support report grow by registry rows, not by editing consumers.

## Reference (wpr-inspector, verified on 2026-10-06 by full-source read)

- `wpr-inspector/inspector.js` — `WprInspector` class; one client-side feature pass (`doWPRInspection`).
- Detection mechanism: `meta[name="generator"][data-wpr-features]` is the **primary source**; the attribute holds a space-separated list of feature keys (`wpr_remove_unused_css`, `wpr_async_css`, `wpr_delay_js`, `wpr_defer_js`, `wpr_lazyload_images`, `wpr_lazyload_css_bg_img`, `wpr_lazyload_iframes`, `wpr_image_dimensions`, `wpr_preload_links`, `wpr_minify_css`, `wpr_minify_js`, `wpr_cdn`, `wpr_oci`, `wpr_host_fonts_locally`, `wpr_lazyrender`/`wpr_alr`). `hasWPRFeature(key)`: `true`/`false` when the meta tag exists, `null` only when the tag is absent — the absent-tag case falls back to footprint detection.
- Checks absent from the first baseline: page-cache exclusion markers from HTTP headers (synchronous `HEAD` XHR via `getHTTPHeaders`, scanning the full header string for `['siteground', 'cloudflare', 'somethingelse']`), WordPress version (`meta[name="generator"][content*="WordPress"]` + `/WordPress\s*([\d\.]+\w*)/`), self-hosted Google Fonts (meta `wpr_host_fonts_locally`; fallback `link[data-wpr-hosted-gf-parameters]` or the string `/cache/fonts/1/google-fonts/`), image dimensions (meta-only), ALR (meta `wpr_lazyrender` OR `wpr_alr` — with fallback to `#rocket-lazyrender-inline-css`, `[data-wpr-lazyrender]`, `[data-rocket-location-hash]`, `script[src*="wpr-beacon.min.js"]` **only when the meta tag itself is absent**), auto preload fonts (**dead code** in the source — a fully-written `checkAutoPreloadFonts` that `doWPRInspection()` never calls and whose DOM node does not exist; calling it would throw), OCI (meta `wpr_oci`, no fallback), Delay-JS minified signature `/class RocketLazyLoadScripts\{constructor\(\)\{this\.v="([\d\.]+)"/`.
- Page-cache model (richer than the first baseline in one dimension): `signature = documentElement.nextSibling.data`; `Debug: cached` → enabled + humanized `cached@<ts>`; signature without the debug marker → **`unsure`** ("Page is optimized"); no signature → disabled, unless an exclusion marker was found in headers ("Page is optimized and possibly cached (siteground might have removed the signature tag)"), which is also rendered as an extra line under the Cache chip. The first baseline walks comment siblings for "This website is like a Rocket" (more robust) — that walk stays, gaining the unsure/exclusion semantics.
- Cached-time humanizing: `timeConverter` (dd/mm/yyyy hh:mm:ss local).
- The `unsure` status is real UI: inspector chips are colored `enabled` (green) / `disabled` (red) / `unsure` (amber) — a three-state status model the Detections pages don't have yet; the third state arrives for the Detections page here (first-baseline parity is the two states present/cached; the third state is a committed delta).

## Source quirks fixed in this phase (verified in the source)

| #   | Quirk / bug in the inspector source                                                                                                                                                       | Fix here                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sync XHR `HEAD` (`utils.js getHTTPHeaders`) just to scan headers for exclusion markers — deprecated, main-thread blocking, redundant                                                      | Reuse the main-frame response headers already captured by the P2 header interceptor (the same response); zero extra requests                                                                                                                                              |
| 2   | `checkAutoPreloadFonts` exists but is never called; its template node doesn't exist (calling it would throw `null.classList`)                                                             | Implemented as a real registry row with corrected fallbacks (below)                                                                                                                                                                                                       |
| 3   | Auto-preload-fonts fallback counts the shared beacon script (`wpr-beacon.min.js`) — the same marker the ALR fallback uses, so it false-positives whenever any beacon-backed feature is on | Fallback tightened to `link[rel="preload"][as="font"][data-rocket-preload]` only; beacon presence alone never asserts it (documented task: verify against a real WPR-load-fonts site)                                                                                     |
| 4   | `version` regex `/WP Rocket\s*([\d\.]+\w*)/` looser than the first baseline's `/wp\s*-?\s*rocket[\/\s:;v=]*\s*([0-9]+(?:\.[0-9]+){0,3})/i` (misses e.g. `wp-rocket 3.20` variants)        | The first-baseline regex stays as the primary extractor; version-variant capture cases covered in tests                                                                                                                                                                   |
| 5   | One dead signature ('somethingelse') in the nullifier list — never matches anything real                                                                                                  | Dropped; list becomes a typed registry (`CACHE_EXCLUSION_MARKERS`) with per-entry why-comments                                                                                                                                                                            |
| 6   | `checkCPCSS` fallback `this.pageHTML.includes('wprRemoveCPCSS') !== false` — a pointless tautology (`includes` always returns a boolean), plus the `CPCSStatus` field typo                | The check scans inline script contents directly (the first baseline's stricter surface — see §3 merge verdicts); the RUCSS-enabled → CPCSS-merge semantics stay carried by the P6 "Optimize CSS Delivery" card logic; the engine drops the tautology and the typo'd field |

## Tasks

### 1. `lib/wp-rocket/` — engine contract stays additive

- [ ] Extend the detection result types (each check result gains an optional `source?: 'meta' | 'footprint'` field present only when that mechanism actually decided, plus its existing payload) and add four `WprDetections` keys: `self_hosted_fonts`, `image_dimensions`, `alr`, `auto_preload_fonts`.
- [ ] `wpVersion` joins the envelope (new engine output — page-derived, so the P1 parsers of the envelope must accept/validate it): `{ version: string | null }` via `meta[name="generator"][content*="WordPress"]` + `/WordPress\s*([\d\.]+\w*)/i` (attribute casing from the inspector source; verify against a real page that the digits always follow).

### 2. `lib/detection/feature-meta.ts` — the single meta-source module

- [ ] `parseWprFeatureMeta(doc)`: find `meta[name="generator"][data-wpr-features]`; none → `tagAbsent`; present → `Set<string>` (whitespace-split, empty tokens filtered — parity-observable for exact-key lookups).
- [ ] `hasWprFeatureMeta(meta, key): 'tagAbsent' | true | false` — the three-state semantic the ALR logic needs (fallback must run **only** when the tag is absent, not when the key alone is missing).
- [ ] `FEATURE_META_KEYS`: one `as const` registry row per check: `rocket_cdn → 'wpr_cdn'`, `remove_unused_css → 'wpr_remove_unused_css'`, `async_css → 'wpr_async_css'`, `delay_js → 'wpr_delay_js'`, `defer_all_js → 'wpr_defer_js'`, `lazyload → 'wpr_lazyload_images'`, `lazyload_css_bg_img → 'wpr_lazyload_css_bg_img'`, `lazyload_iframes → 'wpr_lazyload_iframes'`, `image_dimensions → 'wpr_image_dimensions'`, `preload_links → 'wpr_preload_links'`, `minify_css → 'wpr_minify_css'`, `minify_js → 'wpr_minify_js'`, `rocket_above_the_fold_optimization → 'wpr_oci'`, `self_hosted_fonts → 'wpr_host_fonts_locally'`, `alr → ['wpr_lazyrender', 'wpr_alr']` (first hit wins), `auto_preload_fonts → 'wpr_auto_preload_fonts'`.
- [ ] Template precedence per check (the pattern every ported check follows): **meta → footprint** exactly as the inspector does — except where a check's footprint is stronger than the meta (see §3 exceptions). The result carries `source` so the UI can state _how_ it was detected.

### 3. Checks — merged precedence wiring + new checks in `lib/detection/` (merge decisions per overlapping check)

The two baselines' checks merge **individually** — for every overlapping check this phase records which footprint wins and why (the "best of both" rule: strongest, most robust marker set; never a silent drop):

- [ ] All 13 existing checks gain the meta-key fast path; results add `source: 'meta' | 'footprint'` reflecting actual evidence. **Footprint merge verdicts (each tested against fixtures):**
  - `remove_unused_css` — keep the typed selector `style#wpr-usedcss` (the stricter of the two; the other source used a bare id match).
  - `async_css` (CPCSS) — scan **inline script text contents only** (the first baseline's surface; the second baseline's page-HTML sweep matched the string anywhere, e.g. in data attributes/JSON blobs — false-positive-prone) + drop the always-true/tautological comparison (quirk #6).
  - `delay_js` — union: `RocketLazyLoadScripts` inline check, **both** Delay-JS `type` values (old value `rocketlazyloadscript` alone — the newer `text/rocketlazyloadscript` literal is a substring of the old value's match anyway — keep the first baseline's `isDelayJSType` helper), the minified `class RocketLazyLoadScripts` signature, AND **`data-rocket-status` attribute presence** as the last fallback (the second baseline's marker, now adopted for detection too — P14 uses it richly for runtime state). The always-false compared to the per-script inventory: the meta key only fast-answers presence.
  - `defer_all_js` — keep the attributed-element check `script[data-rocket-defer]` (a strict superset of the other source's src-required `<script …data-rocket-defer…></script>` regex — that regex also required an empty element and a `src`, and would miss inline deferred scripts).
  - `minify_css`/`minify_js` — keep the first baseline's footprint (`(.*)(?:cache\/min\/)\d+\/[a-zA-Z0-9_](.*).css|js(.*)` over parsed `link[rel=stylesheet]` / script `src` elements): its `\d+` variable numeric folder beats the other source's literal `1`, and scanning parsed elements beats a page-HTML regex sweep (anchors on actual resources). The meta keys still short-circuit earlier when present.
  - `rocket_cdn` — keep the first baseline's structural `link[rel="dns-prefetch"][href*=".rocketcdn.me"]` (a dns-prefetch to `.rocketcdn.me` anywhere in the page without the link element is far more likely third-party noise than a real RocketCDN setup; documented divergence from the other source's looser page-string check).
  - `preload_links` — union: `#rocket-preload-links-js-extra` (structural, first) **plus** the `RocketPreloadLinksConfig` occurrence count > 1 marker (second source) — the count marker catches builds where the config global is inlined without the legacy `js-extra` id; grossly bounded by `> 1` (helper-data + usage), not a bare presence test.
- [ ] **New `self_hosted_fonts`** — meta `wpr_host_fonts_locally`; footprint: `link[data-wpr-hosted-gf-parameters]` present OR serialized HTML contains `/cache/fonts/1/google-fonts/`.
- [ ] **New `image_dimensions`** — meta-only (no footprint exists in either baseline; when the meta tag yields no verdict, the result ships without `source` and the card renders its muted "not detected — no known footprint" state).
- [ ] **New `alr`** — meta `wpr_lazyrender` ∨ `wpr_alr`; footprint (only when tag absent): `#rocket-lazyrender-inline-css`, `[data-wpr-lazyrender]`, `[data-rocket-location-hash]`, `script[src*="wpr-beacon.min.js"]` (verify these four footprints on a real WPR 3.19+ site; tag-absent semantics exact per §1 API).
- [ ] **New `auto_preload_fonts`** — meta `wpr_auto_preload_fonts`; footprint `link[rel="preload"][as="font"][data-rocket-preload]` (corrected fallback — source quirk #3). Ship the card; if on-site verification shows the fallback insufficient, the card keeps meta-only honesty (result still ships, stated), decision recorded here.
- [ ] **Cache context** — the engine's only change is a new `wpr` result field `signatureFound: boolean` (a WP Rocket comment sibling exists); the Cached/WPR card composition happens at view-model level where headers live: `!signatureFound && exclusionsHit(headers)` → the Cached/WPR card gains the "possibly cached — `<marker>` removed the signature" subtitle + amber `unsure` styling; `signatureFound && !cached` → "optimized but not cached" amber subtitle; `cached` → green (unchanged). `CACHE_EXCLUSION_MARKERS` in `lib/wp-rocket/constants.ts` starts with the two real markers — why-commented, and a written task to add more only after each is verified on real hosting (never speculative markers).
- [ ] **Delay-JS version** — extend `delay_js.version` extraction with the minified class signature regex (parity: `/class RocketLazyLoadScripts\{constructor\(\)\{this\.v="([\d\.]+)"/`) tried after the existing `this\.v\s*=\s*"([^"]+)"` pass; same result field, no API break.
- [ ] **Timestamp format shared, not duplicated:** one `formatCacheTimestamp(ts)` util (relative preferred with absolute fallback — e.g. `2 min ago` / `dd/mm/yyyy hh:mm:ss` when older than an hour) owns both the Detections Cached card subtitle and the strip's cache chip slot; single formatter, adapted density per surface (spec replaces the two divergent format mentions).

### 4. Detections page (P6 surface extensions)

- [ ] New cards appear by registry row (no page edits beyond the shared row types): **Self-Hosted Google Fonts** ("SHGF" in P12's compact strip), **Image Dimensions**, **Lazy Render (ALR)**, **Preload Fonts** — full names confirmed against the WP Rocket settings UI on a test site during this phase (record any label correction here).
- [ ] **Registry gains the `hud` facet** (consumed by P12's on-page strip): per-check `shortLabel` (the compact strings — `SHGF`, `PL Links`, `Circular`-style abbreviations incl. full-name tooltips), `group` (Cache / File Optimization / Media / Preload / CDN / Features / Tools), and display ordering. One registry row drives the panel card, the strip chip, and the report line — no surface re-lists features.
- [ ] "How detected" chip on every card driven by `source` (meta = the stronger claim; footprint = observed evidence) + the amber `unsure` status introduced above (tokens from the P0 design system; the color map doubles for P12's strips).
- [ ] Summary strip + `buildSupportReport` gains: WordPress version line, cache-exclusion subtitle line when applicable (pure functions — golden tests update accordingly).
- [ ] Toolbar-badge summary and `reportDetectionSummary` payload unchanged (present/cached remain the signals — no new background churn).

### 5. Fixture corpus extension (P1 §5 gates still apply)

- [ ] New fixtures: generator meta with `data-wpr-features` (features on/off), ALR page footprints, self-hosted fonts page, image-dimensions meta, preload-fonts links vs bare-beacon page (the adversarial case for quirk #3), WordPress meta with/without version digits, no-meta-no-footprint page, plus the merge-verdict fixtures named in Tests. Snapshot expected outputs; the bench compares only when a reference implementation exists for these checks — for meta-driven checks the tests are the reference (table-driven expectations).

## Explicit enhancements over the inspector source

- **Per-check merge verdicts recorded and fixture-tested** (§3): every overlapping check keeps the strongest marker set — never a silent drop, never a weaker sweep (e.g. `data-rocket-status` joins delay-js _detection_, minify keeps the variable-numeric folder, RocketCDN keeps the structural dns-prefetch anchor, preload-links gets the union marker, CPCSS keeps the strict inline-script surface).
- Three-state detection with a "how detected" chip (`meta` vs `footprint`) — the source's chips were state-colored but never said which mechanism decided (debugging trust).
- Header exclusion markers reuse the captured main-frame response — no sync XHR, zero extra network (quirk #1), no `somethingelse` dead marker (quirk #5).
- Dead auto-preload-fonts check resurrected with a corrected, verified fallback (quirks #2/#3).
- Version extraction keeps the first baseline's stronger regex (quirk #4); broken CPCSS fallback expression removed (quirk #6).
- WordPress version promoted first-class to the summary strip + support report (the inspector only console.logged it and stamped it small in a footer).
- Registry-driven cards/chips: new checks land as data rows (card registration, strip registration, report inclusion).

## Tests

- `feature-meta.test.ts` — tag absent/present/empty; key membership (incl. the ALR two-key rule and the fallback-only-when-tag-absent matrix); whitespace/empty tokens.
- **Merge-verdict fixtures:** for every §3 verdict row, a fixture where the losing footprint would have produced a _different_ result (e.g. `data-rocket-status` present without other DJE markers → `delay_js` present; deferred inline script with `data-rocket-defer` and no `src` → `defer_all_js` present; `cache/min/7/` asset → minify present; bare `.rocketcdn.me` string with no dns-prefetch link → `rocket_cdn` absent) — pins the merges mechanically, not just in prose.
- Check tests × new + extended fixtures — assertion tables: meta win, footprint win, both → `source` reflects evidence union per check exception rules (§3).
- Cache-context view-model tests: headers with/without markers × signature/cached/present combos; support-report line golden tests.
- Version tests: WordPress meta variants; Delay-JS minified-signature fixture vs `this.v` fixture (both extract; priority documented).

## Verification checklist

- [ ] Gates green (`compile`/`lint`/`format:check`/`test`); `pnpm check:budgets` unchanged (engine-only + card work within panel budget).
- [ ] Side-by-side on a real WP Rocket site (3+ optimization combos): new cards reflect reality; meta vs footprint agrees with what the inspector reports on the same page (the inspector is the comparison tool here, run from `../wpr-inspector` in dev mode).
- [ ] `data-wpr-features`-present site: every listed key renders its correct card state without ever consulting footprints except where §3 exceptions require the union.
- [ ] Site behind SiteGround/Cloudflare with the cache signature stripped: the amber "possibly cached" subtitle names the hit marker; headers viewer still lists `x-sg-optimizer`/`cf-cache-status` capture.
- [ ] No-meta/no-footprint site: four new cards state their "no footprint known" nuance without grossly asserting enabled/disabled where nothing is known.

## Docs to update

AGENTS.md — no layout change expected (`lib/detection/` extension); update if the four checks require a new file per AGENTS conventions. Master plan §9 table updated with delivered rows at phase end.
