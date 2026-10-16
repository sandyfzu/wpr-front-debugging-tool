# Independent adversarial scrollbar audit

2026-10-15. Audited implementation: `fcea48742753a18fa2fee4be17c8499577e5c985`,
against `c2bedd8`, on `audit/panel-scrollbars`. No implementation changes made.

## Verdict

**Do not claim universally always-discoverable scrollbars yet.** Normal Chromium
passes actual idle-paint and interaction checks, and the **entire browser suite
passes (128 tests, 1.5 minutes, no retries)**. Forced-colors mode reproduces the
invisible idle scrollbar defect. Firefox also retains OS auto-hide behavior,
which the implementation receipts already acknowledge; this needs an explicit
scope decision rather than an unconditional completion claim.

## Findings

### A1 — P2 / acceptance blocker: forced colors restores invisible overlay bars

**Location:** `assets/css/tokens.css:176–208`;
`tests/e2e/suites/scrollbars.spec.ts:191–195,317–319`.

**Reproduction (headed Chromium, real built extension):**

1. Load the production popup document in an isolated extension-enabled Chromium
   profile, omitting Playwright's `--hide-scrollbars` default.
2. Append a bare `overflow:auto` element, 200×140 px, containing 600×600 px content.
3. Light mode: move the pointer away, wait 2.2 seconds, screenshot the element.
   Both tracks occupy 12 px. Thumb pixels are `[93,102,117,255]`, track pixels
   `[250,251,252,255]`; the horizontal and vertical thumbs are visible.
4. Emulate `forcedColors: 'active'`, move the pointer away, wait 2.2 seconds,
   screenshot again. Both occupied dimensions become **0 px**; sampled thumb and
   track locations are all `[255,255,255,255]`. Visual inspection confirms an
   entirely blank scrollbar region despite overflow on both axes.
5. Exit forced colors: fixed painted tracks return.

**Cause:** the fixed pseudo-element branch is disabled in forced colors, and the
fallback restores the same native overlay mechanism responsible for auto-hide.
Respecting system colors is good; losing discoverability is not necessary to that
goal. This is a real Chromium failure to meet the requested invariant,
not a claim that Windows high-contrast settings were exercised on macOS.

**Safest recommendation:** retain fixed native geometry in Chromium's forced-color
branch while allowing system-selected colors (verify system color keywords and
actual native painting, without globally disabling forced-color adjustment).
Add idle-pixel, occupied-width, hover/drag/leave checks in forced colors. If the
owner intentionally exempts this mode, record that decision and narrow the promise.

**Why existing tests miss it:** the tests assert only computed width/color `auto`,
which is exactly the failing state; they never inspect forced-color idle pixels.

### A2 — P2 / scope decision: Firefox does not meet the visibility promise

**Location:** `assets/css/tokens.css:165–168`;
`docs/plans/scrollbars-feedback-receipts.md:26–30`.

**Actual runtime evidence:** headed Playwright Firefox **155.0** ran the exact
`assets/css/tokens.css` on an overflowing two-axis fixture. The WebKit selector
feature query is false. In light and dark, occupied dimensions are **0×0 px**;
idle screenshots after 2.2 seconds show no scrollbar. Computed colors resolve
correctly, but that does not make a thumb discoverable. Hover screenshots also
show no thumb in this idle scenario.

This was a real Firefox CSS runtime check, **not** an installed Firefox extension
test. The installed desktop Firefox is 158.0 but was not driven. Firefox 155 is
above the manifest's documented 150 floor. The matching current Playwright build
was absent; the existing patched 155 executable was selected explicitly.

**Safest recommendation:** explicitly agree whether always-visible scrollbars are
a Chromium-only requirement. If Firefox must satisfy it too, investigate a
Firefox-specific stable native alternative first; do not change global browser/OS
preferences or add a custom scrolling engine merely to conceal the limitation.
The current documentation is candid, but documentation alone does not satisfy an
unqualified cross-browser acceptance criterion. Not a new undisclosed code defect.

## Non-blocking test-hardening observations

- The shadow probe is appended to the `[data-theme]` wrapper
  (`scrollbars.spec.ts:104–105`), beside rather than inside the open overlay.
  An independent screenshot at that placement showed the white frame over it,
  while computed pseudo-element styles remained correct. The existing shadow
  test never screenshots the probe, so it cannot establish actual idle paint.
  Put a future paint probe inside the overlay's painted stacking context and
  verify a visible identifying mark before sampling pixels.
- `assertPaintedStableBars` exercises dark-mode paint only: the caller leaves
  `data-theme="dark"` before calling it. Light/system palette assertions are
  computed-style checks. The independent headed audit verified actual light →
  dark → light repaint successfully, so this is a coverage gap, not a found bug.
- Drag assertions measure width after release, not visible thumb geometry during
  pointer-down. Horizontal interaction is wheel/keyboard rather than native thumb
  drag in the committed suite. Independent real native drags on **both axes**
  succeeded at 1, 3, 6, 10 and 12 px insets from the outside track edge. No reduced
  hit area was found; the 2 px visual inset remains draggable.
- The ordinary idle-image comparison deliberately makes the thumb transparent
  and forces native repaint. That is meaningfully stronger than CSS-only checks;
  keep it. Do not replace it with width/color assertions when addressing A1.

## Verification receipts

Environment: macOS, Node 24 through `fnm exec --using 24`, pnpm 12.9.1, frozen
lockfile install. The global `AppleShowScrollBars` preference is unset; no OS or
user browser settings were changed. Isolated profiles were used.

- **Full browser tier:** `fnm exec --using 24 pnpm test:e2e`: **128 passed**.
  Build freshness rebuilt this checkout's Chrome production extension first.
  Includes all Docker-site suites, navigation's short-height/menu geometry,
  accessibility, code-copy, virtual lists, shadow surfaces, themes and refresh.
- **Other gates:** compile, lint, repository-wide formatting and production Chrome
  budgets pass. Unit/coverage gate: **175 files; 2,687 passed, 1 skipped**;
  lines **97.72%**, functions **99.50%**. No test expectations were modified.
- **Headed Chromium paint:** actual screenshot pixels verify both axes at idle;
  live light/dark/light switches repaint both track and thumb without an artificial
  overflow reset. Normal and reduced-motion cases occupy 12 px on both axes.
  Existing image tests pass unchanged across hover and post-drag idle.
- **Native pointer reach:** both axes drag successfully across the full sampled
  track width; vertical offsets reach 282 px and horizontal offsets approximately
  287 px. These are real pointer drags, not JavaScript scroll substitutes.
- **Actual data-backed panel:** independent headed checks use the real 301-script
  capture → content script → panel contract. Light and dark screenshots were taken
  at 320×800, 320×240, 480×180, 768×300 and 1280×800. No document horizontal overflow
  was measured. The 320×800 view visibly has one vertical list track plus separate
  horizontal code tracks, with no phantom vertical code track. At short heights
  the page scrolls, as the documented list-height floor requires; content is not
  permanently clipped. The committed suite separately covers 320/480/768/1280 px
  at normal height.
- **Non-overflowing elements:** committed real-browser probes shrink content and
  assert zero occupied scrollbar width/height; those assertions pass. Existing
  `ScrollArea`'s deliberate stable gutter is not mistaken for a new global gutter.
- **Host isolation:** the full suite's host root readback remains unchanged;
  independent host-root pseudo width is `auto`, not the extension's 12 px rule.
  No implementation selector crosses out of the shadow tree. A correctly stacked
  bare probe inside the real open shadow overlay visibly paints both dark native
  tracks after idle; its identifying text is visible in the screenshot.
- **Firefox:** production build passes; exact stylesheet runtime limitation is A2.

### Evidence on this machine

All standalone audit scripts and raw evidence are outside the repository, under
`/private/var/folders/ch/n74cjyr900d98tcydn9lp8940000gn/T/opencode/`:

- `scrollbar-full-e2e.log` — complete 128-test run.
- `scrollbar-audit.cjs`, `scrollbar-paint-headed.json`,
  `audit-headed-{light,dark-live,light-live,forced-idle,reduced}.png` — exact
  screenshot pixel samples, geometry and native drag offsets.
- `scrollbar-firefox.cjs`, `scrollbar-firefox.json`,
  `firefox-{light,dark}-{idle,hover}.png` — standard-branch runtime evidence.
- `scrollbar-surfaces.cjs`, `scrollbar-surfaces.json`, `panel-*.png`,
  `shadow-dark-idle.png` — actual panel geometry and injected-surface evidence.
- `scrollbar-firefox-build.log` — secondary-target production build.
- `scrollbar-audit-unit.log` — complete unit/coverage gate.

These are local audit evidence, not shipped assets or portable committed fixtures.
The full browser report is `tests/e2e/playwright-report/index.html` (gitignored).

### Limitations / no overclaim

- No attached DevTools right/bottom-docked visual session; standalone panel pages
  use the existing genuine tab-id contract shim. No browser-action popup envelope
  automation; the actual built popup document was tested in a browser tab.
- Forced colors was browser-emulated on macOS, not Windows OS high contrast.
- Firefox extension loading, the 145 Chrome floor, touch hardware, RTL and zoom
  were not exercised. No claim of their verification is made.
- No implementation fix, dependency change, permission change, push, delegation,
  main/develop modification or browser/OS preference change was performed.
