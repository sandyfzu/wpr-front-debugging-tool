# Phase 5.1 — Panel shell browser suites

**Depends on:** P4.1, P5. **Effort:** S. **Parallelizable with:** P6 implementation.

## TLDR

Automate the browser-observable part of P5's devtools-panel checklist through the P4.1 harness — panel boot states, tab navigation, deep-links, search interactions — by driving the panel as an extension page (real Chrome devtools attach stays manual).

## Approach

The devtools **attach itself** isn't Playwright-scriptable (headless can't load extensions; attaching the panel requires a real devtools window). The suite therefore drives `panel.html` directly (`chrome-extension://…/panel.html`), which is the identical app shell with the same message/search/hash contracts; real-devtools visuals (first-open experience, panel surface in the browser's devtools chrome) stay manual.

## Suites

1. **Boot states:** no captured page → the fetching → graceful error/retry state (CS absent); with dev-override data / after a fixture page visit → ready state with the devtools-contract data path.
2. **Navigation:** every nav registry row renders and re-reach (the reserved Diagnoser row renders disabled with its tooltip); hash deep-link survives a reload; **soft refresh** — a fixture-page navigation refetches data in place with route/scroll/focus preserved, no frame-level panel reload.
3. **Command palette:** `Cmd/Ctrl+K` opens, jumps to every page, runs one action; Esc closes; `?` overlay opens and lists the shortcuts.
4. **Status bar:** the present/version/cached/freshness segments render from the fixture data and navigate — the 0-interaction answer asserted.
5. **Search:** Ctrl/Cmd+F streams typed input debounced; Escape cancels and clears filtering immediately (legacy no-op → assert the port's behavior); a second simulated panel instance does not reload with its own tab (master #42 — approximated here by two panel-page contexts; the true two-devtools-windows case stays manual).
6. **Keyboard + a11y:** keyboard-only reachability of the shell's controls, route-switch focus lands on the page `h1`, and valid tablist semantics via an axe run (the P5 doc's manual pass, automated where the harness allows); **nav morphology** asserted at two root widths (top tab bar ≥ 768 px, icon rail below).
7. **Cold-start budget:** the shell's `performance.mark`s measured on the fixture; the `panel cold-start ≤ 500 ms` row asserted green (the budget row's `measuredBy`).
8. **Elements sidebar interactions** (once P3 data exists): lazyload info for an IMG target and the rocket-attribute inventory; the failed-eval error-object state per master #36.

## Definition of done

- Suites above green in `pnpm test:e2e`; the P5 doc's checklist annotates each item "automated here (P5.1)" or "manual (reason)".
- Gates untouched-green; panel bundles unaffected (suite asserts, doesn't extend).

## Stays manual

First-open-in-real-devtools visuals; the exact two-devtools-windows topology; Firefox devtools smoke (`dev:firefox`, no harness).
