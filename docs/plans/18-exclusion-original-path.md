# P18: undefined-references exclusion copies the original path

## TLDR

The Undefined References page's "Copy as exclusion" copies the **served** script URL's path — on a Minify-JS site that is WP Rocket's cache path (`wp-content/cache/min/<site-id>/<original-path>`), which support never uses: it dies the moment minify is toggled off and carries a cache folder the site does not serve long-term. Fix (owner-approved 2026-10-19): recover the original path **deterministically from the minified URL** (per-file Minify mirrors the original URL path into the cache URL — verified in the shipped plugin source) and copy that — **the final answer, not a fallback**: the original path is the one identifier that matches Delay JS's exclusion check in **both** minify states (the check runs on tags already carrying minified `src`s). Host-hidden originals (remote mirrors, custom content dirs) copy the **hostless** original path directly — **no host resolution**: a P18.3 `?nowprocket` bypass map was built and then retracted on live+source evidence (the bypass does not un-minify, and a resolved true-host pattern would not even match the served minified tag — see P18.3). Combined bundles (original unrecoverable from the URL, and impossible while Delay JS is on) get an honest "cannot be excluded per-file" row. No worker thread; no new dependency or manifest permission. Standalone defect fix on the shipped P6 surface; parallel with any phase not touching `entrypoints/panel/pages/undefined-references/`, `components/ui/copy-button.*` or `lib/wp-rocket/`.

## Defect (verified 2026-10-19)

Live docker site (`minify_js=1` seeded), original enqueue `wp-content/mu-plugins/assets/fdt-delayed-definer.js`:

- served: `http://127.0.0.1:8493/wp-content/cache/min/1/wp-content/mu-plugins/assets/fdt-delayed-definer.js?ver=1792424592`
- copied today: `wp-content/cache/min/1/wp-content/mu-plugins/assets/fdt-delayed-definer.js` — the cache path
- required: `wp-content/mu-plugins/assets/fdt-delayed-definer.js` — the original path (support's `?nowprocket` convention)

Why the original path is also the technically robust one (verified mechanics): the Delay JS exclusion check runs on `rocket_buffer` at priority **26** — _after_ minify/combine at **22** — against tags already carrying minified `src`; the minified URL **embeds the original path** (path mirror), so an original-path pattern substring-matches the check in **both** minify states, survives purges/updates (it rides the path, not `?ver=`), and matches the un-minified tag when minify goes off. A cache-path pattern dies in that last state — the state debugging workflows routinely create.

### Evidence anchors (WP Rocket 3.23.5.1, `docker/wpr/wpr-rocket-3.23.5.1.zip`)

- Per-file minify: original query stripped (`JS/Minify.php:99`, `strtok`); local `[-.]min.js` files skipped (`JS/Minify.php:37-50` — unrewritten, URL untouched); cache filename = `ltrim(rocket_realpath($parsed_url['path']), '/')` (`JS/Minify.php:191-192`); URL = `minify_base_url . $filename` (`JS/AbstractJSOptimization.php:154-166`, CDN rewrites via `rocket_js_url`); base = `WP_ROCKET_MINIFY_CACHE_URL . $site_id` (`AbstractOptimization.php:55-56`); `?ver=` = file mtime or md5(key) (`AbstractOptimization.php:235-241`).
- Combine: filename = `md5($content . $this->minify_key) . '.js'` under the same base (`JS/Combine.php:337-358`) — **original not recoverable from the URL**.
- Pipeline: CSS minify 16, JS minify/combine 22, Delay JS 26 (`CSS/Subscriber.php:26`, `JS/Subscriber.php:29`, `DelayJS/Subscriber.php:49-52`); Delay's exclusion match `preg_match("#{$pattern}#i", $tag)` (`DelayJS/HTML.php:219-225`), patterns escape `+`/`?ver`/`#` (`DelayJS/HTML.php:120-133`).
- Delay JS **disables Combine** (`DelayJS/Subscriber.php:53,131-137`, `pre_get_rocket_option_minify_concatenate_js` → `false`) — combined bundles cannot coexist with the Delay-JS universe this remedy targets.
- `?nowprocket` bypass: **Delay JS skips; Minify does NOT.** The bypassed render still serves `cache/min/1/…` srcs carrying `data-minify="1"` and `data-rocket-defer defer` (live-verified on this site 2026-10-19; no Minify subscriber consumes `rocket_bypass()` — the P18.3 retraction below). The earlier claim here ("plain render, original URLs") came from a capture where `minify_js` was not engaged.
- Real remote-mirror captures in `lib/detection/fixtures/me-home-cached.html` / `me-blog-alr.html`: `…/cache/min/1/onsite/js/PD7as8/klaviyo.js?ver=…`, `…/cache/min/1/bootstrap/v5/tp.widget.bootstrap.min.js?ver=…` — remote originals are minified to the site's cache with the **remote path mirrored** and no truthful host anywhere in the data.
- Port side: single pattern consumer `word-card.tsx` `ScriptRow` → `exclusionPattern(props.url, props.pageOrigin)` (`model.ts:673`); served URLs from `inspectedWindow.getResources` (`inspected-scripts.ts` adapter, callback-form `evaluate` seam, `lastError` read); store owns per-page lifecycle + `pageKey` reset (`store.ts`); shared `CopyButton` owns the guarded write, spinner (`data-fdt-loading`/`aria-busy`) and toasts (`components/ui/copy-button.tsx`); copy vocabulary `copy-exclusion.ts`; existing minify-cache vocabulary `lib/wp-rocket/constants.ts:137-145` (`MINIFY_JS_URL_PATTERN`); pure HTML→script extraction exists — `lib/detection/parse-page.ts` (`parsePage`, DOMParser-based, runs anywhere the panel runs).

## Design decisions (owner-approved 2026-10-19)

1. **No Web Worker.** The recovery's cost is same-origin network I/O that can only run **in the inspected page** (panel/worker contexts are `chrome-extension://`; a page-context `fetch` through `inspectedWindow.eval` needs no permission). The parse is one bounded string pass (chunk only if ever measured slow). The shiki worker precedent is CPU-bound work — a different class.
2. **Every row copies immediately — no pending state, no resolution lane.** Untouched, site-obvious and host-unknown originals alike resolve their pattern on first render (the host-unknown lane to the **hostless** original path, its final answer — the P18.3 bypass map that would have gated it was retracted on evidence, below); no card-level notice, no per-row toast.
3. **Hosts are never fabricated.** Site-obvious originals → plain path (today's same-origin shape, now the right path). Host-unknown → hostless, **final**: the URL never carried the host, and the path matches both minify states. Combined → no copy at all.
4. **No Combine machinery.** It cannot coexist with Delay JS (verified above); the honesty row is a shape check + words.
5. **The row's link is untouched** (`href`/`title`/shown basename stay the served URL) — it opens what actually loaded; only the copy payload changes.
6. **No new dependency, no new manifest permission.**

## P18.0 — evidence gate (no code)

Depends:—. Parallel:—. Goal: make the two source-cited assumptions evidence-grade before code.

- [x] Combined-bundle capture (2026-10-19, docker arm `minify_concatenate_js=1` + `delay_js=0`, config regen + purge, `/fdt/?fdt-delay=1`, baseline restored after): served `http://127.0.0.1:8493/wp-content/cache/min/1/cdb2e71f9f3da2a001630dcca225acbf.js` — bare `<32-hex>.js` remainder, **no `?ver=`** (Combine returns `get_minify_url($filename)` versionless). Same page served two untouched `.min.js` URLs (negatives for P18.1): `…/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js`, `…/wp-includes/js/dist/script-modules/block-library/navigation/view.min.js?ver=1bf28ded04f9f188bdcb`.
- [x] All anchors above rechecked 2026-10-19 against the zip — confirmed at the cited lines. One precision note: the `?ver` fallback is `md5( $minified_url . $this->minify_key )` (`AbstractOptimization.php:239`), not bare "md5(key)" — no behavioral impact (the recovery ignores the query). Combine's `get_minify_url($filename)` adds no version, matching the capture.
- [x] Live capture pair (2026-10-19, `/fdt/?fdt-delay=1`): original enqueue `wp-content/mu-plugins/assets/fdt-delayed-definer.js` ↔ served `http://127.0.0.1:8493/wp-content/cache/min/1/wp-content/mu-plugins/assets/fdt-delayed-definer.js?ver=1792430636` (`?ver` is the minified file's mtime — changes per purge; the recovery ignores it). Siblings: `fdt-delayed-reference.js`, `fdt-delayed-lifecycle.js`, same shape. P18.1 fixtures use these strings.

DoD: anchors confirmed, combined capture recorded, no code. Effort S · difficulty easy.

## P18.1 — recovery helper (`lib/wp-rocket/`)

Depends: P18.0. Parallel: P18.3's parser/join core. Goal: one pure, typed predicate for "what can this served URL tell us".

- [x] New module beside the minify patterns in `lib/wp-rocket/` (`minify-url-recovery.ts`; `recoverOriginalScript` + `MinifiedUrlRecovery`). One declaring site for the cache shape, kept byte-identical at runtime: `constants.ts` now exports the directory atom `MINIFY_CACHE_DIR_SOURCE` (`cache/min/<digits>/`) and composes the detection footprint source from it — the existing `MINIFY_*_URL_PATTERN`s are unchanged strings, all consumers `.test()`-only.
  - `{ kind: 'original'; originalPath: string; hostKnown: 'site' | 'unknown' }` — first `cache/min/<digits>/` occurrence (lazy prefix, strip once, never loops; query ignored; `.js` suffix required, case-insensitive). `hostKnown: 'site'` iff the remainder starts with `wp-content/` or `wp-includes/`; else `'unknown'`.
  - `{ kind: 'combined' }` — cache shape, remainder is a bare hex-32 `.js` filename (no `/`).
  - `{ kind: 'untouched' }` — no cache shape (skipped `.min.js` files, non-JS paths, non-http(s), unparseable).
- [x] Unit tests over the full matrix: the live docker capture pair (+siblings); the real remote-mirror captures (klaviyo delayed spelling, trustpilot); multisite `<n>` ≠ 1; CDN-fronted minified URL (host ignored); percent runs preserved (never decoded); `cache/min` without `wp-content` prefix; the double-cache `cache/busting` remainder; first-occurrence (double `cache/min`); combined (the P18.0 capture); uppercase `.JS`; negatives (non-numeric site-id, non-JS, `.js` hidden in the query, non-http, protocol-relative, unparseable, empty).

DoD met: pure module + full edge matrix green; no consumer wiring (checked at that commit). Effort M · difficulty medium.

## P18.2 — word-card wiring + combined honesty row

Depends: P18.1. Parallel:—. Goal: every copy payload names the original; bundles say why they cannot.

- [x] `ScriptRow` classifies its URL once (`recoverOriginalScript`) and composes the pattern:
  - `untouched` → today's `exclusionPattern(props.url, props.pageOrigin)` byte-identical (the existing payload tests pass unchanged).
  - `original`/`site` → `exclusionPattern(`${pageOrigin}/${originalPath}`, pageOrigin)`; `pageOrigin` `null` → hostless lane below.
  - `original`/`unknown` → the hostless builder `exclusionPatternFromOriginalPath(originalPath)` (leading `/` added — it cannot end-match inside a longer file name; the raw machinery shared by extraction into one `rawUrlPattern` helper). Initially composed with the P18.3 resolved-host branch; since that map's retraction (P18.3) the hostless builder is this lane's only and final form.
- [x] Combined rows: copy control replaced by the honest state (`COMBINED_EXCLUSION_NOTE` in `copy-exclusion.tsx`, S-3 words, W-1 spelling): "This script ships inside WP Rocket's combined JS bundle — per-file Delay exclusion is not available. The remedy is disabling Combine JS or excluding the original file in File Optimization." Non-interactive text (K-1 holds — nothing to operate), no dead end (D-4: the remedy names the working path).
- [x] Link/href/title/basename unchanged (decision 5) — the row's linkability now rides `linkable` (combined rows are http(s) by construction; every other row keeps today's pattern-gates-the-link rule).
- [x] Tests: `word-card.test.tsx` payload assertions per class (the docker capture strings as fixtures: site, site+null origin, unknown-host, combined state matrix); the pattern-parity corpus (`model.test.ts` `wpRocketMatches`/`regexpMatches`) re-run over recovered inputs (both minify states of the docker pair and the klaviyo mirror).

DoD met. Effort M · difficulty medium.

## P18.3 — remote-host resolution via the `?nowprocket` map — RETRACTED on evidence

Planned (owner-approved 2026-10-19), implemented, then **retracted 2026-10-19** (owner-directed "fix immediately, best way possible"): host-unknown rows would have resolved their true external host through a one-pass bypass read in the inspected page (the same URL with `nowprocket=1` added, fetched same-origin via a synchronous XHR inside a static `inspectedWindow.eval` expression), joining the bypassed render's script `src` pathnames against each row's recovered original path — per-row pending state, one card-level failure notice, hostless fallback on timeout/ambiguity/absence.

**Why retracted — three independent proofs:**

1. **Live (this site, real Chrome via CDP):** the bypassed render is NOT un-minified. Navigating `/fdt/?fdt-delay=1&nowprocket=1` and evaluating the (then-shipped) expression answered `ok: true` — and the returned HTML's script tags still carried minified cache urls: `<script data-minify="1" src="http://127.0.0.1:8493/wp-content/cache/min/1/wp-content/mu-plugins/assets/fdt-delayed-definer.js?ver=…" data-rocket-defer defer>`. The bypass skips Delay JS only.
2. **Source (WP Rocket 3.23.5.1):** `rocket_bypass()` (`inc/API/bypass.php`) is consumed by DelayJS/HTML, CacheDynamicResource, CDN, GoogleFonts, Heartbeat, ImageDimensions, PreloadLinks, LazyRender and Support/Meta — **by no Minify subscriber**. `Minify/JS/Subscriber.php`'s `is_allowed()` checks only `DONOTROCKETOPTIMIZE`, the `minify_js` option and post exclusions. `CacheDynamicResource` (which does check the bypass) excludes external and non-`.php` files, so it cannot explain a remote mirror either.
3. **The planned fixture generalized from a non-holding capture:** the real-site capture `lib/detection/fixtures/me-nowprocket.html` carries zero `cache/min` urls — captured under conditions that do not hold on a `minify_js` site (this site disproves the generalization).

**Consequences (verified):**

- The join's path equality compares a row's `onsite/js/PD7as8/klaviyo.js` against the bypassed srcs' `/wp-content/cache/min/1/onsite/js/PD7as8/klaviyo.js` — never equal. **Every host-unknown row would stay unresolved forever, silently** (the pass "succeeds", so not even the failure notice would fire).
- **Resolving the "true external host" would be a correctness regression, not a feature:** Delay JS's exclusion check runs on `rocket_buffer` at priority 26 — after minify at 22 — so served tags carry the MINIFIED src. A host-led pattern (`static.klaviyo.com/onsite/js/…`) does not substring-match that tag: the exclusion would be inert while minify is on. The hostless original-path pattern matches BOTH minify states (parity-proven in `model.test.ts` — the minified tag and the plain tag, under both readers). The hostless pattern is therefore not a fallback — it is the best possible deliverable for host-unknown rows.

**What shipped instead:** the hostless original-path pattern is the host-unknown row's final state (P18.1 and P18.2 stand unchanged as the deliverable). Removed with the retraction: the store's bypass state machine and its timeout, the in-page bypass read, the join/normalize helpers and their verdict type, the copy control's `pending` prop with its `PENDING_TITLE`/`BYPASS_NOTICE` strings, their tests, and the e2e failure/timeout arms (whose shim-provided bypass answers were values the real page never produces — they could not catch the deadness); one e2e arm remains, asserting the remote-mirror row copies the hostless payload with no notice and no pending state.

## P18.4 — integration, gates, docs

Depends: P18.1–P18.3. Parallel:—.

- [x] Gates (2026-10-19, final state after the P18.3 retraction): `pnpm compile` ✓, `pnpm lint` ✓, `pnpm format:check` ✓, `pnpm test` ✓ (184 files, 2876 passed, 1 skipped; coverage above thresholds — the recovery module covered by its suite). `pnpm build` ✓ and `pnpm check:budgets` ✓ — panel chunk delta: devtools panel JS 393.3 KiB vs the ≤ 600 ceiling (the recovery/hostless lane's net cost after the bypass machinery's removal; no row moved).
- [x] E2E (local tier, headless Chromium + the unpacked extension): `panel-copy-exclusion` carries four tests — the **pending-copy arm** (a controllable slow write: focus kept, repeat activation swallowed, the confirmation toast naming the WP Rocket setting, the byte-exact payload, the flash window), the **rejected-write arm** (the error toast names the pattern to type by hand, never the platform's error), the **minify arm** (the P18.0 docker capture pair as the stub resources: the row presents the served file, the link opens the served URL, and the audited clipboard write carries the ORIGINAL path, never the cache path), and the **remote-mirror arm** (the real klaviyo served URL: the row copies the HOSTLESS original path, no notice, no pending state — the final answer). Full tier: 165 passed. `undefined-references.spec` stays the capture suite — its capture behavior is untouched by P18 (words and the `getFdtData` pull-through are unchanged; nothing there asserts copy payloads), so it gained no arm; its 3 tests pass unchanged.
- [x] Explicit limit + owner manual check (received 2026-10-19, closing evidence): a real third-party mirror has no local live arm (the docker site has no external scripts), so the owner ran the live check on `bwu8.e2e.rocketlabsqa.ovh` — minify JS on, a cross-origin script enqueued from `bwu9.e2e.rocketlabsqa.ovh/assets/test-script.js`, served as `bwu8/wp-content/cache/min/1/assets/test-script.js?ver=…` (path-only mirror; the `bwu9` host absent from every client-visible surface — the page's only `bwu9` trace is a dns-prefetch hint, not attribution). The row copied the **hostless original path** `/assets/test-script.js`, with no pending state and no notice — matches all three receipted arms; the captured page HTML confirms the delayed tag carries only the cache URL and the Defect/priority-26 analysis holds (host-anchored patterns would be inert while minified).
- [x] UI bar §D receipts (touched: the definition row's copy states + the combined note): **D-1** — panel-layout suite green (165-test run includes it); the note is `max-w-56 shrink`, the row's flex wraps, no horizontal scroll introduced. **D-2** — token classes only (`text-fg-secondary`/`text-fg-muted`, `BODY_NOTE`); no new motion (the spinner is the shared existing one). **D-3** — keyboard walk: the copy control keeps focus across its own in-flight write (unit + the pending-copy e2e); the combined note is non-interactive. **D-4** — `panel-a11y` suite (axe-core) green. **D-5** — no new lane: refresh/rescan keep UI state per the shell's own S-2 machinery (store tests). **D-6** — grep gate over the touched files: only the sanctioned existing spinner (`animate-spin`, M-6) and `&#038;`/`&#039;` entities inside TSDoc text. **D-7** — no row-list changes; budget delta receipted above.
- [x] W-2 string deltas (P15 owns the final sweep): the combined note (`COMBINED_EXCLUSION_NOTE`, verbatim in P18.2). **Nothing else ships**: the pending hint (`PENDING_TITLE`) and the failure notice (`BYPASS_NOTICE`) never shipped — they died with the retracted P18.3 map. No existing string changed.
- [x] Runbook row added (minified-copy behavior + the combined capture arm how-to); plans README active-work line updated. AGENTS.md: no convention changed (no new dependency, permission, script or directory).

## Non-goals

- No worker thread (decision 1); no CSS/other-asset surfaces (the vocabulary extends when a consumer exists — not speculatively); no `?nowprocket` diff tooling (the retracted P18.3 map was its only consumer; bundle attribution is impossible from any client data — grouping lives inside WP Rocket); no exclusion-builder work (P10 parked); no user-editable pattern affordance.
