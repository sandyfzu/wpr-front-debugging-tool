# Local site runbook — the dockerized WordPress debugging site

The one-page operating guide for the local site phase (P4.2). The compose stack lives in
`docker/`; this page is how to drive it and what to expect from every scenario flag.

## Quick facts

| Item             | Value                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site URL         | `http://127.0.0.1:8493` (pinned by `docker/.env`)                                                                                                    |
| Fixture hub      | `http://127.0.0.1:8493/fdt/`                                                                                                                         |
| Beacon page      | `http://127.0.0.1:8493/fdt-beacon/`                                                                                                                  |
| wp-admin         | `http://127.0.0.1:8493/wp-admin/`                                                                                                                    |
| Credentials      | inside `docker/.env` (`WPR_FDT_ADMIN_*`) — never logged, never committed                                                                             |
| Port             | loopback-only publish; free-port check runs in `up.sh`                                                                                               |
| WP / PHP         | WordPress 7.1.3 on PHP 8.4 (`wordpress:7.1.3-php8.4-apache`)                                                                                         |
| Database         | MariaDB 11.8.9 (container-only, no published port)                                                                                                   |
| wp-cli           | one-shot bootstrap container (`wordpress:cli-2.12.0-php8.4`, uid 33)                                                                                 |
| WP Rocket        | 3.24 via `apvm build` — `tag:v3.24 @ 5b71db4`                                                                                                        |
| Conflict plugins | 62 free wp.org plugins installed inactive (`docker/conflicts.txt` — 60 pattern-derived + 2 vendor aliases, see `docker/scripts/derive-conflicts.sh`) |

## One-command lifecycle

```bash
docker/scripts/up.sh      # boot (first time: copies .env, boots db+site, then the bootstrap)
docker/scripts/down.sh    # stop; volumes kept — next up boots exactly as it was
docker/scripts/reset.sh   # hard reset: down -v + up — fully rebuilt, zero manual steps
```

`up.sh` auto-copies `docker/.env.example` → `docker/.env` on first use, verifies the
`apvm`-built zip exists, verifies the port is free, deletes the readiness marker, boots,
runs the one-shot bootstrap in the foreground (its output streams here; its last step
writes `docker/state/bootstrap-ready.txt`, served at `/fdt-state/bootstrap-ready.txt` —
the browser tier's readiness URL), then smoke-checks the site. The bootstrap is
idempotent and re-applies the fixture baselines on EVERY boot; the first boot takes a
few minutes (WP Rocket + the 62-plugin conflict set), later boots converge in seconds.

## Building WP Rocket into place (once)

`docker/wpr/wpr-rocket.zip` is produced by `apvm` at harness time and is git-ignored —
the zip is never committed. The bootstrap pins the installed version through
`WPR_FDT_EXPECTED_WPR_VERSION` in the `.env` and fails the boot when a stale zip slips in.

```bash
apvm build wp-rocket tag:latest-stable /tmp/wpr-out
mkdir -p docker/wpr && cp /tmp/wpr-out/wp-rocket-*.zip docker/wpr/wpr-rocket.zip
```

`apvm --verbose` records the resolved tag and commit in its output. Built here: tag
`v3.24` @ `5b71db4` → version 3.24, the same build as the pinned parity zip, so
`cp docker/wpr/wpr-rocket-3.24.zip docker/wpr/wpr-rocket.zip` is an equivalent shortcut.

Re-pinning a newer tag: put its zip in place, update `WPR_FDT_EXPECTED_WPR_VERSION` in both the
`.env` and `.env.example`, then run `docker/scripts/reset.sh` — a plain `up.sh` keeps the installed
plugin (the bootstrap never reinstalls one) and fails the pin.

The parity harness (`pnpm parity:wp-rocket`) does not read this zip: it derives the parity tables and the
simulation data file under every supported WP Rocket version (`SUPPORTED_WPR_VERSIONS`, `lib/wp-rocket/versions.ts`),
each from its own git-ignored zip `docker/wpr/wpr-rocket-<version>.zip` whose sha256 must equal the row's
`zipSha256` (apvm builds are not byte-reproducible, so the pinned file is the reference). Cold start: copy the
pinned builds from apvm's cache and check them —

```bash
cp ~/.apvm/cache/wp-rocket/commits/3.24/5b71db4/wp-rocket-3.24.zip docker/wpr/wpr-rocket-3.24.zip
cp ~/.apvm/cache/wp-rocket/commits/3.23.5.1/8e89a59/wp-rocket-3.23.5.1.zip docker/wpr/wpr-rocket-3.23.5.1.zip
shasum -a 256 docker/wpr/wpr-rocket-*.zip   # = the registry's zipSha256 values
```

Adding or replacing a supported version (owner decision, never from GitHub's release flags): edit its registry
row (version, zip sha256, role, rule variants), put its zip in place, run `pnpm parity:wp-rocket --write` and
review the changes. The tables' `header.plugins` lists the tags the parity workflow
(`.github/workflows/wp-rocket-parity.yml`) builds (`tag:v<version>`) and the package versions each must vendor —
no workflow edit needed. The workflow's own APVM release is pinned there (`APVM_VERSION`).

## Scenario flags (any page)

Every scenario is a URL flag; no admin state exists for any of them. Flags combine
(`?fdt-error=reference&fdt-delay=1` runs both). Unknown values no-op silently.

| URL flag                 | Scripted problem (verified in a real Chromium)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `?fdt-error=reference`   | `ReferenceError: fdtFixtureReference is not defined` — at load, un-delayed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `?fdt-error=reading`     | `TypeError: Cannot read properties of undefined (reading 'fdtFixtureProperty')` — at load, un-delayed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `?fdt-error=notfunction` | `TypeError: document.body.fdtFixtureNotAFunction is not a function` — at load, un-delayed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `?fdt-error=minified`    | `ReferenceError: a is not defined` — at load, un-delayed; the thrown word is the single letter `a`, the shape minified code produces — the undefined-references card qualifies such a word with its minified-code note, and the definition search answers the page's sources (one-letter names match plenty of coincidental candidates)                                                                                                                                                                                                                                                                                                                                              |
| `?fdt-delay=1`           | Delay-JS queue: dispatch a user interaction (mousemove etc.) and the delayed script throws `ReferenceError: fdtDelayTypedDependency is not defined` exactly then; the sibling benign delayed script tags its node `data-fdt-delay="executed"`, and WP Rocket marks every executed delayed script `data-rocket-status="executed"`. A third delayed script runs LAST and then defines the thrown name — the found-verdict replay: the tab's definition search answers `fdt-delayed-definer.js` (the name was thrown as undefined, and the definition exists in the page's sources, loaded too late to help) and its Copy-as-exclusion copies that served path into Delay JS exclusions |
| `?fdt-mobile-cache=1`    | WP Rocket's separate-mobile-files option (`do_caching_mobile_files`) forced on per request via the option-read filter — the served copy carries the `wpr_mobile`/`wpr_desktop` rendering marker (verified). Read from the request, stored nowhere: self-resets. Note the boundary: the plugin's compiled per-host buffer config keeps the boot-seeded state, so against this site's always-on baseline the flag is a no-op force that exists for rounds that run after any config shift                                                                                                                                                                                              |
| `?fdt-fonts-on=1`        | WP Rocket's opt-in `auto_preload_fonts` option forced on per request via the option-read filter — the served copy's beacon config flips `status.preload_fonts` to `true` and the Preload-fonts payload lists appear (P1.1 round). **Boundary:** the flag is page-side only — the beacon's own `admin-ajax` decisions read the stored option in their request context and cannot see the URL flag, so full-font-family arms force the option itself, not the flag (P1.1's record)                                                                                                                                                                                                     |
| `?fdt-oci-off=1`         | The `rocket_above_the_fold_optimization` filter answered `false` per request — the plugin's documented filter/helper disable path (P1.1 round). The Optimize-critical-images factory leaves the whole pipeline for that request: its `status.atf` key, its `elements` payload, and all applied markup vanish while sibling features behave normally                                                                                                                                                                                                                                                                                                                                  |
| `?fdt-wpr-versionless=1` | WP Rocket's generator meta issued WITHOUT its version (`rocket_display_meta_generator_content_version` answered false for the request — the plugin's own filter): the served copy still detects as present, cached and footprint-complete, but the WPR version reads absent. The scenario the versionless-identity surface renders against (the P12A widget round); the CDP smoke's scenario 5 asserts the arm's served HTML both ways                                                                                                                                                                                                                                               |
| `?fdt-meta-off=1`        | WP Rocket's generator meta NOT issued (`rocket_disable_meta_generator` answered true for the request): an optimized, cached page whose features only their markup can decide — the tag-absent arm, distinct from the digits-free meta above and from the bypass                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `?fdt-white-label=1`     | WP Rocket's own `WP_ROCKET_WHITE_LABEL_FOOTPRINT` defined for the request: the footer becomes `Cached for great performance` (stamped on the stored copy) and no generator meta is issued                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `?fdt-decoy=1`           | Inert look-alikes of five footprints (`style#wpr-usedcss`, a `wprRemoveCPCSS` inline script, `RocketPreloadLinksConfig` ×2, a `data-wpr-hosted-gf-parameters` link, `#wpr-lazyload-bg-container`) — the explicit fixture for the licence-masked RUCSS/async-CSS rows; they must be ignored while the meta is issued and decide their rows with `fdt-meta-off=1`                                                                                                                                                                                                                                                                                                                      |
| `?fdt-no-store=1`        | WP Rocket processes the page but writes no cache file (`do_rocket_generate_caching_files` answered false at `PHP_INT_MAX`, the managed-host mechanism): every response is a live render with the unstamped footer, never a stored copy. With `nowprocket` it is the genuinely uncached bypass arm                                                                                                                                                                                                                                                                                                                                                                                    |
| `?fdt-edge-strip=1`      | **Edge layer** (`docker/fixtures/edge/fdt-edge.php`, required from wp-config before WordPress, so its buffer is outermost): removes WP Rocket's cache footer (all three forms) from the response — live render or stored copy; the stored file keeps it                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `?fdt-edge-header=<x>`   | **Edge layer**: sends one hosting header — `sg` → `sg-f-cache: HIT`, `cf` → `cf-cache-status: HIT`, `cf-dynamic` → `cf-cache-status: DYNAMIC`, `proxy` → `x-proxy-cache: HIT`; HTML untouched. Combine with `fdt-edge-strip=1` to vary comment and headers independently                                                                                                                                                                                                                                                                                                                                                                                                             |
| `?nowprocket=1`          | WP Rocket bypass: no generator meta; Delay JS skips (its queue and its delayed-script stamps), but Minify, Defer and LazyLoad still apply (`data-minify="1"`, `cache/min/1/` srcs; live-verified 2026-10-19), and the per-feature `<!-- wpr_* -->` comments stay after `</html>` (verified 2026-10-20). Alone it serves plain WordPress; **with a cached query flag (e.g. `?fdt-delay=1&nowprocket=1`) the plugin stores and later serves that render as a stamped cached copy** (verified 2026-10-20)                                                                                                                                                                               |

Every page also carries one inert external-origin `<link>` (a `.invalid`-reserved hostname, never resolved) so the Preconnect factory's collecting phase always has at least one external domain to report — head + fixture-name, `rel="novelty"`, defined in the fixture mu-plugin; it asserts nothing itself by design.

The delay scenario is the real delayed-execution reproduction: zero errors before the
interaction, the error only when WP Rocket's delay queue runs (its trigger list —
`keydown/keyup/mousedown/mouseup/mousemove/mouseover/mouseout/touchmove/touchstart/
touchend/touchcancel/wheel/click/dblclick/input` — verified against the built runtime).
It is also the found-verdict replay for the Undefined References tab: the name thrown as
undefined is then defined by `fdt-delayed-definer.js`, so the tab's search — over the
scripts DevTools itself now lists — answers it, and the card carries the script-file row
with Copy-as-exclusion. The only timing rule is that the definitions land once the queue
has finished (the tab's waiting state clears); whether the panel rides through the
interaction or is opened after it changes nothing — sources are read, then searched.

## The UA-echo endpoint (per-request network truth)

```text
GET http://127.0.0.1:8493/wp-json/fdt/v1/ua-echo
```

A `text/plain` body answering the **request's own `User-Agent` header verbatim**, marker
first (`fdt-ua-echo`), then the UA line — the assert surface for "what the network
actually carried", including inside the side-by-side halves (an iframe document body of
text/plain is the raw bytes, readable as `body.textContent`). Properties, verified live:

- **Live per request** — WP Rocket's compiled `cache_reject_uri` rejects every
  `wp-json` request (never buffered, never stored), and the response pins
  `Cache-Control: no-store` + `Expires: 0` itself: the site's expires-by-type fallback
  would otherwise give this MIME type a 30-day HTTP cache lifetime.
- **Uncacheable frontier is deliberate** — a served UA echo must never be replayed
  across a request that flips the UA (a session rule does exactly that).

## Detection matrix rounds (P11.1)

`tests/e2e/suites/site-detection-matrix.spec.ts` drives the round list declared once in
`tests/e2e/helpers/detection-matrix.ts` (combinations, URLs, expected rows and cache lines
live only there). Each combination is written whole through wp-cli (`helpers/site-wpcli.ts`:
settings from stdin, config regenerated, domain + minify purged) and the found settings are
restored the same way afterwards; the suite refuses to start on a site whose bootstrap-forced
keys drifted or whose `cache_query_strings` lacks a matrix flag (re-run `up.sh`), and every
browser run's global setup (`tests/e2e/site-baseline-setup.ts`) refuses a live `/fdt/`
render whose meta is off the baseline (a killed run's leftover combination; its probe
carries `fdt-no-store=1`, so it never stores a cache file). Recovery from either refusal
is `up.sh`: the bootstrap forces every key a combination writes. `minify_css_key`/`minify_js_key` are regenerated by the plugin
whenever a minify option toggles, so they are not byte-restorable (cache-busting values, not
settings).

| Combination     | Stored overrides                                                                                      | Rounds                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `baseline`      | none (the bootstrap set)                                                                              | A1–A10 precedence/bypass/white-label arms, K1–K7 cache arms |
| `media-preload` | Delay/Defer/Minify off; iframes, CSS backgrounds, image dimensions, Preload Links, self-host fonts on | B1 meta, B2 tag-absent                                      |
| `all-off`       | Delay/Defer/Minify/LazyLoad off                                                                       | C1 device-only meta, C2 + decoys, C3 no meta/no footprint   |

Every round asserts the served decoy DOM, the payload (row presence + `source`), the
on-page strip, the panel cards, summary facts and status bar, the support report, and —
when the edge sent a header — the Headers page. A6/A7 (the "Bypass requested" arms)
carry `fdt-no-store=1` and first prove a repeat request is still a live render (no
`Last-Modified`, no `cached@` stamp): without it, the plugin stores any `nowprocket` URL
that carries a cached query flag (A8), and the verdict would describe a stored copy.

## Verifying the served copy's rendering (mobile-cache markers)

With separate mobile files on (the boot baseline seeds `cache_mobile` +
`do_caching_mobile_files` = 1), a request's UA decides which copy is served, and the
served copy carries its own rendering marker:

```text
Profile UA (Android + Mobile tokens) → index-mobile.html → data-wpr-features contains wpr_mobile
Desktop UA                           → index.html           → data-wpr-features contains wpr_desktop
?nowprocket=1                        → bypassed render: no wpr_mobile/wpr_desktop markers (no data-wpr-features meta); scripts stay deferred + minified — only Delay JS skips
```

Verified live by direct requests (2026-10-12, both copies built and listed below the
Observability paths).

## Re-running the browser smoke (no test deps installed)

`docker/scripts/cdp-smoke.mjs` drives system Chrome headless over raw CDP with Node's
built-in `WebSocket` only (no new dependencies) and asserts all of the above — the
scenario flags **and** the UA-echo endpoint (marker line, the verbatim browser UA, a
UA-overridden navigation proving per-request liveness, and no WP Rocket footprint),
the Priority-Elements beacon knobs (below), and the versionless generator arm
(scenario 5: the baseline copy's versioned meta vs the flagged copy's stamp-free one,
both cached copies) — reading their arm configs from the raw served HTML:

```bash
node docker/scripts/cdp-smoke.mjs
# env overrides: FDT_SITE_URL, FDT_CDP_PORT, CHROME
# exits nonzero — a missing proof is a failure, never a pass
```

Scenario 4 (the Priority-Elements knobs) asserts each arm's served beacon config per
rule, never per presence: config absence per arm is the legitimate applied-row outcome
(the beacon injects only while a registered factory lacks its row, and the smoke cannot
reset site tables). The knobs assert fully on the pending row state —
`docker/scripts/reset.sh` returns to it.

## Verifying by wp-cli (bootstrap container shorthand)

```bash
cd docker
alias wpc='docker compose -f docker-compose.yml --env-file .env run --rm wp-bootstrap sh -c'
wpc 'wp --path=/var/www/html plugin list --format=csv'           # all conflicts inactive, wp-rocket alone active
wpc 'wp --path=/var/www/html eval "rocket_clean_domain(); rocket_clean_minify();"'   # own purge
```

### The minify arms the exclusion panels copy from (P18 capture arms)

The panel's Undefined References "Copy as exclusion" names the script's ORIGINAL
path on a minified site: WP Rocket's per-file Minify mirrors the original URL
path into the cache URL (`cache/min/<site-id>/<original-path>`), and the panel
recovers it (verified live on this site — the defect it fixes copied the cache
path instead). Combined bundles (`minify_concatenate_js`) carry only an md5
filename — the row says so instead of a copy control.

To reproduce the **combined-bundle capture arm** (recorded in
`docs/plans/18-exclusion-original-path.md`), flip the two options, regenerate
the per-host config, purge, fetch, and restore:

```bash
wpc 'wp --path=/var/www/html option patch update wp_rocket_settings minify_concatenate_js 1
     wp --path=/var/www/html option patch update wp_rocket_settings delay_js 0
     wp --path=/var/www/html eval "do_action( \"permalink_structure_changed\" );"
     wp --path=/var/www/html eval "rocket_clean_domain(); rocket_clean_minify();"'
curl -s "http://127.0.0.1:8493/fdt/?fdt-delay=1" | grep -o 'src="[^"]*cache/min[^"]*"'
# → .../cache/min/1/<32-hex>.js — the combined bundle (no ?ver=).
# Restore the baseline (the next `up.sh` would anyway):
wpc 'wp --path=/var/www/html option patch update wp_rocket_settings minify_concatenate_js 0
     wp --path=/var/www/html option patch update wp_rocket_settings delay_js 1
     wp --path=/var/www/html eval "do_action( \"permalink_structure_changed\" );"
     wp --path=/var/www/html eval "rocket_clean_domain(); rocket_clean_minify();"'
```

A `?nowprocket=1` fetch serves the bypassed render: Delay JS skips, but the scripts
stay deferred and minified (`data-minify="1"`, `cache/min/1/` srcs) — the bypass does
NOT un-minify (live-verified 2026-10-19; the panel's exclusion copy recovers original
paths from the served minified URLs directly, no bypass fetch involved).

The WPR admin's real options are seeded by the bootstrap through one authenticated admin
request (`wp_rocket_settings` exists only after an admin-page-context hit — wp-cli
activation does not seed it; verified against the bundled WP-CLI 2.12.0).

## What the bootstrap enforces every boot (identical-run guarantees)

| Forced baseline (patch every boot)                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cache_mobile` + `do_caching_mobile_files` = 1                                                                                                                                                 | mobile cache state exists for the P16.1 rounds                                                                                                                                                                                                                                                                                     |
| `lazyload` = 1                                                                                                                                                                                 | `data-lazy-src` fixture images                                                                                                                                                                                                                                                                                                     |
| `defer_all_js` = 1                                                                                                                                                                             | `data-rocket-defer` fixtures                                                                                                                                                                                                                                                                                                       |
| `delay_js` = 1                                                                                                                                                                                 | the delay-queue scenario (`?fdt-delay=1`)                                                                                                                                                                                                                                                                                          |
| `minify_css`/`minify_js` = 1                                                                                                                                                                   | `/wp-content/cache/min/` asset markers                                                                                                                                                                                                                                                                                             |
| `remove_unused_css` = 1                                                                                                                                                                        | forced at the option-row level — but 3.24 masks the RUNTIME read to 0 (the license check's "expired >15 days" gate; a synthetic local key has no expiration, so it always reads as expired). RUCSS and Async-CSS therefore never engage on this site — fixture-scale only; a suite needing live RUCSS must not rely on this toggle |
| `lazyload_iframes` / `lazyload_css_bg_img` / `image_dimensions` / `preload_links` / `host_fonts_locally` = 0                                                                                   | the seeded state (0 or absent, read as off); every key a matrix combination writes is forced, so `up.sh` undoes a killed run (contract-pinned)                                                                                                                                                                                     |
| `cache_query_strings` = `[fdt-error, fdt-delay, fdt-fonts-on, fdt-oci-off, fdt-wpr-versionless, fdt-meta-off, fdt-white-label, fdt-decoy, fdt-edge-strip, fdt-edge-header, fdt-no-store]`      | makes flagged URLs cached URLs (the buffer only processes listed params) — the versionless flag rides the bus because its filter arm acts inside the buffer pipeline, so an unprocessed URL would serve plain WP output and never answer the versionless question                                                                  |
| permalink structure = `/%postname%/`                                                                                                                                                           | non-home URLs resolve (plain permalinks 404 and never cache — observed)                                                                                                                                                                                                                                                            |
| `WP_CACHE` / `WP_ROCKET_DEBUG` in wp-config                                                                                                                                                    | the page cache + the plugin's own debug log                                                                                                                                                                                                                                                                                        |
| `WP_ROCKET_KEY` / `WP_ROCKET_EMAIL` in wp-config                                                                                                                                               | the plugin's local licence-override channel — its empty `licence-data.php` shim otherwise shadows the DB values and no optimization engine ever registers                                                                                                                                                                          |
| edge-layer `require_once` in wp-config (guarded on the file)                                                                                                                                   | `docker/fixtures/edge/fdt-edge.php` must run before WordPress and WP Rocket's advanced-cache drop-in, so its output buffer wraps cached serves too                                                                                                                                                                                 |
| `FS_CHMOD_DIR` / `FS_CHMOD_FILE` in wp-config (core's own derivation)                                                                                                                          | the plugin's hourly debug-log check truncates a log of 30 MB+ through `WP_Filesystem_Direct` without `WP_Filesystem()`; undefined, the call fatals the wp-cli settings write it runs in (the matrix's intermittent `wp-cli step failed`)                                                                                           |
| `docker/state/bootstrap-ready.txt` written as the last step (deleted by `up.sh` before boot; `up.sh` sets `docker/state` to 1777 so the bootstrap's uid 33 can write it on a Linux bind mount) | the browser tier's readiness URL: answers only once this boot converged, never from a warm volume mid-bootstrap                                                                                                                                                                                                                    |
| synthetic local key (`fdtlocal` / `local-fdt-fixture@127.0.0.1` + crc32 secret)                                                                                                                | `rocket_valid_key()` must pass locally or every front-end optimization is skipped (observed first-hand)                                                                                                                                                                                                                            |
| fixture pages exist (`/fdt/`, `/fdt-beacon/`)                                                                                                                                                  | created by slug; the committed content is the source of truth and is re-applied whenever the stored copy drifted (a hub-content fix lands on existing stacks at the next up)                                                                                                                                                       |
| conflict plugins installed inactive                                                                                                                                                            | plugins.php produces real name matches without touching front-end behavior                                                                                                                                                                                                                                                         |

Note: `cache` is not a settings key — page caching is unconditional in WP Rocket
(verified in the 3.24 defaults), so there is nothing to force about it.

## Self-reset semantics

- `down` + `up` (no `-v`): volumes kept — the site returns as it was; the bootstrap
  still re-applies every baseline above, so forced keys cannot drift — including a killed
  matrix run's leftover combination (every key a combination writes is forced). Other
  settings are not forced; a killed run never writes them.
- `reset` (`down -v` + `up`): everything rebuilt — core, WP Rocket from the zip, all 62
  conflict plugins, fixture pages, baseline. Proven: the post-reset state compares
  byte-identical (plugins+statuses, pages, picked settings) against the pre-reset one;
  the full CDP smoke passes again on the fresh stack.
- Fixture-page behavior is flag-keyed, not state-keyed: a WP Rocket cache purge never
  changes scenario outcomes (the fixtures are code, not admin state). A fixture CODE
  edit does flip flag-keyed behavior — but every prior request baked the flagged URLs'
  cached copies, so run `rocket_clean_domain(); rocket_clean_minify();` (the wp-cli
  shorthand above) after editing a fixture asset or the plugin itself; the next hit of
  a flagged URL then serves the new copies. `reset.sh` always rebuilds fresh.

## Observability

- WP Rocket's own debug log: `wp-content/wp-rocket-config/wp-rocket-debug.log.html` (enabled by `WP_ROCKET_DEBUG`; rotates older files under the same directory; grows ~60 MB/h under looped browser runs; the plugin checks it hourly, on the first settings write after its transient expires, and truncates it at 30 MB+ — that needs the `FS_CHMOD_*` defines above).
- Page cache tree: `wp-content/cache/wp-rocket/<host>/<path>/index.html` (+ `_gzip` twin)
  — the port is dropped from the cached host path (observed: `127.0.0.1/...` while the
  site URL is `127.0.0.1:8493`). With separate mobile files on there is a second,
  UA-gated variant per path: `index-mobile.html` (+ `_gzip` twin), served to requests
  whose UA the plugin reads as a phone and desktop-invisible to them (verified live:
  both variants carry their own `wpr_mobile`/`wpr_desktop` marker).
- Minified assets: `wp-content/cache/min/1/wp-content/...-min.js` (hashed name; the
  fixture Delay/Defer exclusion stems still match, by design).
- Serve-cached proof: repeat GETs of the same URL are byte-identical and carry the
  `<!-- Performance optimized by WP Rocket ... -->` footprint.

## HTTPS (mkcert) — documented, not required

HTTP is fully functional and is the default (the extension matches `http://*/*`). If a
suite ever needs HTTPS: `mkcert`-issue a certificate for `127.0.0.1` into
`docker/certs/` (git-ignored), terminate TLS in front of the site (a small profile-based
proxy service), and point `WPR_FDT_SITE_URL` at `https://…`. This path is NOT exercised
in this phase; revisit when a suite actually requires it. Nothing in the bootstrap
assumes TLS today.

## Troubleshooting

| Symptom                                 | Where to look                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `up: missing docker/wpr/wpr-rocket.zip` | run the `apvm build` command above                                                                                                                       |
| `up: port … is already taken`           | free the port or change `WPR_FDT_TCP_PORT` **and keep `WPR_FDT_SITE_URL` in sync with it** (the bootstrap pins the site URL from there) in `docker/.env` |
| bootstrap fails at `wpr_pin`            | the installed plugin's version differs from the pin — rebuild/re-pin, then `docker/scripts/reset.sh`                                                     |
| bootstrap log messages                  | `docker compose -f docker/docker-compose.yml --env-file .env logs wp-bootstrap`                                                                          |
| site unreachable                        | `docker compose -f docker/docker-compose.yml --env-file .env logs wordpress`                                                                             |
| a conflict slug fails to install        | wp.org moved it — re-derive the list: `docker/scripts/derive-conflicts.sh`                                                                               |
| a browser navigation hangs after idling | `docker/apache/accept-filter.conf` must be mounted (`AcceptFilter http none`; the why + measurements are in the file and `tests/e2e/README.md`)          |
