# Discoverable, fixed native scrollbars — feedback receipts

## 2026-10-15 follow-up: idle visibility and fixed thickness

**Outcome:** Chromium gets always-painted native scrollbars on overflowing axes,
with a fixed 12 px track, 8 px visible rounded thumb and a 24 px minimum thumb
length. Hover, drag and idle use identical geometry and colors. No custom scrolling
engine, observers, timers, dependencies, permissions or page-width changes ship.

### Diagnosis and implementation

- The previous universal `scrollbar-width: thin` / token color rule selected native
  macOS overlay bars: the real Chromium baseline had **0 px occupied width** and no
  idle thumb. No app CSS grew the bar; the OS/browser controlled its reveal and
  expansion. Styling only `ScrollArea` would miss `VirtualList`, code, textareas,
  portaled menus and other bare native overflow containers.
- `assets/css/tokens.css` keeps one universal treatment inside owned documents and
  shadow trees, never on the shadow host. A supported `::-webkit-scrollbar` branch
  sets fixed dimensions; **both** standard properties become `auto`, otherwise
  Chromium ignores the pseudo-elements. MDN's current selector reference confirms
  that precedence; actual occupied width and painted pixels were verified here.
- Thumb = existing `fg-muted`, track/corner/border = `surface-1`; contrast remains
  covered by the palette token tests. The border insets the thumb without shrinking
  the native dragging area. There are no hover selectors or transitions. Native
  keyboard, wheel, touch and dragging remain browser-owned.
- Forced colors bypasses the entire pseudo-element branch and restores automatic
  system width/colors. Non-WebKit engines retain themed standard bars with normal
  native width, not `thin`; Firefox's OS overlay policy remains browser-owned.
  A persistent fixed-width Firefox overlay cannot be promised with these standard
  properties. Firefox runtime remains the documented manual tier.
- No global stable gutter: non-overflowing probes and normal menus reserve **0 px**.
  Existing `ScrollArea` stable-gutter policy stays intact. Actual JavaScript page
  evidence pins one vertical virtual-list scroller plus horizontal code panes,
  with no extra page vertical overflow at normal height and no horizontal list or
  document overflow at 320/480/768/1280 px. The rail remains scroll-free and its
  tiny-height menu stays usable (existing browser suite).
- The old browser assertions only read computed CSS, so they accepted invisible
  overlay bars. The headless harness also inherited Playwright's default
  `--hide-scrollbars`. The driver now omits that flag: layout and paint tests must
  use real scrollbar geometry. Existing expectations were updated for the intended
  fixed native branch, not relaxed; new image/geometry/drag assertions detect the
  original defect. Native drag completion is allowed to settle before restoring
  its compositor-owned offset for pixel comparison.

### Verification and §D receipts

- Compile, lint, format: pass. Full unit/coverage gate: **175 files, 2,687 passed,
  1 existing skip; lines 97.72%, functions 99.50%**. Existing happy-dom disabled
  iframe-load diagnostics still print, but no tests fail.
- Production Chrome build and budgets: pass; panel JS **380.6 KiB**, isolated JS
  **121.6 KiB / 41.6 KiB gzip**, no raised budgets or added JS work. CSS grows by
  approximately **0.38 kB per consuming stylesheet** versus this branch's baseline.
- D-1: `scrollbars` uses the real capture → panel contract with a 300-script inert
  fixture. Four widths pin vertical list and horizontal-only code scrolling, no
  document horizontal overflow and no double page/list vertical bars at 800 px
  height. Screenshots attach to the local HTML report. `panel-nav` also checks the
  rail and clamped menu's small-height behavior. Attached DevTools right/bottom
  docking visuals remain manual; viewport geometry is the automated approximation.
- D-2: system/light/dark live palettes, forced-colors enter/exit, reduced motion
  with no running page animations. Idle thumb pixels are compared with a
  deliberately transparent thumb; real native thumbs are present before hover,
  unchanged while hovering the track, and still present after scrolling/fade time.
- D-3: native arrows on both axes, wheel on both axes and actual thumb dragging;
  the existing nav/axe suites retain keyboard focus/ring and menu reach checks.
- D-4: existing strict axe checks cover the ready shell, palette and shortcuts;
  script-copy's real page accessibility tests also run. No semantics change.
- D-5: no data, focus, refresh or async behavior changes.
- D-6: production scrollbar rules use tokens only, no animation or new breakpoint.
  Test color literals deliberately pin resolved palette values.
- D-7: CSS-only production change, no per-row computation/listeners or new pipeline;
  budgets pass. No new 5k timing claim is made.
- Targeted browser gate: `pnpm test:e2e scrollbars.spec.ts panel-nav.spec.ts
panel-a11y.spec.ts panel-script-copy.spec.ts`: **24 passed**. Firefox production
  build also passes (existing extension-ID/data-consent packaging warnings remain).
  Standalone extension documents use
  the real DevTools tab-id contract shim; Firefox/attached-DevTools visual checks
  and the full Docker-site browser suite remain integration/manual work.
- New fixture is fulfilled from this checkout at its real loopback HTTP origin:
  parallel worktrees can otherwise reuse a fixture server rooted in another
  checkout and receive its 404. Content capture and the panel remain shipped code.

## Earlier thin-scrollbar approach (superseded above)

2026-10-15. Scope: shared scrollbar appearance on all currently built UI surfaces.

The shared token stylesheet now gives every owned scrolling element a native
thin scrollbar with the existing muted foreground thumb and a transparent track.
This includes unwrapped code blocks, textareas, document scrolling, virtual lists
and portaled menus. Native shape, drag, keyboard and wheel behavior remain browser
owned. Forced colors restores the browser's automatic color and full width.

The shared rule lives inside extension documents or injected shadow stylesheets;
it deliberately does not target the shadow host or change the inspected page's
scrollbars. Local component and injected-list overrides were removed so they
cannot defeat the shared high-contrast reset. No dependencies or permissions added.

## Verification

- Compile, lint, format, full coverage gate: pass; 173 files, 2,631 tests passed,
  1 existing skip. Coverage: lines 97.69%, functions 99.49%.
- Chrome production build and budgets: pass. Panel JS 378.2 KiB, isolated JS
  120.6 KiB (41.3 KiB gzip); no budget increases. Firefox build: pass; runtime
  Firefox remains the existing manual tier.
- Real Chromium: `tests/e2e/suites/scrollbars.spec.ts`, 2 tests passed. Both built
  page surfaces (panel/popup), both overflow axes, native keyboard and wheel
  scrolling, root/document styling, light/dark/system with live switches,
  forced-colors entry/exit, real injected shadow UI, storage-driven appearance
  updates, host document and shadow host isolation.
- The render assertion previously requiring component-local scrollbar utility
  classes was replaced with a stable-gutter/no-local-override assertion because
  appearance now belongs to the shared stylesheet. Real browser assertions pin
  its computed behavior; the earlier utility assertion would reject this design.

## UI/UX bar §D applicability

- D-1: no dimensions, overflow policy, content, controls or breakpoints changed;
  the browser test verifies both existing overflow axes remain operable.
- D-2: all appearance modes and live switching covered; no motion added.
- D-3: native arrow-key scrolling covered on both axes; no focus changes.
- D-4–D-5: no semantics, asynchronous states or refresh behavior changed. Thumb
  uses an existing AA foreground token; its contrast pairs remain gated.
- D-6: production delta uses tokens only; no animation, media width breakpoint,
  hardcoded palette or smooth scrolling added.
- D-7: CSS-only appearance change, no per-row work or listeners; all bundle
  budgets pass. No new filter/view pipeline requires a performance fixture.

The focused browser run used the normal suite and an uncommitted temporary config
selecting only the existing fixture server, so it did not start the unrelated
WordPress stack. The temporary config was deleted after the run. Full combined
browser regression and independent adversarial review belong to integration.
