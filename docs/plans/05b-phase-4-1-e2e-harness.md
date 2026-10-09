# Phase 4.1 — Browser-test harness + fixture-page suites (retroactive, next to implement)

**Depends on:** — (covers the implemented P0–P4 surfaces). **Effort:** M. **Parallelizable with:** P4.2, any P5+ implementation work.

## TLDR

Stand up the real-browser test tier: a Playwright harness that launches **headed Chromium with the unpacked extension loaded**, plus the first suite over static fixture pages. This is the automation floor every later `X.Y` test phase plugs into; browser-verifies P2–P4 behaviors that need no WordPress site.

## Goal

Convert the unsampled browser-checklist items ("manual" tiers of P2–P4) into repeatable local suites, so regressions of the P2/headers-capture class can never again pass every machine gate invisibly.

## Environment & convention (owner-set, 2026-10-08)

- Playwright (latest stable), **headed** Chromium, unpacked extension built by `pnpm build` (the suite refuses a stale build: rebuild or fail fast with the diff).
- `pnpm test:e2e` — **local-only, no CI lane**; unit/coverage stays the CI gate.
- Fixture pages live in `tests/e2e/fixtures/`, served over **two local origins** (`localhost` + `127.0.0.1`) so cross-origin script errors and SBS mechanics are real.
- Extension API states beyond page DOM are asserted from the **service worker context via CDP evaluate** (the documented drive surface when a flow has no page-DOM presence).
- Firefox has no harness (Playwright cannot load extensions in its Firefox build): per-phase Firefox items stay manual (`dev:firefox` smokes) — recorded per suite, never silently dropped.

## Suites (fixture-page reaches — assertable without a WP site)

1. **Boot & registry:** SW alive, the four context-menu entries exist exactly once after install **and** after reload; menus have the parity shapes from P2's table (id/title/contexts/documentUrlPatterns).
2. **Undefined-references capture (host safety + pipeline):** fixture page throws `ReferenceError: foo is not defined` after 2 s → the isolated side logs the validated batch (dev build debug log is the observable; panel pull-through completes in P6.1 once the panel exists); the page's own console output stays unchanged (no injected noise); a hostile `stack` getter and a malformed message cannot break it.
3. **Cross-origin sentinel:** a script from the second origin throws → the sentinel reaches the isolated receiver (immediate, not debounced) — the master-#21 resurrection, now asserted on every run.
4. **Side-by-Side mechanics:** message-driven open (harness messages the CS from the SW) on a fixture page → overlay in shadow DOM, both iframe `src`s match the URL rules, refresh behaves per origin, close restores `html`/`body` scroll exactly, re-open shows the previous frames; context-menu _clicks_ stay manual (browser-nested menus aren't Playwright-reachable) — recorded, not silently skipped.
5. **Processed-page pipeline:** on a fixture page with markers, the `[WPR FDT] Page data processed in X ms` log appears in the mandated format, followed by a best-effort summary push (observable at the SW/badge seam in P4.3's site rounds).

## Definition of done

- `pnpm test:e2e` runs the above green locally; suites reference only observable contracts (each assert names its source: log line, SW state, shadow-DOM probe).
- `pnpm compile && pnpm lint && pnpm format:check && pnpm test` still green; e2e artifacts (screenshots/streams) gitignored.
- `AGENTS.md` gets the new command + the no-CI lane rule; parent phase docs gain one line pointing here.
- A committed `tests/e2e/README.md` documents how to run, the CDP drive surface, and the manual remainder.

## Stays manual (recorded)

HelpScout/real-site flows (P4.3+), devtools-attached visuals, context-menu clicks, Firefox runtime — each named in the parent phase's checklist.

## Implementation record (2026-10-09)

**What shipped** (the automation floor every `X.Y` test phase plugs into):

- `pnpm test:e2e` → Playwright 1.64.0 (latest stable at install; devDependency, lockfile committed) over `tests/e2e/playwright.config.ts`: headed Chromium (bundled Chromium for Testing 156.0.8078.4, above the manifest's 145 floor) with the unpacked `.output/chrome-mv3` loaded. Local-only by rule — `.github/` untouched; AGENTS.md carries the command + the no-CI-lane rule.
- **Stale-build refusal** (`tests/e2e/global-setup.ts`): fingerprints every build input (`entrypoints/`, `components/`, `lib/`, `utils/`, `assets/`, `public/`, `wxt.config.ts`, `package.json`) against `tests/e2e/.build-stamp.json` (gitignored derived data); on mismatch it either rebuilds first (default) or fails fast printing the changed-file diff (`E2E_BUILD_STRICT=1`). All three paths verified live: skip (fresh), fail-with-diff, auto-rebuild-then-run.
- **Fixture server** (`tests/e2e/server.mjs`): one Node process on port 8891 serving `tests/e2e/fixtures/` over both `localhost` and `127.0.0.1` (distinct origins, one port; loopback-only bind — `127.0.0.1` + `::1`, verified unreachable from the machine's LAN address). A taken port fails with the port, the remedy, and the underlying `EADDRINUSE`. Every response `no-store` (every reload is a real network round-trip); the `__E2E_FRAME_TOKEN__` placeholder in any served `.html` is replaced per request (a page can prove its body is from the latest request); `/__e2e/health` for the runner's readiness; `/favicon.ico` answers 204 so fixture consoles stay clean error baselines.
- **The drive plane** (`tests/e2e/helpers/extension.ts`): `Worker.evaluate` into the extension service worker (Playwright exposes the MV3 background as a `Worker`; the handle survives Chromium's idle suspension); protocol rows sent from the SW in the library's wire shape (`{ id, type, data, timestamp }`, read from the installed `@webext-core/messaging` v4 dist — `getFdtData` pull-through, `openSideBySide`, …); duplicate-create menu probes with an absence control; profile relaunch helper.
- **Five suites, 12 tests, all green, repeatable** (3 consecutive full runs 9.0–9.6 s): boot & registry (3), cross-origin sentinel (1), processed-page pipeline (2), side-by-side mechanics (3), undefined-references capture (3).
- `tests/e2e/README.md` (committed): how to run, the SW drive plane, the manifest-API limitation, the manual remainder, environment facts.
- Vitest/Playwright disjointness: vitest `exclude` gained `tests/e2e/**` (`pnpm test` — 426 unit tests green, coverage thresholds hold); Playwright's `testDir`+`testMatch` (`**/*.spec.ts` under `tests/e2e/suites`) can never see the unit files.
- e2e artifacts (`test-results/`, `playwright-report/`, stamp) gitignored; `scripts/budgets.json` untouched (the tier adds no shipped bytes).

**Spec deviations (each verified, none silent):**

1. **Suite 2's "validated batch" observable.** The planned assert named a dev-build debug log that does not exist in the shipped code — the isolated receiver's validated path merges and pushes without logging (only the reject path logs). The suite asserts the stronger always-on production observable instead: the `getFdtData` pull-through (the panel's own protocol row, driven from the SW — the P6.1 pull mechanism without its rendering) plus the reject-path warning for the malformed fixture. No dev-build dependency.
2. **Menus: no runtime read-back.** `chrome.contextMenus.getAll` does not exist in Chromium (verified live against the installed build and committed `@types/chrome` — only `create/update/remove/removeAll/onClicked` exist). "Exists exactly once" is probed by duplicate-create semantics (a duplicate id is refused with the duplicate-id `lastError`; Chrome makes a second item with the same id impossible) with a scratch-id absence control proving the probe can answer "absent". The title/contexts/documentUrlPatterns parity shapes stay pinned by the P2 unit table (`context-menus.test.ts`, which pins `menuCreateParams` exactly) — the runtime cannot be read back, so this suite re-pins the id column only.
3. **The reload leg.** In this Chromium build (Chromium-for-Testing 156 via Playwright), `chrome.runtime.reload()` leaves any extension that declares content scripts unrecoverable: the extension vanishes from Chrome's own extension registry (`chrome://extensions-internals` no longer lists it), no SW target ever reappears, content scripts stop injecting on later navigations — and it is not about this extension's code or manifest (a 5-line extension with content scripts dies the same way; one WITHOUT content scripts revives instantly; every manifest field bisected — none is the cause). The harness's reload leg therefore closes the browser and relaunches on the SAME profile — the bundle re-registers over persistent extension-owned browser state, which is the checklist's actual question (the menu ids survive an extension reload exactly once, the duplicate-id fix preserved). The in-place `runtime.reload()` flow stays in the manual remainder (`tests/e2e/README.md`).
4. **Sentinel timing measurement.** "Immediate, not debounced" is page-clock self-measured: the fixture records the throw (`performance.now()`) and its window-bridge acknowledgment (`@webext-core/messaging/window/response` envelope); the harness reads the delta and asserts < 450 ms against the capture's 500 ms debounce. Cross-check measurement on the same build: **1.0 ms observed** (error event → receiver acknowledgment, page-local clocks). The cross-origin throw is deferred 800 ms so polling observes from a settled baseline.
5. **Badge colors at the SW seam.** The push observable is the `chrome.action` badge state: `●` over the transparent tile (`getBadgeBackgroundColor` `[0,0,0,0]`), the cached state's green vs the absence state's gray (`getBadgeTextColor` — the badge's own state contract, P2/P3 shipped decisions).

**Found issues:** none in the extension. Every failing assert during bring-up resolved to harness-side causes (a never-resolving probe promise in a helper, a mis-placed fixture marker vs the engine's real served layout, Playwright's `frameLocator` not piercing the shadow-DOM iframes' contents — replaced by the main-world shadow probe the user's own devtools would make). No `test.fixme` needed; the manual remainder is recorded above and in the README, not silently skipped.

**Harness-quirk notes for future `X.Y` suites:** `chrome.tabs.query` matches URLs literally (only `*` is special), so `openFixturePage` stamps each page with a unique `e2e-tab` query key; module-level state a fixture asserts must be page-scoped (workers run suites sequentially when `workers=1`).
