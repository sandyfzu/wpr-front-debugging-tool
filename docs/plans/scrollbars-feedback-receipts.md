# Thin themed scrollbars — feedback receipts

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
