# Phase 2 — Background service worker

**Depends on:** P1. **Effort:** M. **Parallelizable with:** P3, P4.

## Goal

Port the three background responsibilities (header capture, KC-DB updater, context menus) with the legacy bugs fixed, correct permissions, and defensive error handling. Thin `entrypoints/background/index.ts`; all logic in `entrypoints/background/` siblings or `lib/`.

## Legacy reference

- `entrypoints/background/index.ts` — wires `knownConflictsBackground()`, `new RequestInterceptor(['https://*/*','http://*/*']).listen()`, `setContextMenus(URLPatterns)`.
- `entrypoints/background/RequestInterceptor.ts` — `webRequest.onResponseStarted` (main_frame, responseHeaders) → `Map<tabId, headers>`; `tabs.onRemoved` → delete; serves `getPageHeaders`.
- `entrypoints/background/knownConflictsBackground.ts` — creates hourly alarm `update-known-conflicts-db` if missing; `onAlarm` + context-menu `updateKnownConflictsDB` trigger `updateKnownConflictsDB()`; fetch `https://mega.wp-rocket.me/support/kc/known-conflicts.json` → `knownConflictsStore.setValue` + meta `lastUpdate`. **Bug:** `updating` flag never resets on failure (master bug #1). Smells: the `onStartup` listener registers at import time (outside `defineBackground`), background init calls fire-and-forget, and every fetch failure (network / non-OK / invalid JSON) is laundered to one indistinguishable `null` (master #46).
- `entrypoints/background/setContextMenus.ts` — `removeAll()` then create 4 items (`wprSideBySide` all-contexts, `psiSideBySide` all-contexts, `exclusionBuilderPage` action-context, `updateKnownConflictsDB` action-context); `onInstalled` + `onStartup` recreate; click handler queries active tab and sends `openSideBySidePerformance`/`openSideBySide` to the tab's CS, or opens `exclusion-builder.html` (skipped when `tab.incognito`); `runtime.lastError` acknowledged in create callback. Two separate `onClicked` listeners exist (this file + `knownConflictsBackground`), and the click handler re-queries the active tab although the click event already carries the `tab` (master #45/#46 drivers).

## Tasks

### 1. `entrypoints/background/index.ts`

- [ ] `defineBackground(() => { ... })` (module type default in MV3) wiring the three modules; top-level `try/catch` per module init so one failing subsystem can't blank the others; structured logs via `lib/logger`. Every init call awaited/branched (legacy fired them un-awaited — master #46); global `error` + `unhandledrejection` handlers registered first (log + continue, per AGENTS.md); all listener registration inside `main()` (legacy registered `onStartup` at import time — master #46).

### 2. `entrypoints/background/headers.ts`

- [ ] Port RequestInterceptor as functions (no class needed): register `webRequest.onResponseStarted` filter `{ urls: ['http://*/*','https://*/*'], types: ['main_frame'] }`, `['responseHeaders']`; store per-tab headers with **cap (LRU, 100 tabs)** + `tabs.onRemoved` cleanup (master #20). The same listener notifies the badge manager (§5) on every main-frame response (navigation started → clear that tab's badge).
- [ ] Serve `getPageHeaders` with **no payload** — the background resolves the tab from `sender` (P1 contract: no spoofable tabId field); return `null` when unknown (the panel then omits the Server / Known Platform cards — legacy parity behavior, see P6). Ignore requests whose sender carries no numeric tabId (legacy `Map.get(undefined)`-ed on malformed senders — master #45).
- [ ] **Verification task:** confirm header capture works with declared `host_permissions` on real navigations; document legacy-vs-new difference in this file's notes (master bug #2 / §1.2).
- [ ] Unit-test the pure parts: LRU map behavior + header validation (validators from P1).

### 3. `entrypoints/background/known-conflicts.ts`

- [ ] Alarm lifecycle: ensure alarm exists (periodInMinutes: 60), `onAlarm` filter by name, onStartup trigger. **Also port the KC context-menu click trigger:** legacy wires `updateKnownConflictsDB` inside `knownConflictsBackground.ts` (menu id `updateKnownConflictsDB` → direct function call); in the port the single `contextMenus.onClicked` handler in `context-menus.ts` calls `updateKnownConflictsDb()` for that id — one listener total (legacy had two).
- [ ] `updateKnownConflictsDb()` rewritten: single-flight with **try/finally** reset (fixes master #1), fetch with `AbortSignal.timeout(10_000)`, `r.ok` check, JSON shape validation via `parseKnownConflicts` (P1) — invalid shape = failure, storage untouched, `lastUpdate` meta only on success; log outcome.
- [ ] Initial seed: if storage is empty (first install), run one update immediately at startup (improvement: legacy shipped the embedded DB as fallback and waited up to an hour for freshness; we keep the embedded fallback **in this bundle only** via static import in background — content scripts never embed it, see P3). Serve `getKnownConflictsDb` (P1 protocol) from storage: if empty, trigger an update and return its result (background is the single owner of the DB bundle).
- [ ] Unit tests: update logic with injected `fetch` (success, non-ok, malformed JSON, network error, timeout, single-flight race) — pure core extracted as `fetchAndStoreKnownConflicts(deps)` with injectable fetch/storage/clock; **plus the `getKnownConflictsDb` serve path** (storage hit returns cached; empty storage triggers update and returns its result).

### 4. `entrypoints/background/context-menus.ts`

- [ ] Port all 4 menu items + recreate-on-installed/startup + `removeAll()` guard + `lastError` acknowledgment (parity with legacy's careful handling) — including the `documentUrlPatterns: ['http://*/*', 'https://*/*']` property on the three page-scoped items (parity: without it the menus would surface on chrome:// and store pages, a user-visible weakening).
- [ ] Click handler: `openSideBySide` / `openSideBySidePerformance` messages targeted to the clicked tab (`sendMessage(type, undefined, tabId)`), with **real error handling** — if the CS is not there (chrome://, store pages), log + no-op visibly in console rather than swallowed catch (fixes master #3). Use the click event's own `tab` — no re-query (legacy's `tabs.query({ active, currentWindow })` approximated the SW's notion of the current window; master #45).
- [ ] `exclusionBuilderPage`: skip incognito (parity), `browser.runtime.getURL('exclusion-builder.html')` + `tabs.create` — verify no `tabs` permission needed for `tabs.create` (it isn't; verification note here).

### 5. Toolbar action badge (new capability — master §8)

- [ ] Receive `reportDetectionSummary` (P1 protocol): set the per-tab toolbar badge — green dot when `{ wprPresent, cached }` are both true, blue dot when `wprPresent`, clear otherwise (`browser.action.setBadge*({ tabId })`; no new permission).
- [ ] Clear a tab's badge on every `main_frame` `onResponseStarted` (navigation started — the headers.ts listener already fires; it notifies this module) and on `tabs.onRemoved`, so stale badges never survive navigation. Worst case (the CS never reports) the badge is transiently absent, never wrong.
- [ ] Gate on `features.toolbarBadge` from `optionsStore`: read once at init + `optionsStore.watch` to apply P9's toggle without restart.
- [ ] Pure core (`entrypoints/background/badge.ts`): `badgeFor(summary | null): { text: string; color: string } | null` + the navigation/removed state machine — unit-tested; `browser.action` calls stay thin glue.

## Explicit enhancements over legacy

- Fix stuck-updater bug (#1); bounded header cache (#20); validated fetched DB (security); timeout on fetch (reliability); first-install seed (UX); real error propagation instead of `.catch(e => e)` (#3); embedded 45 KB JSON lives only in the background bundle.
- Toolbar action badge (new capability, master §8): WPR presence/caching at a glance per tab; sender-validated header serving (#45); click-event tab targeting (#45); awaited/branched init + global error handlers, no import-time listeners (#46).

## Tests

- `entrypoints/background/known-conflicts.test.ts` (pure core with injected deps — cover the 5 failure modes above).
- `entrypoints/background/headers.test.ts` (LRU + validators; webRequest listener wiring itself is entrypoint glue).
- `entrypoints/background/badge.test.ts` (pure core: summary → badge state, clear-on-navigation/removed, option-off → no badge).

## Verification checklist

- [ ] Gates green.
- [ ] `pnpm check:budgets` — background ≤ 25 KB raw (master §1.3; the shared KC-DB chunk is background-owned and counted separately).
- [ ] Manual: load extension → menus appear after install **and** after reload (legacy's duplicate-id fix preserved); "Update Known Conflicts Database" works; `local:known-conflicts-db` populated with `lastUpdate` meta; kill network → update fails, `updating` flag demonstrably resets (second attempt works).
- [ ] Manual: navigate a real WP Rocket site → `getPageHeaders` returns headers (log line); navigate 120 tabs in a test profile or simulate → cache bounded.
- [ ] Side-by-Side menu click on a chrome:// page logs a clean error, no unhandled rejection.
- [ ] Manual badge (with P3 landed): cached WP Rocket page → green dot; present-but-uncached → blue dot; non-WPR page → none; navigating updates/clears it; `getPageHeaders` from a malformed sender (no tab) is ignored (unit test + log).

## Docs to update

AGENTS.md permissions table if any change vs P0 plan (none expected).
