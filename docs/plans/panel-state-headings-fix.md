# Panel fallback headings — 2026-10-16

## Scope and decision

Addresses the P2 blocker in `panel-layout-postfix-verification.md`, on
`fix/panel-state-headings` from `bb91d6c` (geometry fix `ece6568`).

Loading now visibly says **Loading page data**, using `PageHeader` instead of
the title-shaped skeleton. This is the actual state, not a claim that the
destination's data is ready. The three content placeholders remain. Full-page
data errors and render crashes opt into `ErrorState.pageHeading`: their existing
visible failure titles use `PageHeader` as the sole h1, within the existing alert.
Embedded `ErrorState` consumers retain their existing non-heading title: they
must not create a second page heading or invent a section level.

No screen-reader-only heading, duplicated title, hidden content, axe exclusion,
new dependency, route registry, canvas, scrollbar, or retry implementation.
The only new visible copy is the loading title (already the live-region copy).
No h2 is warranted in these single-purpose fallback surfaces.

## Focus and tests

Route navigation during loading now focuses its real, programmatically focusable
loading heading through the existing selector. Data settlement does not itself
move focus. Error/crash titles are not destination headings: the existing
route-focus selector continues to leave focus alone in those states. Retry still
re-fetches data; crash Retry still reloads only the panel document.

The old loading unit assertions (no h1, four placeholders, skipped route focus)
necessarily change because they pinned the defect being fixed. They now require
one visible, honest h1, three content placeholders, loading route focus and no
focus theft on settlement. The defensive missing-heading focus test still tests
the same no-op, renamed to avoid describing it as the actual loading UI. Error
primitive tests pin both page-heading opt-in and unchanged embedded semantics.
Every route's loading/error/retry/ready canvas remains covered by the existing
unit regression, and the crash test pins one h1 and its reload action.

Browser regression changes the old expected `page-has-heading-one` violation to
strict zero violations and zero incomplete results, without disabling rules.
The existing geometry assertions remain unchanged. Additional browser tests
fail the first real transport response, keyboard-activate Retry, hold its genuine
reply, observe error → loading → ready, then throw once at the actual JavaScript
route attribute write. They restore the native method before throwing, exercise
the real crash boundary, and keyboard-reload to the ready Diagnoser. There is no
production test hook. Both palettes cover 320/1920×220 error/loading/crash states;
both Retry transitions run at each width. The crash canvas also traverses all
seven routes while the boundary is active.

## Validation and §D receipts

- **D-1:** existing ready geometry suite is unchanged. The fallback suite keeps
  its independent 896/1280 px caps, equal-gutter, zero horizontal overflow and
  skeleton-containment assertions unchanged, across 320/480/768/1280/1920 widths
  and all seven loading routes. Both reading and inventory canvases settle to
  exactly their loading geometry. New failure/crash checks add 220 px height at
  320/1920 widths. No scrollbar policy changed.
- **D-2:** held loading and persistent errors pass in system/light/dark; render
  crashes pass in light/dark. Reduced-motion loading has zero running animations;
  ready-state motion and live appearance changes retain the existing checks.
  No new animation or theme token is introduced.
- **D-3:** real Tab/Enter reaches data-error Retry, observes held loading, then
  genuine ready. The crash Retry is also keyboard-activated and demonstrably
  reloads into ready. Loading route focus is observed, not forced by the driver.
  Existing ready-route automatic focus and refresh-preservation suites remain.
- **D-4:** whole-document axe runs have zero violations **and** incomplete results
  in held loading, data error, render crash and recovered ready. No rules or
  elements are excluded. Exactly one visible h1 is required in each audit.
- **D-5:** the route/data machine and refresh render arm are untouched; existing
  browser preservation checks exercise real data pushes, focus, scroll and live
  appearance changes.
- **D-6:** binding grep over all eight changed source/test files returns no hits.
- **D-7:** no list logic changed; existing real 5,000-script and cold-start tests
  pass. All committed budgets pass unchanged. Panel JS **390.00 kB** (was
  389.83 kB), CSS **41.98 kB** (was 42.05 kB), using WXT's decimal build sizes.

All commands use Node 24 (`fnm exec --using 24`). Compile, lint, format check,
full unit/coverage, fresh Chromium production build, budgets and Firefox build
pass. Unit gate: **175 files; 2698 passed, 1 skipped**; coverage statements
96.94%, branches 96.01%, functions 99.50%, lines 97.72%. Firefox retains its
existing extension-ID/data-consent warnings; Firefox runtime is not claimed.

The final **143-test full browser run passes**, without retries or expected
failures, including all seven fallback tests. The earlier full run also passed
141/141 before adding the separate narrow/wide keyboard recovery combinations.
Native 200% zoom, real 5,000-script performance/virtualization, live theme/data
preservation and all site suites pass. Opened and visually reviewed the narrow
light/dark errors, narrow light crash, wide dark crash, narrow dark loading and
wide light loading screenshots: visible, readable state titles and reachable
recovery controls, no fake route content or clipped placeholders.
The first focused attempt passed all 17 existing selected cases but failed the
two new recovery tests: their initial shim set only `chrome.devtools`, while WXT
uses the available `browser` namespace. Corrected the harness to set the real
inspected-tab value on both, without changing acceptance assertions. The added
request flag also proves that the failure traversed the transport seam, not the
missing-inspected-tab path. Failure is injected in the real request callback;
the held Retry reply is the real fixture content-script response.

Fixture isolation: an ignored copy of the test harness under
`.output/state-headings-runtime/` uses loopback **18971**, replacing 8891 in its
server/helpers/fixture references only. This preserves the two-origin cases and
warm-up while avoiding other sessions' fixture servers. It loads this worktree's
fresh production extension. The copied config omits build setup (the build was
run explicitly) and Docker startup (the existing site's `/fdt/` returned 200);
it neither rebuilds nor starts another session's site. No committed harness or
server configuration changed. Runtime copies are archived outside the repository
before final unit collection.

Evidence directory:
`/private/var/folders/ch/n74cjyr900d98tcydn9lp8940000gn/T/opencode/panel-state-headings/`.
It holds unit/build/budget/Firefox/browser logs, the full browser report with
named screenshots, and the isolated runtime source/config. The first full-suite
attempt hit the shell's 120-second timeout; the final run removes that timeout.
The immediate retry refused its leftover fixture listener; verified that PID's
working directory belonged to this runtime and stopped only that owned process
before restarting with a fresh server.
Final browser log: `browser-full-143.log`; report: `browser-report/`; named visual
samples: `visual/`; archived harness: `runtime-source/`. To reproduce, copy the
archived harness back to `.output/state-headings-runtime/`, then run
`fnm exec --using 24 pnpm exec playwright test --config
.output/state-headings-runtime/playwright.config.ts` after a fresh build.

Limits: no native docked DevTools chrome, Firefox runtime, or exhaustive
screen-reader testing. The browser drives real standalone extension documents
with the inspected-tab value that DevTools supplies. Automated keyboard, theme,
zoom, layout, live-data and axe checks are not a claim of exhaustive manual AT
coverage.
