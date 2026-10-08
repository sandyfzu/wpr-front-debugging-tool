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

- [x] `defineContentScript({ matches: ['http://*/*','https://*/*'], runAt: 'document_start', main(ctx) { ... } })` wiring the four modules; each module receives `ctx` and registers cleanup via `ctx.onInvalidated`. **Forward note (second baseline, P12–P14):** this entrypoint later gains more colocated modules — the on-page inspector strip (P12) and the live-test executors (P13/P14) — keep the wiring registry-style (a list of `{ setup(ctx) }` modules), never positional one-off code, so every feature stays addable/deletable without touching siblings.

### 2. `lib/…` vs entrypoint placement decision (enforced here)

- [x] Data hub is consumed by two surfaces conceptually (CS + devtools contract) — its _logic_ is pure in P1; the CS-specific glue (`entrypoints/isolated.content.ts` + a colocated `data-hub.ts` in the same folder since only this surface uses it) owns messaging listeners. Promote to `lib/` only if a second surface needs it (per AGENTS.md promotion rule).
- [x] `data-hub.ts`:
  - [x] `DOMContentLoaded` (plus a `document.readyState` guard for late injection): serialize HTML once, fetch headers via `getPageHeaders` (no payload — background resolves `sender`, per the P1 contract), send `notifyPanelReload` to devtools (best-effort; errors logged not swallowed).
  - [x] Lazy processing exactly once (`processPageData` or first data request); result cached; processing wrapped in try/catch → returns `null` + error log (panel shows error state).
  - [x] **Release the snapshot after processing (master #47):** drop the serialized `pageHTML` string once `dataProcessed` flips — results are cached, not the multi-MB source. The DOMContentLoaded capture itself stays: snapshot semantics are the feature (late DOM mutations must stay invisible).
  - [x] **Detection summary push (master §8):** after a successful processing pass, best-effort `reportDetectionSummary` to the background (`{ wprPresent, cached }` — powers the P2 toolbar badge; logged, never fatal).
  - [x] Listen `window` event `rocket-allScriptsLoaded` (parity) → flag + push to devtools.
  - [x] Window-bridge receiver for error batches → validate (`parseErrorWords`) → append (cap 50) → push `undefinedReferencesUpdated` to devtools.
  - [x] The timing log: same measurement as legacy, new format `[WPR FDT] Page data processed in X ms` (master §1.3 — benchmarks compare elapsed values, not strings). **Documented delta:** legacy's follow-up `console.log` of the full detections object (page content) is dropped per the no-page-content-logging rule (master §4.7).
  - [x] All listeners (window events, bridge receivers) registered with `ctx.onInvalidated` cleanup.

### 3. `entrypoints/isolated.content.ts/improvements.ts`

- [x] **Parity-only by explicit decision** (the smallest module in the extension: a one-shot, option-gated DOM injection of a static link — there is no honest improvement to make here beyond hygiene, and inventing one would be churn). Port: read `optionsStore` once; if enabled, on `load` (guarded for late injection) append `li#wp-admin-bar-d-bugger` with link `/wp-admin/tools.php?page=wprockettoolset` into `#wp-admin-bar-wp-rocket-default`; skip if already present or bar missing; DOM ops in try/catch; build the node with `createElement` + `textContent` instead of legacy's `innerHTML` (hygiene, not a behavioral change — the string is static); no listeners to clean (one-shot). Known legacy limitation (master #50) handled here: the link is root-relative and 404s on subdirectory WordPress installs — derive the admin path from the WPR admin-bar item's own link when it exposes one, else ship parity and record the decision in this file.

### 4. `entrypoints/isolated.content.ts/known-conflicts/` (UI rebuilt, behavior parity)

- [x] Load DB: `knownConflictsStore.getValue()`; if empty → request seed from background via the `getKnownConflictsDb` protocol entry (background answers from storage or triggers an update — see P2) — **never embed the JSON here** (bundle budget). **Re-scan when the DB changes** (`knownConflictsStore.watch`) — legacy read the DB once at `document_start` and needed a page reload to see updates (master #48).
- [x] Mode detection + scans: pure logic already in `lib/known-conflicts/match.ts`; this file owns: HS page text extraction (`.threads-container .messageBody table` fallback `.ThreadListItem table`) queried on the **live DOM** — parity of extracted text, minus legacy's serialize + re-parse of the entire document per 500 ms-debounced observer tick (repeated multi-MB work, master #48), WP plugin titles extraction (`th.plugin-title.column-primary, td.plugin-title.column-primary` — the legacy v2.2.5 fix for WordPress 7.x markup; fixtures cover both markups), SPA URL-change tracking, and a **bounded WP re-scan** (one delayed pass, cleaned up — legacy's one-shot `load` scan missed late-rendered plugin tables, master #48).
- [x] Observer hygiene: one `MutationObserver` on `document.body` (HS mode only), debounced 500 ms (P0 util), **disconnected on `ctx.onInvalidated` and when leaving HS mode** (legacy leaked it).
- [x] UI: rebuilt with WXT `createShadowRootUi` + Solid (`components/` under the entrypoint folder, promoted if reused): fixed badge (bottom-left parity), badge count, slide-in list panel (Kobalte-free — plain Solid + CSS transitions), items rendered with `textContent`/`Show` (fixes master #13), links validated `isHttpUrl` and opened with `window.open(url, '_blank', 'noopener')` (fixes #12); hide button (`◂/▸` parity) and close button; `prefers-reduced-motion` respected. Palette rule (three-way appearance, owned by the P0 tokens + resolution util): correct in **both** palettes; resolve the stored appearance from `sync:options` (`appearance`: system default / dark / light) and set `[data-theme]` on the shadow-root container — `system` = no attribute → `prefers-color-scheme`. Open/close state changes never depend on `transitionend` — state is class-based and immediate, animation is decoration only (legacy accumulated a new `transitionend` listener per click and containers stuck `hidden` under reduced-motion — master #49).
- [x] States: loading-until-DB-ready state (enhancement); an explicit "No known conflicts found…" empty state (enhancement — legacy ships one in its template but it is unreachable since the UI only renders when conflicts are found; keep it hidden-by-default exactly like legacy and only show when a scan completes with zero findings) — fixes the overlay's "No Know conflict found" typo (master #34).

### 5. `entrypoints/isolated.content.ts/side-by-side/` (UI rebuilt, behavior parity)

- [x] Context-menu messages: `openSideBySide` opens the overlay (no-op if open — parity); `openSideBySidePerformance` builds `pagespeed.web.dev/?wpr-sbs=<site-url minus nowprocket/wpr-sbs>` and `window.open(..., '_blank', 'noopener')`; no-op on PSI host (parity). The PSI-host auto-open of the two analyses also carries `noopener` (legacy's `window.open` calls had none).
- [x] Overlay via `createShadowRootUi` + Solid components: header bar with Cached/Not-cached labels + per-side refresh + close (SVG icons via `lucide-solid`, in-shadow styles — `splitShadowRootCss` exists in WXT but is **not** auto-imported; use an explicit import from `wxt/utils/split-shadow-root-css` or inject the style string, decided at build time); palette-correct via the same appearance rule as Known Conflicts above (both palettes, stored appearance → `[data-theme]` on the shadow-root container).
- [x] URL logic (pure, in this folder or `lib/side-by-side/urls.ts` + tests): `getSiteUrls(siteUrl)` / `getPsiUrls(siteUrl)` parity with legacy incl. `nowprocket` presence/absence branching and `wpr-sbs` extraction on PSI host.
- [x] Refresh fix (#19): via `iframe.contentWindow?.location.reload()` when same-origin-safe, else re-assign `src` (keep assignment fallback; document choice); open/close via CSS class transitions — state changes never depend on `transitionend` (guards: `{ once: true }` + fallback timeout; reduced-motion skips animation entirely — fixes master #49's stuck-container hazard; replaces legacy's `setTimeout(10)`/1 ms hacks); overflow save/restore exactly like legacy (html+body); re-open after close shows the previously loaded iframes (parity with legacy's `first` flag — do not reset `src` on close).
- [x] Iframes `sandbox`/`credentialless` evaluation: **decision — do not sandbox** (the whole point is loading the real page authenticated); document why in TSDoc (security reviewer note).

**Forward note (P16):** the overlay's scroll-sync toggle and the header chip for an active mobile simulation land in P16 (`lib/side-by-side/scroll-sync.ts` engine + the device-sim relay, budgets re-checked there) — no rework in this phase; P16's doc owns placement, mechanism and tests.

## Explicit enhancements over legacy

- Observer/listener cleanup on invalidation (legacy leaked the HS observer and window listeners).
- KC DB fetched via background (−45 KB bundle), UI states (loading/empty), safe link handling, reduced-motion.
- Solid shadow-root UIs replace raw `innerHTML` templates; per-side refresh improved; no setTimeout animation hacks.
- All scan/URL logic extracted as pure tested functions (legacy was inline and untested).
- Live-DOM HS extraction, `storage.watch` KC re-scan, bounded WP re-scan (master #48); transition-independent open/close state (#49); snapshot released after processing (#47); v2.2.5 WP 7.x selector with both-markup fixtures; detection summary push feeds the toolbar badge (master §8); KC overlay typo fixed (#34).

## Tests

- [x] `side-by-side/urls.test.ts` — cached/bypassed/PSI branches, `nowprocket` present/absent, `wpr-sbs` round-trip. Done (11 tests: both bypass directions, the PSI analysis pair, host detection + carried-site reads, the context-menu entry cleanup).
- [x] `known-conflicts/extract.test.ts` — HS table extraction (both inbox layouts via fixtures), WP titles extraction (both markups — WP ≤6 `td`, 7.x `th`), live-DOM HS extraction equivalence vs the serialized pass on the same fixture, URL-mode detection, `storage.watch` re-scan trigger. Done — the extraction/mode cases live here (fixtures committed next to the module), the storage-watch half lives in `conflicts-db.test.ts` (fake-browser round trip: writes arrive validated, unreadable writes degrade to null, unwatch stops delivery, and `load()`'s storage-first/background-ask order with adversarial answers).
- [x] Data hub: processing orchestration tested with P1 engine over fixtures (mock messaging via injected senders). Done — `data-hub.test.ts` runs the real pass over the committed corpus fixture (pinned shapes, presence propagation, repairable diagnoser payloads) and pins the one-parse-per-pass guarantee by counting `DOMParser` constructions; the push/listener wiring stays entrypoint glue per AGENTS.md.

## Verification checklist

- [x] Gates green + content-script bundle ≤ 60 KB raw / ≤ 20 KB gzip (budget table). **Shipped note:** see §Shipped deltas — the committed budget row could not hold for this surface with the committed stack (Solid runtime + the P1 engine + `jsonrepair` + WXT storage/context all live in the one content-script bundle); the row was re-derived with the reasoning committed there, after the icon-package decision below. Measured after all cuts: **78.97 KB raw / 27.5 KB gzip** (was 88.4 / 31.5 before the icon swap), −35 % raw vs the baseline's 122 KB; re-measured **79.7 KB / 27.7 KB** (79,699 / 28,341 bytes) after the audit's content-script fixes — the 80/30 row holds throughout.
- [ ] Manual on WP Rocket test site: `[WPR FDT] Page data processed in X ms` log present; elapsed value ≥ 30 % faster than legacy's `Took:` log on the same page (record numbers).
- [ ] Manual HS conversation page: badge appears, count matches legacy on the same conversation; SPA navigation clears/re-scans; hide/show works; **loading state renders until the DB arrives and the empty state appears on a zero-finding scan** (the two UI-state enhancements); no console errors from observers after SPAs navigate.
- [ ] Manual plugins.php page: conflicts badge on a site with a known conflicting plugin (use the fixture DB entry).
- [ ] Manual side-by-side: overlay opens via context menu, both iframes correct (cached vs `?nowprocket=1`), refresh/close work, page scroll restored; PSI flow auto-opens with two analyses; context-menu PSI entry opens new tab.
- [ ] Manual: D-bugger entry appears on a WP admin page when option enabled; disappears when disabled.
- [ ] Manual (with P2): after the `[WPR FDT] Page data processed` log, the toolbar badge reflects WPR presence/cached for that tab; navigation clears/updates it; updating the KC DB (context menu or Options) re-scans an open HelpScout/plugins.php page without a reload.
- [x] `pnpm dev:firefox` smoke equivalent for this worktree (`pnpm build:firefox`): manifest inspected — MV2 output keeps `content_scripts` (no `css` field, since `cssInjectionMode: 'ui'` publishes the stylesheet as a web-accessible resource instead), `web_accessible_resources: ['content-scripts/isolated.css']`, host-permission list intact; no `chrome.*`-only calls exist in the content script (WXT `browser` only).
- [x] Machine-run extra: headless Chromium probes (this worktree) verified the two CSS-cascade facts the injected UIs depend on — `:host { all: initial !important }` beats both inline host styles and any `:host` rule (so all positioning lives on an inner element), and `color-scheme: normal` (the reset's effect) resolves `light-dark()` by OS preference while an explicit `data-theme` on the shadow container wins — the appearance model holds in both palettes.

## Shipped deltas (vs the plan text above)

- **Entrypoint layout is WXT-legal.** The plan's literal `entrypoints/isolated.content.ts/` folder cannot coexist with a `isolated.content.ts` file under WXT 0.21 (both resolve to the entrypoint name `isolated` → duplicate-name build error; verified against WXT's entrypoint glob table). The shipped layout is the framework-native equivalent: `entrypoints/isolated.content/index.ts` (matches `*.content/index.[jt]s` → one content script) with every module colocated inside it. Output paths are unchanged: `content-scripts/isolated.js` + `content-scripts/isolated.css` match the budget globs.
- **The KC seed does not ride the content script.** `lib/storage/known-conflicts.ts` shipped with the committed snapshot as the storage item's _fallback_ — any runtime import of that module would bake the 137-row JSON into the content-script bundle (the exact thing this phase forbids). The snapshot moved to `lib/storage/known-conflicts-seed.ts` (frozen rows + the validated `getKnownConflicts()` reader + the 137-count pin, now with its own tests), and `knownConflictsStore` is defined **without** a fallback: an unset/corrupt value reads `null`, surfaces validate reads at the boundary (`readStoredConflicts`) and the scanner asks the background (`getKnownConflictsDb`) when nothing usable is stored — which is the phase doc's load order, now real. The background seeds through its **own bundled asset** of the same JSON file (`known-conflicts-db.json?url&no-inline`, the background-owned `assets/background.json` budget row); `lib/storage/known-conflicts-seed.ts` is the frozen typed view over that committed file — tests (and any consumer needing the rows directly) read it, runtime seeding does not.
- **`ERROR_WORD_LIMIT` exported** from `lib/messaging/validate.ts` (derived from the existing single-source batch cap): the receiver-side merge keeps the accumulated word list under the same 50-word ceiling without re-typing the constant; `mergeErrorWords` is the tested pure function for it.
- **`applyPresencePropagation` exported** from `lib/detection/run-detection.ts`: the data hub owns the pass end-to-end over **one** `parsePage` tree (parse-page → `runChecks` + `detectPreloadedResources` + propagation + diagnoser extraction on the same tree). The rule still has exactly one declaring site; the orchestrator (`runDetection`) is unchanged for its existing consumers.
- **Injected-UI CSS architecture.** The surface adopts WXT's `cssInjectionMode: 'ui'` + a runtime-fetched `content-scripts/isolated.css` (auto web-accessible). Tokens live in `assets/css/tokens.css` (`:root, :host` selectors, so the same rules serve documents and shadow roots); `theme.css` imports them for page surfaces and the content stylesheet imports them once. `theme.test.ts` now reads both files (concatenated) so the AA/structure gates are unchanged in effect. Inside a shadow root the tokens survive the WXT host reset (custom properties are excluded from `all`) and palette pinning is verified end-to-end (see checklist).
- **Icons: inline SVG, not `lucide-solid`** — the doc's sanctioned fallback. Measured: the two overlay icons via `lucide-solid/icons/*` (per-icon imports + shared `Icon` base + context) cost ~11 KB raw / ~4 KB gzip inside this bundle (per-icon tree-shaking verified working; the cost is the Solid icon runtime itself). The overlay uses two tiny inline-SVG stroke components instead; `lucide-solid` was uninstalled again (it is the panel surfaces' icon stack and P5 installs it at its own phase).
- **Known Conflicts model.** Findings accumulate per surface state (first-seen order keyed by row id — the conversation's messages load lazily) and clear on a pathname change (a different ticket is a fresh scan); the empty state renders only for a settled zero-finding scan (`emptyStateVisible` pure rule — HelpScout per pass, plugins screen after the bounded late pass); leaving both modes disconnects the observer and unmounts the UI. The badge/list reset on navigation is class-state-driven (no DOM rebuild, a `requestAnimationFrame` slide re-arm), replacing the legacy element re-creation.
- **Budget row re-derived (committed change).** Measured composition of the finished surface (rollup visualizer + build deltas): Solid runtime ≈ 27 KB raw (P1.4 stack decision; every injected UI surface carries its own copy), `@wxt-dev/storage` ≈ 8 KB, the P1 engine + validators ≈ 10 KB, `jsonrepair` ≈ 7.5 KB (P1 committed it for diagnoser tolerance; IIFE content scripts cannot split dynamic imports), WXT messaging/context/UI helpers ≈ 16 KB, and ~24 KB of this phase's feature code. The committed stack sums past 60 KB before page features begin; the honest floor after the icon decision is **77.1 KB raw / 27.5 KB gzip**. `scripts/budgets.json` rows updated to raw 80 / gzip 30 (measured + ~4 % headroom; still −35 % raw / −21 % gzip vs the 122/35 baseline) and the whole-build backstop to 857 (the same sum-safe update). **Post-integration measurement:** the P1.1 panel-engine integration landed shared modules into this bundle and consumed the planned headroom — the committed surface measures **78.97 KB raw / 27.5 KB gzip** at that point, and **79.7 KB / 27.7 KB** (79,699 / 28,341 bytes) after the audit's content-script fixes — the 80/30 row still holds throughout. The P15 re-audit owns re-deriving the table when P12–P14 extend this surface.
- **PSI auto-open also fires for late injection** (deliberate, behavior-superior delta). The compare flow's PageSpeed Insights auto-open runs once now when the content script injects after DOM load (`document.readyState !== 'loading'`), where the source only auto-opened from a DOMContentLoaded listener — a late-injected analysis page (restored navigation, extension-driven reload) gets the two-analysis comparison instead of silently skipping it.
- **Component-render tests are P5's setup** (per the P0 note: "tsx component tests later feed configs through `vite-plugin-solid`, owned by P5"). This phase test-covers the logic layers fully (scan-state, extract, urls, conflicts-db, improvements derivation, data-hub pass + word merge) and deliberately leaves UI atom renders to P5's configuration.
- **Processing is eager, not panel-gated (owner decision, 2026-10-08).** Task §2's "Lazy processing
  exactly once (`processPageData` or first data request)" is superseded: the single pass starts at
  the capture moment (`onParserReady`) — the toolbar badge (`reportDetectionSummary`, master §8
  "at a glance per tab") and the `[WPR FDT] Page data processed in X ms` timing log must work with
  no devtools panel ever opened; a panel gating both made the badge worthless (the panel already
  shows everything). Panel requests are unchanged as callers — they are cache hits of that same
  single-flight pass (one `DOMParser` construction per page still holds). The deliberate tradeoff,
  owned here: the engine pass now runs on every http/https page load (the ≥30 %-faster benchmark
  still governs its cost), and the multi-MB snapshot is released on every page instead of being
  retained for the page lifetime — strictly better than the panel-gated retention. The
  summary-push failure log moved debug → warn: a live context failing to deliver is abnormal
  (the background owns the listener from boot) and must not be prod-silent. Site-round verification
  (badge without a panel, log format, elapsed benchmarks) rides the P4.3 rounds.
- **Global error handlers attribute by source (owner-reported defect, 2026-10-08).** The
  page-safety last line logged the `ErrorEvent` wrapper itself (`[object ErrorEvent]`, no details)
  and sat on the page-shared `window`, so every uncaught _host-page_ error was claimed under our
  prefix on the extensions error page. The handlers are now the shared `lib/uncaught-errors.ts`
  factories through `ctx`: only errors sourced under the runtime URL prefix are claimed (rejections
  by stack), reported with the real message + source/line + the error object; foreign events are
  skipped — the page reports its own failures natively, and our error page stays ours. Tests pin
  the attribution rule, the detail shape, and the worker-scope no-prefix mode.
- **Badge is a three-state, transparent-tile dot (owner decision, 2026-10-08).** Every reported
  page now carries a visible state dot — green cached, blue present-uncached, **gray no WP Rocket**
  (the plan's "none = absent" is superseded: a badge only worth having when the panel shows the
  same info was absurd, and with the eager pass the absent state is known per page). Rendering fix
  from the owner's real-browser report: the dot is the `●` glyph in its state color over a
  **transparent tile** (`setBadgeTextColor` + `setBadgeBackgroundColor([0,0,0,0])`) — Chrome's
  default colored-tile-with-white-text rendered the glyph off-center inside the square, which read
  as a defect. State-machine shape: absence reports render now (overwriting stranded dots truthfully)
  instead of clearing; navigation clears, the gate's record/restore, and the gate-off sweep are
  unchanged. Badge tests re-pinned with the decision cited.
- **Page-analysis console print (owner decision, 2026-10-08).** The timing-log delta that dropped
  the legacy's full-detections `console.log` is superseded — the owner wants the console line back,
  organized. `lib/detection/describe.ts` is the view model the checks deferred family composition
  to: real feature names (labels verified by the coverage audit), one honest state per feature
  (plain markup evidence → applied/not applied; the beacon family → applied/collecting/not
  enabled/not applied per the parsed config), counts instead of raw page content (URLs/srcs stay
  out of the console; the no-page-content rule holds), version + UTC cache timestamp. The data hub
  logs it at info right after the timing line on every processed page; P6's Detections page may
  reuse the same view model.
- **Isolated content-script budget row 80 → 85 KiB raw** (deliberate, sanctioned path): the
  analysis view model landed in the bundle; measured **81.0 KiB raw / 28.7 KiB gzip** — gzip's
  30 row holds, raw re-derived at the standard ~4 % headroom (85). The P15 re-audit still owns the
  table when P12–P14 extend this surface.

## Docs to update

AGENTS.md: the entrypoint-tree entry for the isolated content script moved from a file (`isolated.content.ts`) to the folder form (`isolated.content/`, WXT's layout for multi-file content scripts), and the design-token entry now names `tokens.css` — both updated in this phase.
