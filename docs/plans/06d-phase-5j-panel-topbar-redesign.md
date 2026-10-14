# Phase 5J — Panel header & navigation redesign (the release train's last implementation phase)

**Depends on:** P5C–P5D (shipped), P5I's shell close-out; executes in the terminal implementation slot — **after P7 (and P14.6), immediately before P15**. **Effort:** M. **Parallelizable with:** nothing in its slot (it finalizes the shell's header geometry every other surface then reads).

## Decision record (owner, 2026-10-13)

Daily use of the shipped P5D nav found three frictions with the wide-docking form (the grouped top tab bar):

1. At wide widths the top bar looks unpolished, and its horizontal overflow shows a visible scrollbar — while the icon rail reads well at every size.
2. The rail's tooltips floated **below** their rows and covered the next row's hit area, swallowing its clicks.
3. A white screen precedes the panel while it loads (dev makes it long; see the paint-model note in `entrypoints/panel/index.html`).

**Owner decision (same day):** frictions 2 and 3 were fixed immediately and the **top bar was removed outright — the icon rail is the nav's only form at every window size** until this phase properly redesigns the wide form. Shipped in the same round:

- `nav/morphology.ts` + its sync-guard tests deleted; every container-query variant class removed from the nav and the shell (`adaptive-nav.tsx`, `App.tsx`, `style.css`'s `#root` container anchor).
- Tooltips float to the row's **right** — beside the rail column, over the content region, never over a sibling row (pinned by `tests/e2e/suites/panel-nav.spec.ts`, which also hit-tests the next row's center under an open tooltip).
- The panel document paints a themed canvas from the first frame: the token stylesheet is a render-blocking head link and `html` carries `background-color: var(--surface-0)` under the paint lock (verified in both palettes; dev measured FCP ~1240 → ~250 ms warm, requests 2304 → 174 — the icon barrel was also retired, see the lucide note in AGENTS.md's stack table).
- Unit + browser tests re-pinned: `adaptive-nav.test.tsx`, `App.test.tsx`, `panel-nav.spec.ts` (rail at every width; no top-bar edge).

**This phase exists for the deferred half:** the wide-docking header/nav form returns only when redesigned — never by re-flipping the deleted morphologies.

## Goal

Give the panel a final header/navigation design that holds up at **every** docking geometry (docked right, docked bottom, undocked window) and every realistic size — solving what the retired top bar got wrong without regressing what the rail got right.

## Scope

- [ ] **Design pass first, committed here before any code:** wireframes + decisions for the final header/nav shape across the three dockings — including what the brand mark, the (P5F) status bar and the header share, how group captions read (or don't), how overflow behaves (never a visible scrollbar as the default state), and the palette/appearance placement. Re-audit against 06a's `UX-D2`/`UX-D14` and amend the study first if the design contradicts it (the study's traceability rule).
- [ ] **Implement the chosen form over the nav registry** — `routes.ts` stays the one row source; the nav consumes it in both forms again (if two forms return) or one (if the design keeps the rail). No branching forks: one typed surface, groups and live-state rows render additively as today.
- [ ] **If a width-adaptive form returns**, container queries come back through their own declaring site: the `#root` container anchor in `style.css`, a threshold constant + pure rule (the deleted morphology module's shape), and the class-literal sync-guard test — one number, pinned.
- [ ] **The panel-nav browser suite re-pins the final geometry:** form at narrow and wide widths, overflow behavior, tooltip placement that never covers a sibling, keyboard reach, `aria-current`, the reserved row.
- [ ] Re-measure budgets (`pnpm build` + `pnpm check:budgets`) — the panel JS ceiling holds; re-run `build:firefox`.

## Constraints the redesign inherits

- The rail's interim contract stays true until this phase lands: tooltips right of their rows, live state tooltip-resident, rows state-free until data is trustworthy.
- Hit areas never below 24px; keyboard reach and visible focus everywhere; `aria-current` on the active row; groups named for AT in both forms.
- The header is never scrolled out (the content region owns scrolling); the crash boundary, boot states and soft-refresh preservation are shell contracts this phase must not disturb.
- Whatever the design decides, the "visible scrollbar" complaint and the "ugly at wide widths" complaint are the acceptance bar's named rows — a redesign that only re-styles the old bar fails the phase.
- **Inherited from the rail-overflow task (2026-10-13, recorded in the 06 doc's P5D receipts + the study's `UX-D15`):** the rail's small-heights contract is now the affordance, not a scrollbar — measured slice (`visibleRowsInRail` over the geometry stub), the rail-end "More pages" trigger + APG menu of the hidden rows, the `overflow-hidden` rail, and the rail column's `z-10` pointer guarantee. A wide form returning in this phase keeps the registry-driven slice + menu (its overflow surface re-consumes the same computation), re-pins `UX-D15`'s scroll-free invariant for whatever shape it adds, and must not delete the affordance from the rail-only form without revising the study first. The rail column's `z-10` header class is the micro-height pointer rule; if this phase changes shell stacking, re-verify the trigger is never pointer-blocked (the 06 doc's P5D sweep row names the heights).

**Tests:** the width → form rule as a pure function (if applicable) + sync guard; nav render tests re-pinned to the final anatomy; `panel-nav.spec.ts` geometry rows re-pinned; the full manual docking matrix (all three dockings, both palettes, reduced motion) signed off in this doc.

**Audit receipts (2026-10-13 adversarial round of the same-day fixes):** all findings were probed empirically against the real build, none required rework of the fixes themselves, and two hardening rows closed. (1) **Narrow-width tooltip geometry** — measured at 320/300/280 px viewport (the realistic docked-right minimum): the tooltip stays right of its trigger (left = trigger right + the 4 px gutter, no Kobalte flip onto the rail) and the next row's center hit-tests to the row itself; pinned permanently as a live-resize row in `panel-nav.spec.ts` (fail-closed: a missing tooltip box fails the test, it cannot pass vacuously). (2) **The explicit-choice pre-boot canvas trade measured and documented:** with `appearance: dark` stored and an emulated light OS, the pre-boot canvas paints the system (light) `--surface-0` and flips to dark exactly once when the lock releases — background-only, content still never paints wrong (`index.html`'s themed-canvas comment now states this). (3) **Render-level silence pin** — the retired bar-inline chip test's count semantics gained the tooltip-resident equivalent: a row whose selector declines (`present: true`, inventory not collected) opens a label-only tooltip, no badge (`adaptive-nav.test.tsx`). (4) **Dev-mode first frame verified themed** — the first painted frame in a dev session carries `--surface-0` (sampled with the lock still unset; warm run 174 requests, ~188 ms to content). (5) Both builds' emitted `panel-*.css` verified merged-complete (tokens + preflight + the panel's utilities + keyframes; zero `@container`/`not-sr-only`/`container-type` remnants) and both `panel.html` files carry the inline canvas rule + link; the one minifier fold found (the token whose two palette arguments are identical — `--on-accent: light-dark(#fff, #fff)` → `#fff`) is value-preserving by construction and every other `light-dark` declaration survives byte-for-byte; budgets unchanged (panel 106.1 raw / 36.0 gzip). The themed-canvas _rendering_ was verified on Chromium; the mechanism is standard CSS (`light-dark()` + background propagation), and its Firefox reading rides the release-train cross-browser pass. Gates after the round: `compile`/`lint`/`format:check`/`test` 943/943/`build`+`check:budgets`/`build:firefox`/`test:e2e` 53/53 all green.

**Done when:** gates green; the design decisions committed here; the user's three frictions each verified fixed in real DevTools (wide-window look, tooltip-over-row, no unthemed frame); budgets green.
