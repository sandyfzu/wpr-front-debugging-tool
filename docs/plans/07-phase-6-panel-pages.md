# Phase 6 — Panel pages: Detections, JavaScript, Lazyload, Preloaded Resources, Undefined References

**Depends on:** P5 (+P3 for live data). **Effort:** L. **Parallelizable with:** P8, P9, P10 after P5.

## Goal

Port the five non-Diagnoser panel pages with behavioral parity, better information design, and the performance work (virtualization, lazy highlighting, memoized filtering).

## Legacy reference (page by page)

- **Detections** (`pages/WPRDetectionsPage.tsx` + `WPRDetectionItem.tsx`): builds status cards from `wprDetections` + headers: Server (from `server` header), Known Platform (WP Engine/Kinsta/Hostinger header match), one card per detection key except `async_css` merged into the RUCSS card as "Optimize CSS Delivery" (three-branch logic preserved verbatim), `wpr` card (+ separate "Cached" card with timestamp when cached), subtitles for ATFO (beacon / preloaded-image count `9+`), lazyload_iframes (replace-preview), delay_js version, RUCSS ("Optimize CSS Delivery"). `getNeededHeaders` extracts `server` + platform headers case-insensitively.
- **JavaScript** (`pages/JavaScriptPage.tsx`): maps `delay_js.scripts` → resource items (inline = code view, external = link view); filter chips Show All/Delayed/Non-delayed/Deferred/Non-Deferred/Inline/External with per-key memo cache; summary bar (Delayed/Non-delayed/Deferred/Non-deferred/Inline/External counts + total); Delay JS present badge; labels logic `formatLabel` incl. "Excluded by FDT legacy" variants; search filters `content` (external: URL, inline: code).
- **Lazyload** (`pages/LazyloadPage.tsx`): images list; chips Show All/Lazyloaded/Non-lazyloaded; summary (Lazyloaded/Non-lazyloaded + total); non-lazyloaded label shows `Excluded reasons found: "…"` or `No reasons found` or `Excluded by FDT legacy` (when `data-wpr-fdt-excluded` present); search filters `src`.
- **Preloaded Resources** (`pages/PreloadedResources.tsx`): chips Show All/Images/Fonts; summary Images/Fonts + total; items rendered as links; search filters `href`; **copy bug:** feature badge says "Lazyload" (master #9).
- **Undefined References** (`pages/UndefinedReferencesFinderPage.tsx`): states — waiting for scripts (`FetchingComponent`), "Delay JS has not been executed yet" (when delay present + scripts not loaded), "No undefined references detected (monitoring)", results list; results from `chrome.devtools.inspectedWindow.getResources` (type `script`, http URLs) + inline scripts concatenated from detections; per-word definition search regex `(((var|let|const|function) +)W(([^a-zA-Z0-9_$#])|$))|((^|([^a-zA-Z0-9_$#]))W( *(=|:)))` gm across every script content; external-error sentinel card explains CDN caveat; re-runs when references update (all script assets cached in module state — master #7).
- Shared: `NothingToShow`, `FetchingComponent`, `ResourcesSummary`, `ResourceItem` (expand/collapse for code, lazy shiki), `FilterButtonsBar`.

## Tasks

### Shared view-models (pure, tested) in `entrypoints/panel/pages/<page>/view-models.ts` or `lib/panel/`

- [ ] `detections-view-model.ts` — `buildStatusItems(fdtData): StatusItem[]` — port `getStatusItems` + `getNeededHeaders` verbatim in behavior (pure functions over P1 types; async_css merge branch included); enhancement: expose richer subtitle data for the redesigned card (e.g. cached timestamp formatted, platform name + header).
- [ ] `resources-view-model.ts` — shared `filterAndSearch(items, filterId, query)` + per-page filter definitions (JS/Lazyload/Preloaded); legacy's per-page `filteredCache` maps become `createMemo` graphs (Solid fine-grained = no manual cache maps); counts derived from the same memo (no double iteration).
- [ ] `undefined-refs.ts` — pure `findDefinitions(scriptAssets, words): Definition[]` (regex parity, escaped word — **hardening:** legacy interpolates the word raw into `new RegExp`; escape regex metacharacters — words come from page errors, could be `(` etc.; verify parity on non-special words, document the fix) + `loadScriptAssets(devtoolsApi, inlineScripts)` rewritten with `Promise.all` + zero-resources resolution (fixes master #6) and null-content guards. Inline-script assets get a **typed discriminator** (`{ kind: 'inline' } | { kind: 'url', url }`) instead of legacy's magic string (`'In an Inline Script.'` compared against `'Inline Script'` → broken anchor, master bug #22). **Incremental re-analysis:** when `undefinedReferencesUpdated` pushes arrive, only the new words go through `findDefinitions` — a memo keyed by word caches prior results (enhancement; owned by the test below).

### Pages (Solid components; all lists virtualized via `virtual-list.tsx`; every page animates its own entrance with CSS on mount only — replacing legacy's per-page `runAnimations` module-flag hack, master #17)

- [ ] **Detections page** — responsive card grid (2/3/4 cols parity+); redesigned card: status icon + name + subtitle, hover elevation, `status-badge`; "Cached" card shows formatted timestamp (relative + absolute tooltip — enhancement); cards keyboard-focusable with tooltips carrying the full subtitle; when `pageHeaders` is null (unknown tab / capture miss), the Server and Known Platform cards are omitted silently (legacy parity — `getStatusItems` pushes them only if `fdtData.pageHeaders` exists).
- [ ] **JavaScript page** — filter chips with counts inline; summary strip (feature badge + counts + total — `ResourcesSummary` successor); rows: type chip (Inline/External), label chips (Delayed / Deferred (By WP Rocket) / Not delayed (Excluded by FDT) — rename "FDT legacy" → "FDT", documented string delta), external rows open in new tab (`noopener`); inline rows use `code-block.tsx` (collapsed 65 px parity, expand persists while row mounted, expandability computed without the post-render `clientHeight === scrollHeight` re-measure — fixes master #10 incl. the "Trucated" typo); virtualized when > 100 rows.
- [ ] **Lazyload page** — parity filters/summary; rows: image URL + lazyloaded chip; non-lazyloaded shows excluded reasons as small badges (better than legacy's quoted string dump); FDT-excluded reason highlighted distinctly; thumbnails preview (enhancement, lazy-loaded `<img>` with `loading="lazy"`, referrer-policy safe) behind a P6 flag — ship only if trivially safe on arbitrary hosts (skip on CSP concerns; decision recorded).
- [ ] **Preloaded Resources page** — parity filters (Images/Fonts) + summary; fix badge label to "Preload" (master #9); rows as links with `as` type chip.
- [ ] **Undefined References page** — port the three waiting/empty states (same trigger conditions: `delayJSPresent && areScriptsLoaded && !ready` → processing; `delayJSPresent && !areScriptsLoaded` → "interact with the page" hint; zero results → monitoring note); results: card per word — "Undefined" badge + word (sentinel → "Script error."), definitions list (**inline entries rendered as "Inline Script" chips — fixes legacy's broken anchor, master #22** — URL entries as links), found/not-found icon with tooltip; sentinel explanation text (fix legacy typo "ocurred", keep guidance); state kept in Solid stores owned by the page (no module-level mutable state — master #7); refresh definitions when `undefinedReferencesUpdated` pushes arrive (incremental: re-run `findDefinitions` on new words only — enhancement).
- [ ] **Search integration** — every list page reads the P5 search store: `performSearch` sets query; **`nextSearchResult`/`previousSearchResult` move a highlight cursor across matching rows and scroll-into-view** (new capability implied by legacy's protocol — fixes the dead half of the protocol, master #8, and completes the store work referenced in master #18); `cancelSearch` clears; route change resets (parity).

## Explicit enhancements over legacy

- Virtualized lists + memoized filters (thousands of images without jank); real JSON tree where relevant; regex-escaped definition search (security/robustness); incremental re-analysis; search match navigation; consistent empty/error/summary components; fixed copy bugs and typos; "FDT legacy" strings updated.

## Tests

- View-models: `buildStatusItems` table tests (async_css merge matrix, cached card, subtitles); filter/search per page (incl. empty results → empty state, next/prev cursor wrap-around); `findDefinitions` regex parity tests (legacy-form samples + metacharacter words) — the pure logic lives outside components so all of this is unit-testable.
- `undefined-refs` store: **zero-script-resources page resolves to `[]` (master #6 regression test)**; **incremental re-analysis — a push with 1 new word runs `findDefinitions` for that word only (memo hit count asserted), not the full set.**

## Verification checklist

- [ ] Gates green; `pnpm check:budgets` — panel main chunk ≤ 600 KB hard **and the ≤ 350 KB stretch target reported met/not-met with reason** in the committed table (stretch is accounted for, not ignored).
- [ ] Side-by-side vs legacy on fixture pages: identical card sets/subtitles on Detections; identical counts/filters on JS/Lazyload/Preloaded; identical definitions on an undefined-reference test page.
- [ ] **Perf gate (automated, not eyeballed):** `entrypoints/panel/dev/fixtures/generate-images.ts` produces a committed 5,000-row fixture JSON loaded via the dev-only data override; a script (Playwright or chrome-trace) loads the JavaScript page with the fixture, triggers tab switch + filter change + search, collects `PerformanceObserver('longtask')` entries, and **asserts none > 50 ms and total blocking time < 200 ms**; re-run in P11.
- [ ] Search: perform/next/prev/cancel E2E by hand with DevTools search box.
- [ ] Keyboard pass on every page; axe run clean on each page state.

## Docs to update

None mandatory; note the thumbnail decision (shipped/skipped + why) in the Lazyload page TSDoc.
