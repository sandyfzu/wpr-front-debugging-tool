# Phase 3 — Isolated-world content scripts (data hub + 3 UI features)

**Depends on:** P1 (P2 optional for live headers; mocks until then). **Effort:** L. **Parallelizable with:** P2, P4.

## Goal

Port `isolatedWord.content.ts` and its four modules: the devtools data hub, page improvements, the Known Conflicts UI, and Side-by-Side. Content-script safety rules from AGENTS.md apply to everything here: wrap risky work, clean up via `ContentScriptContext`, never break the host page.

## Legacy reference

- `entrypoints/isolatedWord.content.ts` — `matches: http/https all`, `runAt: 'document_start'`, wires 4 modules.
- `content-scripts/devtoolsContentScript.ts` — see master §1.1. Key behaviors: HTML serialized at `DOMContentLoaded` (`new XMLSerializer().serializeToString(document)`), headers fetched from background, `notifyPanelReload` sent; on-demand processing (DOMParser on serialized HTML) via P1 engine; serves `getFdtData`/`getWprDetections`/`getDiagnoserData` (the last is receive-only-dead in legacy — registered, never sent; dropped in the port, master #43); relays error words (from window bridge) and `allScriptsLoaded` window event (`rocket-allScriptsLoaded`) to devtools; keeps the `⬇️ (Took: Xms)` timing log. The XMLSerializer snapshot runs on **every** http/https page (devtools open or not) and the multi-MB string is retained for the page lifetime (master #47).
- `content-scripts/improvements.ts` — option-gated D-bugger admin-bar entry.
- `content-scripts/known-conflicts/index.ts` — mode detection (`secure.helpscout.net/conversation/` → 'hs'; `/wp-admin/plugins.php` → 'wp'), shadow-DOM badge bottom-left (`z-index: 999999`), HS SPA rescan via debounced MutationObserver + URL-change tracking (clears list, re-creates UI), WP admin scan of `th.plugin-title.column-primary, td.plugin-title.column-primary` (legacy v2.2.5 fixed the selector for WordPress 7.x markup — port the fixed selector, not the pre-fix one), badge count `9+`, list items with name/summary/link, hide/show + list toggle transitions. HS rescan serializes + re-parses the **entire document** per 500 ms-debounced observer tick; the observer is never disconnected; `transitionend` listeners accumulate per click and containers stick under reduced-motion; the DB is read once at `document_start` (updates need a page reload); WP mode is one-shot at `load` (masters #48/#49 — the tasks below fix all of these).
- `content-scripts/sideBySide/index.ts` — overlay modal in shadow DOM; cached/bypassed iframes via `?nowprocket=1` toggling; refresh buttons per side; close restores saved `overflow` of html/body; PSI mode on `pagespeed.web.dev?wpr-sbs=<url>` auto-opens two analyses (close/refresh hidden there); context-menu `openSideBySidePerformance` opens `pagespeed.web.dev/?wpr-sbs=<site url>` in a new tab.

## Tasks

### 1. `entrypoints/isolated.content.ts`

- [ ] `defineContentScript({ matches: ['http://*/*','https://*/*'], runAt: 'document_start', main(ctx) { ... } })` wiring the four modules; each module receives `ctx` and registers cleanup via `ctx.onInvalidated`. **Forward note (second baseline, P12–P14):** this entrypoint later gains more colocated modules — the on-page inspector strip (P12) and the live-test executors (P13/P14) — keep the wiring registry-style (a list of `{ setup(ctx) }` modules), never positional one-off code, so every feature stays addable/deletable without touching siblings.

### 2. `lib/…` vs entrypoint placement decision (enforced here)

- [ ] Data hub is consumed by two surfaces conceptually (CS + devtools contract) — its _logic_ is pure in P1; the CS-specific glue (`entrypoints/isolated.content.ts` + a colocated `data-hub.ts` in the same folder since only this surface uses it) owns messaging listeners. Promote to `lib/` only if a second surface needs it (per AGENTS.md promotion rule).
- [ ] `data-hub.ts`:
  - [ ] `DOMContentLoaded` (plus a `document.readyState` guard for late injection): serialize HTML once, fetch headers via `getPageHeaders` (no payload — background resolves `sender`, per the P1 contract), send `notifyPanelReload` to devtools (best-effort; errors logged not swallowed).
  - [ ] Lazy processing exactly once (`processPageData` or first data request); result cached; processing wrapped in try/catch → returns `null` + error log (panel shows error state).
  - [ ] **Release the snapshot after processing (master #47):** drop the serialized `pageHTML` string once `dataProcessed` flips — results are cached, not the multi-MB source. The DOMContentLoaded capture itself stays: snapshot semantics are the feature (late DOM mutations must stay invisible).
  - [ ] **Detection summary push (master §8):** after a successful processing pass, best-effort `reportDetectionSummary` to the background (`{ wprPresent, cached }` — powers the P2 toolbar badge; logged, never fatal).
  - [ ] Listen `window` event `rocket-allScriptsLoaded` (parity) → flag + push to devtools.
  - [ ] Window-bridge receiver for error batches → validate (`parseErrorWords`) → append (cap 50) → push `undefinedReferencesUpdated` to devtools.
  - [ ] The timing log: same measurement as legacy, new format `[WPR FDT] Page data processed in X ms` (master §1.3 — benchmarks compare elapsed values, not strings). **Documented delta:** legacy's follow-up `console.log` of the full detections object (page content) is dropped per the no-page-content-logging rule (master §4.7).
  - [ ] All listeners (window events, bridge receivers) registered with `ctx.onInvalidated` cleanup.

### 3. `entrypoints/isolated.content.ts/improvements.ts`

- [ ] **Parity-only by explicit decision** (the smallest module in the extension: a one-shot, option-gated DOM injection of a static link — there is no honest improvement to make here beyond hygiene, and inventing one would be churn). Port: read `optionsStore` once; if enabled, on `load` (guarded for late injection) append `li#wp-admin-bar-d-bugger` with link `/wp-admin/tools.php?page=wprockettoolset` into `#wp-admin-bar-wp-rocket-default`; skip if already present or bar missing; DOM ops in try/catch; build the node with `createElement` + `textContent` instead of legacy's `innerHTML` (hygiene, not a behavioral change — the string is static); no listeners to clean (one-shot). Known legacy limitation (master #50) handled here: the link is root-relative and 404s on subdirectory WordPress installs — derive the admin path from the WPR admin-bar item's own link when it exposes one, else ship parity and record the decision in this file.

### 4. `entrypoints/isolated.content.ts/known-conflicts/` (UI rebuilt, behavior parity)

- [ ] Load DB: `knownConflictsStore.getValue()`; if empty → request seed from background via the `getKnownConflictsDb` protocol entry (background answers from storage or triggers an update — see P2) — **never embed the JSON here** (bundle budget). **Re-scan when the DB changes** (`knownConflictsStore.watch`) — legacy read the DB once at `document_start` and needed a page reload to see updates (master #48).
- [ ] Mode detection + scans: pure logic already in `lib/known-conflicts/match.ts`; this file owns: HS page text extraction (`.threads-container .messageBody table` fallback `.ThreadListItem table`) queried on the **live DOM** — parity of extracted text, minus legacy's serialize + re-parse of the entire document per 500 ms-debounced observer tick (repeated multi-MB work, master #48), WP plugin titles extraction (`th.plugin-title.column-primary, td.plugin-title.column-primary` — the legacy v2.2.5 fix for WordPress 7.x markup; fixtures cover both markups), SPA URL-change tracking, and a **bounded WP re-scan** (one delayed pass, cleaned up — legacy's one-shot `load` scan missed late-rendered plugin tables, master #48).
- [ ] Observer hygiene: one `MutationObserver` on `document.body` (HS mode only), debounced 500 ms (P0 util), **disconnected on `ctx.onInvalidated` and when leaving HS mode** (legacy leaked it).
- [ ] UI: rebuild with WXT `createShadowRootUi` + Solid (`components/` under the entrypoint folder, promoted if reused): fixed badge (bottom-left parity), badge count, slide-in list panel (Kobalte-free — plain Solid + CSS transitions), items rendered with `textContent`/`Show` (fixes master #13), links validated `isHttpUrl` and opened with `window.open(url, '_blank', 'noopener')` (fixes #12); hide button (`◂/▸` parity) and close button; `prefers-reduced-motion` respected. Palette rule (three-way appearance, owned by the P0 tokens + resolution util): correct in **both** palettes; resolve the stored appearance from `sync:options` (`appearance`: system default / dark / light) and set `[data-theme]` on the shadow-root container — `system` = no attribute → `prefers-color-scheme`. Open/close state changes never depend on `transitionend` — state is class-based and immediate, animation is decoration only (legacy accumulated a new `transitionend` listener per click and containers stuck `hidden` under reduced-motion — master #49).
- [ ] States: loading-until-DB-ready state (enhancement); an explicit "No known conflicts found…" empty state (enhancement — legacy ships one in its template but it is unreachable since the UI only renders when conflicts are found; keep it hidden-by-default exactly like legacy and only show when a scan completes with zero findings) — fixes the overlay's "No Know conflict found" typo (master #34).

### 5. `entrypoints/isolated.content.ts/side-by-side/` (UI rebuilt, behavior parity)

- [ ] Context-menu messages: `openSideBySide` opens the overlay (no-op if open — parity); `openSideBySidePerformance` builds `pagespeed.web.dev/?wpr-sbs=<site-url minus nowprocket/wpr-sbs>` and `window.open(..., '_blank', 'noopener')`; no-op on PSI host (parity). The PSI-host auto-open of the two analyses also carries `noopener` (legacy's `window.open` calls had none).
- [ ] Overlay via `createShadowRootUi` + Solid components: header bar with Cached/Not-cached labels + per-side refresh + close (SVG icons via `lucide-solid`, in-shadow styles — `splitShadowRootCss` exists in WXT but is **not** auto-imported; use an explicit import from `wxt/utils/split-shadow-root-css` or inject the style string, decided at build time); palette-correct via the same appearance rule as Known Conflicts above (both palettes, stored appearance → `[data-theme]` on the shadow-root container).
- [ ] URL logic (pure, in this folder or `lib/side-by-side/urls.ts` + tests): `getSiteUrls(siteUrl)` / `getPsiUrls(siteUrl)` parity with legacy incl. `nowprocket` presence/absence branching and `wpr-sbs` extraction on PSI host.
- [ ] Fix legacy #19: refresh via `iframe.contentWindow?.location.reload()` when same-origin-safe, else re-assign `src` (keep assignment fallback; document choice); open/close via CSS class transitions — state changes never depend on `transitionend` (guards: `{ once: true }` + fallback timeout; reduced-motion skips animation entirely — fixes master #49's stuck-container hazard; replaces legacy's `setTimeout(10)`/1 ms hacks); overflow save/restore exactly like legacy (html+body); re-open after close shows the previously loaded iframes (parity with legacy's `first` flag — do not reset `src` on close).
- [ ] Iframes `sandbox`/`credentialless` evaluation: **decision — do not sandbox** (the whole point is loading the real page authenticated); document why in TSDoc (security reviewer note).

## Explicit enhancements over legacy

- Observer/listener cleanup on invalidation (legacy leaked the HS observer and window listeners).
- KC DB fetched via background (−45 KB bundle), UI states (loading/empty), safe link handling, reduced-motion.
- Solid shadow-root UIs replace raw `innerHTML` templates; per-side refresh improved; no setTimeout animation hacks.
- All scan/URL logic extracted as pure tested functions (legacy was inline and untested).
- Live-DOM HS extraction, `storage.watch` KC re-scan, bounded WP re-scan (master #48); transition-independent open/close state (#49); snapshot released after processing (#47); v2.2.5 WP 7.x selector with both-markup fixtures; detection summary push feeds the toolbar badge (master §8); KC overlay typo fixed (#34).

## Tests

- `side-by-side/urls.test.ts` — cached/bypassed/PSI branches, `nowprocket` present/absent, `wpr-sbs` round-trip.
- `known-conflicts/extract.test.ts` — HS table extraction (both inbox layouts via fixtures), WP titles extraction (both markups — WP ≤6 `td`, 7.x `th`), live-DOM HS extraction equivalence vs the serialized pass on the same fixture, URL-mode detection, `storage.watch` re-scan trigger.
- Data hub: processing orchestration tested with P1 engine over fixtures (mock messaging via injected senders).

## Verification checklist

- [ ] Gates green + content-script bundle ≤ 60 KB raw / ≤ 20 KB gzip (budget table).
- [ ] Manual on WP Rocket test site: `[WPR FDT] Page data processed in X ms` log present; elapsed value ≥ 30 % faster than legacy's `Took:` log on the same page (record numbers).
- [ ] Manual HS conversation page: badge appears, count matches legacy on the same conversation; SPA navigation clears/re-scans; hide/show works; **loading state renders until the DB arrives and the empty state appears on a zero-finding scan** (the two UI-state enhancements); no console errors from observers after SPAs navigate.
- [ ] Manual plugins.php page: conflicts badge on a site with a known conflicting plugin (use the fixture DB entry).
- [ ] Manual side-by-side: overlay opens via context menu, both iframes correct (cached vs `?nowprocket=1`), refresh/close work, page scroll restored; PSI flow auto-opens with two analyses; context-menu PSI entry opens new tab.
- [ ] Manual: D-bugger entry appears on a WP admin page when option enabled; disappears when disabled.
- [ ] Manual (with P2): after the `[WPR FDT] Page data processed` log, the toolbar badge reflects WPR presence/cached for that tab; navigation clears/updates it; updating the KC DB (context menu or Options) re-scans an open HelpScout/plugins.php page without a reload.
- [ ] `pnpm dev:firefox` smoke: CS loads, no `chrome.*`-only calls.

## Docs to update

None beyond AGENTS.md if promotion to `lib/` happens (note it).
