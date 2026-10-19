# P18: undefined-references exclusion copies the original path

## TLDR

The Undefined References page's "Copy as exclusion" copies the **served** script URL's path — on a Minify-JS site that is WP Rocket's cache path (`wp-content/cache/min/<site-id>/<original-path>`), which support never uses: it dies the moment minify is toggled off and carries a cache folder the site does not serve long-term. Fix (owner-approved 2026-10-19): recover the original path **deterministically from the minified URL** (per-file Minify mirrors the original URL path into the cache URL — verified in the shipped plugin source), copy that; resolve the true external host for remote-mirrored scripts through a **one-pass `?nowprocket` bypass fetch** run in the inspected page (same-origin via the existing `inspectedWindow.eval` seam — no worker, no new permission), with per-row pending state and hostless fallback; combined bundles (original unrecoverable from the URL, and impossible while Delay JS is on) get an honest "cannot be excluded per-file" row. No worker thread — the bottleneck is same-origin I/O that must run in the page; the parse is one bounded pass. Standalone defect fix on the shipped P6 surface; parallel with any phase not touching `entrypoints/panel/pages/undefined-references/`, `components/ui/copy-button.*` or `lib/wp-rocket/`. Installed stack only; no new dependency or manifest permission.

## Defect (verified 2026-10-19)

Live docker site (`minify_js=1` seeded), original enqueue `wp-content/mu-plugins/assets/fdt-delayed-definer.js`:

- served: `http://127.0.0.1:8493/wp-content/cache/min/1/wp-content/mu-plugins/assets/fdt-delayed-definer.js?ver=1792424592`
- copied today: `wp-content/cache/min/1/wp-content/mu-plugins/assets/fdt-delayed-definer.js` — the cache path
- required: `wp-content/mu-plugins/assets/fdt-delayed-definer.js` — the original path (support's `?nowprocket` convention)

Why the original path is also the technically robust one (verified mechanics): the Delay JS exclusion check runs on `rocket_buffer` at priority **26** — _after_ minify/combine at **22** — against tags already carrying minified `src`; the minified URL **embeds the original path** (path mirror), so an original-path pattern substring-matches the check in **both** minify states, survives purges/updates (it rides the path, not `?ver=`), and matches the un-minified tag when minify goes off. A cache-path pattern dies in that last state — the state debugging workflows routinely create.

### Evidence anchors (WP Rocket 3.23.5.1, `docker/wpr/wpr-rocket.zip`)

- Per-file minify: original query stripped (`JS/Minify.php:99`, `strtok`); local `[-.]min.js` files skipped (`JS/Minify.php:37-50` — unrewritten, URL untouched); cache filename = `ltrim(rocket_realpath($parsed_url['path']), '/')` (`JS/Minify.php:191-192`); URL = `minify_base_url . $filename` (`JS/AbstractJSOptimization.php:154-166`, CDN rewrites via `rocket_js_url`); base = `WP_ROCKET_MINIFY_CACHE_URL . $site_id` (`AbstractOptimization.php:55-56`); `?ver=` = file mtime or md5(key) (`AbstractOptimization.php:235-241`).
- Combine: filename = `md5($content . $this->minify_key) . '.js'` under the same base (`JS/Combine.php:337-358`) — **original not recoverable from the URL**.
- Pipeline: CSS minify 16, JS minify/combine 22, Delay JS 26 (`CSS/Subscriber.php:26`, `JS/Subscriber.php:29`, `DelayJS/Subscriber.php:49-52`); Delay's exclusion match `preg_match("#{$pattern}#i", $tag)` (`DelayJS/HTML.php:219-225`), patterns escape `+`/`?ver`/`#` (`DelayJS/HTML.php:120-133`).
- Delay JS **disables Combine** (`DelayJS/Subscriber.php:53,131-137`, `pre_get_rocket_option_minify_concatenate_js` → `false`) — combined bundles cannot coexist with the Delay-JS universe this remedy targets.
- `?nowprocket` bypass: plain render, original URLs (`rocket_bypass()`; IE fallback relies on it, `DelayJS/HTML.php:171-173`).
- Real remote-mirror captures in `lib/detection/fixtures/me-home-cached.html` / `me-blog-alr.html`: `…/cache/min/1/onsite/js/PD7as8/klaviyo.js?ver=…`, `…/cache/min/1/bootstrap/v5/tp.widget.bootstrap.min.js?ver=…` — remote originals are minified to the site's cache with the **remote path mirrored** and no truthful host anywhere in the data.
- Port side: single pattern consumer `word-card.tsx` `ScriptRow` → `exclusionPattern(props.url, props.pageOrigin)` (`model.ts:673`); served URLs from `inspectedWindow.getResources` (`inspected-scripts.ts` adapter, callback-form `evaluate` seam, `lastError` read); store owns per-page lifecycle + `pageKey` reset (`store.ts`); shared `CopyButton` owns the guarded write, spinner (`data-fdt-loading`/`aria-busy`) and toasts (`components/ui/copy-button.tsx`); copy vocabulary `copy-exclusion.ts`; existing minify-cache vocabulary `lib/wp-rocket/constants.ts:137-145` (`MINIFY_JS_URL_PATTERN`); pure HTML→script extraction exists — `lib/detection/parse-page.ts` (`parsePage`, DOMParser-based, runs anywhere the panel runs).

## Design decisions (owner-approved 2026-10-19)

1. **No Web Worker.** The recovery's cost is same-origin network I/O that can only run **in the inspected page** (panel/worker contexts are `chrome-extension://`; a page-context `fetch` through `inspectedWindow.eval` needs no permission). The parse is one bounded string pass (chunk only if ever measured slow). The shiki worker precedent is CPU-bound work — a different class.
2. **Per-row pending, never a global block.** Site-local mirrors and untouched URLs copy immediately; only host-unknown (remote-mirror / custom content-dir) rows wait for the bypass map; timeout, ambiguity or absence resolves that row to the **hostless** pattern; one card-level notice, never per-row toast spam.
3. **Hosts are never fabricated.** Site-obvious originals → plain path (today's same-origin shape, now the right path). Host-unknown → hostless until the bypass map resolves the real host. Combined → no copy at all.
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
  - `original`/`unknown` → resolved-host pattern from the P18.3 map (`exclusionPattern(resolvedOrigin + '/' + originalPath, pageOrigin)`); hostless via the model sibling `exclusionPatternFromOriginalPath(originalPath)` (leading `/` added — it cannot end-match inside a longer file name; the raw machinery shared by extraction into one `rawUrlPattern` helper) until resolved or on fallback.
- [x] Combined rows: copy control replaced by the honest state (`COMBINED_EXCLUSION_NOTE` in `copy-exclusion.tsx`, S-3 words, W-1 spelling): "This script ships inside WP Rocket's combined JS bundle — per-file Delay exclusion is not available. The remedy is disabling Combine JS or excluding the original file in File Optimization." Non-interactive text (K-1 holds — nothing to operate), no dead end (D-4: the remedy names the working path).
- [x] Link/href/title/basename unchanged (decision 5) — the row's linkability now rides `linkable` (combined rows are http(s) by construction; every other row keeps today's pattern-gates-the-link rule).
- [x] Tests: `word-card.test.tsx` payload assertions per class (the docker capture strings as fixtures: site, site+null origin, unknown-host, combined state matrix); the pattern-parity corpus (`model.test.ts` `wpRocketMatches`/`regexpMatches`) re-run over recovered inputs (both minify states of the docker pair and the klaviyo mirror).

DoD met. Effort M · difficulty medium.

## P18.3 — remote-host resolution via the `?nowprocket` map

Depends: P18.2. Parallel:—. Goal: host-unknown rows copy the true external host; failures degrade per row.

- [x] Store-owned, one-pass-per-`pageKey` effect (ticket-guarded like the existing reads): triggers when ≥1 answered origin classifies `hostKnown: 'unknown'` and the map is unresolved; a refetch (pageKey) and the rescan/retry flow reset the lane — the existing flow retries the map, no new control. States: `unresolved → resolving → resolved(path→origin map) | failed`; a settled pass is final (its ticket closes — a late answer lands nowhere).
- [x] Fetch through the existing `evaluate` seam (`inspected-scripts.ts` → `readBypassedPage()`): **platform fact (verified against both vendors' API contracts, 2026-10-19): `inspectedWindow.eval` cannot await a promise — the evaluated expression must be JSON-compliant at callback time.** The one-pass read therefore rides a **synchronous same-origin XHR inside the static eval expression** — one bounded same-origin request, nothing left in the page (no globals, no polling), the URL taken from the page's own `location` with `nowprocket=1` added to the existing search params (fixture flags survive; `searchParams.set` keeps them). The expression is static — the extension interpolates nothing (the cap is a build-time constant) — so there is no eval-injection surface. Response capped (`BYPASS_HTML_CAP` = 5 Mi chars; oversized → degraded lane); non-2xx, a page CSP blocking `connect-src`, a `lastError`/eval exception, a junk answer or a throwing call all resolve `null` → the degraded lane. The read returns the **response URL** (post-redirect), so the join normalizes against the document's true origin. Cost accepted and documented: the browser may log its sync-XHR deprecation line in the page's console once per pass.
- [x] Extract + join (pure, unit-tested in `model.ts`): `resolveOriginalHosts(html, pageUrl)` — `parsePage(html).scripts` → `src` attributes → http(s)-only, resolved against the read's URL; `normalizeOriginalPath` (leading `/` added, percent-runs decoded so either spelling joins, undecodable runs stay) as the comparison key both sides share; unique origin → resolved (`HostResolution { kind: 'resolved', origin }` — the origin, scheme included, so the composition is an absolute URL); ambiguous (same path, two origins) or absent → that row's hostless fallback; the page's own origin appears as any other — the custom content-dir case resolves site-local through the standard same-origin builder.
- [x] Failure lane (CSP block, no receiver, timeout, cap): hostless patterns everywhere affected + **one** card-level notice (`BYPASS_NOTICE` in `page.tsx`, shown while `bypassDegraded` — failed AND ≥1 unknown path visible; no per-row toasts); the existing rescan/refetch flow retries the map — no new control.
- [x] UI: `CopyButton` gains `pending?: boolean` (focusable, `aria-disabled` + `aria-busy`, the existing spinner, activation suppressed, title from the consumer's vocabulary: "Resolving the script's original path…" — static hint text, no pulse — M-3; reduced motion honored by the existing spinner — M-6). The row control (`ExclusionCopyButton`, `copy-exclusion.tsx`) composes it with accessor props, so the mounted control's payload swaps hostless → host-led on resolution without a remount (non-keyed `Show`, focus kept). The factory `exclusionCopyProps` is replaced by that component (its only consumer was `ScriptRow`).
- [x] Tests: join/normalize matrix (real fixture snippets: encoded paths, query variants, ambiguous origins, missing script, page-origin relatives, non-http/inline srcs); store effect tests (pageKey/refetch rescan retry, ticket/late-answer, timeout→failure lane, runs once, no-run without unknown rows); adapter tests (ok answer, every degraded shape, the static expression asserted); CopyButton `pending` tests; page-level notice test.

DoD met: remote-mirror rows resolve or degrade honestly; every failure branch lands in the fallback lane; primitive change tested. Effort L · difficulty harder.

## P18.4 — integration, gates, docs

Depends: P18.1–P18.3. Parallel:—.

- [x] Gates (2026-10-19): `pnpm compile` ✓, `pnpm lint` ✓, `pnpm format:check` ✓, `pnpm test` ✓ (184 files, 2897 passed, 1 skipped; coverage above thresholds — the new modules covered by their suites). `pnpm build` ✓ and `pnpm check:budgets` ✓ — panel chunk delta: devtools panel JS 397.6 KiB vs the ≤ 600 ceiling (+~8 KiB for the recovery/join/store lane; no row moved).
- [x] E2E (local tier, headless Chromium + the unpacked extension): `panel-copy-exclusion` extended with three arms — the **minify arm** (the P18.0 docker capture pair as the stub resources: the row presents the served file, the link opens the served URL, and the audited clipboard write carries the ORIGINAL path, never the cache path), the **failure arm** (a junk bypass answer → exactly one card-level notice, the row's control resolved, the audited copy = the hostless payload), and the **timeout arm** (the eval never answers → the store's real 10 s timeout fires → the same degraded lane, copy works hostless + notice). Full tier: 166 passed. `undefined-references.spec` stays the capture suite — its capture behavior is untouched by P18 (words and the `getFdtData` pull-through are unchanged; nothing there asserts copy payloads), so it gained no arm; its 3 tests pass unchanged.
- [x] Explicit limit + owner manual check: **remote-host resolution is unit- and shim-tested only** — the docker site has no external scripts, so no live arm can exercise a real third-party mirror end-to-end. Manual live-check step for the owner: open a production WordPress site with WP Rocket minify on and a remote-mirrored script (the klaviyo/trustpilot shapes), open the Undefined References page, click the word's row → the control resolves (spinner → payload swaps to the host-led pattern) and the copied text names the true external host.
- [x] UI bar §D receipts (touched: the definition row's copy states + the combined note): **D-1** — panel-layout suite green (166-test run includes it); the note is `max-w-56 shrink`, the row's flex wraps, no horizontal scroll introduced. **D-2** — token classes only (`text-fg-secondary`/`text-fg-muted`, `BODY_NOTE`); no new motion (the spinner is the shared existing one). **D-3** — keyboard walk: pending control focusable and focus kept across resolution (unit + the pending-copy e2e); the combined note is non-interactive. **D-4** — `panel-a11y` suite (axe-core) green. **D-5** — the bypass lane is store-owned state; refetch/rescan retry it (store tests); refresh keeps UI state per the shell's own S-2 machinery. **D-6** — grep gate over the touched files: only the sanctioned existing spinner (`animate-spin`, M-6) and `&#038;`/`&#039;` entities inside TSDoc text. **D-7** — no row-list changes; budget delta receipted above.
- [x] W-2 string deltas (P15 owns the final sweep): the combined note (`COMBINED_EXCLUSION_NOTE`, verbatim above); the pending hint (`Resolving the script's original path…`); the failure notice (`BYPASS_NOTICE`: "Some scripts' original hosts could not be verified (the page blocked the check or it timed out), so their exclusions copy the path only. Rescan or reload the page to try again."). No existing string changed.
- [x] Runbook row added (minified-copy behavior + the combined capture arm how-to); plans README active-work line updated. AGENTS.md: no convention changed (the bypass lane introduced no new dependency, permission, script or directory).

## Non-goals

- No worker thread (decision 1); no CSS/other-asset surfaces (the vocabulary extends when a consumer exists — not speculatively); no full `?nowprocket` diff tooling (the map is bounded to host resolution for this page; bundle attribution is impossible from any client data — grouping lives inside WP Rocket); no exclusion-builder work (P10 parked); no user-editable pattern affordance.
