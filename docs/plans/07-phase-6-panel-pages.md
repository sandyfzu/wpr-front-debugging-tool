# P6: remaining panel work and acceptance

## TLDR

P6A/A.1/B–F and P6G.1 shipped; **P6G.2–.10 and P6.1 remain open**. Implement the small pieces below, then close integrated browser parity/performance. [Completed pages](./completed-panel-pages.md) owns decisions/evidence, [UI acceptance](./completed-ui-acceptance.md) owns merged layout/feedback fixes. Do not reread completed execution history by default or reimplement a solved candidate.

Stack: installed Node24/pnpm, TS5.9, WXT/Solid, Tailwind4, Kobalte0.13 wrappers, TanStack Virtual, Shiki worker, Vitest/Solid Testing Library/happy-dom, Playwright/axe; lockfile/AGENTS authoritative. No new dependency needed. All pieces inherit master gates and UI bar §D, include focused unit/component/browser regressions, and remain usable independently. Shared primitive changes also run Firefox build. No ceiling increases merely to pass.

## P6G order and ownership

Safe default .2→.3→.4→.5→.6→.7→.8→.9→.10; independent pieces may start after their dependencies. Parallelism means disjoint edits, not authorization to spawn agents. Merge shared docs/budgets serially.

- .2 owns pure list rules/reconciliation; finish before .3/.5 page memo chains.
- .3 owns JS/resource search/control composition; .4 primitive keyboard entry merges before .5 virtual search-scroll.
- .5 owns search store/row integration; serialize script-row edits with .6/.7.
- .6 owns compact CodeBlock; .7 copy feedback, no code-block changes; .8 Headers & Cookies only unless evidence requires shared seam.
- `lib/panel/` pure feature rules, `utils/` generic helpers, panel composition entry-local, primitives never import panel logic. Paths are current ownership, not mandated new files.

### P6G.1 — done

Grouped count/accessible names and bounded300-code-point hover titles promoted to `utils/format-count.ts`/`cap-text.ts`; full copy/hrefs unchanged. [Receipt](./completed-panel-pages.md#p6g1-counttitle-consolidation-2026-10-16). Consume these owners, never recreate aliases.

### P6G.2 — Shared list rules/reuse

Depends: .1. Parallel: .4/.6/.7. Size:S–M. Goal: one pure list-behavior seam without merging different identity models.

- [ ] Consolidate chip/default/zero-count rules, query normalization and list-cut predicate (scriptListCut/listCapped/nav counters). Predicate/search-field definitions stay with resource owner; extraction stays capture-specific.
- [ ] Sentence-case chip labels in declaring table; IDs/predicates unchanged, literal wording tests.
- [ ] Reconciliation with explicit key/equality inputs; retain script identity+occurrence, unchanged-object reuse, resource identity, expanded pruning. Never document-position script keys or script-typed resource framework. Migrate/delete duplicate implementations, no markup/search redesign.

DoD/tests: all/selected-zero reachable, other zero disabled; refresh insert/delete/reorder/change/duplicates preserve correct objects/focus/scroll/expanded state; string clipping alone never claims list cut. Browser refresh checks both families; gates green, no generic list framework.

### P6G.3 — Shared search controls/announcements/layout

Depends: .2. Parallel: .4/.7. Size:M. Goal: common control behavior before cursor feature.

- [ ] Promote JS search-field binding/duplicated Esc into panel seam for JS/resource-list. Immediate raw echo plus existing debounced committed store; no second query store/platform find-text setter.
- [ ] Cancel pending raw/debounce even when committed query already empty; explicit reset notification if needed, never depend on unchanged empty signal firing.
- [ ] Share noun-aware counts/singular/plural/zero and lifecycle: announce committed filter/query changes, quiet refresh/no keystroke chatter.
- [ ] Reconcile field width/list rhythm with accepted **centered canvas**, preserve page summary/empty/special rows. No obsolete local width caps.

DoD/tests: bursts/external query/clear/Esc/pending cancel/disposal/refresh/filter changes, no-match focus; all three pages compact/wide browser checks retain chip focus. No partial cursor API introduced.

### P6G.4 — Virtual-list keyboard entry

Depends: B–F. Parallel: .2/.3/.6–.8. Size:S. Goal: Tab entry into scrolled list targets visible content, not offscreen overscan.

- [ ] Reproduce in real browser first. Specify forward/reverse entry, partly visible rows and rows without controls.
- [ ] Primitive-owned geometry/focus fix, no bespoke roving tabindex. Preserve sequential Tab/Shift+Tab exit, internal focus during refresh/measure, pointer scroll, noninteractive consumers, cleanup.

DoD/tests: deep scroll/both directions/overscan/variable heights/expanded code/filter-refresh/empty; focused control actually visible without jump, not just correct index. JS+resource+Headers keyboard/axe, deterministic helper/component pins, gates.

### P6G.5 — Complete next/previous results

Depends: .3/.4. Parallel: .7/.8 (serialize row edits). Size:M. Goal: full perform→next/previous→cancel across JS/Lazyload/Preloaded, not unfinished cursor seam.

- [ ] Consume cursor/matchCount/advance; pure wrap math, unit **matching row**, not textual occurrence. Search existing script content/resource src/href only; no invented Detections/reference search.
- [ ] Report active filtered matching-row count only nonblank query; first selection/wrap/query-chip changes, repair refresh shrink/remove/reorder. Disposed page cannot clear new page count.
- [ ] Minimal typed index-scroll after installed API verification; unmounted target then measured geometry, nearest edge/no unnecessary jump. No timers/retry loops/smooth scroll.
- [ ] Token current-row highlight distinct from focus and not color-only. Keep input/find focus; don't expand/fetch entire scripts. Match outside bounded inline preview remains truthful matched row.
- [ ] Cancel/route reset clears query/count/cursor/highlight/pending scroll; refresh/user scroll must not repeatedly snap to active result.

DoD/tests: zero/one/many/whitespace, both wraps, query/chip, reordered/removed/fewer matches, pre-debounce cancel, rapid route/dispose, unmounted variable-height target. Wire-delivered perform/next/prev/cancel; browser asserts real highlight+visibility. Palettes/keyboard/axe/large list pass. Native find-bar check distinct from standalone contract. Closes master#8/#18.

### P6G.6 — Compact inline-code rows

Depends:C. Parallel:.2/.4/.7/.8; serialize row integration. Size:S.

- [ ] Additive toolbar-less CodeBlock, default unchanged; row owns language/single accessible Wrap via reactive API, not DOM styling.
- [ ] Preserve worker-only highlight, preview/expanded caps, required unavailable/too-large notes, clipping fade, overflow focus, complete-source copy and expanded state. Update estimates only from measurement, never use estimates to fix geometry.

DoD/tests: default/compact, one Wrap, expand/collapse/wrap, plain/failure/large/dispose; actual variable-height remeasure/focus at320/both palettes. No regressions to default consumer/copy.

### P6G.7 — Shared copy feedback

Depends:B/C/E. Parallel:.2–.6/.8; serialize script rows. Size:S.

- [ ] Recheck current CopyButton: async source read, abort and **focus-safe pending guard already ship**. Extend only missing action-label/toast-noun/success-description/responsive-label needs.
- [ ] Exclusion consumer uses shared feedback where appropriate, same exact safe pattern+destination hint/failure handling. No duplicate toast/flash or partial-source fallback.
- [ ] Generic busy-but-focusable Button only if actual second non-copy consumer warrants it; otherwise disposition in .9.

DoD/tests: read/write failures, duplicate guard, abort/dispose/late settle, flash reset, responsive names/description/exact clipboard; browser slow-copy focus/exclusion hint. Retain toast semantics/pause fixes.

### P6G.8 — Headers evidence polish

Depends:B/F. Parallel:.4–.7. Size:S–M.

**Reconciliation:** owner2026-10-15 removed Detections preview; its “Open Headers & Cookies” link task is **withdrawn**. Do not restore either. Cards/report header facts stay; current ownership regression must pass.

- [ ] F's approved local filter+tone hints, existing evidence only. Define searched header/cookie-name fields; no cookie values/new verdicts/resource next-prev protocol.
- [ ] Filtered-empty recovery/count/live feedback/keyboard/refresh; understandable noncolor hints, untrusted values as text.

DoD/tests: null/empty/present headers, positive/zero/clear/refresh, names-only/missing cookies, rule-consistent hints; keyboard/axe/narrow/both themes, no capture/storage contract change.

### P6G.9 — Candidate disposition

Depends:.1–.8. Parallel:—. Size:XS–S.

- [ ] Ledger every B–F candidate: evidence/owner/outcome implemented, already solved(link), or kept local(reason). Recheck content-sized VirtualList, merged canvas/feedback and .1 before acting.
- [ ] Cover summary/separator patterns; compact header actions; custom-label ExternalLink vs local links/name-first resources; timestamp/Stamp reuse; WithheldValue; sticky section label; focusable-busy Button; copy flash; shell-owned **per-fetch** references cache. No speculative cache/primitive/module mutable state.
- [ ] P15 freshness captured/fetched copy remains there. Any required defect exceeding small local change gets explicit .9a child (dependencies/tests/DoD) **before .10**, not hidden cleanup or deferred required work.

DoD: every candidate disposition evidenced; no duplicate shared declaring sites; actual code gets full gates. Optional candidate is not new feature approval.

### P6G.10 — Integration/handoff

Depends:.9+explicit children. Parallel:—. Size:S.

- [ ] Current-tree full gates/build/budgets/Firefox/applicable local browser tier; prior green letters aren't integrated proof.
- [ ] UI bar §D for compact/wide/themes/reduce/changed states; virtual entry, expanded code, cursor/wrap/cancel/reset, refresh, header filter, copy; keyboard/axe.
- [ ] **Real native DevTools** find bar perform/next/prev/cancel, Esc vs drawer/route change; missing run is blocker, not standalone proxy pass.
- [ ] Panel≤600KiB hard,≤350 stretch met/not with measured reason; worker separate, no main-thread shiki. Updated candidate ledger and P6.1 search/perf/axe handoff; no unfinished implementation.

## P6.1 — Browser acceptance

Depends:P6G/P4.1; site rounds+P4.2. Parallel:technical P7 work, not release-order override. Size:M. Goal: repeatable whole-phase parity/performance, not only focused piece checks.

1. Cards/subtitles/counts/filters/definitions against same fixture in source build, with intentional deltas recorded. Headers inventory only Headers & Cookies (not removed preview); null/missing/empty graceful, names-only cookies, older payload omission. Local site has no x-rocket/age; use known fixtures for those branches.
2. Summary/card consistency, report golden byte-exact, header capture/display/clipboard/redaction, complete script-copy and exclusion safety regressions.
3. Wire/native search perform/next/prev/cancel, correct matching-row highlight/visibility, query reflection/route reset/Esc vs drawer; source comparison/native UI checks labeled separately.
4. Seeded5000-row generated-on-demand fixture (not committed JSON): route/view/filter/search and **large-list result navigation**, PerformanceObserver longtask none>50ms, TBT<200ms. Repeat P15; record cold/warm/context honestly. Real capture path preferred; any dev-only override explicitly named.
5. Keyboard/strict axe for every changed page state/primitive; UI bar D1–D7. Exact reviewed unresolved target allowances only where unavoidable, never silent incomplete results.

DoD: suites green locally, per-check automated/manual annotation and measured perf table here; native/source-build comparison outcomes attached. P11.1 still owns new real-site merged detection. All B–F enhancement promises accounted,350 stretch explicitly reported (last387.1KiB **not met**). Thumbnail skip retained; no structural changes require AGENTS except its usual triggers.
