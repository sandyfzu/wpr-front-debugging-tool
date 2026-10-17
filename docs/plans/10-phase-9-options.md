# P9: options and P9.1 suites

## TLDR

Build registry-driven full-tab options with real save/dirty/error states, three-way live appearance, KC freshness/refresh and badge toggle. Depends:P1/P5; parallel:P6/P8 (P10 parked). Installed stack/shared UI; storage already owns keys/defaults. No dependencies planned.

Source options App: Improvements/D-bugger entry, full-tab options_ui. Drop commented Miscellaneous, fake1000ms saving, module-section mutation, default-off load flash and detail-free swallowed error.

## Slices

- **P9A model/store:** depsP1; parallelP8. One option registry(id/section/native label/description), never a new storage shape. Canonical improvements `wp-dashboard-dbugger-entry`; appearance system/dark/light; features.toolbarBadge true. Initial load skeleton→populated or actionable retry; dirty Save only; await write/toast success/failure, no delay. Preserve unknown boolean fields/concurrent options; registry never mutable state. DoD: fake-browser load/dirty/save/reject/corruption/registry-integrity tests.
- **P9B page:** depsA/P5. `options_ui.open_in_tab:true`; header product+manifest version, section cards/described accessible switches, Save busy/clean guard. Resolve appearance before paint, **System default/Dark/Light only**, persists and restyles every open panel/popup/options/builder/injected UI immediately (panel/options only writers). KC row reads **updatedAt** meta, relative last update+Refresh now typed request/outcome; never old `lastUpdate` key. Toolbar toggle applies live via existing background watch, no restart. DoD: component states/keyboard/axe/UI bar §D,≤50KiB raw/build gates.
- **P9.1 suites:** depsB/P4.1, site effects+P4.2/P4.3. Parallel independent parked-P10 replan only if authorized. Assert storage persistence; OS-emulated System follows, explicit overrides/live cross-surface palettes; action badge off/on at SW seam; D-bugger on/off **after inspected admin reload** (P3 one-shot behavior); KC successful stamp advance/offline failure/corrupt storage, readable error, keyboard+axe. DoD: local green/parent checks annotated, no restart claim confused with no-page-reload promise. P15 judges visual polish; Firefox runtime remains release matrix.

Use existing `lib/storage/options.ts` contracts/tolerant validators; the on-page strip's global default joins through P12 as `features.onPageInspector`, not an independent option key. That row is planned for the options page: **"Show the detection chip on pages by default"**, default **on** (owner 2026-10-17 — replaces the interim constant as unconfigured origins' source), and a per-origin entry (the context-menu toggle) keeps winning over it in both directions. Final docs update only actual AGENTS triggers and user-facing operation changes.
