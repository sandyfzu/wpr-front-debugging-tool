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
| WP Rocket        | 3.23.5.1 via `apvm build` — `tag:v3.23.5.1 @ 8e89a59`                                                                                                |
| Conflict plugins | 62 free wp.org plugins installed inactive (`docker/conflicts.txt` — 60 pattern-derived + 2 vendor aliases, see `docker/scripts/derive-conflicts.sh`) |

## One-command lifecycle

```bash
docker/scripts/up.sh      # boot (first time: copies .env, boots db+site, then the bootstrap)
docker/scripts/down.sh    # stop; volumes kept — next up boots exactly as it was
docker/scripts/reset.sh   # hard reset: down -v + up — fully rebuilt, zero manual steps
```

`up.sh` auto-copies `docker/.env.example` → `docker/.env` on first use, verifies the
`apvm`-built zip exists, verifies the port is free, boots, runs the one-shot bootstrap in
the foreground (its output streams here), then smoke-checks the site. The bootstrap is
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
`v3.23.5.1` @ `8e89a59` → version 3.23.5.1 (update `WPR_FDT_EXPECTED_WPR_VERSION`, in
both the `.env` and `.env.example`, when you re-pin a newer tag).

## Scenario flags (any page)

Every scenario is a URL flag; no admin state exists for any of them. Flags combine
(`?fdt-error=reference&fdt-delay=1` runs both). Unknown values no-op silently.

| URL flag                 | Scripted problem (verified in a real Chromium)                                                                                                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?fdt-error=reference`   | `ReferenceError: fdtFixtureReference is not defined` — at load, un-delayed                                                                                                                                                                                                                                                       |
| `?fdt-error=reading`     | `TypeError: Cannot read properties of undefined (reading 'fdtFixtureProperty')` — at load, un-delayed                                                                                                                                                                                                                            |
| `?fdt-error=notfunction` | `TypeError: document.body.fdtFixtureNotAFunction is not a function` — at load, un-delayed                                                                                                                                                                                                                                        |
| `?fdt-delay=1`           | Delay-JS queue: dispatch a user interaction (mousemove etc.) and the delayed script throws `ReferenceError: fdtDelayTypedDependency is not defined` exactly then; the sibling benign delayed script tags its node `data-fdt-delay="executed"`, and WP Rocket marks every executed delayed script `data-rocket-status="executed"` |
| `?nowprocket=1`          | WP Rocket bypass: flags still fire their own scripts, but nothing is delayed/deferred/minified (serves the plain page)                                                                                                                                                                                                           |

The delay scenario is the real delayed-execution reproduction: zero errors before the
interaction, the error only when WP Rocket's delay queue runs (its trigger list —
`keydown/keyup/mousedown/mouseup/mousemove/mouseover/mouseout/touchmove/touchstart/
touchend/touchcancel/wheel/click/dblclick/input` — verified against the built runtime).

## Re-running the browser smoke (no test deps installed)

`docker/scripts/cdp-smoke.mjs` drives system Chrome headless over raw CDP with Node's
built-in `WebSocket` only (no new dependencies) and asserts all of the above:

```bash
node docker/scripts/cdp-smoke.mjs
# env overrides: FDT_SITE_URL, FDT_CDP_PORT, CHROME
# exits nonzero — a missing proof is a failure, never a pass
```

## Verifying by wp-cli (bootstrap container shorthand)

```bash
cd docker
alias wpc='docker compose -f docker-compose.yml --env-file .env run --rm wp-bootstrap sh -c'
wpc 'wp --path=/var/www/html plugin list --format=csv'           # all conflicts inactive, wp-rocket alone active
wpc 'wp --path=/var/www/html eval "rocket_clean_domain(); rocket_clean_minify();"'   # own purge
```

The WPR admin's real options are seeded by the bootstrap through one authenticated admin
request (`wp_rocket_settings` exists only after an admin-page-context hit — wp-cli
activation does not seed it; verified against the bundled WP-CLI 2.12.0).

## What the bootstrap enforces every boot (identical-run guarantees)

| Forced baseline (patch every boot)                                              | Why                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cache_mobile` + `do_caching_mobile_files` = 1                                  | mobile cache state exists for the P16.1 rounds                                                                                                                                                                                                                                                                                         |
| `lazyload` = 1                                                                  | `data-lazy-src` fixture images                                                                                                                                                                                                                                                                                                         |
| `defer_all_js` = 1                                                              | `data-rocket-defer` fixtures                                                                                                                                                                                                                                                                                                           |
| `delay_js` = 1                                                                  | the delay-queue scenario (`?fdt-delay=1`)                                                                                                                                                                                                                                                                                              |
| `minify_css`/`minify_js` = 1                                                    | `/wp-content/cache/min/` asset markers                                                                                                                                                                                                                                                                                                 |
| `remove_unused_css` = 1                                                         | forced at the option-row level — but 3.23.5.1 masks the RUNTIME read to 0 (the license check's "expired >15 days" gate; a synthetic local key has no expiration, so it always reads as expired). RUCSS and Async-CSS therefore never engage on this site — fixture-scale only; a suite needing live RUCSS must not rely on this toggle |
| `cache_query_strings` = `[fdt-error, fdt-delay]`                                | makes flagged URLs cached URLs (the buffer only processes listed params)                                                                                                                                                                                                                                                               |
| permalink structure = `/%postname%/`                                            | non-home URLs resolve (plain permalinks 404 and never cache — observed)                                                                                                                                                                                                                                                                |
| `WP_CACHE` / `WP_ROCKET_DEBUG` in wp-config                                     | the page cache + the plugin's own debug log                                                                                                                                                                                                                                                                                            |
| `WP_ROCKET_KEY` / `WP_ROCKET_EMAIL` in wp-config                                | the plugin's local licence-override channel — its empty `licence-data.php` shim otherwise shadows the DB values and no optimization engine ever registers                                                                                                                                                                              |
| synthetic local key (`fdtlocal` / `local-fdt-fixture@127.0.0.1` + crc32 secret) | `rocket_valid_key()` must pass locally or every front-end optimization is skipped (observed first-hand)                                                                                                                                                                                                                                |
| fixture pages exist (`/fdt/`, `/fdt-beacon/`)                                   | created by slug, content is a fixed string                                                                                                                                                                                                                                                                                             |
| conflict plugins installed inactive                                             | plugins.php produces real name matches without touching front-end behavior                                                                                                                                                                                                                                                             |

Note: `cache` is not a settings key — page caching is unconditional in WP Rocket
(verified in the 3.23.5.1 defaults), so there is nothing to force about it.

## Self-reset semantics

- `down` + `up` (no `-v`): volumes kept — the site returns as it was; the bootstrap
  still re-applies every baseline above, so settings cannot drift.
- `reset` (`down -v` + `up`): everything rebuilt — core, WP Rocket from the zip, all 62
  conflict plugins, fixture pages, baseline. Proven: the post-reset state compares
  byte-identical (plugins+statuses, pages, picked settings) against the pre-reset one;
  the full CDP smoke passes again on the fresh stack.
- Fixture-page behavior is flag-keyed, not state-keyed: a WP Rocket cache purge never
  changes scenario outcomes (the fixtures are code, not admin state).

## Observability

- WP Rocket's own debug log: `wp-content/wp-rocket-config/wp-rocket-debug.log.html` (enabled by `WP_ROCKET_DEBUG`; rotates older files under the same directory).
- Page cache tree: `wp-content/cache/wp-rocket/<host>/<path>/index.html` (+ `_gzip` twin)
  — the port is dropped from the cached host path (observed: `127.0.0.1/...` while the
  site URL is `127.0.0.1:8493`).
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
| bootstrap fails at `wpr_pin`            | the zip's version differs from the recorded pin — rebuild/re-pin                                                                                         |
| bootstrap log messages                  | `docker compose -f docker/docker-compose.yml --env-file .env logs wp-bootstrap`                                                                          |
| site unreachable                        | `docker compose -f docker/docker-compose.yml --env-file .env logs wordpress`                                                                             |
| a conflict slug fails to install        | wp.org moved it — re-derive the list: `docker/scripts/derive-conflicts.sh`                                                                               |
