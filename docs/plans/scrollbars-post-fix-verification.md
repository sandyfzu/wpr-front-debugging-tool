# Independent post-fix scrollbar verification

2026-10-16 · branch `verify/panel-scrollbars` · implementation reviewed:
`896675aa68283f31fdba52c998f20f15336d1f93`. Review only; no implementation or
existing test changes, browser/OS preference changes, push or delegation.

## Verdict: accept for the primary Chromium contract

**A1 is fixed, with actual painted-pixel evidence. No remaining acceptance
blocker reproduced.** Fixed native bars survive forced colors, hover, held drag,
pointer leave and idle. Normal palettes, native input, narrow JavaScript layouts
and shadow/host isolation pass the focused production-extension tests.

**This is not acceptance of universally persistent Firefox bars.** A2 remains a
real secondary-platform limitation, now accurately disclosed in README and the
fix receipts. If the requirement becomes persistent bars in Firefox too, that
requirement remains unmet; documenting it does not implement it.

## Independently observed browser evidence

Fresh headed Chromium **156.0.8078.4**, macOS, default native scrollbar painting
enabled (Playwright's `--hide-scrollbars` omitted). Separate experiment from the
committed suite: exact shared CSS from `fcea487` versus the reviewed checkout,
200×140 px unbordered native scroller, 600×600 px content. Each initial image was
taken with the pointer away after **2.3 seconds**. PNG pixels were decoded into
RGBA, not inferred from computed scrollbar colors. Screenshots were also opened
and visually inspected.

| Mode         | Before                                       | After                                           |
| ------------ | -------------------------------------------- | ----------------------------------------------- |
| Normal light | 12×12 px occupied geometry; visible thumbs   | Identical complete PNG                          |
| Normal dark  | 12×12 px occupied geometry; visible thumbs   | Identical complete PNG                          |
| Forced light | 0×0 px; all four sampled bar positions white | 12×12 px; black thumb on white track, both axes |
| Forced dark  | 0×0 px; all four sampled bar positions black | 12×12 px; white thumb on black track, both axes |

Horizontal center samples after the fix: forced light thumb `[0,0,0,255]`,
track `[255,255,255,255]`; dark reverses these. Vertical rounded-edge samples
are `[1,1,1,255]` / `[254,254,254,255]`, visibly distinct from their tracks.
Normal horizontal thumb/track samples are `[93,102,117,255]` /
`[250,251,252,255]` in light, `[139,150,169,255]` / `[17,20,24,255]` in dark.
The old forced-color screenshots are visibly blank; the new ones are not.

For each new normal/forced palette, native-thumb hover keeps the complete PNG
unchanged. Real pointer-down vertical dragging moves the content while held;
geometry stays 12×12 px after leaving and another 2.3-second idle. Native End
reaches vertical offset **472**; native diagonal wheel input subsequently reaches
offsets **[90,382]**. No JavaScript scrolling substitutes were used in this
independent experiment. The separate production-extension suite additionally
checks horizontal held drag, arrows on both axes and disappearance after shrink.

Headed Firefox **155.0**, explicitly selected installed patched executable,
fresh isolated profile, exact current shared CSS: WebKit selector support is
false, occupied geometry is **0×0 px**, idle and hover PNGs are identical and
blank in both palettes. Native wheel reveals both thumbs and moves both offsets;
End reaches vertical **460**. The screenshot visibly shows the revealed native
thumbs. This reproduces the disclosed limitation, not a Firefox extension
installation test. No claim about every Firefox/OS combination or the installed
desktop Firefox follows from this experiment.

## Tests, implementation and documentation review

- The committed PNG assertions are meaningful: they require distinct thumb/track
  colors and at least 20 real pixels of each on **each axis**, including while
  each native thumb is held. Transparent-thumb image-difference negative control
  remains. Accepting any zero-alpha RGB is valid in forced colors, not a weakened
  visibility guarantee.
- The shadow probe is now inside the visible open overlay. Its identifying mark
  must actually paint; computed styles behind an occluding frame cannot pass.
  The real host root remains unstyled by the extension's pseudo rules.
- The production delta only changes shared CSS aliases and forced-color behavior.
  No custom scroll engine, observer, input handler, permission or dependency is
  introduced. The non-WebKit path remains native; no global gutter is added.
- README correctly distinguishes Chromium persistence from Firefox's native
  reveal policy. The macOS Always setting is user-controlled guidance, **not** a
  verified preference-change result. The fix receipts accurately call the older
  audit historical evidence and supersede the earlier unqualified claims.
- Minor future coverage opportunities, not reproduced defects: the forced shadow
  paint run uses one explicit owned palette; the document cases cover both.
  Host-isolation assertions read styles rather than independently comparing a
  custom host scrollbar PNG. Neither justifies claiming more coverage than run.

## Gates rerun in this worktree

All commands use Node **24** via `fnm exec --using 24`; frozen-lockfile install,
pnpm **12.9.1**.

- Compile, lint and repository-wide format check: pass.
- Full unit/coverage gate: **175 files passed; 2,687 tests passed, 1 skipped**;
  lines **97.72%**, functions **99.50%**.
- `E2E_HEADED=1 fnm exec --using 24 pnpm test:e2e scrollbars.spec.ts`:
  **3 passed, 1.4 minutes, zero retries**, using this checkout's rebuilt production
  extension. Includes panel/popup normal and forced pixels, both-axis native
  interactions, real injected overlay and the data-backed 301-script JavaScript
  page at **320 / 480 / 768 / 1280 px** without document horizontal overflow.
- Chromium production build and unchanged bundle budgets: pass. Firefox
  production build: pass, with existing ID/data-collection packaging warnings.
- The previously reported 128-test full browser run was **not rerun**; the focused
  headed run and independent experiments above are this review's runtime evidence.

Local evidence retained in this worktree's gitignored `tests/e2e/test-results/`:
`independent-paint.cjs`, `independent-paint.json`, `independent-paint.log`, and
`independent-*.png`. Reproduce the additional experiment with
`fnm exec --using 24 node tests/e2e/test-results/independent-paint.cjs` before a
new Playwright run clears that directory. The headed suite's attachments remain
in `tests/e2e/playwright-report/`. These are local evidence, not shipped fixtures.

Residual limits: forced colors is browser-emulated on macOS, **not Windows high
contrast**; Chrome 145 floor, attached right/bottom DevTools docking, popup browser
envelope, Firefox extension installation, touch, RTL and zoom were not newly
verified. No claim that CSS can override Firefox/OS auto-hide is accepted. Those
limits are candidly recorded in the fix receipts and do not reopen the reproduced
primary-Chromium A1 defect.
