# Panel UX integration — 2026-10-16

## Scope and status

Integration worker on `integrate/panel-ux`, starting at heading fix
`d315ce93c0c4aaea93aaee59e23f92dc63173b8b`. Merge
`caffb866effb15ea5779c85c06e592c96d2dc206` combines that exact parent with accepted
scrollbar tip `20f7d4ac5409a0030b02e80d75c50d09f02e696a`, using `--no-ff`.
Git reconciled the histories without textual conflicts. No source implementation,
dependency, permission, budget, UI-bar rule or recovery semantics changed here.
No push, delegation, Orca orchestration or other branch modification.

**Integration evidence, not final independent acceptance.** The subsequent
independent combined auditor still owns that decision. Prior scrollbar acceptance
and the heading worker's receipts are inputs, not substitutes for this run.

## Integration-only test correction

The first actual full browser run: **140 passed, 4 failed**, no retries. All four
failures were the new 220 px-height failure/recovery cases, before their axe runs:
at 320 px panel width, the scroller's outer box is 259 px, its native vertical
track occupies 12 px, and the canvas correctly fills the remaining 247 px. The
test expected 259 px and counted the track as an asymmetric right content gutter.

`tests/e2e/suites/panel-layout-states.spec.ts` now measures the usable scrollport:
`clientWidth`, starting at `getBoundingClientRect().left + clientLeft`. Its right
edge is that start plus `clientWidth`. The independent 896/1280 px caps, equal
content gutters, containment, zero horizontal overflow, actual headings,
keyboard recovery and strict axe assertions remain unchanged. A new explicit
narrow-error assertion requires overflowing content **and a real 12 px occupied
track**, preventing an overlay-only run from silently dropping this regression.

Changing this existing test is necessary: production cannot both reserve a
native track and fill that track with page content. Disabling native bars,
clipping content, widening the canvas into the track or weakening the cap/gutter
assertions would violate the two tracks' intentions. No application fix was
needed. This is a corrected measurement boundary, not a relaxed tolerance.

## Combined gates

Node **24.21.0**, via `fnm exec --using 24`; all gates run in this worktree.

- Compile, lint, repository-wide formatting: pass.
- Full unit/coverage: **175 files; 2698 passed, 1 existing skip**. Statements
  **96.94% (2286/2358)**, branches **96.01% (1638/1706)**, functions
  **99.50% (399/401)**, lines **97.72% (1935/1980)**.
- Fresh Chromium production build and unchanged budgets: pass. Panel all-chunk JS
  **380.9 KiB**, gzip **117.9 KiB**; panel CSS **42.48 kB** (WXT decimal units).
  The budget tool names options/exclusion-builder absent, as before: they are
  unbuilt surfaces, not newly verified UI. Runtime cold-start is the browser gate.
- Firefox production build: pass; existing data-collection declaration and
  extension-ID warnings remain. No Firefox extension runtime claim.
- Final full Chromium browser gate: **144 passed, 3.5 minutes, zero retries or
  expected failures**, including all seven strict fallback cases and all three
  scrollbar cases. The fallback audits require zero violations **and** zero
  incomplete rules in held loading, data errors, real render-boundary crashes
  and recovered ready; both narrow/wide keyboard Retry transitions pass. The
  full run also includes native 200% zoom, real 5000-script virtualization and
  performance, cold-start, live refresh/theme preservation and all site suites.
  Log: `browser-full-scrollport.log`; archived report: `full-report/`, raw
  attachments: `full-results/`. The earlier failing integration log is retained
  as `browser-full-final.log`, not described as passing evidence.
  Also opened the saved narrow light fetch error, narrow dark loading/crash and
  ultrawide light crash images: authentic visible titles, contained placeholders
  and visible native tracks. Short error/crash surfaces scroll; the suite's
  Tab/Enter walks prove Retry remains reachable. Named samples are in `visual/`.
- Additional headed scrollbar run: **3 passed, 1.5 minutes, zero retries**,
  including normal/forced-color pixels, both-axis native input, shadow isolation
  and narrow JavaScript layouts. Log: `browser-scrollbars-headed.log`; its report
  remains in `runtime/tests/e2e/playwright-report/`, separate from `full-report/`.

## Real attached/docked DevTools investigation

**Actual native docking is programmatically reachable on installed Chromium
156.0.8078.4.** A fresh owned headed browser profile loads this worktree's built
extension. Browser CDP `Target.openDevTools` (verified in the installed protocol
types) opens the inspected site's native frontend. Its actual registered WPR FDT
tab is selected through that frontend, and the panel is a genuine extension
iframe, not a standalone tab. `chrome.devtools.inspectedWindow.tabId` is read back
as the native positive tab id; no namespace shim or data-store injection is used.

After waiting for the frontend's real tab DOM, the local probe imports its
installed `ui/legacy/legacy.js` module and uses the observed InspectorView and
DockController methods. It changes docking only in this disposable profile, never
the user's preferences or existing browser. Direct debugger WebSockets address
the frontend and the extension iframe. Closing the owned context closes them.

**28 ready geometry samples pass:** seven routes × light/dark × right/bottom.
Each requires one h1, correct independent reading/inventory cap, equal scrollport
gutters and zero document/scroller/canvas horizontal overflow. Four strict
whole-panel axe audits (Diagnoser, each palette/dock) have **zero violations and
zero incomplete rules**. Both palettes switch live through real synced storage.

Observed right panel: **554×788**, inspected page **945×913**; Detections canvas
**481 px**, 12 px occupied native track. Bottom panel: **1500×232**, inspected
page **1500×613**; Detections canvas **1280 px**, scrollport **1427 px**, equal
**73.5 px** gutters and a 12 px track. The changed inspected-page dimensions and
native frontend's dock-side readback distinguish real docking from resized tabs.
Opened and visually reviewed all four native frontend screenshots: actual WPR
FDT selected, visible light/dark Diagnoser heading, rail/overflow menu and status
strip remain readable and contained. The compositor screenshot's inspected-page
area is blank; no claim about the host page's painted pixels follows from it.

This is a **ready-state docking smoke**, not exhaustive native UI-bar acceptance:
it does not cover every prescribed panel width while natively docked, all native
DevTools keyboard interception, native fallback/crash states, every control or
screen reader. Standalone production-document state/width tests are separate.
The first probe's obsolete `devtools: true` option opened no native target; the
successful path explicitly uses `Target.openDevTools`. An initial attempt to
access InspectorView before frontend initialization failed with missing locale
data; waiting for actual tab DOM resolves that probe race, not an app defect.

## Isolation, reproduction and UI-bar coverage

Evidence root (local, outside Git):
`/private/var/folders/ch/n74cjyr900d98tcydn9lp8940000gn/T/opencode/panel-ux-integration/`.

The copied harness is under `runtime/tests/e2e/`, with fixture-port references
changed from 8891 to owned loopback **18981** in server/helpers/fixtures/suites.
Both fixture origins and warm-up remain real. Root links point to this checkout's
build, source imports, budgets and Docker config. The copied config omits global
build setup (explicit fresh build already ran) and Docker startup (the existing
site's `/fdt/` returned 200); it never starts/stops someone else's site. External
placement also avoids accidental Vitest collection of copied browser specs.

Two preliminary collection attempts failed before running tests: the external
copy lacked an ESM package boundary, then lacked its source-import root link.
Adding a private `type: module` package and the source link fixed only the local
copy. No committed configuration or expectations changed to bypass those errors.

Reproduce the isolated run after a fresh build:
`fnm exec --using 24 pnpm exec playwright test --config
<evidence-root>/runtime/tests/e2e/playwright.config.ts`.
The actual native docking smoke is
`fnm exec --using 24 node <evidence-root>/actual-docked.cjs` (owned debugging port
18983); inspect `actual-docked.json`, `actual-docked-ready.log` and
`native-{right,bottom}-{light,dark}.png`. Gate logs are alongside those files.

UI-bar receipts: D-1's standalone width matrix and actual docking smoke remain
distinct above; D-2–D-5 retain the combined suite's themes, reduced motion,
keyboard, strict per-state axe and real refresh checks. D-6 introduces no color,
motion or breakpoint declarations. D-7 keeps production bytes unchanged by the
integration-only test correction; the combined full suite owns the real 5k-script
and cold-start measurements. No broader performance/AT claim is made.

Residual platform limits remain: Firefox's disclosed native auto-hide behavior,
Firefox extension runtime, Windows high contrast (forced colors are emulated on
macOS), minimum Chrome 145 runtime, touch, RTL, native popup browser envelope and
exhaustive assistive-technology behavior are not newly verified.
