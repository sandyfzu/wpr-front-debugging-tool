# Phase 9 — Options page

**Depends on:** P1 (storage), P5 (design system). **Effort:** S. **Parallelizable with:** P8, P10.

## Goal

Port the options page (Improvements section) with honest saving, error surfacing, and room to grow, on the design system.

## Legacy reference

- `entrypoints/options/App.tsx` — section "Improvements" ("Injects little scripts or styles to improve tools we use daily") with one option `wp-dashboard-dbugger-entry` (label "Add an entry to access the D-bugger to WP Rocket's menu", description "Adds a convenient entry in the WP Rocket menu for quick access to the D-bugger tool"); loads `OptionsStore`, populates toggles, Save writes `improvements` map; **fake 1000 ms saving UX; errors swallowed into a bare "Some kind of error ocurred.." screen** (master #16); commented-out "Miscellaneous" section (do not port dead code; keep the section architecture extensible).
- `options_ui: { open_in_tab: true }` (legacy built manifest) — keep parity (full tab, not embedded dialog).

## Tasks

- [ ] `entrypoints/options/` — `options.html` + Solid app (`options_ui: { open_in_tab: true }` in wxt.config manifest block).
- [ ] **Options registry (pure):** `lib/storage/options.ts` already owns the shape (canonical option id `wp-dashboard-dbugger-entry`, per P1); add `option-registry.ts` (id, section, label, description) as the single source used by both this page and any future consumer; page renders from the registry (extensible sections, legacy's architecture preserved without dead entries).
- [ ] **Store:** `use-options-page.ts` — load (`optionsStore.getValue()`), dirty tracking (enhancement: Save enabled only when dirty), save (`optionsStore.setValue(...)` awaited), toasts for success/failure (`toast-store`), real error surfacing with message (fixes #16), loading skeleton on first load.
- [ ] **UI:** page header (product name + version from `browser.runtime.getManifest().version` — enhancement); section card per registry section: title + description + switch rows (`switch.tsx`, tooltip with description, keyboard-complete); Save button (loading state, disabled when clean); footer: version + "Legacy-equivalent behavior" note not needed — keep clean.
- [ ] `prefers-color-scheme` light/dark follows the P0 tokens; explicit theme toggle (light/dark/system) stored in `sync:options` (`appearance` key) — **committed enhancement** (trivial with the P0 `[data-theme]` hook: sets the attribute on `<html>` and persists); tokens are palette-agnostic regardless.

## Explicit enhancements over legacy

- Real awaited save with toasts and error details; dirty-state Save; version display; registry-driven extensibility; a11y-complete switches; no fake delays; no swallow-all error screen.

## Tests

- `use-options-page.test.ts` with `fakeBrowser` — load → populate, toggle → dirty, save persists to `sync:options`, save failure → error state + toast path; registry integrity (unique ids, labels non-empty).

## Verification checklist

- [ ] Gates green; `pnpm check:budgets` — options ≤ 50 KB raw.
- [ ] Manual: toggle off → save → WP admin bar no longer shows the D-bugger entry (with P3 live); toggle on → entry returns; storage inspected (`sync:options`) matches; **theme toggle persists and switches the palette immediately**.
- [ ] Manual: error path (block storage via test build or temporary mock) shows a readable error, not the legacy dead-end.
- [ ] Keyboard/axe pass.

## Docs to update

CLAUDE.md only if an option key or permission changes (none expected).
