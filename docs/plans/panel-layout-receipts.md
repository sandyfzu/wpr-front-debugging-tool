# Panel canvas alignment — 2026-10-15

## Outcome and rationale

The page frame now centers **one canvas containing its header, actions, filters
and results**. Data workspaces stop at `max-w-7xl` (1280 px including padding);
Undefined References and the reserved Diagnoser page use the shorter
`max-w-4xl` reading canvas (896 px). Both remain fluid below their cap. These
are existing Tailwind measures, not new design tokens or breakpoints.

Browser baseline at 1920 px: the content region was 1859 px, the JavaScript
header 1835 px, but the result column only 1152 px, all starting at x=73.
Other result surfaces independently capped at 1024/896 px. The result was a
large right-hand void and inconsistent header/result edges. The revised data
canvas is 1280 px, centered within that region; its padded content starts at
x≈363 and is 1256 px wide. Reference explanations stay shorter rather than
stretching across the available width. Detections keeps its existing adaptive
card grid, with fewer, readable columns on an ultrawide panel.

`PageFrame` owns both measures; result-local caps are removed. The unpadded
container-query root, rail, status bar, list-height floor, virtualization and
scrollbar styling are unchanged. The reserved placeholder now uses the same
frame and heading primitive. No user-facing copy, dependencies, permissions,
storage or messaging contracts changed.

## §D receipts

| Check | Evidence                                                                                                                                                                                                                                                                                                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1   | `panel-layout.spec.ts`: all seven routes × 320/480/768/1280/1920 px × light/dark × 360/800 px heights = 140 geometry checks. Every frame has `scrollWidth === clientWidth`; centered equal gutters, exact fluid/capped width, header width and virtual-list width asserted. Heights model bottom/right docking; actual attached DevTools chrome remains manual.                              |
| D-2   | Both stored explicit palettes tested; live system/light/dark writes preserve canvas geometry and search. System follows emulated dark/light immediately. Reduced motion has no **unfinished** animation after settling. Existing `animation-fill-mode: both` retains a finished entrance Animation object, so literal `getAnimations().length === 0` is not claimed. No motion code changed. |
| D-3   | Keyboard Tab from each page heading in all 140 cases reaches an on-screen control with a computed focus ring. Existing full nav/palette/shortcuts and route-heading-focus suites also pass. This is not an exhaustive keyboard walk of every feature state.                                                                                                                                  |
| D-4   | 42 whole-document axe audits: seven routes × 320/1280/1920 px × both palettes at 800 px height. **Zero violations and zero incomplete rules.** Covers fixture-populated scripts/headers/detections, resource empty/present views, reference monitoring and reserved placeholder; not every feature-specific error state.                                                                     |
| D-5   | A real inspected-tab navigation changes script results from populated to filtered-empty while preserving the focused search, query and canvas bounds. Existing soft-refresh suites pass too.                                                                                                                                                                                                 |
| D-6   | Forbidden styling/motion grep over changed source/test files: empty. Existing primitives/tokens only; no viewport breakpoints, new palette literals or scrollbar edits.                                                                                                                                                                                                                      |
| D-7   | Build and all budget rows pass. Panel JS 389.69 → 389.53 kB raw (−0.16 kB); panel CSS 42.12 → 42.03 kB (−0.09 kB), from WXT reports. No row-processing or virtualization algorithm changed. A dedicated 5k-row long-task/TBT measurement was **not** rerun; no new runtime-performance claim is made.                                                                                        |

Visual review: real unpacked Chromium build, baseline at 320/768/1920 px
(light); changed screenshots at the same widths in **both** themes for
Detections, JavaScript and Undefined References. Screenshots attach to the
local Playwright report. Baseline dark screenshots were not captured. Native
attached-DevTools visuals and Firefox runtime remain manual limitations.

## Verification

- `pnpm compile`, `pnpm lint`, `pnpm format:check`, `pnpm test`: pass.
- Unit coverage: statements 96.94%, branches 96.01%, functions 99.50%, lines 97.72%.
- `pnpm build`, `pnpm check:budgets`: pass; no budget increases.
- `pnpm build:firefox`: pass; existing WXT extension-id/data-consent warnings remain.
- `pnpm test:e2e`: **132 passed**, local Chromium including five new layout tests.
- Existing unit assertions mentioning result-local width caps were updated
  because ownership moved to the frame, not to hide failing behavior: the new
  browser regression verifies actual header/result alignment, while frame
  unit tests pin both canvas policies and the unchanged query root.

No promotion candidate: this is the existing page-frame seam, not a new
primitive. No overlap with the parallel scrollbar work is intended; page
component files are the only potential textual merge overlap.
