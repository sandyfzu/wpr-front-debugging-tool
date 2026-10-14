# Phase 8 — Popup (optimization toggles via Diagnoser URL params)

**Depends on:** P1, P3 (detections), P5 (design system). **Effort:** M. **Parallelizable with:** P9, P10.

> **UI/UX bar:** this phase's UI meets [`docs/ui-ux-bar.md`](../ui-ux-bar.md) (rules cited by id; its §D checks are receipted with every UI change) — this doc keeps only surface-specific decisions.

## Goal

Port the popup that turns WP Rocket optimizations on/off by rewriting Diagnoser-plugin URL params, with parity on the param semantics and a far better, keyboard-accessible UI.

## Legacy reference

- `entrypoints/popup/App.tsx` — state machine: no active tab → error; non-http URL → "Page incompatible with this feature"; else fetch `getWPRDetections` (tab-targeted) → options page; loading text states are bare strings. The outer `chrome.tabs.query().then()` has no `.catch` — a rejection leaves the popup stuck on "Loading.." forever — and a debug `console.log(data)` is left in (master #26).
- `entrypoints/popup/pages/activate-deactivate-options.tsx` — param list: `wpr_cache` + `minify_css, minify_js, minify_concatenate_js, remove_unused_css, async_css, delay_js, defer_all_js, lazyload, lazyload_iframes, lazyload_css_bg_img, cdn`; initial switch state from detections (`wpr.cached` → cache; each option `present` — skipping `cdn` and `minify_concatenate_js` which are never auto-detected); **Apply:** all params set to `0`, active ones to `1`, delete `nowprocket`/`wpr_activate_all`/`wpr_deactivate_all`, `chrome.tabs.update`, window close; **Reset:** delete all params + `nowprocket`/`wpr_activate_all`/`wpr_deactivate_all`/`wpr_new_cache`; strips `nowprocket` from the working URL before anything; footer link to the Diagnoser plugin releases; switches are `<input>` + `<span onClick>` (not keyboard accessible — master #15). Toggle states initialize in a post-render effect (the first frame renders all-off), every row's name carries the same duplicated `id="option-name"` with no label association (master #27), and the fixed 320×576 body has no scrollable region (master #28).
- `entrypoints/popup/style.css` — custom legacy stylesheet (replaced by the design system).

## Tasks

- [ ] `entrypoints/popup/` — `popup.html` + Solid app; size parity (legacy is **320 × 576 px** per `popup/style.css`) and compact theme; applies the stored appearance before mount (system default / dark / light — P0 resolver + `[data-theme]`) so the popup never flashes the wrong palette.
- [ ] **State flow** (typed store): `fetching → incompatible | error | ready(tabUrl, detections)`; tab query via `browser.tabs.query({ active: true, currentWindow: true })`; **warm-up ping (parity decision):** legacy's `main.tsx` sends `processPageData` when the popup opens; in the port `getWprDetections` already triggers lazy processing synchronously as part of the request, so the separate ping is redundant — record this as an intentional simplification (behavior observable to users is unchanged: opening the popup always yields fresh detections). The outer tab query is failure-aware: a rejection renders the typed error state with retry (fixes master #26); no debug logging; toggles initialize synchronously from the fetched detections — no all-off first frame (fixes master #27).
- [ ] URL read requires host permissions (P0 decision) — **verification task:** confirm `tab.url` is readable for web pages without the `tabs` permission; if not, restore `tabs` permission with why-comment + AGENTS.md update (record outcome here).
- [ ] **View-model (pure, tested)** `toggles.ts`: param registry (id, human name via `getRealOptionName`, detection mapping); `initialState(detections): Set<ParamId>` (cache + detectable options only — parity); **Enable All / Disable All operate on the full 12-param set including `cdn` and `minify_concatenate_js` (parity with legacy's `allOptions`)**; `buildApplyUrl(url, active): URL` (all → `0`, active → `1`, strip `nowprocket`, `wpr_activate_all`, `wpr_deactivate_all` — parity incl. ordering-insensitive set ops); `buildResetUrl(url): URL` (strips the 12 params **plus `nowprocket`, `wpr_activate_all`, `wpr_deactivate_all`, `wpr_new_cache`** — the exact legacy reset set); both return new URLs (no mutation).
- [ ] **UI:** header (rocket mark + "Disable or enable optimizations" title); toolbar (Enable all / Disable all — parity); list of switches via `switch.tsx` (real Kobalte controls, labels clickable, keyboard operable — fixes #15), Cache row first (parity), groups visually ordered like legacy; sticky footer: Apply (primary) + Reset URL (secondary, tooltip "Removes all the querystrings related to the diagnoser" — parity); footer note with link to `https://github.com/wp-media/wp-rocket-diagnoser/releases` (target `_blank`, `rel="noopener noreferrer"` — legacy lacked rel). The list region scrolls within the fixed 320×576 (fixes master #28); row ids are unique and properly associated with their switches (fixes master #27).
- [ ] Apply/Reset: `browser.tabs.update({ url })` + `window.close()`; guard: if `tabs.update` rejects (e.g. restricted URL race) show error toast instead of closing (enhancement).
- [ ] Status line (enhancement): "Detected on this page: Cache ✅, Delay JS ✅ …" — the toggles initialize from detections, make the initialization visible with a subtle "detected" tick on rows that came from detection vs untouched.
- [ ] **Device-simulation row (P16's mechanism):** one row beneath the switches — "Debug this tab as mobile" — reflecting + flipping the clicked tab's per-tab state from P16. Capability is feature-detection: on browsers without the API the row renders its typed unavailable state with the documented fallback hint (P16's Firefox rule). It applies **immediately** via P16's rule mechanism — deliberately **not** part of the Apply/Reset URL flow (different mechanism; the row carries a one-line hint saying so). The popup's tab query already carries the target tab id.

## Explicit enhancements over legacy

- Keyboard/AT-complete switches; real loading skeleton + friendly incompatible/error states; apply-error toast; detected-vs-untouched affordance; safe external link; pure URL builders unit-tested (legacy's was inline and untested). Failure-aware tab query (#26); synchronous toggle initialization (#27); scrollable fixed-size body (#28).

## Tests

- `toggles.test.ts` — initial-state matrix (cached or not, each option present/absent, cdn/concat never pre-set), apply (params `0`/`1` + strip set), reset (**full param set: 12 + `nowprocket` + `wpr_activate_all` + `wpr_deactivate_all` + `wpr_new_cache`**), `nowprocket` handling (pre-present and absent), param preservation of unrelated querystrings, **Enable All = the full 12-param set**; **`detectedIds` input set for the "detected" tick** (pure selector: which rows came from detection vs untouched) so the tick affordance has an owned test.
- Device-simulation row state derivation (P16 mechanism): active/inactive/unavailable matrix over the state ask + the capability detection (pure) — the flip itself and the rule behavior are P16-owned suites.

## Verification checklist

- [ ] Gates green; `pnpm check:budgets` — popup ≤ 50 KB raw.
- [ ] Manual vs legacy on the same page: identical resulting URL after Apply (diff the two URLs) and after Reset; toggles reflect detections identically; **rows that came from detection show the "detected" tick**.
- [ ] Manual: on `chrome://` page → incompatible state; with CS absent → error state with retry (enhancement). 12 rows + toolbar + footer fit and scroll within 576 px; the first rendered frame already shows detected toggles (no all-off flash).
- [ ] Keyboard-only: tab through all switches, space toggles, Apply triggers.
- [ ] Firefox: popup works (URL param flow is cross-browser).
- [ ] **Diagnoser plugin v2 re-verification (owner deferral note, 2026-10-12):** when the rebuilt plugin ships, re-verify the Apply/Reset URL-param semantics against it — the popup's builders target the current plugin's contract; adapt the pure builders (tested, a one-file change) if the contract changed.

## Docs to update

AGENTS.md if `tabs` permission had to be restored (decision point above).
