# P14.5: coverage audit, decisions and tooling

## TLDR

One phase owns **D1–D7/T1–T9** and all corrections below; original audit proposals are not separate execution plans. Owner approved this grouping2026-10-07, **not unconditional implementation without the decision gate**. Depends:P11–P14; chosen order P14→P14.5→P14.6→P7→P5J→P15. No parallel implementation phase in its slot. Installed stack; no new permission/dependency expected unless decision explicitly changes scope.

## Gate first: P14.5A

Depends:P11–P14. Parallel:—. Goal: current evidence/BUILD-DROP-DEFER before code.

- [ ] Recheck current WP Rocket source/release against audit anchors below, correct drift **here**; actual installed settings/KB spelling for each label.
- [ ] For every item record BUILD/DROP/DEFER+one-sentence reason. Defaults D1–D7/T1–T7 BUILD, T8 DEFER, T9 DROP; no verdict prefilled as executed work.
- [ ] Recount actual registry, not old **19→27** claim:3 proposed new rows+4 upgrades do not add8. Completion measures actual rows/all consumers, not a false arithmetic target.
- [ ] Resolve T1 placement: original claimed “P7 SBS page” does **not exist** (P7 Diagnoser; optional P17 panel home). Use current SBS seam or explicitly approve a local surface; don't make P17 required silently. T7 expiry must tolerate absent rebuilt Diagnoser until deferredP7; revisit its field when plugin arrives.

DoD: current-source/label evidence, each decision, placement/count/dependency reconciliation recorded. Before code, expand approved items into **small independently testable/reviewable slices** using the groups below, not one dozens-file batch.

## Audit evidence (2026-10-07, WP Rocket develop3.23.5.1)

Source inventory: `inc/Engine/Admin/Settings/Page.php`, views/settings, Support/Data+Meta; each emitter below read, not assumed. Page DOM/captured headers/user-trigger probes allowed; live-host validation still future. Initial13+P1.1 four+P11 two=19 audit rows; current registry may differ. Preserve proof **limits**:

- Page cache signature/version/debug stamp detectable; **no cache settings toggle** in audited3.23 UI. Lifespan/purge/reject URLs-cookies-UA/query config/User Cache can't be inferred from logged-out HTML; Diagnoser reports actual configuration.
- Server preload sitemap crawl no page proof; links script/config observable. Priority family as P1.1; preconnect no settings field found at audit, verify live. Hidden DNS option distinct below.
- Minify/defer/delay/RUCSS/async markers observable; Combine JS still exists with Excluded Inline JavaScript. Combine Google Fonts hidden Tools action rewrites ordinary links, **no attribution marker**, requires ±cache probe. Emoji removes core script/hints only, absence alone not proof.
- Images/background/iframes/YouTube facade observable (background container/exclusion/nostyle IDs; iframe options/facade/rll classes). Image dimensions comment/meta attributable, ordinary width/height not. Self-host fonts link **and style** attributed. Used-CSS font preload opt-in overlaps attributed-font emitter (defaultoff); no automatic-feature claim from generic preload.
- Generic CDN wpr_cdn meta proves application; off-origin assets/plain preconnect alone heuristic. RocketCDN-specific dns-prefetch .rocketcdn.me remains its narrower footprint; no extra generic CDN row justified. CNAME attribution T1, not guess.
- Control Heartbeat, Performance Monitoring, eight database options/add-on config server-only→Diagnoser/admin. **Host-layer headers never prove Cloudflare/Sucuri/Varnish add-on enabled.** WebP server rewrite leaves unchanged HTML; no page-only verdict. Speculation rules not emitted by audited plugin.

Meta provenance: generator-map `wpr_preload_links`, `wpr_host_fonts_locally`, conditional `wpr_dns_prefetch`, device `wpr_mobile/wpr_desktop`; CommentTrait prefixes minify_css/minify_js/minify_concatenate_js/defer_js/delay_js/remove_unused_css/async_css/cdn/lazyload_images/iframes/css_bg_img, plus family/image dimensions. Verify final emitted **wpr_** tokens, not raw emitter argument mistaken as attribute value. No emoji/Combine-font/WebP/admin token.

## Detection slices (after gate)

Each approved D item can be a small slice; depends:A+P11; parallel other D cores only with disjoint shared-contract edits coordinated. Each ships registry/guard/check/fixture+independent reference lockstep, native labels and all consumers, then gates. No silent weaker marker/drop.

- **D1 mobile_cache:** separate-mobile-cache active+served variant mobile/desktop from **wpr_mobile/wpr_desktop** only (`Support/Meta.php`, conditional do_caching_mobile_files). Beacon is_mobile is context, never proof; absent markers→not detected, not disabled guess. Typed `{present,variant:'mobile'|'desktop'|null,deviceContext}`; absence/unknown context handled honestly at design gate.
- **D2 dns_prefetch:** hidden dns_prefetch/rocket_dns_prefetch→wp_resource_hints (`front/dns-prefetch.php`,functions/options). Meta emitted domains exist AND(CDN off OR>1domain). Plain dns-prefetch corroborates, **cannot assert WP Rocket alone**. Present meta+no observed link valid domains[]. Remove old P11 weak-preconnect mapping; attributed prefetch/preconnect belongs separate Priority feature.
- **D3 minify_concatenate_js:** add **wpr_minify_concatenate_js** (`Minify/JS/Combine.php:135`); combined script before body/cache-min/data-minify(:129) cannot distinguish plain minify by URL, so meta discriminator required. This feature wasn't removed; original plan premise wrong.
- **D4 minify:** primary data-minify=1 on stylesheet/script, cache/min/<n> URL weaker fallback (`Minify/CSS/Minify.php:197`,JS/Minify:265,Combine:129).
- **D5 async CSS:** add link[data-rocket-async=style] onload swap beside inline wprRemoveCPCSS (`CriticalPath/CriticalCSSSubscriber.php:618,749`), wpr_async_css confirmed.
- **D6 original script type:** retain data-rocket-type on delayed records+JS real-type detail (`DelayJS/HTML.php:249`).
- **D7 fonts:** attributed **style** plus link (`Media/Fonts/Frontend/Controller.php:227,322`); cache/fonts/<blog-id>/… not literal1 (`Fonts/Filesystem.php:32`).

DoD per slice: positive/negative/malformed/capped fixtures, correct source/unknown, reference parity, UI bar where touched, measured build/budgets. P11 doc pointer stays; corrections execute here, not retroactive scope expansion.

## Tool slices (after gate)

Each approved T item gets its own implementation/verification slice; depends:A/owning P6/P12/P13/P14/D data. Parallel only disjoint page/core ownership; final integration serial. Pure cores+tests, no speculative shared framework.

- **T1 This page ± cache:** current exact URL vs plugin bypass nowprocket (`API/bypass.php`, since3.7), pure parsed-doc diff/golden grouped by feature: only with cache/removed by cache/renamed assets/CDN. Emoji/Combine-font attribution needs both copies, never absence-only. Existing host permissions, page-context same-origin fetch only when safe/allowed; background fallback fixed-target validated, explicit failure. Placement resolved at gate, not nonexistent P7 page. Highest-value probe, opt-in.
- **T2 Assets:** new registry page, one CSS/JS resource with observed Minified/Combined/Deferred/Delayed/Excluded/Lazyloaded/CDN/Preloaded/Hosted-font chips. Preserve existing JS/Lazyload pages; no unproven attribution of site-exclusion configuration. Shared inventory pass over already classified assets, pure matrix, filter/search/virtualization; dedicated budget row without double-counting/evading whole build.
- **T3 Hosting/cache layers:** extend existing header registry for verified SiteGround/`sg-f-cache`, LiteSpeed,Cloudflare cf-ray/cache-status (`HIT`/`STALE`/`REVALIDATED`/`UPDATING` served; `EXPIRED`/`MISS`/`DYNAMIC`/`BYPASS`/`NONE`/`UNKNOWN` not),Sucuri,Varnish,x-cache/age and the generic `x-proxy-cache` host/proxy layer (never labeled SiteGround). Verify each real marker before row; no new capture, absence no card, layer-not-add-on wording.
- **T4 Warm-up inventory:** Preloaded page adds grouped rel/type preloads/preconnect/DNS hints+instruction context, existing filter/summary. Keep generic hints vs WP Rocket-attributed distinctions.
- **T5 Instruction sheet:** whole bounded parsed rocket_beacon_data read-only JSON in P14 page (status/selectors/exclusions/mobile); reuse P1.1 parser, never eval/second decoder.
- **T6 RUCSS sizes:** P13 results original vs shaken per stylesheet/total,≈saving% pure math; verify original byte data is genuinely available before showing numbers—style listing alone isn't bytes. No fabricated size/per-file attribution.
- **T7 Cache age/expiry:** reuse existing age formatting (P6 already shows age); add only missing evidence. Optional expiry from actual Diagnoser cache_lifespan when available afterP7, absent is honest, no mandatory blocked dependency introduced.
- **T8 DEFERRED snapshot:** background phone-UA **snapshot**, distinct from shipped P16 live overlay simulation. Historical permission-cost rationale predates DNR already added; decision remains defer until support demand/new review, not automatic approval because permission now exists.
- **T9 DROPPED speculation viewer:** no WP Rocket3.23.5.1 emitter; not missing work. Reproposal needs new source evidence.

## Integration/acceptance

Depends:all approved slices. Parallel:—.

- [ ] Detection fixtures mobile/desktop/bypass/DNS/combined/minify/async/font style; all guard/reference/cross-consumer tests. Golden diff/assets/header negatives/config/size/age cores.
- [ ] Real matrix: both served device copies; DNS not preconnect; Combine distinct minify; busy-page emoji/Combine-font/CDN diff; real Cloudflare/Sucuri layer; white-label no-meta fallback. Explicit authorized-service vs local-simulated evidence.
- [ ] Every actual registry row in Detections/strip/report, no duplicate table; BUILD/DROP/DEFER evidence for every item, current raw/gzip table/Assets row, UI bar §D/common gates. Record actual count, never claim old19→27.
- [ ] Update index/master delivered note and AGENTS for actual structure/dependency/permission changes. No per-item implementation implied by audit approval alone.
