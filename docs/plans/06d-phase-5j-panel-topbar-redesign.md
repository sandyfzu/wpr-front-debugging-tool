# P5J: final header/navigation redesign

## TLDR

**Planned, last implementation phase:** after P14.6/P7, immediately before P15; dependencies shippedP5C/D/I. Parallel:—in release slot. Installed stack/shared nav registry/primitives, no new dependency approved. Design first, then small implementation/test slices; don't revive retired top-bar morphology.

Owner2026-10-13 found wide top bar ugly/scrolling, below-row tooltips stealing clicks and white boot. Immediate fixes already shipped: **rail only at every width**, tooltips right/sibling hit-test safe, themed boot canvas/per-icon imports. Background-only System→stored-theme flip before content accepted; content never wrong palette. P5J owns the **deferred final form**, not those completed repairs. [Shell record](./completed-shell.md), [design decisions](./design-decisions.md).

## P5J.A — Design gate

Depends:P7/P14.6 delivery knowledge+P5I. Parallel:—. Goal: final right/bottom/undocked shape agreed before code.

- [ ] Wireframes/decisions for brand/header/status bar/appearance, grouping/live details, wide/narrow/short overflow, rail-only or dual form. Explicitly solve wide polish/default-visible scrollbar complaint, not old bar recolor.
- [ ] Preserve nav registry/additive rows, UX-D2/D14/D15/D16; amend dated design decision **first** if contradictory. If width form returns, one named container threshold/pure rule+CSS sync guard, not viewport branches.

DoD: committed decisions here, each owner friction mapped to acceptance check, small scoped implementation boundaries chosen. No code before this gate.

## P5J.B — Implement final form

Depends:A. Parallel:—shared geometry. One route table, no duplicate DOM registries; group AT names/aria-current/reserved note. Tooltips right/no sibling occlusion,≥24px controls/visible focus. Header/status remain outside content scroller; crash/loading/soft-refresh/canvas contracts intact.

Height contract persists: measured fitting prefix+More pages suffix, no scrolling rail,32px pitch/separator breathing, pointer-reachable trigger (current z10 guarantee). Menu can internally scroll under clamp, no phantom stable gutter. Reuse same fit rule for any returning wide form; don't delete rail affordance without revising study. Status footer spans shell width.

DoD: pure morphology/sync guard if applicable, render/nav/geometry/focus/reserved/overflow tests, UI bar §D, build/budgets/Firefox. No ceiling raise just to hide redesign growth.

## P5J.C — Native acceptance

Depends:B. Parallel:—.

- [ ] Narrow/wide/short, real right/bottom/**undocked**, both palettes/System/reduced motion; final form/overflow, every row reach, active/reserved/menu behavior, tooltip sibling hit-testing, first-paint themed canvas.
- [ ] Maintain current native docking method/evidence distinction (actual DevTools now reachable; standalone viewport tests not native proof). Full applicable local browser regression; final all-three-frictions visual signoff.

DoD: gates green, final design/actual runtime+size receipts here. This is the last implementation, not permission to skip P15's independent release gate.
