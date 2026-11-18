# P22 post-release real-site verification

## TLDR

**Deferred until after the first store release** (owner 2026-11-17; replaces the pre-release P14.6 slot). Prove on a real, public, licensed WP Rocket site what the docker site, stubs and fixtures cannot: live PSI, the live RUCSS/beacon services, mobile cache, cache verdicts on a real host over HTTPS, the simulation on a real theme, real timing. P22A builds a separate local-only Playwright track for an external site (+ fixes the env-merge bug); P22B–P22H are one small suite each; P22I (CDN/host layers) waits for owner-provided requirements. Never CI. Manual owner verdicts stay manual.

## Context

- **Site:** owner-provided disposable site (nginx, PHP 8.3, WordPress beta — note the WP version in every receipt), WP Rocket latest stable with a real licence, page cache on. Access lives only in the git-ignored repo `.env`: `TEST_SITE_URL`, `TEST_SITE_USER`, `TEST_SITE_PASSWORD` (P22A adds the SSH host alias + WordPress path keys). Never print, log, screenshot or commit their values. WP-CLI runs over SSH **as the web server user** (`sudo -u www-data wp …`) so file ownership stays intact. Owner re-spawns the site if it breaks.
- **Not in P22 (stay manual / elsewhere):** visual judgments (same CSS by eye, themes), the authenticated HelpScout mailbox, real stable Chrome with DevTools open (infobar, prerender, bfcache), the DevTools availability policy → owner checklists; Firefox runtime → doc 17 + per-phase owner smokes.
- **Survivor sources** (what each suite closes): P16 [`completed-side-by-side.md`](./completed-side-by-side.md) l.71/73, [`completed-core.md`](./completed-core.md) l.141, [`completed-browser-infrastructure.md`](./completed-browser-infrastructure.md) l.45/46/74, P11 [`12-…`](./12-phase-11-detection-coverage.md) l.128/130/208/209, P13 O4/O7 [`14-…`](./14-phase-13-rucss-tester.md), P14 [`15-…`](./15-phase-14-live-analysis-tools.md) l.13/39, P14.5 [Open items](./15b-phase-14-5-coverage-and-tooling.md#open-items) (M4), P21 [`21-…`](./21-phase-21-wpr-simulation.md) l.504/506/604, [`completed-exclusion-builder.md`](./completed-exclusion-builder.md) l.106, [`tests/e2e/README.md`](../../tests/e2e/README.md) "Manual remainder". Each receipt ticks its source row.

## Stack

Installed tools only, no new dependency: `@playwright/test` (repo-pinned), headless Chromium + unpacked `pnpm build`, Node 24 (`.nvmrc`), system `ssh`, WP-CLI on the site. Re-check the installed Playwright API in `node_modules/` before use.

## Risks and mitigation

| Risk                                                           | Mitigation                                                                                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suites mutate a shared live site (options, tables, cache)      | Every suite: set → assert → **restore in `finally`** via WP-CLI, verified after restore; one site lock (`mkdir` lock like the e2e lock); suites run serially (`workers: 1`) |
| Secrets leak (env, cookies, licence)                           | Read env only in one helper; redact in errors/traces; traces/screenshots off by default for this track; `git check-ignore` asserted in setup                                |
| Live services flaky/slow (PSI, RUCSS queue, Google bot checks) | Bounded polling with explicit ceilings and named timeout outcomes; `retries: 1` for PSI only; a service-side failure is reported as "service unavailable", never a pass     |
| Load on WP Media / Google services                             | Minimal request count per run, documented; no loops; run on demand only                                                                                                     |
| Breaking the docker tier                                       | Separate config/project; docker suites and `site-baseline-setup` untouched (diff-proven); full docker `pnpm test:e2e` green after P22A                                      |
| Site drift (versions, beta WP)                                 | Setup prints WP Rocket + WP versions into the report; suites assert the WP Rocket version is a supported one                                                                |

## Order

P22A → P22B ∥ P22C ∥ P22D ∥ P22E ∥ P22F ∥ P22G ∥ P22H (implementation parallel; **execution serialized** on the one site). P22I after owner requirements. Same pipeline as every phase: worker → fresh adversarial audit → fixes → owner go → merge.

## P22A — External-site harness + env-merge fix

Depends: — (post-release). Parallel: —. Effort S, difficulty M.

- [ ] **Bug fix first:** `tests/e2e/helpers/site.ts` `readSiteEnv` spreads `.env.example` after `docker/.env`, so the committed defaults override a real `docker/.env` (its TSDoc says the reverse). Make `docker/.env` win, fall back to the example per key; unit-test both orders + missing key.
- [ ] New config `tests/e2e-external/playwright.config.ts` (or a separate project) + script `pnpm test:e2e:external`: no docker boot, no `site-baseline-setup`, `workers: 1`, extension fixture reused from `tests/e2e/helpers/extension.ts`.
- [ ] Env helper: reads `TEST_SITE_*` (+ new `TEST_SITE_SSH_HOST`, `TEST_SITE_WP_PATH`) from repo `.env`; fails fast naming the missing key, never its value.
- [ ] Remote WP-CLI helper: `ssh <host> sudo -u www-data wp --path=<path> …`, argument-array quoting (no shell interpolation of values), timeout, typed result; `withOption(name, value, fn)` set/restore + verify; `purgeCache()`; DB read helper (`wp db query`, read-only by default).
- [ ] Live-host opt-out: an explicit per-suite allow-list lifting `BLOCKED_REMOTE_HOSTS` (`helpers/blocked-hosts.ts`) (default stays blocked); add the known-conflicts DB host to the default block list (hygiene: it still reaches the network from docker e2e).
- [ ] Site lock + preflight: lock, version report (WP Rocket, WP), licence-present check (meta token, no value read), cache on.
- [ ] Test-only mu-plugin install/remove helper (same fixture flags the docker suites use: no-store, UA echo) — flags added to WP Rocket's cache query list on install, removed on teardown.
- DoD: `pnpm test:e2e:external` runs one smoke (site reachable, extension detects WP Rocket on the real home page); docker `pnpm test:e2e` unchanged and green; `tests/e2e/README.md` gains a short "External track" section; AGENTS.md Commands row.

## P22B — PSI live

Depends: P22A. Parallel: P22C–H (execution serial). Effort S, difficulty M.

- [ ] Real pagespeed.web.dev framing + auto-run for the site URL, both analyses open; no phone UA or device rule leaks into PSI (closes P16 l.71 PSI part/l.73 PSI, core l.141).
- [ ] Cross-origin SBS refresh fallback (`src` reassignment branch) on PSI.
- Edge: Google consent/bot challenge → named "service unavailable" outcome, not a failure of ours; 60 s ceiling per analysis.

## P22C — RUCSS live service + real RUCSS/Async CSS

Depends: P22A. Parallel: as P22B. Effort M, difficulty M.

- [ ] Tester vs live service (P13 O4 Chromium leg): multi-parameter address ends `%26<s>`, bare page `?<s>`, Mobile + Home, result matches the page; an answer slower than 30 s survives the keep-alive (a 404 page ≈ 54 s → `service-code` outcome). Note: an attached CDP session may itself keep the worker alive — record whether the owner must re-check with the SW inspector closed.
- [ ] O7 sheet-size comparison source build vs port (`helpers/source-build.ts`); visual sameness stays owner-manual.
- [ ] `remove_unused_css` / `async_css` on via `withOption`; poll the used-CSS queue (ceiling e.g. 20 min, then "queue not done" outcome); assert `style#wpr-usedcss` / meta tokens and the Detections cards + Stylesheets page on real output (closes infra l.45, P11 l.130).

## P22D — Beacon live

Depends: P22A. Parallel: as P22B. Effort M, difficulty M.

- [ ] Reset `wp_wpr_{above_the_fold,lazy_render_content,preload_fonts,preconnect_external_domains}` + purge; eligible viewports (desktop ≥ 1600×700, mobile ≤ 393×830, per core l.85-88); real visit POSTs → collecting → applied; separate mobile/desktop rows; Beacon tester (never POSTs) agrees with saved rows.
- [ ] Capture evidence of the fonts/preconnect sub-beacon results (P14 l.13/39). Whether to build a results UI = owner decision after the evidence.
- [ ] Optional: real `wp_is_mobile()` vs UA copy on nginx (P14.5.1 finding).

## P22E — Mobile cache + device simulation

Depends: P22A. Parallel: as P22B. Effort S, difficulty M.

- [ ] `cache_mobile` + `do_caching_mobile_files` on: SBS phone mode served the mobile copy (`wpr_mobile`), desktop the desktop copy; second tab keeps the real UA; close/navigation restores desktop identity; DNR session rule removed; cache files listed over SSH. UA byte-exact leg via the mu-plugin UA echo (closes P16 l.71/73).

## P22F — Cache/host verdicts on real nginx + HTTPS

Depends: P22A. Parallel: as P22B. Effort S, difficulty S.

- [ ] Footer stamp → Cached; first uncached optimized URL → not cached; bypass → "Bypass requested"; plain `server: nginx` invents no vendor in Host layers / Headers; header capture race absent over real TLS (closes P11 l.208 for nginx, infra l.46 HTTPS).
- Real CDN/proxy strip stays P22I.

## P22G — Simulation + Exclusion Builder on a real page

Depends: P22A. Parallel: as P22B. Effort M, difficulty H.

- [ ] Per feature (Delay, Defer, LazyLoad): WP Rocket ON page (real output) vs OFF page + our simulation — equal per the docker equality suites' comparison rules, on the real theme/plugin set; set/restore options; no-store guard via the mu-plugin.
- [ ] Real latest exclusion list online/offline (Chromium; lift that host for this suite only).
- [ ] `Network`-event cost of a session on a heavy real page (exclusion-builder l.106).
- Non-default plugin/content folder runtime URL only if the site has one; CDN variant → P22I.

## P22H — Real-page timing

Depends: P22A. Parallel: as P22B. Effort S, difficulty S.

- [ ] Source build vs port, ≥ 5 real loads each on the site: header capture, total page timing, absolute counts (core l.54/139, P15A timing row). Report medians; machine benchmark stays local.

## P22I — CDN and host layers (requirements pending)

Depends: owner provides the layers (Cloudflare proxy on a covered hostname, Sucuri; Varnish/LiteSpeed/SiteGround/Kinsta where available — never installed on the current server). Parallel: —. Effort M, difficulty M.

- [ ] M4: real Cloudflare (`cf-cache-status`, `cf-ray`, DYNAMIC), Sucuri, LiteSpeed, Varnish, SiteGround, `x-kinsta-cache` layer verdicts.
- [ ] A real stripped cache signature (CDN/optimizer strip).
- [ ] RocketCDN / CDN rows (P11 l.209; "CDN on but nothing rewritten" residual).
- [ ] LazyLoad simulation runtime URL served from a CDN (P21 P-2).
