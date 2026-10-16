# Scrollbar audit fixes — 2026-10-15

## Outcome and scope

A1 is fixed without replacing native scrolling: Chromium keeps the same 12 px
geometry in forced colors, using `CanvasText` thumbs and `Canvas` tracks, corners
and thumb borders. Forced-color adjustment remains `auto` on elements **and**
scrollbar parts. Normal palette tokens, native input, shadow isolation and page
alignment are unchanged. No dependency, permission, observer or runtime JS added.

A2 is an explicit secondary-target platform limitation, **not a Firefox CSS fix**.
The always-painted guarantee is Chromium-only. Firefox retains accessible native
bars and its user's reveal policy; README now explains the limitation, wheel/
keyboard access and the optional user-controlled macOS “Show scroll bars: Always”
setting. We did not change that setting, browser preferences, or use shrinking/
hidden bars, custom scrolling engines or polling to fake a persistent affordance.

This supersedes the forced-color bypass and unqualified cross-browser claims in
the earlier feedback receipts; the independent audit remains unchanged evidence.

## Platform investigation

Current official documentation checked on 2026-10-15:

- [MDN forced colors](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/forced-colors):
  system keywords preserve the user's palette without opting out of adjustments;
  `scrollbar-color` is forced to `auto`.
- [CSSWG scrollbars](https://drafts.csswg.org/css-scrollbars/#scrollbar-width):
  standard width is `auto | thin | none`; fading/reveal animation is not defined.
  Non-auto standard values override nonstandard scrollbar styling.
- [MDN scrollbar gutter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-gutter):
  the browser selects classic versus overlay bars; `stable` has no effect on
  overlays. It cannot force persistent native thumbs.
- [Apple Appearance settings](https://support.apple.com/guide/mac-help/change-appearance-settings-mchlp1225/mac):
  the user can select “Always” for scrollbars. This is guidance, not a tested
  preference change or a promise to override Firefox from extension CSS.

Headed Firefox **155.0**, exact shared stylesheet, fresh isolated profile, two-axis
200×140 px probe with 600×600 px content: both palettes tested with (1) `auto`,
(2) `overflow: scroll`, (3) `scrollbar-gutter: stable`, (4) `thin` (experiment only,
not shipped), (5) native automatic colors. All ten cases retain **0×0 px occupied
geometry** and blank idle/hover bars after 2.2 seconds. Wheel screenshots visibly
reveal both native thumbs; wheel offsets are `[50,50]`, keyboard End reaches
`[50,460]`. WebKit selector support is false. Thus none of the viable standard
CSS candidates solves idle discoverability on this observed platform. No claim
that every Firefox/OS combination hides bars, or that this tests a Firefox-loaded
extension: this is a real Firefox CSS/runtime capability probe, not an extension
installation test. Stable gutters and forced overflow were rejected rather than
shipping empty layout changes that do not fix visibility.

## Regression coverage

`tests/e2e/suites/scrollbars.spec.ts` now decodes real PNG screenshot pixels, not
just computed CSS. At rest, **both** thumb/track pairs must match their palette
and differ from each other; both axes must contain ≥20 painted thumb pixels and
≥20 track pixels. The same scan runs while each real native thumb is held down
and dragged. Fixed occupied geometry, hover equality, 2.2-second idle after drag,
native keyboard/wheel on both axes and zero bars after content shrinks remain
asserted. The transparent-thumb negative paint control is retained; its assertion
now accepts any fully transparent RGB channels because forced colors preserves
zero alpha but remaps RGB (`rgba(255,255,255,0)` is as transparent as black).

Light and dark normal paint is exercised in built panel/popup documents and the
real injected overlay; forced colors runs both owned document themes and the
shadow surface. Forced-color thumb/track/corner/border must resolve to the system
palette, and no part may disable adjustment. The shadow probe now lives **inside
the open overlay's painted stacking context**, not behind it. Its visible 8 px
system-color identifying mark is sampled before accepting any idle bar pixels.
Host-root pseudo width stays `auto`; extension parts stay 12 px. Native keyboard
animation settles before resets so input tests do not race the compositor.

## Gates and UI/UX bar §D

- Node **24** via `fnm exec --using 24`, pnpm **12.9.1**, frozen-lockfile install.
  Compile, lint, repository-wide formatting: pass. Full unit/coverage: **175 files,
  2,687 passed, 1 existing skip**; lines **97.72%**, functions **99.50%**.
- Headed Chromium **156.0.8078.4**, real unpacked production extension:
  `E2E_HEADED=1 fnm exec --using 24 pnpm test:e2e scrollbars.spec.ts`:
  **3 passed, 1.4 minutes, no retries**. Full browser gate:
  `fnm exec --using 24 pnpm test:e2e`: **128 passed, 2.8 minutes, no retries**,
  with this checkout's own fixture process throughout. Includes all Docker-site,
  accessibility, refresh, theme, navigation, copy and shadow-surface suites.
- Chrome production build, unchanged budgets, Firefox production build: pass.
  Panel JS **380.6 KiB**, isolated JS **121.6 KiB / 41.6 KiB gzip**. Against the
  audit build, each consuming CSS asset grows by **119 bytes** (panel 42,503 →
  42,622; popup 42,606 → 42,725; isolated 22,041 → 22,160). No JS growth.
- D-1: unchanged four-width data-backed script list/code geometry assertions pass
  in the headed run; no content or page alignment changes. Attached right/bottom
  docking is not reverified; the existing standalone panel shim remains in use.
- D-2: live system/light/dark plus reduced motion remain covered. New real-pixel
  checks cover both normal palettes, forced-color documents and shadow UI.
  A separate headed control loads the exact `fcea487` and current shared CSS in
  the same built popup document: before, forced light/dark is blank with **0×0 px**
  occupied geometry; after, **12×12 px**, both axes paint `[0,0,0,255]` thumbs over
  `[255,255,255,255]` tracks in light, and the reverse in dark. Normal pixels are
  unchanged: light thumb `[93,102,117,255]`, track `[250,251,252,255]`; dark thumb
  `[139,150,169,255]`, track `[17,20,24,255]`. All samples follow 2.2 seconds idle.
- D-3: every paint scenario exercises arrows, wheel and held native drag on both
  axes; geometry does not expand, thumbs stay painted, post-drag idle pixels equal
  pre-hover pixels. No new keyboard semantics or focus handling ships.
- D-4–D-5: existing full-suite accessibility/refresh coverage retained, no ARIA,
  data lifecycle or refresh changes. No claim of a separate forced-color axe run.
- D-6: production delta uses palette aliases/system keywords only, no animation,
  hardcoded palette colors, breakpoint or smooth-scroll change. Existing token
  definitions and deliberate regression-test RGB literals are excluded as usual.
- D-7: CSS-only production change; no per-row work or new filter pipeline. Budgets
  pass; no new 5k timing claim.

### Local reproducible evidence

Evidence root (outside the checkout):
`/private/var/folders/ch/n74cjyr900d98tcydn9lp8940000gn/T/opencode/`.

- `scrollbar-fix-headed.log`, `scrollbar-fix-unit.log`,
  `scrollbar-fix-full-e2e.log`,
  `scrollbar-fix-chrome-build.log`, `scrollbar-fix-budgets.log`,
  `scrollbar-fix-firefox-build.log`: gate receipts. Firefox retains the existing
  packaging warnings about extension ID and data-collection declarations.
- `scrollbar-fix-paint.cjs`, `scrollbar-fix-paint.json`,
  `fix-proof-{before,after}-{none,active}-{light,dark}.png`: exact old/new
  stylesheet negative/positive controls and raw pixel samples.
- `scrollbar-fix-firefox.cjs`, `scrollbar-fix-firefox.json`,
  `fix-firefox-{light,dark}-{auto,scroll,stable,thin,native-color}-{idle,hover,wheel}.png`:
  Firefox candidate experiment, geometry, input offsets and real paint.
- Browser suite attachments: `tests/e2e/playwright-report/index.html` (gitignored),
  including idle, post-scroll and both held-drag images plus narrow panel views.

The first full-suite attempt lost the reused fixture listener after eight tests
(`localhost:8891` returned `ERR_CONNECTION_REFUSED`); its raw output is retained as
`scrollbar-fix-full-e2e-first.log`. No expectations were changed in response.
The follow-up waits for the other worktree's listener to exit, then owns its
fixture process for the entire run rather than interrupting another session.

Limitations: browser-emulated forced colors on macOS, not Windows high contrast;
no new attached/docked DevTools, browser-action popup envelope, touch, RTL, zoom
or minimum-Chrome-version runtime claim. The actual built popup document is
tested in a tab. Firefox auto-hide remains the explicit secondary degradation
above; no automatic visual hint is added because a generic CSS support query
cannot detect whether a particular native scrollbar is actually idle-hidden.
