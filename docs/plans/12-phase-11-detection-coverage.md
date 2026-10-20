# P11: merged detection and P11.1 site matrix

## TLDR

Add generator-feature evidence/source labels, missing font/dimension coverage, cache context (cache states declared once; an absent marker never renders a verdict) and shared card/strip/report registry. P1.1 already owns Priority Elements footprints/status; P12A already exposes a provisional strip and WordPress-version parser. Reuse them. Depends:P1/P1.1/P6; chosen slot after parked-P10 resolution, before fullP12; no independent consumer work during contract changes. Installed stack, no dependencies planned.

> **NOTE FROM DEV:** P14.5 owns corrections to P11's meta-key table and footprint verdicts. Do not move that work into P11. The [coverage audit and exact corrections](./15b-phase-14-5-coverage-and-tooling.md) remain the declaring site; reconcile its decisions there, not by silently “fixing” this phase's scope.

## Verified behavioral reference

Second baseline v4.1.1 `inspector.js`, audited2026-10-06. `meta[name=generator][data-wpr-features]` primary; tag present+key missing→false, tag absent→fallback. Generator began **3.17.2**, not3.16; digits-free meta is **not tag absence**. P12's era record retains provenance/conditional emission.

Source defects not to port: synchronous HEAD XHR for already-captured headers; fake “somethingelse” cache marker; loose version regex; arbitrary-HTML CPCSS match; wrong ALR keys `wpr_lazyrender/wpr_alr`; beacon-as-feature fallback; defined-but-never-called auto-font check. No console narration/placeholder popup/incognito-only gate.

## Implementation slices

### P11A — Meta contract and precedence — **shipped 2026-10-20**

Depends:P1/P1.1. Parallel:—. Goal: one bounded meta parser/registry and explicit per-check evidence rule.

- [x] `feature-meta.ts` parses whitespace-separated exact tokens once, distinguishes absent/present-empty/member. Additive optional `source:'meta'|'footprint'` only when deciding evidence exists; old payloads tolerate absence. Keep inventory payloads even when presence fast-paths.
- [x] P11 mapping (with later P14.5 amendments explicitly outside this slice): rocket_cdn→wpr_cdn; remove_unused_css→wpr_remove_unused_css; async_css→wpr_async_css; delay_js→wpr_delay_js; defer_all_js→wpr_defer_js; lazyload→wpr_lazyload_images; lazyload_css_bg_img/iframes→same `wpr_` names; image_dimensions→wpr_image_dimensions; preload_links→wpr_preload_links; minify_css/js→same `wpr_` names; critical images→wpr_oci; self_hosted_fonts→wpr_host_fonts_locally; automatic_lazy_rendering→wpr_automatic_lazy_rendering; auto_preload_fonts→wpr_auto_preload_fonts; preconnect_external_domains→wpr_preconnect_external_domains. Old weak-DNS-key proposal is recorded/corrected **only in P14.5 D2**, not an additional declaring table here.
- [x] Table/tests per overlap: meta authoritative, fallback **absent-or-degraded only** (a caps-violating attribute never manufactures refutations), any stronger-footprint exception explicitly documented before code. No accidental “missing key means fallback.” Validate new rows/source/envelope; reuse existing WordPress version parser, strengthen digits-required/absence boundary rather than duplicate it.

DoD: absent/empty/whitespace/meta true/false, both evidence sources and hostile guards tested; precedence/deltas recorded, existing inventories/contracts stay valid.

**Shipped state (2026-10-20, tokens verified token-by-token against WP Rocket 3.23.5.1 source in the apvm cache, not from memory):** `feature-meta.ts` owns the registry (`FEATURE_META_TOKENS`), the bounded parser (`parseFeatureMeta`, caps 64 tokens/128 chars/8 KiB attribute — violation degrades the whole declaration so hostile input can only lose meta authority, never manufacture refutations) and the verdict rule (`featureMetaVerdict`: declared/refuted/absent, computed once per page in `parsePage.featureMeta`). Emitter-verified deltas to the compressed table above: `lazyload_css_bg_img`→**`wpr_lazyload_css_bg_img`** and `lazyload_iframes`→**`wpr_lazyload_iframes`** (the emitters' comment ids carry the full feature name; no bare `wpr_css_bg_img`/`wpr_iframes` token exists), and the compound selector matches the behavioral baseline exactly — attribute presence decides; content tokens are not required to name the plugin. The port's read deltas are the bounded single parse (caps degrade wholesale, so hostile input only loses meta authority, never manufactures refutations), whitespace-run token splitting (`/\s+/` — NBSP/BOM separate, where the baseline split single spaces), the exact-token registry, and first-matching-tag-in-document-order selection. The `source` contract field is declared on all 15 feature rows and validated at the messaging boundary (beacon/wpr rows stay source-free); producers emit it in P11B. The two new rows (`self_hosted_fonts`, `image_dimensions`) land with their checks in P11B — the registry gains them there, keyed by the compiler-exhaustive `FeatureMetaRow`. P14.5-owned tokens (`wpr_dns_prefetch`, `wpr_minify_concatenate_js`, `wpr_cache_webp` — the last two comment emitters, not builder appends; `wpr_mobile`/`wpr_desktop`) parse but map to no row — pinned by test so a silent mapping can't sneak in. The registry carries the current emitter vocabulary; historical token spellings across older plugin releases are the later coverage audit's re-verification scope, not a mapping to invent now.

### P11B — Checks/cache context

Depends:A. Parallel:—. Preserve these footprint choices (P14.5 owns later upgrades):

- [ ] RUCSS `style#wpr-usedcss`; CPCSS inline script text `wprRemoveCPCSS` only, no arbitrary page-string match. P6 CSS-delivery merge unchanged.
- [ ] Delay union: controller, both Delay types, minified class signature, data-rocket-status presence. Version existing this.v extraction first, minified `/class RocketLazyLoadScripts\{constructor\(\)\{this\.v="([\d\.]+)"/` after. Metadata presence never discards script inventory.
- [ ] Defer attributed script includes inline/no-src; minify parsed script/stylesheet resolved URLs with variable numeric cache/min folder (not literal1); RocketCDN structural dns-prefetch link to .rocketcdn.me, not bare text. Generic wpr_cdn vs RocketCDN attribution nuance retained in P14.5 audit.
- [ ] Link preloading union `#rocket-preload-links-js-extra` or RocketPreloadLinksConfig count>1 (not one incidental string).
- [ ] Priority family adds meta over P1.1: attributed OCI image preloads, lazyrender elements/style, collecting location hashes (never applied), attributed fonts/preconnect. Shared beacon asserts **none individually**. Auto-font false positives from manual fonts remain forbidden; RUCSS-font overlap recorded.
- [ ] New self_hosted_fonts originally link[data-wpr-hosted-gf-parameters] or cache/fonts/1/google-fonts; P14.5 D7 owns style/blog-ID corrections. image_dimensions meta-only: no evidence means no source/“no known footprint,” never infer attribution from standard width/height.
- [ ] Add wpr.signatureFound from robust sibling-comment walk. Wiring first: the strip hub read carries detections only today — the captured headers are panel-side (`FdtData.pageHeaders`) — so the header capture reaches the strip view model through the hub, with a headers-unavailable arm distinct from marker-absent (nothing captured proves nothing). Cache states declared once, every arm explicit, absence of a marker never renders a verdict: stamp → cached green; marker without stamp → plugin fingerprint on the served HTML, no cache proof for the visit (amber, never folded into "not cached"); no signature + verified SiteGround/Cloudflare marker → possibly cached amber naming evidence; no signature otherwise → "cache not detected"; "not cached" only with counter-evidence (a bypass the capture attests). Chip label/tooltip copy is the single declaring site; strip, status-bar segment, describe facts and the support report read it. Remove fake marker, typed why-commented registry; no extra HEAD/request or speculative host guesses. Keep badge present/cached protocol unchanged.
- [ ] Reuse single timestamp/representability/relative-age owners; UI-density formatting only. Do not implement a second contradictory local-time formatter.
- [ ] Producer rule: rows emit `source` only when decided evidence exists (spread-omitted, never an own `undefined` — the messaging boundary rejects that shape). Minify-namespace exception: `wpr_minify_css`/`wpr_minify_js` can be DECLARED while the transform applied nothing (both Minify subscribers append the comment after the candidate loop, which continues on failures/exclusions) — declared⇒applied must not be assumed for minify rows; record any further per-row exceptions in this doc before wiring.
- [ ] Budget: the isolated content script sits near its cap (121.9/122 KB raw, 41.7/42 gzip after P11A); P11B growth re-derives the row per the budgets protocol (expected data growth, never hidden).

DoD/tests: losing-marker adversarial fixtures (status-only Delay, inline defer, cache/min/7, incidental RocketCDN/CPCSS text, bare beacon/manual fonts), applied/collecting/mixed/disabled/bypass, missing resources; no-meta/no-footprint honest unknown; header/signature/present/cached matrix; version variants; snapshots/bench/reference where comparison exists. New meta expectations table-driven, not falsely called unchanged-source parity.

### P11C — Registry/consumers

Depends:B/P6. Parallel:—.

- [ ] Native-label cards/source chips, amber why; verify **Self-host Google Fonts/Add missing image dimensions** spelling on real settings/KB (no invented acronym). Existing family cards extended, not added twice.
- [ ] One `hud` facet shortLabel/group/order feeds cards/strip/report; plugin-native compact wording/full-name tooltip. **Delete P12A provisional strip-items registry** and repoint; no second feature list. Summary/report adds WordPress version/cache-exclusion lines, golden update.
- [ ] Cache-state consumers repoint to P11B's vocabulary — strip chip+tooltip, status-bar cache segment, the describe facts row ('page served from cache'), the support report's `Page cache:` line; each surface's honest state pinned in its consumers tests (support-report/describe goldens included). No surface keeps an absence-born "Not cached".

DoD: registry→all consumers tests, UI bar §D/gates/budgets; current raw/gzip evidence, no engine-only/no-bundle-growth assumption after consumers import it; strip e2e matchers pinning the old chip pair (/✓ Cached|Not cached/) updated with the vocabulary.

## P11.1 — Site matrix

Depends:C/P4.1/P4.2; parallel fullP12 implementation. Size:M–L.

- [ ] At least3 scripted optimization combinations, wp-cli config/capture→real panel/card/JS state against declared precedence; pin combinations/expected outputs in Docker round list.
- [ ] Stripped-signature fixture and authorized real host where available: possibly cached names actual marker; x-sg-optimizer/cf-cache-status visible when **sent**. Don't confuse stripped comment with removed headers.
- [ ] No-meta/no-footprint states remain unknown appropriately; meta-present keys never consult forbidden fallback. Digits-free live fixture and actual bypass/tag-absent arm separate.
- [ ] Real second-baseline dev-build comparison on same pages, annotate differences/manual judgment. Synthetic local key cannot run live service RUCSS/async CSS; use explicit fixtures/authorized service site, not failed option toggles.

DoD: scripted rounds+parent annotation, common gates/build/budgets, card/strip/report/UI checks green; source comparison and hosting/Firefox limitations explicit. Current source HEAD rechecked before starting.
