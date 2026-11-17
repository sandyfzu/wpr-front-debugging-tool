# Completed core: P0–P4

## TLDR

P0/P1/P1.1 shipped; P2–P4 are implemented and Chromium-tested, with manual verification still open below. This is a maintenance/parity record, not an implementation queue. Current APIs, limits, versions and budgets live in code, the lockfile, [AGENTS.md](../../AGENTS.md) and `scripts/budgets.json`.

Behavioral sources: first baseline v2.2.5 (`Globals.ts`, `Types.ts`, `lib/wprDetection.util.ts`, `content-scripts/*`, background modules); second baseline v4.1.1. Re-check both HEADs before further port work. [Browser infrastructure](./completed-browser-infrastructure.md) owns P4.1–P4.3; [SBS](./completed-side-by-side.md) owns P16 refinements; [P12](./13-phase-12-on-page-inspector.md) owns the early widget and remaining strip work.

## P0: scaffold and transport

Delivered 2026-10-06:

- MV3 Chromium floor 145; justified `storage`, `alarms`, `webRequest`, `contextMenus` and all-http/https host coverage. Dropped `tabs`: host coverage supplies URL access and `tabs.create/query` need no extra permission for these uses. Firefox initially built MV2; release must revisit the manifest choice.
- Vitest/coverage, budget tooling, dependency bans and CI gates. Coverage gates `lib/**`/`utils/**`; budget validation rejects malformed rows, works from foreign cwd, and caps whole-build JS so chunk splitting cannot evade it. Unbuilt surfaces were explicitly skipped until their phase shipped. No e2e or machine-relative bench in CI.
- Tailwind v4 CSS-first tokens, AA contrast tests, reduced-motion reset and System/Dark/Light resolution. `light-dark()` is light-first; palette overrides work on nested elements. Tokens later split into `tokens.css` for shadow roots. `@source not` excludes docs so utility examples cannot generate CSS.
- Tested `cn`, trailing cancellable debounce, capitalization, HTTP URL guards and theme helpers. `tailwind-merge` correctly handles custom density/color tokens without extra config.
- Real Chromium 153 spike verified isolated↔worker, worker→target-tab and MAIN↔isolated round trips with cloned payloads/return values. `@webext-core/messaging` v4 uses `/page` for window messaging; WXT has no messaging utility at the proposed path. Tab-target sends use the installed transport's options signature, not a payload tab ID.
- A receiver returning `undefined` and a missing extension receiver both produce `Error: No response`; handlers return defined acknowledgments and every sender handles rejection. Window-bridge no-receiver requests can remain pending, so capture admission bounds outstanding sends. DevTools attachment and Firefox runtime were not proven by the spike.

Evidence: 33 initial tests; token mutation tests, malformed/breached/foreign-cwd budget probes, Chromium transport/token probes, Chromium/Firefox builds. Throwaway spike entrypoints were removed after verification. Installed versions supersede these historical measurements.

## P1: contracts and detection

Delivered 2026-10-07. Logic is input→data; storage/browser calls stay at boundaries.

### Contract ownership

- `lib/messaging/`: typed protocol, per-domain validators and window bridge. Original used-channel mapping: `getFDTData`→`getFdtData`, `getWPRDetections`→`getWprDetections`, `reloadDevTools`→`notifyPanelReload`, `devToolsSearch`→`panelSearch`; headers, processing, undefined-reference, scripts-loaded and SBS channels retain behavior. Added KC serve/refresh and badge summary. Receive-only `getDiagnoserData` and 11 unused channels were omitted; Diagnoser data is inside FDT data.
- Content scripts never submit a tab ID: background derives it from the sender. DevTools/popup target via transport options. Push receivers filter sender tab against `inspectedWindow.tabId`; two panels must never consume each other's updates. Push handlers acknowledge `true`; `processPageData` returns a boolean.
- Guards rebuild own-key data, retain supported unknown fields, reject malformed/over-cap collections wholesale rather than truncate. Empty resource URLs/content remain valid where the engine emits them, including srcset-only preload hints. `lib/detection/contract.test.ts` passes every fixture's actual output through both FDT/detection parsers.
- Historical caps: 50 printable words ×200 chars; 256 headers (name/value 512/4096 chars); 5,000 script/image/resource rows; inline script 512 KiB; URLs 4096; versions null or 1–64 chars; KC 500 rows. Authoritative values are the owning contract leaves/guards, not this record. Hostile getters, lone surrogates and prototype keys have rejection tests; deterministic fuzz performs 2,000 mutations without throws.
- `sync:options` owns appearance (System default), `features.toolbarBadge` (true) and `improvements['wp-dashboard-dbugger-entry']` (true). Reads retain unknown own boolean feature/improvement keys, reject non-booleans and restore required defaults; later settings extend this shape.
- KC storage is nullable and has no reader-side embedded fallback. Background alone packages the seed; consumers validate storage, then ask background. Refresh metadata is `updatedAt`, not the source's `lastUpdate`. KC nullable/empty optional fields are valid; name/URL are required.

### Engine decisions worth retaining

- One parsed snapshot, shared script/link **element lists**, no eager ten-read records (profiling found those slower). Checks preserve raw-vs-resolved URL semantics: Delay/Defer read attributes; minify reads reflected URLs. Preserve full inline content for search; truncate only display.
- Lazyload exclusions retain substring semantics over **one** `outerHTML` serialization/image, not 23 serializations. Structural shortcuts were rejected: serialization/escaping, class prefixes and tokens inside URL/attribute values admit parity differences. Reverse scans share one helper; 24 exclusion entries remain single-owned.
- `wpr.present` propagates from every optimization except `defer_all_js`; P1.1 adds its rows. CPCSS/minify retain falsy-`src` behavior; RUCSS matches `style#wpr-usedcss`, including SVG styles. Minify-CSS `rel` reflection stays case-preserved; RocketCDN's selector is whole-value/case-insensitive like Chromium.
- Cache timestamps preserve source truthiness, use explicit decimal radix and normalize malformed/empty suffixes to null. Deliberate hostile-only difference: `cached@0x10` becomes 0 rather than radix-less 16.
- Historical quirks retained: minify misses URLs hidden in `data-rocket-src`; an earlier delayed script can prevent controller-version capture. Improvements must be explicit, not accidental parity changes.
- Independent reference **control flow** imports shared vocabulary/types from `lib/wp-rocket/`; it must not import port logic. Constants, corpus and runtime test settings each have one declaring site. No source provenance in code/comments.
- Reference normalizations: unrendered `textContent` replaces runner-broken `innerText`; srcset-only lazy images normalize null URL to `''`. A compiled-source comparison found 13/14 fixtures identical, the other differing only in that null slot. P1.1 deliberately corrects beacon semantics in both engines.
- Diagnoser extraction finds both `wpr-diagnoser-*-json-data` elements, repairs JSON, validates known fields and preserves unknown fields for future plugin output. NoRocket covers plugin/options/filters/server/constants/tasks/query/UA/Imagify/version; Rocket covers option records and post-meta exclusions. `jsonrepair` is lazy where splitting permits it.
- Option maps retain 39+5 source labels as data, with validated nonempty mappings; consuming phases correct labels to plugin/KB wording. KC matching escapes regex names (`C++`, parentheses); HelpScout matches delimited lowercase names, WP titles use lowercase containment.
- Logger prefix `[WPR FDT]`; debug off in production, timing at info. Console summaries use counts/states, never page URLs/source.

### Evidence and limitations

Initial corpus: 11 captured pages +3 crafted, port/reference/snapshot equal. Uncapturable branches (current Delay type, CPCSS fallback, CSS-background IDs, RocketCDN hint) have mini-document tests. Snapshot write mode asserts parity first. P1 passed 179 tests; P1.1 expanded this below.

`pnpm bench:detection`: 3 warmups, 10 alternating runs/fixture, checks-phase aggregate port/reference ≤0.70. P1 recorded 2.93/6.31 ms (0.46), full pass 47.2/54.5 ms (0.87): the ≥30% claim is **checks only**, not total parse time. Bench is local, machine-relative; tiny-fixture ratios are timer noise.

happy-dom can drop minified scripts containing `<` followed by a non-tag byte and following markup until `</script>`. Runner parity remains valid, absolute counts do not prove Chromium counts. P15 must repeat compiled-source comparison and real-browser counts/timing.

## P1.1: Priority Elements

Engine/fixtures shipped 2026-10-07; real-site/source comparison closed 2026-10-12. Fixes master bug #51: the shared beacon proves **none** of its four features is applied.

### Evidence model

- Dedicated `priority_elements_beacon`: `script[data-name="wpr-wpr-beacon"]` or assets-path `wpr-beacon[.min].js`. Non-minified `SCRIPT_DEBUG` output is supported.
- Beacon injection means at least one context-allowed factory lacks a URL+device row. It disappears once all allowed factories have rows, including empty rows. Mixed applied+collecting states are normal; collecting is not an error.
- Feature checks return markup evidence only; view models compose applied/collecting/not-enabled/not-applied from beacon status. Absent and false status both mean not enabled here. Factories are filtered by `context->is_allowed()` **at registration**; excluded factories emit no key/payload/read/write/apply. Included controller paths can emit false or omit a key.
- `rocket_above_the_fold_optimization`: attributed image preload (`link[data-rocket-preload][as=image]`); retain image list even alongside beacon. `wpr_oci` comment corroborates; `fetchpriority=high` alone proves nothing. Dropped the misleading OCI `beacon` field.
- `automatic_lazy_rendering`: `[data-wpr-lazyrender]` applied; `rocket-lazyrender-inline-css` corroborates. `[data-rocket-location-hash]` is collecting evidence, not applied. Correct meta token is `wpr_automatic_lazy_rendering`, never `wpr_lazyrender`/`wpr_alr`.
- `auto_preload_fonts`: attributed `link[rel=preload][as=font][data-rocket-preload]`. Old manual preloads lack attribution and do not assert it. Attribution also belongs to opt-in RUCSS font preloading; beacon/meta identifies the Media-tab feature specifically.
- `preconnect_external_domains`: union of `data-rocket-prefetch`/`data-rocket-preconnect` link hrefs, deduped first-seen; variant count includes empty-href tags but URL list excludes them. Bare hints prove nothing; attributed RocketCDN can legitimately assert both checks. New font/domain lists use resolved hrefs.
- All four new rows propagate WP Rocket presence, including beacon-only pages. Feature order/serialized field order remain reference-comparable. Native labels: Optimize critical images; Automatic Lazy Rendering; Preload fonts; Preconnect to external domains; family Priority Elements.

Status keys: `atf`, `lrc`, `preload_fonts`, **singular** `preconnect_external_domain`. The first/second/fourth are filter-controlled default-on; fonts is opt-in `auto_preload_fonts`.

### Config/security

Parse the first anchored `var rocket_beacon_data = …` once. Strict JSON first; bounded non-evaluating JS-literal fallback supports rewritten single-quoted captures. Full input consumption; ≤4 nesting levels/2,000 values; cap text at 64 KiB **before** JSON allocation. Sticky regexes have no `^` anchor after offset 0.

`elements` is a comma-joined string (cap 4096), not the proposed array. Known list fields use bounded lists; status known keys require booleans, unknown keys only bounded JSON primitives, never structured values or `__proto__`. `BEACON_CONFIG_LIMITS` is shared by engine/reference/boundary. Malformed/hostile config degrades the beacon row to null config, never the whole detection pass. Parse feeds only the beacon row; feature checks need no speculative config parameter.

Feature comments are trimmed/capped at 256; generator meta removes them from final output. Their absence is normal. Meta introduced in 3.17.2 (2024-10-30); older releases emitted comments. Full era policy is in P12.

### Verification

- 23 fixtures (14 rebaselined +9 crafted): pending with/without fonts; image preload variants including srcset-only; collecting/applied LRC; fonts; preconnect; mixed; malformed/hostile config. All port/reference/snapshots equal and boundary-valid. Third-party high-priority images, manual fonts and unattributed hints do not assert features.
- 260 tests; checks median 3.76/9.49 ms =0.40; full pass 57.4/62.3 ms. Comment walk ≈0.22 ms on largest fixture (~2% parse). Engine-only build had no new surface bytes at that stage.
- WP Rocket 3.23.5.1 local-site matrix: desktop pending (beacon, 7 hashes, no applied evidence); desktop applied (OCI/preconnect; LRC applied-empty); fonts option enabled (attributed Manrope preload); OCI filtered off (no `atf` key); `nowprocket` (no WP Rocket); mobile pending→applied while desktop remains pending (device-separated rows).
- LRC collects outermost qualifying elements ≥1800 px below viewport bottom; measured max 49 desktop/426 mobile explains empty results. Successful posts save all four factories' rows even with zero results (`lcp: "not found"`). Beacon never purges; purge then re-serve to see applied markup.
- Eligible dimensions: desktop **≥1600×700**, mobile **≤393×830**. 390×844 bails; 1920×1080 and 375×667 ran. Force viewport via device metrics: headless `--window-size` proved unreliable. `beacon-completed=true` also marks **bail**, so require an observed admin-ajax POST/no bail line plus row writes, not completion alone. Headless eligibility and other blockers must be checked against the exact beacon version.
- Replay: truncate `wp_wpr_{above_the_fold,lazy_render_content,preload_fonts,preconnect_external_domains}`, purge/bake, run eligible viewport, verify POST/rows, purge/bake again, detect served HTML. Use actual fonts **option** for full-family work: page-only URL forces do not reach AJAX request context. Fixture flags must be cache-query-listed.
- `docker/scripts/cdp-smoke.mjs` pins baseline/fonts-on/OCI-off/combined config arms, removed OCI payload, `.invalid` external link and desktop UA restoration. Missing beacon can legitimately mean rows already applied; smoke never resets tables.
- Real v4.1.1 comparison: applied evidence agrees; pending is richer here. Its auto-font check is defined but never invoked/rendered; generator-meta gating masks its wrong beacon fallbacks; no-meta `.min.js` pages expose them. Its tester covers only ATF/LRC. These are intentional improvements, not missing parity.

Source recheck anchors: `PerformanceHints/{ServiceProvider,Frontend/Processor}.php`; controllers for AboveTheFold, LazyRenderContent, PreloadFonts, PreconnectExternalDomains; Support `CommentTrait`/`Meta`; KB 1841/1816/1835/1317/1869.

## P2: background

Implemented/audited 2026-10-07/08; named site checks passed P4.3. Important corrections:

- Header listener stores validated `main_frame` response headers in a 100-tab LRU; absent headers reset old rows, removal forgets, malformed/tabless sender reads null. Capture and badge-clear are independently guarded. `headers.test.ts` pins actual listener→store wiring; `site-header-capture` pins real responses, tab scoping, supersede and over-cap rejection.
- KC refresh: hourly/startup/manual, single-flight `finally`, 10 s abort, distinct network/timeout/HTTP/JSON/validation/storage failures; failure leaves rows/meta unchanged. Serve stored→one refresh→seed. Boot seed and alarm provisioning are independently guarded. Omit Chrome-150-only `persistAcrossSessions` on floor145; reprovision each worker start.
- Seed uses background-only `?url&no-inline` packaged asset (`assets/background.json`), validated once/worker. Shared readers must never import it. Initial 137 rows later grew to175 during release re-sync; release rules require live endpoint refresh and count/asset-budget repins, not these historical counts.
- One context-menu table/listener: SBS, PSI SBS, Builder, KC refresh; page-scoped URL patterns; click event's tab, not active-tab requery; expected no-CS branch logs. No runtime menu readback API: shapes are unit-pinned, runtime IDs duplicate-probed. Builder opens in private windows too (owner overrode original incognito skip).
- Toolbar dot: transparent tile, colored `●`: green cached, blue present-uncached, gray absent. `features.toolbarBadge` gates live rendering. Navigation/absence clears write unconditionally across worker restarts; off sweeps all tabs and on restores saved summaries. Memory-only skipped writes were unsafe because browser badges survive SW memory.
- Shared uncaught reporting captures message/source/line/frames/raw error once behind hostile-getter guards. Content scripts claim runtime-URL errors only; page failures remain native. Claimed errors call `preventDefault` after attribution to avoid duplicate native+extension error cards; foreign events untouched. Rejections use stack attribution. This is distinct from MAIN capture, which never cancels page errors.

Historical budget derivation: worker25→26 KiB restored previously unwired capture/independent boot/testable seams;26→27 added shared uncaught reporting/badge constants (26.5 measured). Seed46.7 KB initially capped50, later server snapshot required85 KiB. Later SBS changes supersede worker values. No feature was cut to fit a ceiling.

## P3: isolated data hub and page UIs

Implemented/audited 2026-10-07/08; named site checks passed P4.3.

- Actual WXT folder entrypoint is `entrypoints/isolated.content/index.ts`; file+same-named folder would duplicate entrypoint names. `document_start`, all-http/https; registry-style feature setup, independent guards, context-owned cleanup.
- Snapshot at DOMContentLoaded (late-injection ready-state path included), **eager single-flight** processing (owner overrode lazy plan) so badge/timing/summary work without panel. One parse serves checks/preloads/Diagnoser; release serialized HTML afterward. Requests reuse flight/cache. Captured HTML, not late live mutations, defines analysis.
- Headers have a tracked once-flight awaited by serve (`ensureHeaders`); P4.3 caught a race that permanently cached null headers. Re-asks are idempotent. `rocket-allScriptsLoaded` flag/push and validated capped word merges use context cleanup; pushes are tab-scoped at receiver.
- Timing info: `[WPR FDT] Page data processed in X ms`, then `lib/detection/describe.ts` summary: version, UTC cache timestamp, honest applied/collecting/not-enabled states and counts. Never raw URL/source/page-content dumps. Summary-send failures warn, not production-silent debug.
- Improvements: one-shot option-gated `#wp-admin-bar-d-bugger` under WP Rocket menu, idempotent/late-load-safe; derive admin base from existing link. Root `/wp-admin/tools.php?page=wprockettoolset` fallback can fail on subdirectory sites. P9's effect check needs reload; no live watcher was promised here.
- KC: live-DOM HelpScout table extraction (both inbox layouts), 500 ms debounced body observer + pathname tracking/teardown; WP scans both `th`/`td.plugin-title.column-primary` and one bounded late pass. Validated storage-first/background-ask loader + watcher rescans open UI. Findings accumulate first-seen IDs per surface and reset on pathname change; a DB update does not erase existing findings. Settled zero scans show corrected empty copy; loading is real DB wait.
- KC rendering uses text, validated external links and noopener, no server-owned HTML injection. P12's early widget adopts its shell. Owner redesign fixed equal-specificity `display` overriding hidden state: visibility/opacity/transform, no transition-driven state. Pill+collapse handle, anchored card, count9+, dialog focus/ESC return and shadow isolation. Focus retries once after rAF style recalc, checks shadow activeElement, cancels on invalidation. Reduced motion must not hide the just-focused pill or preserve row delays. Later UI bar bans old per-row/stagger motion; historical animation descriptions are not new requirements.
- SBS original behavior: cached/bypass URL pair, per-side refresh, exact overflow/scroll restore, re-open retains frames, PSI two analyses/no overlay controls. Reload same-origin, `src` reassignment fallback cross-origin. No sandbox/credentialless: authentic page behavior is the feature. Late-injected PSI also opens analyses. P16 owns current lifecycle/mobile/width changes.
- Injected styling: WXT `createShadowRootUi`, `cssInjectionMode:'ui'`, one fetched/adopted stylesheet, token CSS in shadow. Host `all:initial!important` means position belongs to inner chrome. Explicit `data-theme='system'`/`color-scheme:light dark` fixed WXT reset choosing light under dark OS; all appearance paths update live.
- Tiny inline SVGs/shared entrypoint icon factory avoid ~11 KB icon runtime in the injected bundle; panel uses lucide. `jsonrepair` cannot split inside WXT IIFE content scripts.

Historical isolated budget: initial60/20 KiB impossible with Solid(~27 raw), storage(~8), engine/validators(~10), repair(~7.5), WXT transport/context/UI(~16) plus feature code. After removing icon runtime:79.7 raw/27.7 gzip; ceiling80/30, then85/30 for analysis summary (81 raw). Scroll/mobile/strip later own raises. KC redesign97→102 raw (98.8/34.4 measured, gzip ceiling35 unchanged), 946 unit/53 browser tests green, Firefox build green; live focus verified both themes/motion settings.

## P4: MAIN-world undefined-reference capture

Implemented/audited 2026-10-07; Chromium capture/sentinel scenarios automated in P4.1 and real-site P4.3.

- Tiny MAIN `document_start` entrypoint; pure extraction for `ReferenceError: … is not defined`, undefined-reading TypeError, not-a-function TypeError (last dotted segment). Stack matching is line-local/pattern-priority-tested.
- Typed `undefinedReferenceBatch` window bridge replaces questionable cross-world CustomEvents and fixes singular `detail.word` sentinel loss (#21/#41). Validate both sides; MAIN is page-compromisable.
- Unique-identifier ledger≤50/page, printable≤200 chars, trailing500 ms dedupe batches. `Script error.` sentinel is once/page, ledger-exempt, immediate; cancels debounce and pending words ride along. Flush≤receiver cap: drop newest IDs before sentinel, announce overflow once. Closed ledger never mutes sentinel. Contract caps live in a dependency-light leaf so capture does not bundle unrelated detection constants.
- Object-shaped thrown values only; a callable with a page-added string stack is deliberately skipped. Native errors remain covered. Hostile stack getters cannot break listeners; no `preventDefault`, rethrow or host-error suppression. Sends are fire-and-handled and ledger-bounded.
- WXT0.21.4 MAIN wrapper supplies **no context argument**, unlike isolated wrapper. Listeners live with the document; explicit `stop()` removes both listeners/cancels debounce for tests/future callers. Do not claim extension invalidation cleanup here.
- UA identity moved to its own all-frame entrypoint pair in P16, not into capture.

Evidence:33 extraction/cap/sentinel/safety/teardown tests plus real-window composition; `undefined-references.spec.ts`, `cross-origin-sentinel.spec.ts`, site data-hub pull-through. Main bundle6580 B raw/2635 gzip; justified ceiling2→8 KB because required transport alone~3.7 KB, capture~1.9 KB, wrapper~370 B. Dependency-leaf extraction reduced7.83→6.58 KB. Firefox MV2 manifest contains `world:'MAIN'`; a successful build/schema check is **not** live-injection proof.

## Open verification (not completed by consolidation)

- Real first-baseline header-capture comparison and total-page timing/absolute counts; repeat source-compiled diff in P15.
- 120-tab LRU/memory exercise (unit cap is covered); menu click ergonomics and real in-place extension reload/mid-page stale capture.
- Authenticated HelpScout SPA/count/hide-show behavior; PSI production/redirect refresh (P22B).
- Firefox runtime, including MAIN capture, messaging/global alias and injected UI. Build-only evidence does not close these; see [Firefox plan](./17-firefox-runtime-parity.md) and P15.
- All current manual rows in [e2e README](../../tests/e2e/README.md) remain authoritative operational checklists. P2–P4 are not relabeled fully done merely because automated subsets passed.
