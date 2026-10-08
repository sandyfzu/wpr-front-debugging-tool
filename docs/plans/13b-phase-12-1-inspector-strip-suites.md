# Phase 12.1 — On-page inspector strip suites

**Depends on:** P4.1, P4.2 (toggles live on the site), P12. **Effort:** M. **Parallelizable with:** P13/P14 implementation.

## TLDR

Automate the strip's interactive surface: opt-in appearance/hiding per origin, drag persistence, Alt+H, the hostile-CSS isolation computed-diff, palette/appearance interplay, and reduced-motion/mobile-viewport reachability — the bulk of P12's manual pass with each item naming its assert surface.

## Suites

1. **Opt-in model:** hidden by default on every page; enabled via the popup/Detections control → appears; disable hides and stays hidden across reloads; per-origin state keeps other origins hidden; enabling from one origin doesn't leak to another.
2. **Drag:** pointer-drag moves on state that persists; no text selection/link activation beneath during drag; right-click cancels cleanly (parity nicety, asserted on the state contract); clamp respected; mobile-size viewport (touch emulation) drags/clamps with page scroll intact after drop.
3. **Alt+H:** toggles on an enabled origin only; a fixture page with its own `keydown` handler (a code-editor-like page) shows no regression from our listener (the host handler still fires).
4. **Isolation (the hostile-CSS pass, converted):** aggressive global CSS (resets, high-specificity rules) on a fixture page → computed-style diff of host nodes before/after strip mount = none; no un-scoped styles leave the shadow root; strip renders identically above the hostile page (screenshot diff).
5. **Cross-palette + appearance:** stored `system`/`dark`/`light` resolution restyles the strip live (flip in Options → immediate restyle without reload — the P12 doc's explicit item), against the P0 token machine (the appearance machinery the P4.2 site already exercises).
6. **Reduced-motion + a11y:** reduced-motion honored in drag/hover transitions; keyboard reachability + axe on the shadow UI.
7. **Zero-markers honesty:** a page with no WP Rocket markers shows only the disabled/unsure chips with honest tooltips — no fabricated states.

## Definition of done

- Suites green under `pnpm test:e2e`; the design-brief conformance and budget/unification items from P12's checklist stay with P12's own gates (structural review, budget table) — annotated, not silently moved.

## Stays manual

Incognito-per-origin (extension instances can't be replicated in a separate incognito context by the harness — Playwright limitation; the parent doc records it); the "glance ≤ 2 s" coherence judgment; Firefox smoke.
