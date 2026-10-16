# Panel canvas fallback fix — 2026-10-16

## TL;DR

Resolves LAYOUT-1 and LAYOUT-2 from the [independent audit](panel-layout-independent-audit.md).
Loading, data-error, render-crash and ready bodies now use the same centered
canvas. Route metadata owns the reading/data width choice. The short loading bar
shrinks at 320 px without hiding overflow. No scrollbar or harness changes.

## Root causes and scope

- **LAYOUT-1:** the cold-loading section and both shell errors retained their own
  full-width padding instead of using the ready page's bounded column. At 1920 px
  the loading-to-ready data edge moved 289.5 px. `PageCanvas`, extracted from
  `PageFrame`, now owns that unchanged column policy. `NavRoute.reading` declares
  the two explanation-heavy routes once, so a deep link or route switch while
  loading/error uses the destination's measure immediately. Ready pages no longer
  independently opt into reading width.
- **LAYOUT-2:** the fixed 256 px short bar exceeded the available 235 px content
  box, including a 9 px overflow beyond the padded root. `max-w-full` alone was
  empirically insufficient: the implicit grid track still took the bar's
  intrinsic width. `grid-cols-1` supplies `minmax(0, 1fr)` and the bar's maximum
  then resolves against available space. Both fixed bars are bounded; neither
  the frame nor descendants conceal horizontal overflow.
- Skeleton vertical spacing is retained: the canvas's existing gap plus `mt-1`
  replaces the old standalone `mt-4`. No timing, retry, focus policy, data
  machine, refresh ownership, dependency, permission or user-facing text changes.

## State inventory

| Path                                            | Outcome                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pre-mount appearance read                       | Existing paint lock; no body is painted until appearance resolves/degrades. Unchanged.                               |
| Shell idle/fetching                             | Unpadded query root + route-owned `PageCanvas`, bounded bars; no fabricated h1.                                      |
| Shell data error/retry                          | Same canvas, existing actionable `ErrorState`, retry returns to real loading.                                        |
| Shell render crash                              | Same route-owned canvas, existing panel-document reload recovery. Unit-tested including a route change while failed. |
| Shell ready/refreshing                          | Existing `PageFrame` now composes the extracted canvas; refresh still keeps content mounted.                         |
| Undefined References processing/failure         | Already inside `PageFrame`; retains its reading width across its local state machine.                                |
| Other page empty/absent/filtered/results states | Already inside their owning `PageFrame`; no result-local policy added.                                               |

The route table imports its bodies synchronously: there is no panel `Suspense`
or lazy route fallback to migrate. Status-bar placeholders belong to persistent
shell chrome, not the page canvas, and remain unchanged.

## Tests

- Existing independent audit: removed only `test.fail` immediately before its
  original geometry assertions. Both assertions now pass unchanged.
- Shell unit tests pin every route across loading → error → retry → ready,
  bounded fixed bars, no fake loading heading, live pre-data route changes, and
  crash-fallback width. Existing refresh identity/focus tests remain intact.
- Frame test now exercises route-owned reading width; the misleading Lazyload
  test name now accurately describes frame-owned sizing (assertions unchanged).
- `panel-layout-states.spec.ts` holds genuine tab-message replies (no replacement
  store/payload), walks all seven loading routes at 320/480/768/1280/1920 in
  system/dark/light, checks both actual overflow and every bar's bounds, then
  releases the reply and compares loading/ready geometry. Reading and data
  settlement are both covered. A standalone panel exercises the real error and
  retry path at every width with both canvas policies. Container-query geometry
  is sampled after two animation frames, not before the browser commits layout.

## §D receipts

- **D-1:** loading/error supported-width matrix above; ready-state matrix retains
  all seven routes in both palettes at 360/800 px heights. Original independent
  ultrawide/shallow/200% native zoom and 5k-script tests retained. Actual docked
  DevTools chrome remains manual; the real extension page is resized by harness.
- **D-2:** system under dark OS, explicit light/dark, reduced-motion loading and
  ready states have no unfinished animations after paint. Existing live
  appearance/search preservation test remains unchanged. Real waits are held by
  the test only; no production timer or artificial delay was introduced.
- **D-3:** loading keyboard Tab → JavaScript link → Enter stays usable before
  reply; error Retry reached by real Tab walking, visible computed ring, Enter
  retries. Genuine ready hash switches assert automatic h1 focus, without test
  calls to `heading.focus()`. Existing full shell/nav/palette coverage retained.
- **D-4:** 24 fallback axe samples (loading/error × two widths × two policies ×
  three themes) have no incomplete rules and exactly the pre-existing
  `page-has-heading-one` best-practice finding. This is **not a zero-violation
  claim**: loading intentionally has no fake route heading; the shared error
  primitive also has no h1. The new test disables no rules and pins that exact
  finding, rejecting any additional one. Ready-state strict axe remains covered
  by the existing suites. Heading semantics need a separate scoped decision.
- **D-5:** full refresh suite and existing live appearance/data-change canvas
  test retain node/query/focus/scroll behavior; no ready-content wrapper added.
- **D-6:** production-diff grep is empty for hardcoded colors, viewport tiers,
  unapproved animation/duration classes, transition-all and smooth scrolling.
- **D-7:** unchanged independent 5k script long-URL/virtualization/action sample
  retained; no performance expansion claimed. Chromium panel chunk 389.83 kB
  versus audit 389.53 kB (+0.30 kB); panel CSS 42.05 kB versus 42.03 kB (+0.02 kB).
  All existing budgets pass without changed ceilings.

## Verification and limits

Node 24 + pinned pnpm frozen install completed without lockfile changes. Compile,
lint, format check, full unit/coverage gate, Chromium production build, budgets
and Firefox build pass. Unit gate: 175 files, 2697 passed / 1 pre-existing skipped;
coverage 96.94% statements, 96.01% branches, 99.50% functions, 97.72% lines.
Firefox retains the existing extension-ID/data-consent warnings; no runtime
Firefox verification is claimed.

Real-browser screenshots of both loading measures at 1920 and bounded loading
at 320, plus light/dark error screens, ready JavaScript/Undefined References at
320/1920, and the Retry focus ring, were opened and visually inspected. The full
browser run passed **139/139** with no expected failures or retries. The final
targeted run passed **24/24**, including the strengthened data-canvas boot
settlement comparison and ready screenshots. Evidence (named PNGs, full and
targeted HTML reports) is retained under
`/private/var/folders/ch/n74cjyr900d98tcydn9lp8940000gn/T/opencode/panel-layout-fix/`;
adjacent `layout-fix-unit-final.log`, `layout-fix-e2e-full.log` and
`layout-fix-e2e-relevant-final.log` retain the raw gate output.

A subsequent full run, after strengthening the data-canvas settlement assertions,
completed **137 passed / 2 failed**: both failures were fixture navigations in
`undefined-references.spec.ts` returning `ERR_CONNECTION_REFUSED` from port 8891.
The layout suites all passed. A direct health request confirmed the fixture
server was gone; the run had reused another session's server. The failed run is
retained as `layout-fix-e2e-full-final.log` and `interrupted-server-report/`, never
counted as a clean pass. A worktree-owned server was then started using the
unchanged `tests/e2e/server.mjs`; its full rerun is recorded separately.
That final owned-server run passed **139/139** (1.9 min), no retries or expected
failures, including the final strengthened tests. Raw output:
`layout-fix-e2e-owned-server.log`; report copy: `owned-server-full-report/`.

Native docked DevTools chrome, exhaustive
screen-reader operation, and every feature-specific asynchronous error state
remain manual; crash layout is unit-tested, not browser-fault-injected.
