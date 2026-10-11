# Phase 4.3 — Local-site browser suites (retroactive coverage of P2–P4)

**Depends on:** P4.1, P4.2. **Effort:** M. **Parallelizable with:** P5 implementation.

## TLDR

The WordPress-backed half of the retroactive test track: run P2–P4's real-site behaviors through the P4.1 harness against the P4.2 site — header capture on real responses, the badge pipeline, Known-Conflicts scans and DB flows over real plugin tables, the improvements entry on wp-admin, side-by-side on genuinely cached pages. Includes the permanent regression pin for the header-capture wiring the P2 audit caught (dead glue that no unit gate could see).

## Handover notes (2026-10-08 cross-phase audit; verified seams — P4.4/`X.Y` phases inherit them)

- **Add the site as a second `webServer`** (Playwright supports a `webServer` array — verified against the installed 1.64.0 types): command `docker/scripts/up.sh`, readiness URL `/fdt/` (exists only post-bootstrap — the site answers HTTP before fixtures exist), raised timeout (first full boot ≈ 4–5 min; converged ≈ 25 s); `reuseExistingServer` skips it when the stack is up.
- **Origin owning stays split**: suite helpers own `ORIGIN_A/B` in `tests/e2e/helpers/extension.ts` and never hardcode ports; read the site URL from `docker/.env` (`WPR_FDT_SITE_URL`) so docker remains the site's single declaring site. The manifest needs nothing — patterns are port-blind and already cover the site.
- **Auth**: one worker-scoped `wp-login.php` fixture; the cookie persists across the worker's tests and the reload leg (same profile dir). Credentials come from `docker/.env`, never printed.
- **`?e2e-tab` uncached trap**: `openFixturePage` stamps `?e2e-tab=N` and WP Rocket only caches params listed in `cache_query_strings` (`fdt-error`/`fdt-delay` in the baseline) — every stamped URL is uncached. Suite 6 (SBS on a _cached_ page) must navigate param-free flagged URLs directly.
- **Raise the worker fixture's 60 s timeout** when a suite group needs a real `docker/scripts/reset.sh` between groups (first boot is minutes); `workers:1` already serializes the run.
- **Offline-first-boot** (suite 3) via `browserContext.setOffline()` (present in the installed API); **`refreshFrame`'s cross-origin fallback** stays manual until a real PSI page (P14.6 reach); helpers already bound extension launches (30 s) — inherited by every `X.Y` suite.

## Suites (each names its assert source)

1. **Header capture — the permanent pin.** Navigate real pages (fixture + normal) → from the SW context request `getPageHeaders` → validated row pairs returned (P1 shape), tab-scoped; tabless/malformed senders ignored (assert from the SW side); a navigation clears/supersedes a tab's rows; `null` when the tab never produced headers.
2. **Badge pipeline.** Real processed page → `{wprPresent, cached}` summary push → `chrome.action.getBadgeText/BackgroundColor` per state (cached → green, present-but-uncached → blue, non-WPR → gray — the badge states every processed page) via CDP; navigation clears then re-sets; `features.toolbarBadge` flip in `sync:options` clears/shows without a service-worker restart.
3. **Known Conflicts over real rows.** `plugins.php` with preinstalled conflict plugins → badge count + list entries match the committed DB rows for those plugins; zero-finding page → the empty state after a settled scan; DB flow: empty storage → the serve path (ask) triggers a refresh and returns rows; a storage `watch` update re-scans an open page **without reload**; offline-first-boot → seed-into-storage path produces the snapshot rows unstamped.
4. **Data-hub on the real site.** `[WPR FDT] Page data processed in X ms` format; no page-content logging (console sweep: only the whitelisted, non-content lines); `rocket-allScriptsLoaded` window-event path flips the flag observable in the panels' absence via the log contract.
5. **Improvements on wp-admin.** Option on → the D-bugger admin-bar link appears; off (flip via storage + reload) → gone; idempotent on re-render (builds the node once).
6. **Side-by-Side on the real site.** Message-driven open on a cached page vs a `?nowprocket=1` visit → the two frames carry the correct URLs; close restores scroll; per-side refresh works (reload same-origin; `src` reassignment cross-origin variant). Context-menu _clicks_ and the psi-host flow stay in the manual row.

---

## Shipped (implementation record)

**Delivered all six suites** (`tests/e2e/suites/site-*.spec.ts`) over the P4.2 stack through the P4.1 harness, wired as the doc prescribed: the site booted as a **second `webServer`** (`docker/scripts/up.sh`, ready on `/fdt/`, seven-minute first-boot timeout, reuse-skips), the site URL read from `docker/.env` into `tests/e2e/helpers/site.ts` (falling back to the committed `.env.example`'s static values), and a worker-scoped `wp-login.php` fixture (`adminPage`) for the two admin suites. Commits: see `git log` on this phase's branch.

Build-order record of what each suite pinned, with the live-verified facts (probe-verified against the running stack; the browser-tier facts also live in `tests/e2e/README.md`):

| Suite                     | What it actually pins (assert sources named per assert)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site-header-capture`     | Real main-frame responses → served `pageHeaders` (the P2 BLOCKER re-run), P1 row-pair shape, tab scoping (two tabs both serve their own sets), navigation supersede driven by the real server (cache-served `/fdt/` carries no `Link` row; a WordPress-served uncached query brings them; the return drops them), the tabless sender (a popup page extension context) answered `{res: null}`, the over-cap header-flood fixture route `/__e2e/header-flood` (300 filler rows > the 256 cap) served `null` wholesale                                                                                                                                                        |
| `site-badge-pipeline`     | Green on a fresh-profile cache-served `/fdt/`, **blue** (`9-105-218`) on a first-hit cacheable flagged URL (unique `fdt-delay` value per run — the only real way to be present-but-uncached), gray on `?nowprocket=1` and on non-site pages, supersede green→blue→green on one tab, the `chrome://version` navigation clears and nothing re-sets, and the `features.toolbarBadge` sync:options flip sweeps all badges off and re-applies from the kept summaries **without a restart**                                                                                                                                                                                     |
| `site-known-conflicts`    | The settled full scan (60 findings → `9+`), the independent containment derivation (stored rows vs the page's own title cells), the corrected empty state on `plugins.php?plugin_status=active` (`: 0` + the corrected copy), the storage-write **no-reload rescan** proven by a crafted DB row that grows the findings, the serve path answering a popup-page ask with rows, and the offline first boot: a relaunch under a dead proxy for non-loopback hosts (`--proxy-server=http://127.0.0.1:9` + the bypass pair — launch-time, race-free) seeds the embedded snapshot **unstamped** (`known-conflicts-db$` has no `updatedAt`), then serves the scan with no network |
| `site-data-hub`           | The mandated timing line + analysis print on real optimized pages, the console whitelist (no un-whitelisted extension line, no page content or markup in our lines, no page-origin error on healthy optimized pages), the `rocket-allScriptsLoaded` flip after a real dispatched mousedown (the delay runtime waits for the first interaction), and the real site's scripted ReferenceError delivered through into `undefinedReferencesOnPage`                                                                                                                                                                                                                             |
| `site-improvements-admin` | The option-on entry exactly once with the derived admin-base href, option-off removed after a reload, restored on again (the real `sync:options` item written from the SW)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `site-side-by-side`       | The two frames' URL pair both ways (opened on the cached page and on a bypassed visit), the REAL cache-state truth read through each frame's own document (the footprint comment + delay markers in the cached frame, none in the bypassed), per-side refresh proven by document-identity (`performance.timeOrigin` changes only for the clicked side), and the close restoring overflow + scroll (the page is verified scrollable to ~600 px)                                                                                                                                                                                                                             |

Harness/driver changes this phase owns:

- **`server.mjs` gained the `/__e2e/header-flood` route** (a main frame with 300 filler header rows) — the deterministic over-cap reject case.
- **`tests/e2e/helpers/site.ts`**: the site env reader (fail-fast, never echoes), `openSitePage` (param-free navigation, exact-URL tab resolution with an ambiguity refusal — the `?e2e-tab` stamp would break cached-page truth), the wp-login flow, and the worker-scoped `adminPage` fixture.
- **`helpers/badge.ts`**: the shared badge-assert helpers (canonicalRgb, the poll profile, `readBadge`) — the fixture pipeline suite now imports them too.
- **The driver's `relaunch(extraArgs)`** (replacing `reloadViaRelaunch`) — the offline boot leg relaunches with launch-time network blockers.
- **The capture warm-up in the driver's launch**: verified 4/4 live, the very first main-frame response after a launch can race the service worker's first listener registration and its capture is lost; one throwaway local page after the worker event absorbs that window so every suite's pages capture deterministically.
- **The fixtures route test** hangs off the fixture server, and the suites close their own pages (same-URL site pages cannot collide).

Fixes this phase made in the extension itself (suite-caught, all verified green after):

- **Data hub (`entrypoints/isolated.content/data-hub.ts`): a `getFdtData` request racing the headers fetch served `pageHeaders: null` forever.** The once-flight fetch is now tracked and awaited by the serve path (`ensureHeaders`); the ask stays idempotent (the background's read never consumes rows), so a late ensure re-asks and receives the same set. This was invisible to every unit gate — the suites caught it live.
- Known Conflicts behavior confirmed unchanged against real data: scan findings **accumulate per surface** (a DB write re-scans the open page and the merged verdict grows; only a surface change clears) — the watch test is designed around that rule, not against it.
- The zero-finding empty state, the `9+` cap, the settled-wait, and the offline unstamped seed all matched the implementation exactly (no fixes needed there).

### Deviations and verified decisions

- **Per-group site resets honored structurally, not literally.** All six suites are read-only on the site (state lives in the browser profile, which the run owns), so nothing a suite does can order-depend on another group's site state; the suites that mutate _browser/profile_ state set it explicitly per test (options flips restore; the KC suite restores its DB rows). A `docker/scripts/reset.sh` between groups would burn minutes per file for zero effect — recorded here rather than building it.
- **The run's workers share one browser profile across consecutive files** (one launch ~35 s total for 36 tests). Consequently, cross-file state leakage is a real possibility — the suites now declare their own preconditions explicitly: the SBS suites clear the site's login cookies in a `beforeAll` (WP Rocket serves logged-in visitors plain pages — the cached-frame truth is invalid otherwise) and the two admin suites log in themselves; the KC offline test re-logins after the relaunch (the login cookie does not survive the close+relaunch in this Chromium build — verified).
- **The SBS cross-origin `src`-reassignment refresh stays manual** (a real PSI host is P14.6 reach) as the doc already listed; the site's frames are all same-origin, so the real-browser leg exercised is the reload path.
- **The badge's navigation-clear transient is not asserted at runtime**: the clear window sits between the response event and the summary push, unorderable from outside; the clear logic is unit-pinned (`headers.test.ts`) and the observable supersede + the nothing-re-sets `chrome://` clear are the two live legs here.

### Site/stack facts verified live during this phase

- **WP Rocket 304s revalidation**: revisits keep serving the same document, so within a profile each page's cache state is stable; a fresh profile's first `/fdt/` visit is cache-served (green), and any uncached first hit of a `cache_query_strings` param (unique `fdt-delay` value) is live-optimized (blue).
- **The plugin's `rocket-allScriptsLoaded` only dispatches after the first user interaction** when Delay JS is active (the runtime's own trigger list).
- **The committed DB snapshot scans to 60 findings on the real `plugins.php`** (badge `9+`); the active-only view scans to 0 → the corrected empty state.
- **The login cookie does not survive a close+relaunch** on the same profile in this Chromium build (verified: the relaunch lands on `wp-login.php` again).

## Definition of done

- All six suites green in `pnpm test:e2e` (site reset between groups so runs are order-independent).
- Every parent phase doc (03/04) records: "site checklists now covered by P4.3 suites for the named items; remainder manual".
- A rerun of the P2 audit's BLOCKER check (built worker calls the capture store) is deliberate here — the suite fails if the glue unwires again.

## Stays manual (recorded, from the parent checklists)

120-tab memory bound, HelpScout conversations, PSI production pages, context-menu click ergonomics, extension-reload-mid-page stale-capture behavior (CDP-driven reload remains feasible but is a stretch item — attempted last, recorded if flaky).
