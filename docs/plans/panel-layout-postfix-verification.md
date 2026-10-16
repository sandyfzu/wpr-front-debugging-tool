# Independent post-fix panel verification — 2026-10-16

## Verdict

**Accept the two geometry fixes; block unconditional UI-bar acceptance.**
`LAYOUT-1` and `LAYOUT-2` are resolved. One P2 accessibility acceptance gap remains:
loading and persistent shell errors have no h1 and fail the mandatory per-state
axe gate. Being pre-existing does not waive that gate. No implementation was
changed by this verifier.

Reviewed/tested SHA: `ece65687d7b2962b1bd1900809416b0e34e15b21`.
Worktree/branch: `wpr-fdt-verify-layout` / `verify/panel-layout`.
Read repository instructions, the binding UI bar, original implementation and
receipts, independent audit, scoped fix, production diff and relevant tests.

## Confirmed geometry results

- Shared `PageCanvas` owns centering/padding; route metadata declares the reading
  measure once. `PageFrame`, boot skeleton, data error and render-crash fallback
  all consume it. No refresh-state wrapper/remount or scrollbar policy change.
- At 1920×220 the content region measures 1859 px. JavaScript's canvas is
  1280 px with equal 289.5 px gutters; skeleton content begins at x=362.5.
  Independently releasing the genuine tab reply produces a ready heading at
  **exactly that same x**: zero horizontal relocation. The reading canvas is
  896 px with equal 481.5 px gutters, content x=554.5. The existing genuine
  boot-settlement suite independently passes for both measures.
- At 320×220, the canvas is 259 px, padded content spans x=73–308. All four
  skeleton bars are contained; the short bar shrinks to 235 px. Main, canvas
  and document each have `scrollWidth - clientWidth === 0`. Canvas overflow
  remains `visible`: this is containment, not clipping an oversized bar.
- Independent samples: seven destinations × five sizes (320×220, 480×360,
  768×220, 1920×220, 3440×800) × loading/error × system/light/dark = **210**
  geometry samples. Width expectations are independent literals, not imported
  route metadata. Live hash changes update both policies before data arrives.
- Keyboard Tab reaches Retry; Enter removes the old error and visibly enters
  loading with a genuine reply held. Releasing it reaches ready, without a
  document reload. This proves more than merely observing the error again.
- Native extension-tab zoom 2 changes `innerWidth` from 640 to 320; loading and
  error remain contained in all three themes. Existing native-zoom tests also
  pass on all seven ready routes. Zoom is restored to 1.
- Browser render-crash test injects a one-shot exception when rendering the
  JavaScript route's `data-fdt-page` attribute, restoring the native method
  before throwing. The real boundary renders its recovery UI. All seven hash
  destinations at 320/1920×220 retain the correct live width and zero overflow.
  This supplements the existing crash unit test; no application test hook used.

## P2 acceptance blocker — heading-less shell states

**Locations:** `entrypoints/panel/App.tsx:289–317,361–373`,
`components/ui/error-state.tsx:65`, and
`tests/e2e/suites/panel-layout-states.spec.ts:73–99`.

Independent whole-document axe runs reproduce exactly
`page-has-heading-one`, impact **moderate**, with no incomplete rules in held
loading, persistent data-error, and browser render-crash states. A separate
strict error-state reproducer asserts one h1 and zero violations; it genuinely
fails: **h1 count 0**, one axe violation. The error's visually prominent title
is a `div`, not a heading. Retry remains usable and the error is an alert; this
is not a total accessibility failure or evidence, by itself, of WCAG AA failure.

It nevertheless directly violates binding **T-4** (exactly one h1 per page) and
**D-4** (zero axe violations per state). Loading is transient; data errors and
crashes can persist indefinitely. The touched fallback surfaces are explicitly
part of this patch's acceptance matrix, so this is relevant to acceptance rather
than an unrelated feature request. The worker disclosed it accurately, but the
phase receipt cannot authorize a weaker rule than the binding bar.

The new test expects the violation rather than disabling its rule. That is
transparent regression detection for additional findings, **not** a passing
D-4 audit; it also makes eventual correction of this defect fail the test.
Require authentic fallback heading semantics and a clean per-state audit, or an
explicit owner-approved change/exception to the binding bar. Do not invent a
misleading route heading merely to satisfy axe. Geometry acceptance stands
independently of that decision.

## Test/architecture review

- The shared route-owned policy is small and coherent; no conflicting page-local
  `reading` choice remains. Crash fallback reactivity is proven in unit and real
  browser runs. No production architecture blocker found.
- Unit class assertions alone cannot prove geometry; actual layout, descendant
  bounds, unclipped overflow and independent dimensions cover that limitation.
- Existing `panel-layout.spec.ts:58` calls `heading.focus()` itself. Its later
  focus assertion is not automatic-focus evidence. The separate a11y suite and
  independent real hash changes assert focus without issuing `focus()`.
- Existing fallback Retry test can observe the same error before proving that a
  new request settled. Existing boot tests cover retry activity; independent
  verification additionally observes error → held loading → genuine ready.
- The original audit's fixed 2 s delay is timing-sensitive on slow machines.
  Its unchanged assertions pass, but the explicit held-reply tests are stronger.
- The new loading suite polls implementation classes to await route settlement;
  geometry assertions still independently pin actual caps/containment. Empty
  virtual-list loops in other tests are not populated-list evidence; the real
  5000-script test separately passes, with fewer than 100 mounted rows and no
  sampled action long task over 50 ms.

## Gates and reproducible evidence

Node 24 via `fnm exec --using 24`; pinned pnpm frozen install, compile, lint,
format check, full unit/coverage gate, fresh Chromium build, budgets and Firefox
build all pass. Unit result: **175 files, 2697 passed / 1 skipped**; coverage:
96.94% statements, 96.01% branches, 99.50% functions, 97.72% lines. Panel JS
389.83 kB / CSS 42.05 kB; no changed budget ceilings. Firefox emits its existing
extension-ID/data-consent warnings; runtime not claimed.

The final 28-test pertinent browser run: **27 passed / 1 failed**, no retries or
expected-failure markers. All 24 existing selected tests pass; three independent
geometry/recovery tests pass. The sole failure is the deliberately strict,
unwaived heading/axe reproducer above. Separate browser crash test: **1 passed**.
Do not describe this as a wholly green accessibility run or a full browser run.

Fixtures are served by this verifier's own loopback port **18961**, forwarding
the browser's standard fixture requests without changing their visible origin.
No other session's server is reused. The harness's pre-fixture warm-up still
tries 8891 and logs connection refusal before forwarding is installed; actual
fixture/measurement requests succeed. This warm-up is not relied upon for any
header-content claim here. Production sources/build inputs are unchanged.

Evidence directory:
`/private/var/folders/ch/n74cjyr900d98tcydn9lp8940000gn/T/opencode/panel-layout-verification/`.
It contains raw unit/Firefox/browser logs, `final-report/`, `crash-report/`,
named PNGs, full axe/geometry attachments, and `runtime-source/` (independent
spec, forwarding fixture, config and unchanged copies of the selected suites).
The local command was `fnm exec --using 24 pnpm exec playwright test --config
.output/verification/config.ts`; crash-only adds `--grep 'browser render-crash'`.
Only this report is committed; verifier runtime files stay ignored/archived.

The first experiment had three verifier-harness failures: wrapping both browser
namespaces could requeue a released callback. Corrected the release gate, not
production or acceptance assertions; the three cases then passed. An initial
crash probe targeted an insertion method this render path did not call; the
successful probe targets the actual route attribute write. These unsuccessful
experiments remain in `browser.log`/`first-report/` and `crash.log`, not counted
as production failures or clean final evidence.

A post-report unit run initially discovered the temporary copied Playwright
specs under `.output/verification/` (outside Vitest's `tests/e2e/` exclusion),
causing seven suite-collection failures while all 2697 unit assertions passed.
Archived that verifier-only runtime outside the repository before the final
unit gate; no project test/configuration was weakened. The original collection
log is retained as `unit-final.log`; the clean rerun is `unit-clean.log`.

Opened and visually inspected narrow/ultrawide loading, light/dark ready pages,
persistent errors, 200% loading/error zoom and the narrow crash fallback.
Native docked DevTools chrome, Firefox runtime, exhaustive screen-reader and
feature-specific asynchronous-state coverage, every keyboard action, and the
full live-site browser suite were not independently rerun. This is a scoped
post-fix verifier, not a claim that those remaining integration checks passed.
