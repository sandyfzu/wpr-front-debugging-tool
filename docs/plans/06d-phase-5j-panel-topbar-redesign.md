# P5J: final header/navigation redesign

## TLDR

**Rail-only is the shipped final form; the wide/horizontal (top bar or dual) form is parked** (owner 2026-11-17: not planned for now, kept below to resume later). **P5J closed 2026-11-17** (owner signoff on the shipped rail; only change wanted = Diagnoser entry removal, tracked separately). Dependencies shippedP5C/D/I. Installed stack/shared nav registry/primitives, no new dependency.

Owner2026-10-13 found wide top bar ugly/scrolling, below-row tooltips stealing clicks and white boot. Fixes shipped: **rail only at every width**, tooltips right/sibling hit-test safe, themed boot canvas/per-icon imports. Background-only System→stored-theme flip before content accepted; content never wrong palette. [Shell record](./completed-shell.md), [design decisions](./design-decisions.md).

## P5J.C — Native acceptance (shipped rail) — closed

Depends:P5I. Parallel: any phase not editing `entrypoints/panel/nav/**` or the shell layout. Size:XS, difficulty: low (eyes-only owner round, fix only what it finds).

- [ ] Narrow/wide/short, real right/bottom/**undocked**, both palettes/System/reduced motion; rail overflow (More pages), every row reach, active/reserved/menu behavior, tooltip sibling hit-testing, first-paint themed canvas.
- [ ] Keep the native docking method/evidence distinction (standalone viewport tests are not native proof). Right/bottom docking already passed 28 ready-route samples ([UI acceptance](./completed-ui-acceptance.md)); **undocked** and the all-three-frictions visual signoff remain.

**Closed 2026-11-17:** owner reviewed the shipped rail, no change wanted beyond removing the Diagnoser entry (separate task, on owner's go). DoD: owner signoff recorded here; any fix found lands with tests + gates green. Not permission to skip P15's release gate.

## Parked — wide/dual form (not planned for now)

Resume only on owner request. Then: run A → B, and re-run C over the new form.

### P5J.A — Design gate

Depends:P5I. Goal: final right/bottom/undocked shape agreed before code.

- [ ] Wireframes/decisions for brand/header/status bar/appearance, grouping/live details, wide/narrow/short overflow, rail-only or dual form. Explicitly solve wide polish/default-visible scrollbar complaint, not old bar recolor.
- [ ] Preserve nav registry/additive rows, UX-D2/D14/D15/D16; amend dated design decision **first** if contradictory. If width form returns, one named container threshold/pure rule+CSS sync guard, not viewport branches.

DoD: committed decisions here, each owner friction mapped to acceptance check, small scoped implementation boundaries chosen. No code before this gate.

### P5J.B — Implement final form

Depends:A. Parallel:—shared geometry. One route table, no duplicate DOM registries; group names/aria-current/reserved note as the shipped primitives give them (new AT-naming work dropped — owner 2026-10-27: no screen-reader support). Tooltips right/no sibling occlusion,≥24px controls/visible focus. Header/status remain outside content scroller; crash/loading/soft-refresh/canvas contracts intact.

Height contract persists: measured fitting prefix+More pages suffix, no scrolling rail,32px pitch/separator breathing, pointer-reachable trigger (current z10 guarantee). Menu can internally scroll under clamp, no phantom stable gutter. Reuse same fit rule for any returning wide form; don't delete rail affordance without revising study. Status footer spans shell width.

DoD: pure morphology/sync guard if applicable, render/nav/geometry/focus/reserved/overflow tests, UI bar §D, build/budgets/Firefox. No ceiling raise just to hide redesign growth.
