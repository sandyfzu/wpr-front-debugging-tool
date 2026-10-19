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

- [ ] Capture a real **combined-bundle** URL on the docker site (one arm: `minify_concatenate_js` on, Delay JS off, purge via `rocket_clean_domain(); rocket_clean_minify();`, fetch, restore). Record it here; pin its shape (expect bare `<32-hex>.js` remainder, `Combine.php:342`).
- [ ] Recheck every anchor above against the zip (drift → correct this doc, never downstream).
- [ ] Record the docker capture pair (original ↔ served) as P18.1's live fixture input.

DoD: anchors confirmed, combined capture recorded, no code. Effort S · difficulty easy.

## P18.1 — recovery helper (`lib/wp-rocket/`)

Depends: P18.0. Parallel: P18.3's parser/join core. Goal: one pure, typed predicate for "what can this served URL tell us".

- [ ] New module beside the minify patterns in `lib/wp-rocket/` (export the shape source `MINIFIED_CACHE_URL_SOURCE` from `constants.ts`; the helper derives its capture-bearing variants from it — one declaring site for the cache shape):
  - `recoverOriginalScript(url: string): MinifiedUrlRecovery` with
    - `{ kind: 'original'; originalPath: string; hostKnown: 'site' | 'unknown' }` — URL matches `…/cache/min/<digits>/…js` (first occurrence, strip once, never loops; query ignored; `.js` suffix required, case-insensitive). `hostKnown: 'site'` iff the remainder starts with `wp-content/` or `wp-includes/` (default WP layout); custom content-dir sites → `'unknown'` (the bypass map resolves them).
    - `{ kind: 'combined' }` — cache shape, remainder is a bare hex-32 `.js` filename (no `/`).
    - `{ kind: 'untouched' }` — no cache shape (includes local `.min.js` files Minify skips, and all non-JS paths).
- [ ] Unit tests over: the live docker capture pair; the real remote-mirror captures (klaviyo, trustpilot); multisite `<n>` ≠ 1; CDN-fronted minified URL (host ignored); encoded characters inside the remainder (percent runs preserved); `cache/min` without `wp-content` prefix; the double-cache `cache/busting` remainder; combined (from P18.0); negatives (non-numeric site-id, non-JS, non-http URL).

DoD: pure module + full edge matrix green; no consumer wiring yet. Effort M · difficulty medium.

## P18.2 — word-card wiring + combined honesty row

Depends: P18.1. Parallel:—. Goal: every copy payload names the original; bundles say why they cannot.

- [ ] `ScriptRow` classifies its URL once (`recoverOriginalScript`) and composes the pattern:
  - `untouched` → today's `exclusionPattern(props.url, props.pageOrigin)` byte-identical.
  - `original`/`site` → `exclusionPattern(`${pageOrigin}/${originalPath}`, pageOrigin)` — the standard builder's overmatch guards keep working (single segment stays host-led); `pageOrigin` `null` → hostless lane below.
  - `original`/`unknown` → resolved-host pattern from the P18.3 map (`exclusionPattern(resolvedUrl, pageOrigin)`), hostless (`model.ts` sibling `exclusionPatternFromOriginalPath(originalPath)` sharing the raw machinery: percent-run handling, segment de-confusion, no host ever) until resolved or on fallback.
- [ ] Combined rows: copy control replaced by the honest state (S-3 words, W-1 spelling): the script ships inside WP Rocket's combined JS bundle — per-file Delay exclusion is not available; the remedy is disabling Combine JS or excluding the original file in File Optimization. Keyboard/axe complete (K-1, D-4), no dead end.
- [ ] Link/href/title/basename unchanged (decision 5).
- [ ] Tests: `word-card.test.tsx` payload assertions per class (docker capture strings as fixtures); combined state matrix; the pattern-parity corpus (`model.test.ts` `wpRocketMatches`/`regexpMatches`) re-run over recovered inputs.

DoD: live-site-shaped URLs copy the original path; parity corpus green over recovered inputs; combined row state complete. Effort M · difficulty medium.

## P18.3 — remote-host resolution via the `?nowprocket` map

Depends: P18.2. Parallel:—. Goal: host-unknown rows copy the true external host; failures degrade per row.

- [ ] Store-owned, one-pass-per-`pageKey` effect (ticket-guarded like the existing reads; refetch/navigation cancels): triggers when ≥1 visible origin classifies `hostKnown: 'unknown'` and the map is unresolved.
- [ ] Fetch through the existing `evaluate` seam (`inspected-scripts.ts`): in-page `fetch` of the current URL with `nowprocket=1` added to the existing search params (fixture flags survive); the URL is passed as a JSON-stringified literal (no eval-injection surface); response capped (oversized → degraded lane); timeout via the store's `schedule` seam.
- [ ] Extract + join (pure, unit-tested): `parsePage(html).scripts` → read `src` attributes → http(s)-only, resolved against the page URL; **normalized exact path equality** (percent-decode, leading `/` kept, query dropped) between bypassed originals and each row's `originalPath`; unique host → resolved; ambiguous (same path, two hosts) or absent → that row's hostless fallback; the page's own origin matches count as site-local (custom content-dir case resolves here too).
- [ ] Failure lane (CSP `connect-src` block, no receiver, timeout, cap): hostless patterns everywhere affected + **one** card-level notice (W-1 wording, no per-row toasts); the existing rescan/refetch flow retries the map — no new control.
- [ ] UI: `CopyButton` gains `pending?: boolean` (focusable, `aria-disabled` + `aria-busy`, spinner icon, activation suppressed, `title` says it is resolving the original path) — a primitive-level gap owned here per Reuse-before-invention; static hint text (no pulse — M-3); reduced motion honored by the existing spinner (M-6).
- [ ] Tests: join/normalize matrix (real fixture snippets: encoded paths, query variants, ambiguous hosts, missing script, oversized, CSP-free failures); store effect tests (pageKey/ticket/cancel/timeout/failure lane, runs once); CopyButton `pending` tests.

DoD: remote-mirror rows resolve or degrade honestly; every failure branch lands in the fallback lane; primitive change tested. Effort L · difficulty harder.

## P18.4 — integration, gates, docs

Depends: P18.1–P18.3. Parallel:—.

- [ ] `pnpm compile && pnpm lint && pnpm format:check && pnpm test`; `pnpm build && pnpm check:budgets` (panel chunk delta receipted).
- [ ] E2E: `panel-copy-exclusion` + `undefined-references` suites extended — live docker minify arm asserts the copied payload is the **original** path; a failure arm (timeout → fallback → copy works hostless + notice). Remote-host resolution stays unit-tested (docker has no external scripts) — record as an explicit limit with a manual live-check step for the owner.
- [ ] UI bar §D receipts for the touched row/UI states (D-1–D-7); W-2: string deltas listed (P15 owns final wording sweep).
- [ ] Runbook row (minified-copy behavior + the combined capture arm how-to); plans README active-work line updated; AGENTS only if a convention actually changed (none expected).

## Non-goals

- No worker thread (decision 1); no CSS/other-asset surfaces (the vocabulary extends when a consumer exists — not speculatively); no full `?nowprocket` diff tooling (the map is bounded to host resolution for this page; bundle attribution is impossible from any client data — grouping lives inside WP Rocket); no exclusion-builder work (P10 parked); no user-editable pattern affordance.
