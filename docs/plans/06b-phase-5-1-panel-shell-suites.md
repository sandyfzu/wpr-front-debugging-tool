# Phase 5.1 — Panel shell browser suites

**Depends on:** P4.1, P5. **Effort:** S. **Parallelizable with:** P6 implementation.

## TLDR

Automate the browser-observable part of P5's devtools-panel checklist through the P4.1 harness — panel boot states, tab navigation, deep-links, search interactions — by driving the panel as an extension page (real Chrome devtools attach stays manual).

## Approach

The devtools **attach itself** isn't Playwright-scriptable (headless can't load extensions; attaching the panel requires a real devtools window). The suite therefore drives `panel.html` directly (`chrome-extension://…/panel.html`), which is the identical app shell with the same message/search/hash contracts; real-devtools visuals (first-open experience, panel surface in the browser's devtools chrome) stay manual.

## Suites

Each row names the P5 sub-phase that delivers the surface it asserts (06 §Sub-phase structure):

1. **Boot states** (P5C): no captured page → the fetching → graceful error/retry state (CS absent); with dev-override data / after a fixture page visit → ready state with the devtools-contract data path. — automated (P5.1), enabling sub-phase P5C (the honest no-inspected-tab boot leg already pinned by the standing `panel-nav` suite). The ready boot also **re-measures the cold-start timing row** once (and only once) its data path exists here: the P5I runner's automated leg is the harness's recorded-error settle, and this row owns the ready-leg measurement so the deferral cannot evaporate.
2. **Navigation** (registry + soft refresh from P5C, the icon rail from P5D): every nav registry row renders and re-reach (the reserved Diagnoser row renders disabled with its tooltip); hash deep-link survives a reload; **soft refresh** — a fixture-page navigation refetches data in place with route/scroll/focus preserved, no frame-level panel reload. (The top bar was retired 2026-10-13 — the rail is the nav's only form until P5J's redesign; these rows already run in the standing `panel-nav` suite.) — automated (P5.1), enabling sub-phases P5C + P5D (rail, deep-links, tooltip and keyboard legs already green in `panel-nav`; the soft-refresh legs ride the data path P5.1 sets up — the standalone broadcast never reaches content scripts, verified in P5I).
3. **Command palette** (P5E): `Cmd/Ctrl+K` opens, jumps to every page, runs one action; Esc closes; the shortcuts overlay opens and lists the shortcuts. — automated (P5.1), enabling sub-phase P5E. _Chord delta, 2026-10-14 audit round of the owner-feedback polish: the overlay's activation is the re-stamped binding from `UX-D3` — the advertised key is the unshifted `/` (`?` stays an accepted, unadvertised alias; the in-DevTools `?` interception stays the P5E receipts' manual leg) — so this row's recipe reads the `/` binding wherever it names the overlay key._
4. **Status bar** (P5F): the present/version/cached/freshness segments render from the fixture data and navigate — the 0-interaction answer asserted. — automated (P5.1), enabling sub-phase P5F; the fixture-data leg rides P5.1's data path (a standalone panel's broadcast fetch never reaches content scripts — verified in P5I).
5. **Search** (P5C): Ctrl/Cmd+F streams typed input debounced; Escape cancels and clears filtering immediately (legacy no-op → assert the port's behavior); a second simulated panel instance does not reload with its own tab (master #42 — approximated here by two panel-page contexts; the true two-devtools-windows case stays manual). — automated (P5.1) in its harness-drivable share (two-instance message scoping), enabling sub-phase P5C; the streaming + Esc flows assert through the store's unit/render pins until P5.1's data path lands, and the devtools-native Ctrl/Cmd+F relay stays manual (relay actions require the inspected tab, verified in P5I).
6. **Keyboard + a11y** (P5E; geometry rows from P5D): keyboard-only reachability of the shell's controls, route-switch focus lands on the page `h1`, and valid tablist semantics via an axe run (the P5 doc's manual pass, automated where the harness allows); the nav's **geometry** asserted at two root widths — the rail holds at both (the top-bar morphology is retired; P5J's redesign re-pins whatever form it lands). — automated (P5.1), enabling sub-phases P5E + P5D (the rail-at-every-width, hash links, focus ring and reachability legs already green in `panel-nav`).
7. **Cold-start budget** (P5I): the shell's `performance.mark`s measured on the fixture; the `panel cold-start ≤ 500 ms` row asserted green (the budget row's `measuredBy`). — automated (P5.1), enabling sub-phase P5I: the spec exists and gates the row today (`tests/e2e/suites/panel-cold-start.spec.ts`, measured ≈ 17 ms on the harness's recorded-error boot); P5.1 re-runs it as the row's gate.
8. **Elements sidebar interactions** (P5A; once P3 data exists): lazyload info for an IMG target and the rocket-attribute inventory; the failed-eval error-object state per master #36. — manual (reason: the rows run on `$0` inside a real DevTools window, which the harness cannot open; the eval-expression shapes are unit-pinned against real elements in P5A's own tests).

## Definition of done

- Suites above green in `pnpm test:e2e`; the P5 doc's checklist annotates each item "automated here (P5.1)" or "manual (reason)".
- Gates untouched-green; panel bundles unaffected (suite asserts, doesn't extend).

## Stays manual

First-open-in-real-devtools visuals; the exact two-devtools-windows topology; Firefox devtools smoke (`dev:firefox`, no harness).
