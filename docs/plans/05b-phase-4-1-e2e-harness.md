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
