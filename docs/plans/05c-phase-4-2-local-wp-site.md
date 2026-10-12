# Phase 4.2 — Local WordPress site (docker compose + mu-plugin fixtures + WP Rocket)

**Depends on:** — . **Effort:** M. **Parallelizable with:** P4.1 (and with all P5+ implementation work).

> **Runbook: [docs/local-site-runbook.md](../local-site-runbook.md)** — one command up/down/reset, URLs and credentials location, every scenario flag, re-run smoke commands, forced-baseline table and troubleshooting.

## TLDR

A reproducible **local WordPress environment in this repo** — Docker Compose, wp-admin test credentials in a git-ignored `.env`, WP Rocket installed from an `apvm`-built zip, free Known-Conflicts plugins preinstalled, and mu-plugin fixtures that inject the deterministic problems the debug tool exists to catch. The default site for every browser suite (owner decision: docker is the default; external real site is future scope only for what docker cannot fake).

## Goal

Make the "real site" checklists (P2–P4 retro suites in P4.3, later X.1 suites, the P7 diagnoser plugin, P11 detection matrix, P13 RUCSS runs, P14 beacon rounds) runnable on demand locally — always the same shape, self-resetting fixtures, no drifting server state.

## Contents

- `docker/docker-compose.yml`: WordPress (php-apache) + MariaDB + wp-cli bootstrap service; one command up/down/reset; document reset semantics (fixtures must survive a WP Rocket cache purge).
- WP Rocket installed from `docker/wpr/wpr-rocket.zip` produced by **`apvm build`** at harness time (pinned tag/branch recorded in the compose config; the zip itself never committed). Domain activation behavior verified empirically during this phase and recorded in this doc (localhost-domain handling) — never asserted from memory.
- **mu-plugin fixture plugin** (`docker/fixtures/`, mounted into `wp-content/mu-plugins`): the fixture strategy is code-injection (owner-delegated decision) —
  - query-flags flip scenarios per page (`?fdt-error=reference|reading|notfunction`, `?fdt-delay=1` making Delay JS genuinely produce the undefined reference, controlled `data-rocket-status` markup when DelayJS executes, beacon-friendly pages);
  - behavior fixtures that the Exclusion Builder (P10) targets;
  - self-resetting: nothing in the admin UI needs hand-configuring between runs;
  - (P16's child plans added fixtures here to keep one fixture list; shipped states live in the runbook): an UA-echo **endpoint** (`/wp-json/fdt/v1/ua-echo` — the uncached server-side echo of the request `User-Agent`) and a separate-mobile-cache query flag (`?fdt-mobile-cache=1`), both shipped in P16.2 B5; the planned `?fdt-redirect=cross` cross-origin redirect flag was never built (dropped — the scroll-sync degrade's evidence ran once over a throwaway dual-origin fixture; 05f's rewritten suites record it) — same self-resetting pattern.
- Preinstalled **free conflict plugins** filtered from the committed 121-row KC DB (`docker/conflicts.txt` committed list; wp.org-installable only) so `plugins.php` produces real matches.
- Slot for the **Support Diagnoser plugin** (P7) — included at build time when its phase lands, same install path.
- `.env.example` + gitignored `.env` (already ignored repo-wide as of 2026-10-08); credentials copied into place by the harness if missing, never logged.
- Optional HTTPS via mkcert (http alone is functional — the extension matches `http://*/*`); document the switch, don't require it.

## Definition of done

- One command boots the site; smoke: WP loads, WP Rocket active with real feature toggles operable, a conflict plugin visible on `plugins.php`, at least one fixture page produces its scripted problem (e.g. a Delay-JS-driven `ReferenceError`).
- `apvm` build + install path documented; versions pinned; secrets proven absent from the tree (`git status` clean with `.env` in place).
- This repo's regular gates untouched (compose files live outside measured/compiled surfaces; prettier-clean YAML).
- `docs/` gains a short runbook (URLs, creds, reset, scenario flags), linked from here.

## Stays out of this phase

Live external services (PSI production runs, HelpScout) — fixture-served locally or P14.6 later.

---

## Shipped (implementation record)

**Delivered everything above.** Commit-tracked units, in build order:

| Piece                                                                     | What actually ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker/docker-compose.yml`                                               | `mariadb:11.8.9` + `wordpress:7.1.3-php8.4-apache` + one-shot `wordpress:cli-2.12.0-php8.4` bootstrap (uid 33 = the serving image's www-data, whose writes must own the volume). Loopback-only publish `127.0.0.1:${WPR_FDT_TCP_PORT}:80`, named with the project-unique prefix `wprfdt` (project name set in-file → containers/volumes `wprfdt-*`). The site container gets the fixture folder as a read-only mu-plugins mount; the bootstrap mirrors the same mount so wp-cli runs load must-use plugins exactly as the serving container does. The P7 diagnoser slot is a documented commented-out mount line in the same file.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `docker/bootstrap/bootstrap.sh` (+ `seed-settings.php`, `activation.php`) | One-shot in compose-foreground: waits for the image entrypoint's core init → waits db → `core install` (first boot only) → pins siteurl/home to `WPR_FDT_SITE_URL` → pins permalinks to `/%postname%/` + flush → WP Rocket install-from-zip + activate + **version pin check against `WPR_FDT_EXPECTED_WPR_VERSION`** (a stale zip fails the boot, naming the fix) → wp-config constants (`WP_CACHE`, `WP_ROCKET_DEBUG`, `WP_ROCKET_KEY`, `WP_ROCKET_EMAIL`; see activation record) → synthetic local key → settings seeding via one real admin request → baseline settings (forced every boot) → per-host config regeneration → fixture pages by slug → **62 conflict plugins installed inactive (idempotent loop; per-slug failures reported, not fatal)** → `rocket_clean_domain()` + `rocket_clean_minify()` purge (the `wp rocket clean` command does not exist in 3.23.5.1 — the CLI command registry ships only `rocket abilities-catalog`, verified) → done marker. Credentials flow via compose environment, are never echoed, never logged. POSIX-sh only (the cli image is Alpine). |
| `docker/scripts/{up,down,reset}.sh`                                       | The one-command entries. `up.sh` copies `.env` from `.env.example` when missing, verifies the zip exists (with the exact reproducible command in the failure message), lsof-checks the port (skips when the listener is this own stack), boots db+site, runs the bootstrap in the foreground (visible convergence), curl-smokes the site and prints the entry points. `down.sh` keeps volumes; `reset.sh` = `down -v` + `up`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docker/fixtures/fdt-fixtures.php` + `assets/`                            | The must-use fixture plugin and its five scripted assets. See the fixture table below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docker/conflicts.txt` + `docker/scripts/derive-conflicts.sh`             | 62 free wp.org conflict plugins, derived (see conflict list section).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docker/.env.example`                                                     | Every variable with a why-comment (port, site URL, wp-admin creds, apvm version pin, db creds). Static local-only values, deliberately non-secret but git-ignored anyway.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/local-site-runbook.md`                                              | The runbook (linked from the header above).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docker/scripts/cdp-smoke.mjs`                                            | The committed browser smoke: raw CDP over Node's built-in WebSocket (zero dependencies added), asserts all five fixture scenarios + the `?nowprocket` bypass in a real headless Chromium; exits nonzero on any miss. Env-overridable (site URL, CDP port, Chrome path).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Fixture table (all empirically verified via CDP in Chrome 154 headless)

Engine cross-link: the two browser-test tools verify with different engines — the P4.1 harness runs Playwright's Chromium-for-Testing (156; the recording doc is 05b), while this phase's CDP smoke drives system Chrome headless (154.0.8037.99 when this record was written; `CHROME`-overridable — the override lives in `docker/scripts/cdp-smoke.mjs` + the runbook, the observed version is recorded here and in the heading above) — neither pins the other; keep the engines distinct when comparing suite outputs.

| Flag                          | Scripted result (real captured exception text)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `?fdt-error=reference`        | `ReferenceError: fdtFixtureReference is not defined` at load — script stays un-delayed/un-deferred via the plugin's own `rocket_delay_js_exclusions` + `rocket_exclude_defer_js` filters (minify still applies; exclusion stems match the minified asset by design)                                                                                                                                                                                                                                                                                                                                                                                          |
| `?fdt-error=reading`          | `TypeError: Cannot read properties of undefined (reading 'fdtFixtureProperty')` at load                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `?fdt-error=notfunction`      | `TypeError: document.body.fdtFixtureNotAFunction is not a function` at load (footer-enqueued so `document.body` exists)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `?fdt-delay=1`                | two external scripts handed to the delay queue: zero errors before interaction, `ReferenceError: fdtDelayTypedDependency is not defined` exactly when the queue runs after a dispatched mousemove (the runtime's own trigger list in 3.23.5.1: `keydown/keyup/mousedown/mouseup/mousemove/mouseover/mouseout/touchmove/touchstart/touchend/touchcancel/wheel/click/dblclick/input`); the sibling benign script sets `window.fdtDelayExecutedAt`, tags itself `data-fdt-delay="executed"`, and WP Rocket sets `data-rocket-status="executed"` on the executed nodes (observed values `executed`/`failed-network`/`failed-transform`/`skipped` across the run) |
| `?nowprocket=1`               | full bypass verified in-browser: zero `text/rocketlazyloadscript` nodes, zero optimization footprint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| pages `/fdt/`, `/fdt-beacon/` | beacon-friendly content shapes (headings, paragraphs, two `<img>` candidates, internal links) — `wpr-beacon.min.js` (`data-name="wpr-wpr-beacon"`) + the inline `rocket_beacon_data` wiring observed on them                                                                                                                                                                                                                                                                                                                                                                                                                                                 |     |

Beacon evidence, served-HTML fingerprints, delay/defer markers, minified names and cache footprints are all observable (runbook section "Observability").

### Conflict-plugin list (62 slugs)

Derived by `docker/scripts/derive-conflicts.sh` from the **committed Known-Conflicts DB**
(committed data, always re-derivable — the living count is this script's output, not a
hand figure):

1. The DB snapshot has grown since the spec was written: **175 rows (155 Plugin) after
   the release re-sync** (commit `8893f0a`), not the 121 the phase was scoped against.
   The derivation works from the live DB file, so the count moves with it.
2. Filter, in order: `type == "Plugin"` → pattern normalizes to a slug (trim, lowercase,
   whitespace→`-`, `dir/file`→`dir`, resolve URLs/prose/markers out) → the wp.org API
   (1.2 endpoint) still lists the slug and it is not closed → **the plugin's wp.org
   display name contains the DB row name case-insensitively** (this is the same
   containment the scanner's wp-admin mode applies to page text, `lib/known-conflicts/match.ts`,
   so only rows that can genuinely match are installed) → dedupe.
3. **Vendor alias pass** (audit fix — closes the `rank-math` trap): when a row's
   pattern-derived slug is absent, closed, or fails containment on wp.org, a fixed
   table of vendor-verified aliases is tried under the same legs. Each alias was
   pinned by checking the live directory — open listing, the row vendor's own plugin,
   display name containing the row name (`seo-by-rank-math` by Rank Math,
   `consenta-se` by Consenta) — AND by live-installing it on this stack and checking
   the rendered `plugins.php` text (both names present). A stale alias degrades to a
   documented drop, never a blind install, because the legs still gate it at run time.
   One candidate alias was REJECTED on the install ground: `sv-provenexpert` for the
   "SV Proven Expert" row — its on-disk header reads "SV ProvenExpert" (no spaces),
   which fails the containment the scan applies; verified in the live admin HTML.
   Generic name-only look-alikes are deliberately NOT aliased (e.g. `ginger-tag-remover`
   for the closed `Ginger` row): they would fabricate scanner matches for rows whose
   real plugin cannot exist.
4. Result: **136 plugin rows in the committed DB → 62 slugs pass** (deduped; 60 direct,
   2 via the vendor aliases). Dropped rows carry their reason (slug absent, closed on
   wp.org, containment miss).
5. All 62 install inactive at bootstrap: presence on `plugins.php` is what the scan
   needs, and inactive plugins cannot alter front-end fixture behavior. Verified
   in-admin (real admin HTML fetch, 274 kB): `Query Monitor`, `Yoast SEO`, `Elementor`,
   `Forminator`, `Ad Inserter` rows (the last is exactly the containment rule biting,
   as designed) plus both alias rows (`Rank Math SEO`, `Consenta.se`). 60 of the 62
   installed titles contain their row name; two are vendor-rename drift rows kept for
   their API-leg pass while their rendered titles ("WP Ghost Lite" for `hide-my-wp`,
   "WooCommerce Stripe Gateway" for `woocommerce-gateway-stripe`) no longer carry the
   row name — caught by this audit's installed-title sweep; the re-derivation picks
   them up whenever the wp.org advertised name drifts to match.

### apvm build record

- Command (runbook): `apvm build wp-rocket tag:latest-stable /tmp/wpr-out`, then copy to
  `docker/wpr/wpr-rocket.zip`.
- Resolved reference as printed by apvm 3.2.0: **tag `v3.23.5.1` @ `8e89a59`** →
  version **3.23.5.1**; pinned through `WPR_FDT_EXPECTED_WPR_VERSION` (`.env` +
  `.env.example`), verified in-container every boot (`wp plugin get wp-rocket
--field=version`).
- Image pins, each verified to exist on Docker Hub at build time: `mariadb:11.8.9`,
  `wordpress:7.1.3-php8.4-apache`, `wordpress:cli-2.12.0-php8.4`.

### Domain-activation record (localhost handling, observed — never from memory)

Behavior of WP Rocket 3.23.5.1 on `http://127.0.0.1:8493`, observed on this stack:

1. **The plugin installs and activates with no license at all** (`wp plugin install
… --activate`), sets up its drop-in (`wp-content/advanced-cache.php`), registers the
   must-use of the site fine, and `wp_rocket_no_licence` stays `'0'`. That is NOT a
   working state: **with no valid key, `Plugin.php` registers NO front-end optimization
   subscribers** (`init_valid_key_subscribers()` is the else-branch that owns
   `buffer_subscriber`, `minify_*`, `delay_js`, `defer`, `lazyload`, …). Observed
   directly: pages cached fine, ZERO markers of any optimization in the served HTML
   until the key state changed.
2. **There is no localhost auto-activation in 3.23.5.1.** `rocket_valid_key()` is a
   purely local formula (`consumer_key` exactly 8 chars AND `secret_key` ==
   hash-crc32 of `consumer_email`) gating that registration; nothing in the plugin
   special-cases local domains for it.
3. **`licence-data.php` shadows the database keys.** The autogenerated plugin-root shim
   defines `WP_ROCKET_KEY` / `WP_ROCKET_EMAIL` (empty by default), and
   `Options_Data::get()` returns those constants **before consulting the option row** —
   so writing the key fields into `wp_rocket_settings` alone does not validate. The
   plugin's own documented resolution is "define them in wp-config.php": the
   bootstrap pins both constants there (plus the truth of the DB fields mirrors).
4. **The running activation used on this site** is exactly that local channel: wp-config
   `WP_ROCKET_KEY=fdtlocal` + `WP_ROCKET_EMAIL=local-fdt-fixture@127.0.0.1`, and the
   DB `secret_key` = crc32 of that email (bootstrap `activation.php`, validated through
   `rocket_valid_key()` in-container on every boot). Synthetic, local-only, no license
   server contacts, no credential material anywhere — recorded here as the site's
   designed state, with the _plugin-free_ path (1–3) documented above it.
5. **The admin view at this state** (settings page fetched with the admin cookie, real
   HTML): renders normally (222 kB); shows a "WP Rocket license type" row (no value) and
   — only inside the RocketCDN section — the "Your WP Rocket license has expired / You
   need an active license to enable this option" banner. No plugin-level complaint
   blocks any non-CDN surface, and every front-end optimization operates (served-HTML
   evidence above). A stale `rocket_check_key_errors` transient can linger from earlier
   states with the "provided license data are not valid" message; it is TTL-bound and
   irrelevant to fixture behavior.
6. **The cache itself works on the localhost host**: page cache files land under
   `wp-content/cache/wp-rocket/127.0.0.1/…` — **the port is dropped from the cached host
   path** (site URL has `:8493`) — observed directly, recorded here for the P4.3 header
   suites.

### Other empirically pinned facts this stack depends on (correcting earlier assumptions)

- `wp option get wp_rocket_settings` exists only after an **admin-page-context request**;
  wp-cli activation does not seed it (`is_admin()` false under WP-CLI 2.12.0 — verified).
  The bootstrap performs one authenticated admin GET (`seed-settings.php`) whose cookies
  are generated server-side, so no admin hand work and no secret ever left the container.
- The optimization AND cache buffers only process / cache URLs whose query params are in
  `cache_query_strings` (or the plugin's small always-on list) — verified in
  `class-tests.php`; the fixture flags are therefore force-listed in the baseline
  (`["fdt-error","fdt-delay"]`), which makes flagged URLs cached URLs.
- Plain permalinks break fixture caching entirely (non-home URLs 404, and the cache
  buffer's permalink-based redirect logic silently declines any path that isn't the
  homepage — `maybe_allow_wp_redirect()`, `class-cache.php`). The bootstrap pins
  `/%postname%/` and forces the config regeneration.
- `wp option patch update` semantics: `update` requires the key to exist (inserting new
  sub-keys needs `insert`), and array values need `--format=json` — the baseline loop
  uses the exact call shapes these imply.
- The delay/defer exclusion patterns are matched as regexes over the **entire script
  markup** by WP Rocket (`replace_scripts()`), so bare-stem patterns (no `.js`) survive
  the minification rename — the fixture exclusion design relies on this, verified.

### Verification checklist (all checked against the live stack)

- [x] One command boots the site (`docker/scripts/up.sh`) — first boot ~minutes (conflicts), later boots seconds.
- [x] WP loads (curl 200 + WordPress HTML).
- [x] WP Rocket active AND operable: optimizations observed in the real served HTML
      (`text/rocketlazyloadscript`, `data-rocket-src`, `data-rocket-defer`,
      `data-lazy-src`, `/wp-content/cache/min/1/...` asset moves) and re-serves are
      bit-identical with the cached footprint comment.
- [x] A conflict plugin visible on `plugins.php` (real admin HTML fetch + wp-cli list:
      65 plugins — wp-rocket active, all 62 conflicts + default pair inactive).
- [x] Fixture problems proven in a real browser (committed `docker/scripts/cdp-smoke.mjs`,
      `SMOKE OK`): the two ReferenceError texts, the reading TypeError, the not-a-function
      TypeError, the delay-hold-before-interaction + throw-after behavior, the
      `data-rocket-status`/`data-fdt-delay` states, and the `?nowprocket` bypass.
- [x] Self-reset proven: `down -v` + `up` from empty volumes, unattended; the post-reset
      state byte-compares IDENTICAL (plugins+statuses, pages, picked settings) and the
      full CDP smoke passes again (`SMOKE OK`).
- [x] Secrets absent: `git check-ignore .env` and `git check-ignore docker/wpr/wpr-rocket.zip`
      both hit; `git status` clean with `.env` + zip in place; the harness/bootstrap
      never prints credential values (cookies are generated inside the containers).
- [x] Regular repo gates untouched and green (`pnpm compile`, `pnpm lint`,
      `pnpm format:check` — compose + fixture JS prettier-clean — `pnpm test` 426 tests,
      `pnpm build` + `check:budgets` all rows inside limits).
- [x] `docker/scripts/derive-conflicts.sh` re-runnable: the list regenerates from the
      committed DB on a fresh run (network probe included, retry/backoff on 429).

### Known limitations / notes for coming phases

- The bootstrap does NOT purge RUCSS used-CSS state (row-driven and stable across boots;
  a suite resets it explicitly when a scenario needs a cold RUCSS — `P13.1`).
- **RUCSS and Async-CSS cannot run live on this stack at all**: 3.23.5.1's license
  check (`Engine/License/Renewal.php::maybe_disable_option`, hooked on the option READ
  at `PHP_INT_MAX`) forces `get_rocket_option('remove_unused_css')` /
  `('async_css')` to 0 whenever the license is "expired more than 15 days" and the
  synthetic local key has NO expiration, so it always reads as expired. The option ROW
  is genuinely 1 (the baseline loop's patch lands) while the runtime read is 0 —
  observed on the live stack. The used-CSS queue also needs the WP Rocket license
  server, which never engages for a local key. Suites needing used-CSS/async-CSS
  behavior must fixture-simulate it — no toggle gets there (`P13`, flagged).
- The plugin's server-fetched dynamic lists (`dynamic-lists-*.json` in wp-rocket-config/)
  evolve server-side; every boot runs from whatever they contain. Byte-stable delay
  behavior across weeks is out of scope here; suites that need a pinned set can overwrite
  the relevant settings themselves (documented in the runbook's baseline table).
- mkcert HTTPS is documented, not exercised; P4.1/P4.3 suites only need HTTP today.
- The diagnoser slot (P7) is the commented-out mount in the compose file, same install
  path as the fixtures.
