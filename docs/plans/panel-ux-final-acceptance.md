# Panel UX final acceptance

## Outcome and source identity

Accepted for primary Chromium after the independent combined audit. The accepted
candidate is `ea8269819438f3f6a1acf1b1dd99ee244472d5f2` (`integrate/panel-ux`).
It was merged without squashing into `review/panel-ux`, preserving both histories.
The merge tree is identical to the accepted candidate; reconciliation adds only
this receipt, not implementation or test changes. Retained browser evidence is
reused for that unchanged source tree, not represented as a new browser run.

## Independently verified results

- Compile, lint, formatting, Chromium and Firefox production builds, and Chromium
  bundle budgets passed. Firefox emitted WXT distribution warnings about data
  collection permissions and an extension ID; build success is not store approval.
- Unit gate: **175 files passed; 2,698 tests passed, one conditional fixture-export
  test skipped** (`PERF_FIXTURE_OUT` unset). Coverage: **97.72% lines, 99.50%
  functions**. The skip is the existing opt-in performance-fixture export, not a
  skipped UX regression.
- Full browser suite: **144 passed**, with no failures, retries, or skips.
- Headed browser checks: **5 passed**: three scrollbar checks and two independent
  regressions covering overflow-injection detection/native zoom and real
  virtual-list geometry at ultrawide, shallow dimensions.
- Actual right- and bottom-docked DevTools, light and dark: **28 route geometry
  checks and four strict axe audits passed**, using the real inspected-tab contract
  without a tab-ID shim. All measured document/main/canvas overflow was zero;
  canvases were centered within the usable native scrollport and respected caps.
- The `clientWidth` measurement correction accounts for occupied native scrollbar
  space. Independent oversized-descendant injection made both canvas and main
  overflow positive, then cleared after removal: the correction does not hide
  overflow behind clipping.
- Genuine delayed loading, fetch error, held Retry, crash and recovered states
  retained a visible, truthful single `h1`. Strict axe checks reported no
  violations or incomplete results, with no exclusions.
- Headed pixel checks verified painted **12px** native scrollbars at idle, stable
  hover, held vertical and horizontal drags, pointer leave and return to idle.
  Light/dark/system changes, forced colors, popup and shadow-isolated injected
  surfaces passed; fitting content did not acquire phantom tracks and host page
  scrollbars remained untouched.
- Narrow **320px**, ultrawide **3440px**, shallow-height, native **200% browser
  zoom**, and **5,000-script** virtualization/performance checks passed.

## Explicit limitations

- Firefox **155.0** retains platform-native autohide. Wheel and keyboard scrolling
  worked in the CSS probe; this was **not an installed-extension Firefox test**.
- Forced colors were emulated on macOS, not tested in Windows High Contrast.
- Minimum Chrome 145, touch, RTL, and exhaustive assistive-technology coverage
  were not tested.
- Actual docked checks covered ready routes, not every fallback-state/docking
  combination. Fallback evidence comes from the separate browser checks above.

## Retained evidence

Local evidence root (not a portable or committed artifact archive):
`/private/var/folders/ch/n74cjyr900d98tcydn9lp8940000gn/T/opencode/`.

- `final-ux-gates.log`: independent common gates, coverage, both browser builds.
- `final-ux-audit/full-e2e.log`: all 144 passing browser checks.
- `final-ux-audit/headed-e2e.log` and `headed-report/`: five headed checks and
  screenshot attachments, including painted idle/held-drag scrollbar evidence.
- `final-ux-audit/actual-docked.json`, `actual-docked.cjs`, and
  `native-{right,bottom}-{light,dark}.png`: real docked geometry, audit results,
  probe method and screenshots.
- `final-ux-audit/scrollbar-fix-firefox.json` and `fix-firefox-*.png`: Firefox
  CSS-probe version, scrolling results and native-autohide evidence.
