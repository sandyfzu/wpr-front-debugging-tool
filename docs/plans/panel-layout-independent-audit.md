# Independent panel-layout audit — 2026-10-15

## Verdict

The ready-state change is small, coherent and visually improves alignment. No
new ready-state functional, security, theme or overflow regression was found.
**Do not describe the work as consistent across all states yet:** two confirmed
loading-state issues remain. Neither is a P0/P1 emergency; both are P2 quality-bar
acceptance blockers below. Implementation was not changed in this audit.

Audited implementation: `a92e01395e13103be8d79c7940ea7bbc9a828f35`, against
`c2bedd8`; worktree/branch: `wpr-fdt-audit-layout` / `audit/panel-layout`.
Read the actual diff, repository instructions, `docs/ui-ux-bar.md`, frame,
consumers, shell fallbacks and the new tests/receipts. Tests use the real unpacked
production extension and real content-script data path, not a replacement store.

## Findings requiring a scoped follow-up

### LAYOUT-1 — P2: cold-loading canvas bypasses the new layout

- **Location:** `entrypoints/panel/App.tsx:352-360` (`SkeletonPage`), together with
  the new policy in `entrypoints/panel/pages/page-frame.tsx:77-84`.
- **Reproduction:** open the panel at 1920×800 while the tab-targeted data reply
  is outstanding. Independent regression test delays delivery of the genuine
  `chrome.tabs.sendMessage` callback by 2 s (the installed messaging package
  uses its callback overload); the eventual data response is not fabricated.
- **Observed:** the content region is 1859 px wide. Loading bars begin 12 px
  inside it and stretch across it. The ready data canvas instead starts 301.5 px
  inside it including padding: a **289.5 px horizontal relocation**. The
  `loading-1920` screenshot visibly shows the full-width, rail-aligned placeholder.
  The actual expected-failure assertion reports expected 301.5, received 12.
- **Impact:** the first real wait previews a different surface from the centered
  workspace that replaces it. New ready-state centering exposes this previously
  unchanged shell fallback as an incomplete migration (S-1 loading shapes/D-1).
- **Safest fix:** share the canvas policy with the loading wrapper (including the
  route's reading/data width), without adding a fake heading, changing loading
  timing, remounting ready content on refresh, or touching scrollbar behavior.
  Keep the outer unpadded query container unchanged.

### LAYOUT-2 — P2, pre-existing: loading overflows the supported 320 px panel

- **Location:** `entrypoints/panel/App.tsx:359`, fixed `w-64` skeleton inside the
  padded `SkeletonPage` root. This source is unchanged from `c2bedd8`; it is **not
  a regression introduced by a92e013**.
- **Reproduction:** same genuine delayed boot, resize to 320×800 while loading.
- **Observed:** loading root `scrollWidth - clientWidth === 9`, not 0; the
  `loading-320` screenshot shows the last placeholder continuing past the right
  edge. Independent regression reports expected 0, received 9. Ready routes at
  the same width pass. This violates L-2/L-4, regardless of the short wait.
- **Safest fix:** bound that short placeholder to the available inline size
  (`max-w-full` or equivalent), preserving its shorter intended measure. Merely
  centering/capping the wrapper does **not** fix this narrow overflow. Do not hide
  overflow to make the assertion pass.

The committed independent loading test is explicitly marked **expected failure**
only immediately before these two geometry assertions; setup/visibility failures
remain unexpected failures. It is not an implementation fix and is not evidence
that these assertions pass. Remove the marker when fixing both issues.

## Design review and optional polish (not blockers)

- **Balanced, but deliberately not full-density:** at 3440 px, the 3379 px
  content region contains a 1280 px data canvas, leaving 2099 px (62%) outside
  it. The 896 px reading canvas leaves 2483 px (73%). Screenshots of Detections,
  JavaScript and Undefined References at 3440×800 and 3440×220 confirm equal
  gutters and substantial whitespace. This is an explicit tradeoff, not a
  clipping bug. The data canvas still fits five detection columns and readable
  rows; there is no evidence justifying an automatic wider cap. Optional owner
  decision: a future persisted comfortable/dense preference, not an unsolicited
  settings expansion in this patch.
- **Route-dependent edges:** moving between reading and data pages shifts the
  heading edge by 192 px once both caps engage. This follows the intended width
  policy and remained navigable/focused in the independent route walk. Treat it
  as a design choice, not a newly discovered correctness defect.
- **Test precision:** `panel-layout.spec.ts` calls `heading.focus()` before
  checking focus, so that suite cannot independently prove automatic route-focus
  behavior. Existing `panel-a11y` tests and the independent audit's genuine hash
  switches cover that separately. Its virtual-list loop is also vacuous on empty
  routes; one markers fixture does not cover populated preload/results/error
  states. It correctly documents most state limits in its receipts.
- **Misleading unit-test name:**
  `entrypoints/panel/pages/lazyload/page.test.tsx:359` still says “caps the list
  width at the wide tier” while asserting the list has no `max-w-` class. Rename
  it to describe frame-owned sizing; the existing browser and frame tests supply
  the missing positive width-policy evidence. This is test clarity, not proof of
  an implementation defect.

## Independent evidence

- Frozen install with Node 24 / pinned pnpm completed without lockfile changes.
- Compile, lint and formatting passed; full unit gate passed with statements
  96.94%, branches 96.01%, functions 99.50%, lines 97.72%.
- Fresh Chromium production build passed; budgets passed without changes.
  Panel JS 389.53 kB and CSS 42.03 kB match the implementation's recorded build.
  Firefox build passed with the existing extension-ID/data-consent warnings.
- Implementation's five new layout tests independently passed: 140 ready-route
  geometry combinations, 42 axe runs, live appearance/search preservation.
  First attempt lost a reused fixture server after three tests; after starting
  an audit-owned server the entire five-test run passed. Connection refusal is
  environmental evidence, not an attributed implementation defect.
- A full browser run with the first two audit tests completed: **134 passed**
  (includes the explicitly expected loading failure). The final four-test audit
  suite independently completed: three positive tests plus one expected failure.
  The subsequent full 136-test run finished with **135 passed, 1 unexpected
  failure**: existing `site-side-by-side.spec.ts:210`, bypassed frame
  `performance.timeOrigin` changed during the independent-refresh assertion
  (1792125862845.1 → 1792125862851.4). This exactly matches the existing README's
  documented live-site flake class; it is outside the panel layout diff. The
  prescribed one-suite retry after 90 s is recorded separately, not silently
  counted as a clean full run: **8 passed** in 4.1 s. Raw full-run and retry logs
  are `e2e-final.log` and `site-retry.log` under the audit evidence directory.
- Independent positive cases: all seven routes at 320×220, 3440×220 and 3440×800;
  actual route-heading focus without test-issued focus; no horizontal overflow;
  a 2100-character HTML-like query rendered as text; forced-colors
  screenshot and clear-search focus restoration.
- Native browser zoom: `chrome.tabs.setZoom(..., 2)` actually changed
  `innerWidth` from 1280 to 640. All seven routes remained horizontally contained.
  Zoom is restored because Chromium persists it across extension-origin tabs.
- A real HTML fixture supplies 5000 inert delayed external scripts, including a
  4000-character URL. Captured count/ARIA size is 5000, fewer than 100 rows mount,
  and containment holds at 320/1280/3440 px. Supported `longtask` observation
  records no task over 50 ms during a committed search, clear and route switch.
  This is one local action sample, not a universal performance guarantee or a
  separate filter-chip/5k-row every-route benchmark.
- Inspected actual screenshots, including 1920 dark detections/JavaScript/
  Undefined References, 320 dark JavaScript, ultrawide ready
  pages, long-URL rows, forced colors and both loading widths. Screenshots and
  JSON diagnostics are named attachments in the local Playwright report;
  independent-run copies live under
  `/private/var/folders/ch/n74cjyr900d98tcydn9lp8940000gn/T/opencode/panel-layout-audit/`.

## Limits

No claim of exhaustive keyboard traversal, every feature-specific async/error
state, every malicious payload shape, screen-reader interoperability, or every
zoom percentage. Native attached DevTools chrome and Firefox runtime were not
driven; the standard harness opens real extension pages with only the inspected
tab identity shimmed. Their manual limitations remain real, not silently passed.
No production files, existing tests, dependencies or budgets were changed.
