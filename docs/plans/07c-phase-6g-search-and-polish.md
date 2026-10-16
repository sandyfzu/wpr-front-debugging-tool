# P6G — Search navigation and page polish: execution pieces

## TLDR

Split P6G into ten small, topic-owned pieces: formatting, list logic, search controls, virtual-list keyboard entry, search-result navigation, compact code rows, copy feedback, headers polish, remaining promotion decisions, and integration acceptance. **P6G.5 is the complete next/previous-search-results feature**, not a partial cursor API awaiting another phase. Finish the reusable list seams first so that feature is implemented once rather than patched into two divergent page bodies.

This expands [07 §P6G](./07-phase-6-panel-pages.md#p6g--search-navigation--per-page-polish); it does not add a new release phase or change P6.1's wider acceptance scope. **Status (2026-10-16): P6G.1 complete; P6G.2–P6G.10 planned.** The original split authorized no implementation or new dependencies; P6G.1 was subsequently requested by the owner.

## Stack and execution contract

- Keep the installed stack: Node 24, pnpm 12.9.1, TypeScript 5.9.x, WXT 0.21.x, SolidJS 1.9.x, Tailwind 4.x, Kobalte 0.13.x through `components/ui/`, TanStack Solid Virtual 3.13.x, and the existing Shiki 4.5.x worker. Tests use Vitest 5, Solid Testing Library, happy-dom, Playwright, and axe-core. Version ranges are verified in `package.json`; the lockfile controls exact versions. No additions or upgrades are needed for this split; retain the project's deliberate compatibility pins.
- Verify current code, installed-library APIs, and the relevant P6B–P6F receipts before implementation. Paths below describe current ownership, not mandatory new filenames. Do not recreate a solved candidate or restore superseded layout values from old receipts.
- Pure feature rules belong in `lib/panel/`; feature-agnostic formatters belong in `utils/`; panel-only composition belongs under `entrypoints/panel/`; primitives stay in `components/ui/`. Never make a primitive import a panel helper.
- Each implementation piece includes its own unit/component tests and focused real-browser checks where layout, focus, scrolling, or extension integration matters. Add the focused browser regression with its change; P6.1 owns the wider parity/performance matrix, not deferred testing of new behavior.
- Every piece ends with `pnpm compile`, `pnpm lint`, `pnpm format:check`, and `pnpm test` green. Runtime changes also run `pnpm build` + `pnpm check:budgets`; shared primitive changes run `pnpm build:firefox`. Receipt the applicable [UI/UX bar](../ui-ux-bar.md) §D checks, including both palettes, 320 px width, reduced motion, and keyboard/axe for changed states. Never raise a ceiling merely to pass.
- Each piece gets a short receipt: affected modules, decisions/deltas, tests and browser evidence, budget changes, and open limitations. A later integration pass does not excuse a half-working earlier piece. No commits or pushes unless requested.

## Ordering and file ownership

**Safe default:** P6G.1 → P6G.2 → P6G.3 → P6G.4 → P6G.5 → P6G.6 → P6G.7 → P6G.8 → P6G.9 → P6G.10.

The dependency/parallelism table in 07 is authoritative. Parallelizable means independent implementation work, not concurrent edits to one file:

| Owner        | Primary boundary                                                      | Collision rule                                                                     |
| ------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| P6G.1        | Generic format/title helpers, `FilterBar`, title callers              | Own the initial helper extraction; later phases consume it.                        |
| P6G.2        | Pure list helpers and reconciliation callers                          | Finish before P6G.3 or P6G.5 edits the page memo chains.                           |
| P6G.3        | Search binding, result announcements, list control/layout composition | Own JavaScript and resource-list page composition until merged.                    |
| P6G.4        | `VirtualList` keyboard behavior and tests                             | Merge before P6G.5 adds search-scroll integration to this primitive.               |
| P6G.5        | Search store, row highlighting, virtual scroll contract, page wiring  | Own search-related page and row edits; do not overlap P6G.6's row integration.     |
| P6G.6        | `CodeBlock`, JavaScript row presentation                              | Primitive work can run independently; serialize row edits with P6G.5/P6G.7.        |
| P6G.7        | `CopyButton`, exclusion/report/script copy consumers                  | Serialize shared script-row edits with P6G.6; no code-block changes here.          |
| P6G.8        | Detections headers preview and Headers & Cookies                      | Independent of resource-list/search work; serialize any common page-frame changes. |
| P6G.9–P6G.10 | Candidate disposition and acceptance receipts                         | After all implementation pieces; no unbounded cleanup batch.                       |

The independent items may run after their own dependencies rather than waiting for their number. Shared docs and budget receipts are merged serially. This is scheduling guidance, not a request to spawn agents.

## P6G.1 — Count formatting and bounded hover titles

**Goal:** one format for counts and one safe title cap, without changing copied values or link targets. **Depends on:** P6B–P6F. **Parallelizable with:** P6G.4, P6G.6, P6G.7. **Size:** S.

- [x] Extract the duplicated JavaScript/resource count formatting into a feature-agnostic owner usable by `FilterBar` and panel consumers. Include the nav's formatting where it expresses the same rule; preserve floor indicators such as `5,000+` in the owning count phrase.
- [x] Format chip counts and their computed accessible names consistently (`5,000`, not `5000`); preserve the selected/disabled/focus behavior already fixed in the primitive.
- [x] Promote `capText`/`capTitle`/`TITLE_MAX` from `resource-list-view.ts` to a suitable shared owner. Cap `ExternalLink` titles using the existing 300-code-point rule; retain full copy text and validated href. Migrate existing title users rather than leaving aliases with duplicated implementations.

**Tests/DoD:** 0/1/1,000/5,000 counts; capped-list wording; chip accessible names; title below/at/above the cap, emoji/surrogate pairs, data URLs; full copy/link values unchanged. Both list-page families and the primitive consume the shared owners; gates and focused title/chip browser checks pass.

### P6G.1 receipt — 2026-10-16

- **Ownership:** `utils/format-count.ts` owns the cached English formatter; `FilterBar`, JavaScript/resource presentation and nav consume it directly. Nouns and `+` floor markers stay with their count phrases. `utils/cap-text.ts` owns `capText`, `capTitle` and `TITLE_MAX`; resource names/titles and `ExternalLink` use it, with no compatibility aliases. Resource-specific accessible-name limits remain local.
- **Behavior:** chips and uncapped nav totals now group thousands, including computed chip names; `ExternalLink` hover previews retain at most 300 code points plus `…`. Full displayed/accessibility text, copy sources, URL validation and hrefs are unchanged. Capping stops after the first excess code point instead of allocating/scanning the full input; invalid generic limits throw a named `RangeError`. No dependency, styling or capture-contract changes.
- **Unit/component evidence:** formatter 0/1/999/1,000/5,000/large counts; cap boundaries, emoji, combining code points, empty/zero limits, invalid limits and large data URLs; reactive link titles/full hrefs; grouped chip names and retained button/focus at 999 → 1,000; grouped nav totals with existing cut-list phrases preserved. Existing tests changed only to import the promoted owners and expect the intended grouped nav numerator.
- **Gates:** `compile`, `lint`, `format:check`, `test`, Chromium `build`/`check:budgets` and `build:firefox` pass. Full unit tier: **2,732 passed / 1 skipped, 177 files**; lines **97.74%**, functions **99.50%**. Validation used available Node **26.12.0** and pinned pnpm **12.9.1**, not a Node-24 runtime smoke. Firefox build still reports its existing data-consent/extension-ID warnings; Firefox runtime is not claimed.
- **Browser / §D:** **13/13** pass across `panel-counts-titles`, `panel-layout-audit`, `panel-layout.spec.ts` and `panel-soft-refresh`. The new regression captures real 5,000-item script/image/preload inventories, asserts grouped accessible/visible counts, capped titles and unchanged full href/display/clipboard values on all three pages. D-1: 320/480/768/1280 px without horizontal overflow, plus existing ultrawide/200%-zoom checks. D-2–D-4: live System/Light/Dark, reduced motion, keyboard chip entry and whole-document axe with **zero violations and zero incomplete results**; transient copy confirmations are explicitly dismissed before the list audit. D-5: component count-boundary focus retention plus existing live appearance/data and soft-refresh regressions. D-6: changed-source grep clean. D-7: existing 5,000-script search/clear/route-switch regression passes its **no task >50 ms** assertion; the wider P6.1 matrix is unchanged.
- **Budgets:** panel **387.1 raw / 119.8 gzip KB**, worker **356.3 / 72.6**, whole JS **966.8 / 272.1**; unchanged at the budget reporter's precision from the pre-edit local build. No ceilings changed. Panel is below 600 KB; the 350 KB stretch target is not met and remains an integration concern.
- **Environment/limits:** an initial broader run had four missing-fixture-data failures; no product code or existing tests were changed for them. A later normal-runner attempt was blocked by the stopped Docker daemon. After verifying the local server's real marker response, all 13 fixture-only tests passed with a temporary external config retaining the original harness/build gate and omitting only the unrelated Docker webServer. Docker/site suites, attached-DevTools docking and Firefox runtime are not claimed by this receipt. P6G.2–P6G.10 remain unimplemented.

## P6G.2 — Shared list rules and row reuse

**Goal:** one pure list-behavior module, while preserving each page's identity model. **Depends on:** P6G.1. **Parallelizable with:** P6G.4, P6G.6, P6G.7. **Size:** S–M, limited to the list model and callers.

- [ ] Consolidate chip creation/default-chip/zero-count-selection rules and query normalization used by JavaScript and resource pages. Keep the resource definitions as the declaring site of predicates and searched fields.
- [ ] Resolve the receipted chip-label sentence-case inconsistency in that declaring table, preserving filter ids and predicates; pin intended user-facing wording in tests rather than scattering overrides through pages.
- [ ] Extract common reconciliation mechanics with explicit key/equality inputs. Preserve script identity plus occurrence keys, unchanged-object reuse, resource identity behavior, and expanded-code pruning; do not replace script keys with document positions or make resource pages depend on script types.
- [ ] Consolidate the equivalent capture-list-cut predicate used by `scriptListCut`, `listCapped`, and the route counters. Keep capture-specific data extraction local.
- [ ] Migrate consumers and remove superseded implementations. Do not also redesign page markup or search navigation.

**Tests/DoD:** selected/default zero-count chips remain reachable; non-default empty chips disable; unchanged refresh reuses objects; insert/delete/reorder/change/duplicate-script occurrences preserve the correct identities; truncation marks caused only by string clipping do not claim a list cut. Focus, scroll, expanded-code, and nav totals remain correct on a browser refresh. Gates pass with no general-purpose list framework introduced.

## P6G.3 — Search controls, announcements, and list presentation

**Goal:** the three searchable pages share one control behavior and result-announcement policy before adding result navigation. **Depends on:** P6G.2. **Parallelizable with:** P6G.4, P6G.7. **Size:** M, confined to search/control composition and its consumers.

- [ ] Promote `javascript/search-field.ts`'s binding and the duplicated Esc handling into one panel-owned seam consumed by JavaScript and `resource-list.tsx`. Keep immediate raw typing plus the existing debounced committed query; do not add a second store or attempt to set the platform's DevTools find-bar text.
- [ ] Cover cancellation while the committed query is already empty but raw input/debounce is pending. If the store needs a cancellation/reset notification, add it explicitly and test it; do not rely on an unchanged empty-string signal firing.
- [ ] Adopt one noun-aware result-announcement policy: truthful counts, singular/plural and zero matches, quiet during refresh, no per-keystroke chatter. Share its logic and lifecycle wiring, not only its text.
- [ ] Reconcile current search-field width and list-width/rhythm rules against the merged layout acceptance receipts. Share only truly common composition; preserve the current refined layouts, each page's summary, empty states, and specialized row rendering.

**Tests/DoD:** typing bursts; external query delivery; immediate clear/Esc; pending debounce cancellation; route disposal; refresh with a live query; filtered-empty focus recovery; announcement silence on refresh and truth after filter changes. Browser checks cover all three pages, compact/wide layouts, and retained filter-button focus. Gates pass; no cursor/scroll feature is partially introduced here.

## P6G.4 — Virtual-list keyboard entry

**Goal:** entering a scrolled list with Tab does not jump to an off-screen overscan row. **Depends on:** P6B–P6F. **Parallelizable with:** P6G.1–P6G.3, P6G.6–P6G.8. **Size:** S, primitive-owned.

- [ ] Reproduce the first-mounted-versus-first-visible-row issue in a real browser before changing `VirtualList`.
- [ ] Make keyboard entry target a visible row's appropriate focusable content without adding a bespoke roving-tabindex model or suppressing ordinary sequential traversal. Specify forward and reverse entry, partly visible rows, and rows without controls in the implementation receipt.
- [ ] Preserve internal focus during refresh/measurement, normal Tab/Shift+Tab exit, pointer scrolling, noninteractive list consumers, and disposal cleanup. Keep geometry and focus behavior in the primitive, not per-page patches.

**Tests/DoD:** deterministic helper/component tests plus browser regressions for a deeply scrolled list, both entry directions, overscan, variable row heights, expanded code, filter/refresh, and empty lists. Assert the focused control is visible and entry does not cause the reported jump; do not merely assert an index. Keyboard/axe pass on JavaScript, a resource page, and Headers & Cookies; gates pass.

## P6G.5 — Next/previous search results

**Goal:** ship the complete perform → next/previous → cancel search protocol across JavaScript, Lazyload, and Preloaded Resources. **Depends on:** P6G.3, P6G.4. **Parallelizable with:** P6G.7, P6G.8, subject to row ownership above. **Size:** M, one end-to-end feature.

- [ ] Consume the existing store's `cursor`/`matchCount`/`advance`; keep cursor math pure. The navigation unit is a **matching row**, not each textual occurrence. Preserve the existing searched-field contract: script `content`, resource `src`/`href`; no search rows are invented for Detections or Undefined References.
- [ ] Report the active page's filtered matching-row count only for a nonblank query. Define and test first-result selection, forward/reverse wrap, query/filter changes, and cursor repair when a refresh shrinks/removes/reorders matches. Prevent disposed pages from clearing a newly mounted page's count.
- [ ] Add a minimal, typed virtual-list index-scroll seam after checking the installed virtualizer API. It must reach rows not currently mounted, then resolve measured geometry without timers, retry loops, or smooth scrolling. Use nearest-edge behavior; a visible target should not jump unnecessarily.
- [ ] Apply token-based current-row highlighting distinct from keyboard focus and not conveyed by color alone. Keep find-bar/input focus; search navigation must not focus row controls or auto-expand/fetch entire scripts. A matched inline script remains a truthful matched row even if its matching text is outside the bounded preview.
- [ ] Clear query/count/cursor/highlight on cancellation and route reset, including pending queries. Clear stale scroll work on route change/disposal; ordinary refreshes or user scrolling must not repeatedly snap back to the active result.

**Tests/DoD:** zero/one/many matches; next/previous wrap; whitespace; query/chip changes; fewer/reordered/removed matches after refresh; cancel before debounce; rapid navigation; route switches; unmounted target; variable heights. Unit/component tests pin store and page integration; browser tests assert the actual highlighted row and visibility, not only the cursor. Perform/next/previous/cancel work via the extension search delivery path; record a real-DevTools find-bar check separately from standalone-panel automation. Gates, palettes, keyboard/axe, and a focused large-list navigation check pass. Fixes master #8 and completes #18.

## P6G.6 — Compact inline-code rows

**Goal:** remove the duplicated language/Wrap toolbar from inline script rows without losing controls or safety. **Depends on:** P6C. **Parallelizable with:** P6G.1, P6G.2, P6G.4, P6G.7, P6G.8; serialize shared row edits. **Size:** S.

- [ ] Add an additive compact/toolbar-less `CodeBlock` contract; keep default consumers unchanged. The row header owns the language and a single accessible Wrap control; wrapping remains reactive through a supported component API, never internal DOM styling.
- [ ] Preserve worker-only highlighting, bounded preview/expanded rendering, unavailable/too-large notes, clipping fade, overflow focus behavior, copy-full-source semantics, and expansion state. Required status notes must remain visible when the toolbar is absent.
- [ ] Update row-height estimates only if measurements show they need adjustment; never use estimates to fix rendered heights.

**Tests/DoD:** default versus compact contracts; exactly one Wrap control; wrap/expand/collapse; unhighlighted/failure/too-large paths; disposal. Browser-check focus rings and variable-height remeasurement in both palettes and at 320 px. The default code-block consumer and script copying remain unchanged; gates pass.

## P6G.7 — Shared copy feedback

**Goal:** remove remaining copy-feedback drift without weakening complete-source reads or focus safety. **Depends on:** P6B, P6C, P6E. **Parallelizable with:** P6G.1–P6G.6, P6G.8; serialize shared script-row edits. **Size:** S.

- [ ] Re-check current `CopyButton` before designing props: it already supports asynchronous source reads, abort-on-disposal, and a focus-safe pending guard. Extend only the missing action-label/toast-noun/success-description/responsive-label needs evidenced by Detections and Undefined References.
- [ ] Migrate the exclusion-copy consumer to shared feedback where appropriate, preserving its exact exclusion text and actionable destination hint. Reuse failure handling rather than creating a fourth local toast/flash implementation.
- [ ] Keep shared button busy-state promotion separate from copy behavior: only generalize `Button` if an actual second non-copy consumer justifies it; otherwise record the candidate's disposition in P6G.9.

**Tests/DoD:** successful write, clipboard rejection, source-read rejection, duplicate activation, abort/disposal, late completion, flash reset, responsive accessible names, success description, and exact copied text. Browser checks retain focus during a slow operation and exercise the exclusion hint. Gates pass; no partial-source fallback or duplicate toast.

## P6G.8 — Headers navigation and evidence polish

**Goal:** finish the Detections-to-evidence journey and the explicitly approved Headers & Cookies polish. **Depends on:** P6B, P6F. **Parallelizable with:** P6G.4–P6G.7. **Size:** S–M, two page folders.

- [ ] Add the Detections preview's “Open Headers & Cookies” action through existing route navigation. Preserve the preview's null-header omission rule and normal destination heading/focus behavior.
- [ ] Implement P6F's approved in-page filter and tone hints from its receipts using existing evidence/view-model rules. Define which displayed header/cookie-name fields are searched; do not expose cookie values, infer new verdicts, or connect this local filter to the resource-only next/previous protocol.
- [ ] Design filtered-empty recovery, counts, live feedback, keyboard use, and refresh preservation. Keep status hints understandable without color and treat values as untrusted text.

**Tests/DoD:** link destination and focus; absent/null/empty headers; positive/zero filter matches; clear/refresh; names-only cookies and missing-cookie payloads; hints consistent with existing evidence. Browser keyboard/axe and both-palette/narrow-width checks pass. Gates pass without changing capture/storage contracts.

## P6G.9 — Remaining promotion decisions

**Goal:** leave no unaccounted P6B–P6F candidate and no surprise cleanup batch. **Depends on:** P6G.1–P6G.8. **Parallelizable with:** —. **Size:** XS–S, primarily a disposition receipt.

- [ ] Create a candidate ledger mapping every P6B–P6F promotion note to its current evidence, owner, and outcome: implemented here, already solved (with receipt), or kept local (with reason). Confirm the content-sized `VirtualList` fix and recently merged layout/feedback work rather than reimplementing them.
- [ ] Explicitly cover the remaining candidates: summary/separator patterns; compact `PageHeader` actions; `ExternalLink` custom labels versus page-local links; name-first resource links; timestamp formatting/`Stamp` reuse; `WithheldValue`; sticky section labels; busy-but-focusable buttons; per-row copy flash; and a shell-owned per-fetch Undefined References cache.
- [ ] Promote only proven shared behavior; keep specialized UI local with a concrete reason. Do not add a cache, sticky label, or generic primitive solely because it was proposed. Preserve the master-#7 ban on mutable module analysis state. The already recorded P15 freshness-copy sweep stays there, explicitly cross-referenced.
- [ ] If a required unresolved defect needs implementation beyond a small local fix, add a narrowly scoped P6G.9a-style child with its own dependencies/tests/DoD **before** P6G.10; do not silently move required P6G work to P15 or hide multiple modules inside this disposition pass.

**Tests/DoD:** every candidate has an evidence-backed disposition; no duplicate declaring sites remain for behavior intentionally shared by P6G.1–P6G.8. Any actual code change gets the full implementation checks above. No new feature is implied by an optional candidate.

## P6G.10 — Integration acceptance and P6.1 handoff

**Goal:** close P6G with integrated evidence, not another implementation phase. **Depends on:** P6G.9 (including any explicitly added children). **Parallelizable with:** —. **Size:** S, acceptance and docs.

- [ ] Run the full required gates, Chromium production build/budgets, Firefox build, and applicable local browser tier over the integrated tree. Record actual results and limitations; a prior letter's green run is not this tree's evidence.
- [ ] Re-run keyboard/axe for changed page states, compact/wide layouts, both palettes, reduced motion, virtual keyboard entry, expanded inline code, search wrap/cancel/route reset, refresh preservation, headers filtering, and copy outcomes. Record [UI/UX bar](../ui-ux-bar.md) §D receipts.
- [ ] Verify perform/next/previous/cancel using a real DevTools find bar, including Esc versus the drawer and route changes. Standalone extension-page tests prove the delivery contract, not the platform UI; if the real-DevTools check is unavailable, record a blocker rather than claiming it closed.
- [ ] Re-measure panel and worker bundles; report the 600 KB hard ceiling and whether the 350 KB panel stretch target is met, with a measured reason if not. Keep worker code out of the main thread/chunk.
- [ ] Annotate 07's checklists and hand off P6.1 suites explicitly: search regression (suite 3), large-list navigation as part of the performance matrix (suite 4), and changed-state keyboard/axe (suite 5). P6.1 retains full page parity and the committed long-task thresholds; focused P6G tests do not replace those gates.

**DoD:** all P6G implementation pieces and required checks are closed, or named blockers prevent completion; candidate ledger and integrated receipts are current; P6.1 can begin without discovering unfinished P6G implementation. Update the plan index/status only to the level actually verified.
