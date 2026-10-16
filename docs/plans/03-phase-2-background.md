# Phase 2 — Background service worker

**Depends on:** P1. **Effort:** M. **Parallelizable with:** P3, P4.

## Goal

Port headers, KC updates, and menus with fixed defects, justified permissions, and handled failures. Keep `entrypoints/background/index.ts` thin; logic belongs in siblings or `lib/`.

## Legacy reference

- `entrypoints/background/index.ts` — wires `knownConflictsBackground()`, `new RequestInterceptor(['https://*/*','http://*/*']).listen()`, `setContextMenus(URLPatterns)`.
- `entrypoints/background/RequestInterceptor.ts` — `webRequest.onResponseStarted` (main_frame, responseHeaders) → `Map<tabId, headers>`; `tabs.onRemoved` → delete; serves `getPageHeaders`.
- `entrypoints/background/knownConflictsBackground.ts` — creates hourly alarm `update-known-conflicts-db` if missing; `onAlarm` + context-menu `updateKnownConflictsDB` trigger `updateKnownConflictsDB()`; fetch `https://mega.wp-rocket.me/support/kc/known-conflicts.json` → `knownConflictsStore.setValue` + meta `lastUpdate`. **Bug:** `updating` flag never resets on failure (master bug #1). Smells: the `onStartup` listener registers at import time (outside `defineBackground`), background init calls fire-and-forget, and every fetch failure (network / non-OK / invalid JSON) is laundered to one indistinguishable `null` (master #46).
- `entrypoints/background/setContextMenus.ts` — `removeAll()` then create 4 items (`wprSideBySide` all-contexts, `psiSideBySide` all-contexts, `exclusionBuilderPage` action-context, `updateKnownConflictsDB` action-context); `onInstalled` + `onStartup` recreate; click handler queries active tab and sends `openSideBySidePerformance`/`openSideBySide` to the tab's CS, or opens `exclusion-builder.html` (skipped when `tab.incognito`); `runtime.lastError` acknowledged in create callback. Two separate `onClicked` listeners exist (this file + `knownConflictsBackground`), and the click handler re-queries the active tab although the click event already carries the `tab` (master #45/#46 drivers).

## Tasks

### 1. `entrypoints/background/index.ts`

- [x] `defineBackground` (MV3 module default): register global `error`/`unhandledrejection` handlers first, then wire siblings inside `main()`, never at import (#46). Await/branch each init with independent guards and `lib/logger` cause logs, so one subsystem cannot disable another. Shipped seams: `bootBadge`, `bootDatabaseService`, guarded registrations.

### 2. `entrypoints/background/headers.ts`

- [x] Port RequestInterceptor as functions (no class needed): register `webRequest.onResponseStarted` filter `{ urls: ['http://*/*','https://*/*'], types: ['main_frame'] }`, `['responseHeaders']`; store per-tab headers with **cap (LRU, 100 tabs)** + `tabs.onRemoved` cleanup (master #20). The same listener notifies the badge manager (§5) on every main-frame response (navigation started → clear that tab's badge). Done — the listener body is the injected-deps unit `handleResponseStarted` (capture → `CachedTabHeaders`, badge clear); each half guarded on its own, so a failing step never blocks the other. Regression-tested to stay wired: a details object with `responseHeaders` must land retrievable in the cache (`headers.test.ts`).
- [x] Serve `getPageHeaders` with **no payload** — the background resolves the tab from `sender` (P1 contract: no spoofable tabId field); return `null` when unknown (the panel then omits the Server / Known Platform cards — legacy parity behavior, see P6). Ignore requests whose sender carries no numeric tabId (legacy `Map.get(undefined)`-ed on malformed senders — master #45).
- [ ] Manual: confirm header capture works with declared `host_permissions` on real navigations; document legacy-vs-new difference in this file's notes (master bug #2 / §1.2).
- [x] Unit-test the pure parts: LRU map behavior + header validation (validators from P1). Done — the cache suite (validation-entry, wholesale rejects, LRU eviction/recency, explicit forget) plus the listener-body suite (capture stored/retrievable, absent-headers reset, junk tab ids ignored, badge/capture decoupling both directions).

### 3. `entrypoints/background/known-conflicts.ts`

- [x] Alarm lifecycle: ensure alarm exists (periodInMinutes: 60), `onAlarm` filter by name, onStartup trigger. **Also port the KC context-menu click trigger:** legacy wires `updateKnownConflictsDB` inside `knownConflictsBackground.ts` (menu id `updateKnownConflictsDB` → direct function call); in the port the single `contextMenus.onClicked` handler in `context-menus.ts` calls `updateKnownConflictsDb()` for that id — one listener total (legacy had two). Done — one `onAlarm` name filter + one `onStartup`; the creation call passes only `periodInMinutes` (see shipped deltas: the cross-session persistence flag is a Chrome-150+ property and this manifest's floor is 145).
- [x] `updateKnownConflictsDb()`: single-flight **try/finally** reset (#1), `AbortSignal.timeout(10_000)`, `r.ok`, `parseKnownConflicts` validation. Failure leaves storage/meta untouched; success stamps `lastUpdate` (shipped key `updatedAt`, notes below). Log distinct `network-error`/`timeout`/`http-error`/`malformed-payload`/`invalid-payload`/`storage-error`, not undifferentiated null.
- [x] Initial seed: if storage is empty (first install), run one update immediately at startup (improvement: legacy shipped the embedded DB as fallback and waited up to an hour for freshness; we keep the embedded fallback **in this bundle only** via static import in background — content scripts never embed it, see P3). Serve `getKnownConflictsDb` (P1 protocol) from storage: if empty, trigger an update and return its result (background is the single owner of the DB bundle). Done — serve order stored → one refresh → embedded snapshot; boot seeds the snapshot when storage is empty and the refresh fails.
- [x] Unit tests: update logic with injected `fetch` (success, non-ok, malformed JSON, network error, timeout, single-flight race) — pure core extracted as `fetchAndStoreKnownConflicts(deps)` with injectable fetch/storage/clock; **plus the `getKnownConflictsDb` serve path** (storage hit returns cached; empty storage triggers update and returns its result). Done — both covered with distinct-outcome assertions.

### 4. `entrypoints/background/context-menus.ts`

- [x] Port all 4 menu items + recreate-on-installed/startup + `removeAll()` guard + `lastError` acknowledgment (parity with legacy's careful handling) — including the `documentUrlPatterns: ['http://*/*', 'https://*/*']` property on the three page-scoped items (parity: without it the menus would surface on chrome:// and store pages, a user-visible weakening). Done — the creation rows are a pure, exact-tested table (`menuCreateParams`): id/title/contexts/documentUrlPatterns pinned per entry.
- [x] Click handler: `openSideBySide` / `openSideBySidePerformance` messages targeted to the clicked tab (`sendMessage(type, undefined, tabId)`), with **real error handling** — if the CS is not there (chrome://, store pages), log + no-op visibly in console rather than swallowed catch (fixes master #3). Use the click event's own `tab` — no re-query (legacy's `tabs.query({ active, currentWindow })` approximated the SW's notion of the current window; master #45). Done — the dispatch decision surface (`dispatchMenuClickEvent`, injected effects) is table-tested: both channels with tab targeting, absent-CS branch resolves with a visible log, private-window skip, refresh trigger, tabless/foreign clicks ignored.
- [x] `exclusionBuilderPage`: skip incognito (parity), `browser.runtime.getURL('exclusion-builder.html')` + `tabs.create` — verify no `tabs` permission needed for `tabs.create` (it isn't; verification note here). Done — the dispatch hands the page path to the injected `openTab` glue, which does `getURL` + `tabs.create` (the only `tabs` use); the manifest carries no `tabs` permission and creation works (build + manual hook).

**Historical P16 forward note:** the proposed “Debug this tab as mobile” menu never shipped; [05e Feature B](./05e-phase-16-sbs-scroll-sync-device-simulation.md#feature-b--mobile-simulation-per-tab) records its supersession by overlay-only comparison (05g).

### 5. Toolbar action badge (new capability — master §8)

- [x] Receive `reportDetectionSummary` (P1 protocol): set the per-tab toolbar badge — green dot when `{ wprPresent, cached }` are both true, blue dot when `wprPresent`, clear otherwise (`browser.action.setBadge*({ tabId })`; no new permission). Done — sender-validated, malformed/tabless senders ignored and logged.
- [x] Clear a tab's badge on every `main_frame` `onResponseStarted` (navigation started — the headers.ts listener already fires; it notifies this module) and on `tabs.onRemoved`, so stale badges never survive navigation. Worst case (the CS never reports) the badge is transiently absent, never wrong. Done — the response half is the badge-clear step in `handleResponseStarted`; removal drops both cache rows and badge state.
- [x] Gate on `features.toolbarBadge` from `optionsStore`: read once at init + `optionsStore.watch` to apply P9's toggle without restart. Done — resolved after boot; unresolved/off gates render nothing, re-applies from recorded values on toggle.
- [x] Pure core (`entrypoints/background/badge.ts`): `badgeFor(summary | null): { text: string; color: string } | null` + the navigation/removed state machine — unit-tested; `browser.action` calls stay thin glue. Done — the state machine effect surfaces are the tests; `applyBadgeEffect` is the glue.

**Historical P16 forward note:** the proposed simulated badge mark never shipped; the same Feature B supersession owns that decision. Comparison state is visible in the overlay.

## Explicit enhancements over legacy

- Fix stuck-updater bug (#1); bounded header cache (#20); validated fetched DB (security); timeout on fetch (reliability); first-install seed (UX); real error propagation instead of `.catch(e => e)` (#3); embedded 45 KB JSON lives only in the background bundle.
- Toolbar action badge (new capability, master §8): WPR presence/caching at a glance per tab; sender-validated header serving (#45); click-event tab targeting (#45); awaited/branched init + global error handlers, no import-time listeners (#46).

## Tests

- `entrypoints/background/known-conflicts.test.ts` (pure core with injected deps — cover the 5 failure modes above).
- `entrypoints/background/headers.test.ts` (LRU + validators; webRequest listener wiring itself is entrypoint glue).
- `entrypoints/background/badge.test.ts` (pure core: summary → badge state, clear-on-navigation/removed, option-off → no badge).

## Verification checklist

- [x] Gates green.
- [x] `pnpm check:budgets` — background ≤ 25 KB raw (master §1.3; the shared KC-DB chunk is background-owned and counted separately). **Corrected measurement:** the fresh build measures 25,562 B = 24.96 KiB against the 25 KiB raw ceiling — a 38 B margin (the earlier "24.95 KiB / 52 B margin" claim was stale; recorded here as the real headroom). **Consequence: the next background addition must trim in kind** (or re-derive the row with committed reasoning, like P3's budget re-derivation). Shipped mechanism: the service-worker bundle is a single IIFE (WXT lib-mode build — no rollup chunking), so the embedded snapshot cannot ship as a JS chunk; it ships as a packaged asset emitted by the background build only (`assets/background.json`, byte-identical to `lib/known-conflicts/known-conflicts-db.json`), reached through a static `?url&no-inline` import (build-verified, no network path, never emitted into any other surface), read + validated before any use, once per worker. It is budgeted by a new dedicated row (asset 46.70 KB raw, ceiling 50) so the `background.js` row keeps measuring the worker's code only.
- [x] **P4.3 (2026-10-09) covers the site checklists below**, over the P4.2 stack through the P4.1 harness — record in `docs/plans/05d-phase-4-3-local-wp-suites.md`.
- [ ] Manual: menus appear after install **and** after reload — install leg automated (`boot-and-registry`); the reload leg runs via the harness's relaunch (`boot-and-registry`), so this row is automated. Remaining manual: "Update Known Conflicts Database" **menu-item click ergonomics** (the update flow itself is automatable via the serve path and is P4.3/Options-covered); `kill network → update fails, updating flag resets` — covered in spirit by the offline seed leg; the bounded in-flight flag reset stays unit-pinned.
- [x] Manual: navigate a real WP Rocket site → `getPageHeaders` returns headers — **P4.3** (`site-header-capture`: real responses → served row pairs, tab scoping, supersede, over-cap reject). The 120-tab LRU bound stays manual (recorded below).
- [x] Manual: Side-by-Side menu click on a chrome:// page — the open flow is message-driven over the same dispatch message (the fixture SBS suite + the site suites); only the actual right-click UX stays manual.
- [x] Manual badge (with P3 landed): cached → green / present-but-uncached → blue / non-WPR → gray; navigation supersede; the malformed-sender ignore — **P4.3** (`site-badge-pipeline`, `site-header-capture`); the `chrome://` clear covered live too.
- [ ] Manual: navigate 120 tabs in a test profile → cache bounded (memory shape; stays manual).

## Implementation notes (2026-10-07)

- The fetch-timestamp meta key is the shared storage contract's `updatedAt` (committed as `KnownConflictsMeta`); "lastUpdate" above refers to the same book-keeping, and the options-facing refresh result stays `{ updatedAt }` as the message contract declares.
- The shared storage item no longer embeds the snapshot as a reader-side fallback: a fresh/empty storage reads `null`, and the background's serve path supplies rows (stored → one refresh → embedded snapshot). This realizes the single-bundle ownership stated in the phase-1 doc; surfaces keep reading `knownConflictsStore` (null means "ask the background") plus messaging.

## Shipped deltas (2026-10-08 audit-fix pass)

- **Header capture was wired for real:** the `onResponseStarted` listener body is `handleResponseStarted` (injected cache + badge runtime) — the capture stores normalized validated rows per tab whenever `responseHeaders` arrives, resets the tab when it does not (absent headers may never leave the previous page's rows readable), ignores junk tab ids, and keeps the badge clear independent (each half in its own guard). The regression suite pin `headers.test.ts` fails if the store call is ever disconnected again.
- **Alarm creation dropped `persistAcrossSessions`:** that property is Chrome 150+ on a manifest whose floor is 145 — on 145–149 the `alarms.create` call rejects and the hourly alarm would never exist. Alarms persist by default where the browser supports it and the worker re-provisions the alarm on every start, so no behavior is lost (module TSDoc updated).
- **Boot steps decoupled:** `prime` now guards alarm provisioning and the boot-time seed/refresh independently — a rejected alarm step logs its own cause and the first-install seed still runs (and vice versa), never a blank subsystem from one cause.
- **Context menus:** the creation mapping (`menuCreateParams`) and the click dispatch (`dispatchMenuClickEvent` over injected `MenuClickDeps`) are testable pure functions; behavior is unchanged — the real `browser.*` calls (`sendMessage`, `getURL` + `tabs.create`, the `lastError` acknowledgment) remain thin glue.
- **Restart-safe badge clears (owner, 2026-10-08):** Chrome retains badges after SW memory resets; memory-only clears stranded old badges after navigation/off-gate. Navigation/absence clears now write unconditionally; off-gate `sweepRenderedBadges` queries all tab IDs with permission-free `tabs.query({})`. Re-pinned skipped-write tests: their memory-truth premise was false across restarts.
- **Logger tags aligned to the dominant convention** (bare module/feature names): `headers`, `known-conflicts`, `badge`, `context-menus` (the `background.headers` / `background.context-menus` dot forms were the outliers).
- **Uncaught-error reporting gets real details and attribution (owner-reported defect, 2026-10-08):** the
  worker-scope global handlers logged the event wrapper itself (`[object ErrorEvent]` on the
  extensions error page — no message, no stack, no location). They now log through the shared
  `lib/uncaught-errors.ts` (used by the isolated content script too, where the same line once
  claimed host-page errors): `error` events render the failure's own message with source/line and
  the raw error object; `unhandledrejection` renders the reason. In the content script, only
  errors sourced under the runtime URL prefix are claimed — the page's own broken scripts are the
  page's business (native reporting) and no longer pollute the extension's error page under our
  prefix.
- **One error-page entry per failure, not two (owner-reported follow-up, 2026-10-08):** the error
  page files our console.error lines AND the browser's native "Uncaught …"/"Uncaught (in promise)"
  record for the same failure, so one real defect — a stale mid-development content-script build
  (pre-dating 2026-10-08 17:51) reading the Priority Elements status map while it was null on
  wp-rocket.me (no beacon tag, ATF applied) — read as two entries and doubled the card's error
  count. Claiming an event now cancels the native record (`preventDefault` immediately after the
  attribution check passes; foreign events are skipped untouched, so page reporting still behaves
  natively) and carries the throw site's frames as a text detail — the frames only the cancelled
  native entry used to have. Reporting itself is hardened for its last-line role: the event
  payloads are cross-world readable, so stack/message reads capture once behind a hostile-getter
  guard and every listener body degrades a poisoned payload to one plain line instead of throwing
  out or claiming without reporting. The stale entries are fossils of the old build and clear with
  an extension reload + "Clear all" (verified after the fix: with preventDefault the native report
  leaves the pipeline entirely while our console.error lines still flow). Change confined to
  `lib/uncaught-errors.ts` (+ its pins). Budget rows hold without re-derivation: background 26.2 →
  26.5 KiB raw (budget 27), isolated 81.1 → 81.5 KiB raw / 28.8 gzip (budgets 85/30).
- **Background service-worker budget row 26 → 27 KiB raw** (deliberate, sanctioned path): the shared
  `lib/uncaught-errors.ts` module + its wiring landed in the worker bundle; measured 26.2 KiB raw
  (9.3 KiB gzip, no gzip row for this surface) after the badge rendering constants joined the
  bundle. Row at 27 gives the standard ~4 % headroom; the whole-build backstop (857) continues to
  cover the build ungameably.
- **Exclusion-builder incognito skip ditched (owner, 2026-10-08):** the §4 task's parity skip no
  longer ships — the context-menu entry opens the standalone builder page from private windows
  too. The historical text above still describes the legacy behavior; P10 is parked pending the
  owner's re-plan of the builder's UX.
- **Budget row raised deliberately 25 → 26 KiB** (`scripts/budgets.json`, via the gate's documented legitimate-breach path): the audit-mandated correctness work above restored ~500 B of genuinely used code — the previously-unwired capture path, independent boot guards, and the testable seams — measured at 26 073 B raw on the final build. The row's projection predates the audit fixes; the 26 KiB ceiling then guarded the surface (a doubled capture+menu tree breaches it), and the whole-build backstop is unchanged — superseded by the 26 → 27 KiB raise above. No behavior was cut to mask the delta.

**Browser-suite pointer (P4.1):** the context-menu registry's runtime state (ids exactly once after install **and** after extension reload, absence-controlled probes) is pinned by `tests/e2e/suites/boot-and-registry.spec.ts`; title/contexts/documentUrlPatterns stay unit-pinned (no runtime read-back). Shared-item context-menu routing (`reportDetectionSummary` → badge seam) rides the P3/P4 suites.

## Docs to update

AGENTS.md permissions table if any change vs P0 plan (none expected).
