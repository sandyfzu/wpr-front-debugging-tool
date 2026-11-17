# Completed browser infrastructure: P4.1–P4.3

## TLDR

The local browser harness, Docker WordPress site and producer suites shipped 2026-10-08/09. Use [e2e README](../../tests/e2e/README.md) and [site runbook](../local-site-runbook.md) for current commands/settings; this record retains decisions, evidence and limitations, not duplicate operating instructions.

Dependencies at delivery: P4.1 covers implemented P0–P4 and ran parallel with independent P4.2; P4.3 requires both and could parallel P5. Browser suites remain **local-only, never CI** (owner decision). Future `X.1` coverage lives inside its feature plan and names each observable/assert source plus manual remainder.

## P4.1: harness

- Playwright persistent Chromium + unpacked production extension. Initially headed; **headless default since2026-10-11**, `E2E_HEADED=1` opts in. Chromium-for-Testing156 ran the suites; system Chrome154 ran Docker CDP smoke. They are separate engines, not interchangeable evidence. Headless shell cannot load extensions; profile seeds Developer Mode.
- Stale-build fingerprints cover extension inputs/config/package; rebuild default, `E2E_BUILD_STRICT=1` fail-with-diff, fresh skip all verified. Current build-stamp implementation/inputs live in tooling.
- Loopback fixture server8891 (`127.0.0.1`/`::1`) serves `localhost` and `127.0.0.1` as separate origins. No-store, per-request HTML token, health endpoint, favicon204, actionable port conflict. LAN isolation tested.
- SW/CDP drives typed protocol wire envelopes and browser state; shadow probes inspect injected DOM/frames. Extension launch is bounded30s with bundle path/remedy. Each fixture page has a unique `e2e-tab` key; module fixture state must stay page-scoped.
- Five suites/12 initial tests: boot/menu IDs; undefined capture with host safety/hostile payloads; immediate cross-origin sentinel; SBS URL/refresh/overflow/reopen mechanics; processed-page timing/summary→badge. Pull-through uses production `getFdtData`, not a nonexistent debug-log observable.
- Chromium has no `contextMenus.getAll`: duplicate-create refusals pin IDs, scratch-ID absence control validates the probe. Menu shapes remain exact unit assertions.
- Chromium156 `runtime.reload()` removed any content-script extension from its registry, reproduced with a minimal extension and bisected manifest. Harness relaunches the same profile instead. This proves persistent re-registration, **not in-place reload**; that remains manual.
- Sentinel throw→bridge-ack measured on one page clock:0.3–0.8ms across10 runs, assert<450ms vs500ms debounce. No cross-clock timing claim. SBS shadow iframe contents need main-world probes, not `frameLocator` assumptions.
- Unit/e2e discovery disjoint, artifacts ignored, no shipped bundle bytes. Nine full/repeat runs green. Adversarial sabotage (launch arg, thrower, URL, timing, badge, double reload, noise, malformed count, extra throw) made the intended assertions fail. Fixed loopback bind, launch hang and weak counts/body checks.

Limitations: Firefox Playwright cannot load the extension; attached DevTools visuals/context-menu clicks stay manual. SBS mount can acknowledge true after an inner logged mount failure, so tests independently assert rendered state. Cross-origin fallback refresh needs external/dual-origin coverage.

## P4.2: reproducible WordPress site

Delivered Compose WordPress+MariaDB+wp-cli, idempotent bootstrap, up/down/reset scripts, ignored credentials/plugin ZIP, mu-plugin fixtures, conflict-plugin derivation and zero-dependency raw-CDP smoke. Docker is the default site; [P22](./22-phase-22-post-release-real-site.md) (post-release) owns external-site scope.

Historical pins: WP Rocket3.23.5.1, `v3.23.5.1@8e89a59` built by apvm3.2.0; MariaDB11.8.9, WordPress7.1.3/php8.4, CLI2.12.0/php8.4. Read compose/env/runbook before rebuilding; the ZIP is never committed and bootstrap rejects a mismatched version.

Bootstrap converges from empty volumes: wait core/db; first-install core; pin site URLs/pretty permalinks; install/activate/check plugin; initialize valid local fixture state; seed settings through real admin context; force baseline; regenerate per-host config; create pages; install62 inactive conflict plugins; purge domain/minify. Site/CLI share fixture mount and uid33 writes. Loopback-only publish; secrets/cookies never logged. Down keeps volumes; reset removes site volumes and rebuilds. Full reset produced identical plugin/page/picked-setting state and a green smoke.

### Fixture contract

- `fdt-error=reference|reading|notfunction`: real named exceptions; bare exclusion stems survive minification because plugin matches full script markup.
- `fdt-delay=1`: real delayed scripts, no pre-interaction error; mousemove triggers missing dependency, benign sibling sets timestamp and execution marker. Runtime marks executed/failed-network/failed-transform/skipped.
- `nowprocket=1`: zero optimization footprint. `/fdt/` and `/fdt-beacon/`: real beacon/config and content candidates.
- P16 added uncached UA echo `/wp-json/fdt/v1/ua-echo` and `fdt-mobile-cache=1`; Priority Elements added fonts/OCI-off config arms. Runbook owns current flags.
- Planned `fdt-redirect=cross` was **never built**; one throwaway dual-origin probe is not permanent coverage.

### Facts that prevent misleading tests

- Activation alone caches but registers **no optimization subscribers** without a valid key. No localhost auto-activation in3.23.5.1. Local key formula and synthetic local-only state are implemented in `docker/bootstrap/activation.php`; constants in wp-config must win over plugin-root `licence-data.php`, whose defaults shadow DB-only edits. No real license credentials/server contacts are required for this fixture channel. This is a test environment, not production licensing advice.
- `wp_rocket_settings` initializes only after an admin-context request; CLI activation is not that context. Bootstrap performs an internal authenticated admin GET without exporting cookies.
- Only cache-query-allowed params get optimized/cached. Fixture flags must be listed. Pretty permalinks/config regeneration are necessary; plain permalinks silently bypass non-home caching. Cache disk path drops `:port` from host.
- No `wp rocket clean` command in this version; bootstrap calls `rocket_clean_domain()`/`rocket_clean_minify()`. Option patch `update` needs existing keys, new keys need insert, arrays need JSON format.
- **Live service RUCSS/Async-CSS cannot run with this synthetic key**: renewal's last-priority read filter treats missing expiration as expired>15d and forces runtime options0 even if DB row1; used-CSS queue needs license service. P11/P13 must fixture-simulate or use an authorized external site, never call a toggle sufficient proof.
- RUCSS tables are not reset at each bootstrap; suites needing cold state reset explicitly. Server dynamic lists can drift across weeks; pin scenario-specific settings when needed. HTTPS/mkcert documented but untested. Rebuilt Diagnoser plugin slot remains empty until P7.

### Conflict derivation

Committed DB grew to175 rows (155 Plugin) at `8893f0a`; later derivation recorded136 eligible plugin rows→62 deduped installable slugs (60 direct/2 aliases). Counts are historical, regenerate from current data.

Pipeline: Plugin row→normalized pattern slug→open wp.org listing→advertised name contains DB name case-insensitively→dedupe. Vendor-verified aliases `seo-by-rank-math`/`consenta-se` undergo the same checks and were live-installed/title-verified. Rejected `sv-provenexpert` (installed spelling fails containment) and unrelated name lookalikes; no fabricated matches.62 install inactive so they do not change front-end fixtures.60 installed titles matched; WP Ghost Lite/WooCommerce Stripe Gateway had vendor-rename drift despite API-name checks, so scanner expectation is60, not62. Derivation retries429 and reports drops/install failures explicitly.

## P4.3: real-site producer suites

Six `site-*.spec.ts` suites shipped; three consecutive full green runs closed the phase. Assertions:

1. `site-header-capture`: real response→served row pairs, two-tab isolation, `Link` supersede, tabless null,300-header fixture rejected against256 cap. Permanent P2 listener-wiring blocker pin.
2. `site-badge-pipeline`: cached green; first uncached but optimized cache-query URL blue; bypass/plain gray; supersede; chrome-page clear; setting off/on sweeps/restores without worker restart. Unobservable between-event clear transient remains unit-pinned, not claimed as a browser assertion.
3. `site-known-conflicts`: independent DB/title derivation60→badge9+, active-only0/empty copy, storage watch grows findings without reload, serve path, offline first boot seeded **without `updatedAt`**.
4. `site-data-hub`: timing+analysis whitelist/no page content, real Delay interaction→scripts-loaded, real ReferenceError in FDT data.
5. `site-improvements-admin`: exactly one derived-link entry; setting off/on after reload.
6. `site-side-by-side`: cached/bypass pair in both launch directions, real cache comment/Delay markers, clicked-frame-only time-origin change, exact overflow+scroll restoration.

Integration decisions:

- Second Playwright webServer boots Docker, readiness `/fdt/` (not early HTTP), seven-minute first-boot timeout/reuse. Site URL/credentials read from Docker env, never hardcoded/logged. Param-free site helper refuses ambiguous tab matches; fixture helper's `e2e-tab` would invalidate cached-page assertions.
- One shared browser profile/workers1 means explicit state preconditions: admin suites log in, SBS clears login cookies, mutations restore options/DB. Login did **not** survive relaunch on this Chromium build; offline leg logs in again. Read-only site suites need no minutes-long reset between files; mutating future suites must reset what they own.
- Offline first boot uses launch-time dead non-loopback proxy, not a later offline toggle that races seed fetch. Header capture's first-launch listener race uses a throwaway warmup navigation.
- Suite caught/fixed real extension defect: data requests racing initial headers fetch permanently returned null. Tracked/awaited `ensureHeaders` now closes it. Tests were not weakened to conceal it.

## Open/manual remainder

In-place extension reload/mid-page stale context;120-tab memory exercise; authenticated HelpScout; context-menu clicks; PSI production/redirect refresh; real baseline timing; Firefox runtime; HTTPS. P16 additionally retains permanent cross-origin-sync/UA-copy gaps in its record. Do not count same-origin reload tests as cross-origin fallback evidence.
