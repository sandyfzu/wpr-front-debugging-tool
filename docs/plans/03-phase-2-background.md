# Phase 2 — Background service worker

**Depends on:** P1. **Effort:** M. **Parallelizable with:** P3, P4.

## Goal

Port the three background responsibilities (header capture, KC-DB updater, context menus) with the legacy bugs fixed, correct permissions, and defensive error handling. Thin `entrypoints/background/index.ts`; all logic in `entrypoints/background/` siblings or `lib/`.

## Legacy reference

- `entrypoints/background/index.ts` — wires `knownConflictsBackground()`, `new RequestInterceptor(['https://*/*','http://*/*']).listen()`, `setContextMenus(URLPatterns)`.
- `entrypoints/background/RequestInterceptor.ts` — `webRequest.onResponseStarted` (main_frame, responseHeaders) → `Map<tabId, headers>`; `tabs.onRemoved` → delete; serves `getPageHeaders`.
- `entrypoints/background/knownConflictsBackground.ts` — creates hourly alarm `update-known-conflicts-db` if missing; `onAlarm` + context-menu `updateKnownConflictsDB` trigger `updateKnownConflictsDB()`; fetch `https://mega.wp-rocket.me/support/kc/known-conflicts.json` → `knownConflictsStore.setValue` + meta `lastUpdate`. **Bug:** `updating` flag never resets on failure (master bug #1).
- `entrypoints/background/setContextMenus.ts` — `removeAll()` then create 4 items (`wprSideBySide` all-contexts, `psiSideBySide` all-contexts, `exclusionBuilderPage` action-context, `updateKnownConflictsDB` action-context); `onInstalled` + `onStartup` recreate; click handler queries active tab and sends `openSideBySidePerformance`/`openSideBySide` to the tab's CS, or opens `exclusion-builder.html` (skipped when `tab.incognito`); `runtime.lastError` acknowledged in create callback.

## Tasks

### 1. `entrypoints/background/index.ts`

- [ ] `defineBackground(() => { ... })` (module type default in MV3) wiring the three modules; top-level `try/catch` per module init so one failing subsystem can't blank the others; structured logs via `lib/logger`.

### 2. `entrypoints/background/headers.ts`

- [ ] Port RequestInterceptor as functions (no class needed): register `webRequest.onResponseStarted` filter `{ urls: ['http://*/*','https://*/*'], types: ['main_frame'] }`, `['responseHeaders']`; store per-tab headers with **cap (LRU, 100 tabs)** + `tabs.onRemoved` cleanup (master #20).
- [ ] Serve `getPageHeaders` with **no payload** — the background resolves the tab from `sender` (P1 contract: no spoofable tabId field); return `null` when unknown (the panel then omits the Server / Known Platform cards — legacy parity behavior, see P6).
- [ ] **Verification task:** confirm header capture works with declared `host_permissions` on real navigations; document legacy-vs-new difference in this file's notes (master bug #2 / §1.2).
- [ ] Unit-test the pure parts: LRU map behavior + header validation (validators from P1).

### 3. `entrypoints/background/known-conflicts.ts`

- [ ] Alarm lifecycle: ensure alarm exists (periodInMinutes: 60), `onAlarm` filter by name, onStartup trigger. **Also port the KC context-menu click trigger:** legacy wires `updateKnownConflictsDB` inside `knownConflictsBackground.ts` (menu id `updateKnownConflictsDB` → direct function call); in the port the single `contextMenus.onClicked` handler in `context-menus.ts` calls `updateKnownConflictsDb()` for that id — one listener total (legacy had two).
- [ ] `updateKnownConflictsDb()` rewritten: single-flight with **try/finally** reset (fixes master #1), fetch with `AbortSignal.timeout(10_000)`, `r.ok` check, JSON shape validation via `parseKnownConflicts` (P1) — invalid shape = failure, storage untouched, `lastUpdate` meta only on success; log outcome.
- [ ] Initial seed: if storage is empty (first install), run one update immediately at startup (improvement: legacy shipped the embedded DB as fallback and waited up to an hour for freshness; we keep the embedded fallback **in this bundle only** via static import in background — content scripts never embed it, see P3). Serve `knownConflictsDbRequest` from P1's protocol: return storage value; if empty, trigger an update and return its result (background is the single owner of the DB bundle).
- [ ] Unit tests: update logic with injected `fetch` (success, non-ok, malformed JSON, network error, timeout, single-flight race) — pure core extracted as `fetchAndStoreKnownConflicts(deps)` with injectable fetch/storage/clock; **plus the `knownConflictsDbRequest` serve path** (storage hit returns cached; empty storage triggers update and returns its result).

### 4. `entrypoints/background/context-menus.ts`

- [ ] Port all 4 menu items + recreate-on-installed/startup + `removeAll()` guard + `lastError` acknowledgment (parity with legacy's careful handling) — including the `documentUrlPatterns: ['http://*/*', 'https://*/*']` property on the three page-scoped items (parity: without it the menus would surface on chrome:// and store pages, a user-visible weakening).
- [ ] Click handler: `openSideBySide` / `openSideBySidePerformance` messages targeted to the clicked tab (`sendMessage(type, undefined, tabId)`), with **real error handling** — if the CS is not there (chrome://, store pages), log + no-op visibly in console rather than swallowed catch (fixes master #3).
- [ ] `exclusionBuilderPage`: skip incognito (parity), `browser.runtime.getURL('exclusion-builder.html')` + `tabs.create` — verify no `tabs` permission needed for `tabs.create` (it isn't; verification note here).

## Explicit enhancements over legacy

- Fix stuck-updater bug (#1); bounded header cache (#20); validated fetched DB (security); timeout on fetch (reliability); first-install seed (UX); real error propagation instead of `.catch(e => e)` (#3); embedded 45 KB JSON lives only in the background bundle.

## Tests

- `entrypoints/background/known-conflicts.test.ts` (pure core with injected deps — cover the 5 failure modes above).
- `entrypoints/background/headers.test.ts` (LRU + validators; webRequest listener wiring itself is entrypoint glue).

## Verification checklist

- [ ] Gates green.
- [ ] `pnpm check:budgets` — background ≤ 25 KB raw (master §1.3; the shared KC-DB chunk is background-owned and counted separately).
- [ ] Manual: load extension → menus appear after install **and** after reload (legacy's duplicate-id fix preserved); "Update Known Conflicts Database" works; `local:known-conflicts-db` populated with `lastUpdate` meta; kill network → update fails, `updating` flag demonstrably resets (second attempt works).
- [ ] Manual: navigate a real WP Rocket site → `getPageHeaders` returns headers (log line); navigate 120 tabs in a test profile or simulate → cache bounded.
- [ ] Side-by-Side menu click on a chrome:// page logs a clean error, no unhandled rejection.

## Docs to update

CLAUDE.md permissions table if any change vs P0 plan (none expected).
