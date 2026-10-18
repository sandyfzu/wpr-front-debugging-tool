# P6: remaining panel work and acceptance

## TLDR

P6A/A.1/B–F and P6G.1–.4 shipped; **P6G.5–.10 and P6.1 remain open**. Implement the small pieces below, then close integrated browser parity/performance. [Completed pages](./completed-panel-pages.md) owns decisions/evidence, [UI acceptance](./completed-ui-acceptance.md) owns merged layout/feedback fixes. Do not reread completed execution history by default or reimplement a solved candidate.

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

### P6G.2 — Shared list rules/reuse — done

Depends: .1. Parallel: .4/.6/.7. Size:S–M. Goal: one pure list-behavior seam without merging different identity models.

- [x] Consolidate chip/default/zero-count rules, query normalization and list-cut predicate (scriptListCut/listCapped/nav counters). Predicate/search-field definitions stay with resource owner; extraction stays capture-specific.
- [x] Sentence-case chip labels in declaring table; IDs/predicates unchanged, literal wording tests.
- [x] Reconciliation with explicit key/equality inputs; retain script identity+occurrence, unchanged-object reuse, resource identity, expanded pruning. Never document-position script keys or script-typed resource framework. Migrate/delete duplicate implementations, no markup/search redesign.

DoD/tests: all/selected-zero reachable, other zero disabled; refresh insert/delete/reorder/change/duplicates preserve correct objects/focus/scroll/expanded state; string clipping alone never claims list cut. Browser refresh checks both families; gates green, no generic list framework.

#### Receipt — 2026-10-16; adversarial audit 2026-10-17

- `lib/panel/list-behavior.ts` owns chip/default/zero-count rules, committed-query trimming, list-limit evidence and keyed reconciliation. Small page adapters retain script derivation/capture rules and numeric resource IDs; script keys remain signature+occurrence, full-content equality still rejects signature collisions, unchanged arrays/objects are reused, expanded-state pruning stays page-owned. No markup, capture contract, dependencies or search controls changed.
- Wording delta: `Show All`→`Show all` on all three inventories; `Non-Deferred`→`Non-deferred`. Existing literal assertions changed only to pin this required copy delta; new shared-rule tests pin all labels and a non-`all` default ID.
- Real Chromium regression exposed retained DOM losing focus when keyed nodes move on reorder. `virtual-list-focus.ts` captures before the keyed render and restores in a microtask only for the same connected control after an observed removal/reinsertion when focus fell to body. One short-lived observer per focused list update, never per row; capture-phase focus listening respects transfers even when controls stop bubbling events. Settlement/cancellation releases listeners, observer and the retained control reference. No scroll, timers, keyboard-entry or roving-tabindex changes; P6G.4 remains open.
- Unit/component coverage includes counts/zero states, trimming, clipping-vs-list-cut, insertion/deletion/reorder/change/duplicates, capture changes, signature collisions, unchanged-object reuse and expansion pruning. New `panel-list-reuse` browser suite proves focused-node+scroll retention through real append/delete capture pushes on JS/Lazyload/Preloaded, and script duplicate-node reuse+expanded focus through insertion/reorder, then pruning on removal/re-add.
- Audit findings fixed: **P2** focus was reclaimed after a deliberate no-move blur, and a stopped bubbling `focusin` could hide a deliberate transfer. New regressions failed before the fixes; exact-helper Chromium scenarios now cover moves/ancestor moves, no-move blur, unrelated mutations, normal/stopped transfer+blur, removal/replacement and disposal. **P3** JS still hardcoded its default/reset chip despite the shared rule; all paths now derive it from the definition. Duplicate browser assertions now require two initial nodes, and a 100-round immutable refresh oracle checks keys/content/object reuse/derivation counts. Changed-data capture refreshes additionally prove stale resource DOM is replaced, not refocused.
- Audit evidence limit/copy fix: the producer's shared `truncated` mark cannot distinguish text-only clipping from dropped entries at exactly the list cap. A real `boundPreloadedResources`→shared-predicate test pins this ambiguity and the below-cap distinction. Keep the existing conservative boundary/lower-bound marker, but replace JS's definite `the page has more` with `more may exist`; no capture-contract expansion. Tests changed only to assert the corrected wording, not to weaken truncation coverage.
- Requested boot-test fix: replace stale `0.0.0` with the version imported from `package.json`, WXT's verified declaring site. The runtime manifest still has to equal the independently read package version; no version bump or exclusion. This test change corrects obsolete metadata, not a broken worker.
- Final gates: compile/lint/format/test pass (**2,757 passed, one existing skip**); Chromium+Firefox builds and budgets pass; unrestricted browser tier **150 passed**, no exclusions/retries, final run 3.6m. One earlier run had a 20s `/wp-admin/plugins.php` navigation timeout; isolated replay and the final full run passed without changing that test or its timeout. Firefox's pre-existing data-consent/add-on-ID build warnings remain in its owning workstream.
- UI bar: D1–D4 width/theme/reduced-motion/keyboard/strict axe exercised by `panel-counts-titles` plus existing layout/a11y suites; D5 by the real-capture suite; D6 unchanged styles/no prohibited additions; D7 existing 5k action/long-task suite passes. Panel **387.8KiB raw/120.1KiB gzip** (before P6G.2: 387.1KiB raw; guarded focus repair adds ~0.7KiB), worker 356.3KiB raw/72.6KiB gzip; all ceilings unchanged, 350KiB stretch still unmet. No native-docking, Firefox-runtime or source-build parity claim: this slice reshapes existing rules, not newly ported behavior. Baseline HEADs rechecked: first `704dbe3`, second `a6a4900`; integrated/native acceptance remains P6G.10/P6.1.

#### Navigation scrollbar repair — 2026-10-17

- Reproduced in Chromium: JavaScript's full-height entrance enlarged the shell's scroll area by 4 px and briefly consumed an 8 px scrollbar gutter. Keep the page root stationary with `overflow: clip`; animate only its padded canvas. No extra scroller, hidden real content, timer, or motion-token change; natural-height pages and short-panel overflow retain shell scrolling.
- New `panel-layout` regression freezes the actual entrance at its start, midpoint and end across all seven routes, 320/480/768/1280 px widths and 360/800 px heights. It failed before the fix; now scroll geometry stays identical, horizontal overflow stays absent, and the shell can reach its real scroll bottom.
- UI bar D1–D5: 31 targeted browser tests pass (`panel-layout`, `scrollbars`, `panel-a11y`, `panel-counts-titles`, `panel-list-reuse`), covering both palettes, system following, reduced motion, keyboard/focus, strict axe, native scrollbar interactions, refresh and 5k lists. The strengthened entrance regression also passes separately. D6: no prohibited additions. D7: no new runtime work; panel JS remains 387.8 KiB raw/120.1 KiB gzip, budgets unchanged. Compile/lint/format and 2,757 unit/component tests pass (one existing skip); Chromium/Firefox builds pass. Native docking and Firefox runtime remain manual acceptance, not claimed here.

### P6G.3 — Shared search controls/announcements/layout — done

Depends: .2. Parallel: .4/.7. Size:M. Goal: common control behavior before cursor feature.

- [x] Promote JS search-field binding/duplicated Esc into panel seam for JS/resource-list. Immediate raw echo plus existing debounced committed store; no second query store/platform find-text setter.
- [x] Cancel pending raw/debounce even when committed query already empty; explicit reset notification if needed, never depend on unchanged empty signal firing.
- [x] Share noun-aware counts/singular/plural/zero and lifecycle: announce committed filter/query changes, quiet refresh/no keystroke chatter.
- [x] Reconcile field width/list rhythm with accepted **centered canvas**, preserve page summary/empty/special rows. No obsolete local width caps.

DoD/tests: bursts/external query/clear/Esc/pending cancel/disposal/refresh/filter changes, no-match focus; all three pages compact/wide browser checks retain chip focus. No partial cursor API introduced.

#### Receipt — 2026-10-17

- `state/search-field.ts` owns the one field binding for every list page: the raw echo streams into the debounced committed store, and re-syncs by two rules — a committed query differing from the echo is adopted (found elsewhere), and a **delivery revision** changing without the field's own write adopts the committed query at once. `state/search.ts` gained that revision counter (one bump per `perform`/`cancel`, none for commit/advance/match-count), so a find-bar cancel drops a field's pending echo even when the committed query is already empty (previously the echo survived: no query change fired), and a foreign keystroke takes query ownership immediately. The binding also carries the panel-wide Esc rule (search-type input + non-empty echo → preventDefault + clear). The JS page's local `search-field` module is deleted; both page bodies attach `field.onKeyDown` on their controls wrapper and read only the binding.
- `pages/results-announcement.ts` owns the shared count line and its lifecycle, used by the JavaScript and resource-list bodies: the text is always the current count (`No images match` / `Showing all N` / `Showing N of M`; `''` only on an empty page, whose own empty state speaks), a refresh mutes that update (`aria-live` off in the same reactive wave), and a committed filter/query change announces again — even when both land in one flush, in either write order: one combined `on` effect decides the switch per flush (any action-source change announces, only a refresh-only flush mutes), element-wise against a creation-seeded baseline — audit-found replacement for the declarer-order reasoning ("the demute wins the tie"): Solid flushes memos by write order, and the shipped tie test never batched its writes. Mount never speaks (the region renders its initial content). The two divergent page lifecycles are deleted.
- `lib/panel/list-behavior.ts` owns `CountNoun`/`countLabel` (zero/singular/plural, optional `+` capture-floor) and the announcement phrasing; `script-view`'s `scriptCount`/`resultAnnouncement` and the resource-list-view duplicates are deleted. Script vocabulary stays JS-page-owned (`SCRIPTS_NOUN` in `script-view`); resource nouns stay with their pages.
- `FilterBar` owns the search-field width (full row while compact, bounded 20 rem from the regular tier); the JS wrapper's `SEARCH_FIELD_WIDTH` and the resource body's fixed `w-72` are gone. The resource body's query memo keeps reading the committed store (the echo only displays); a whitespace-only query now commits its echo and the list normalizes it away — no special-case cancel.
- Behavior deltas (tests re-pinned only for these): resource pages' "a refresh clears the line" became the truthful-muted refresh (JS page's accepted mechanism, now shared); the JS page's `N of M scripts shown`-only-while-narrowed wording became the shared phrasing, and a way back to the unfiltered list now says `Showing all N` instead of silence; the render-at-mount count line is present but never spoken.
- DoD coverage: binding unit suite (bursts, foreign deliveries, pending-cancel-while-empty, takeover, disposal, Esc guards by key/type/empty state), revision unit pins (bump/no-bump), composable pins (text trio, empty page, no-op refresh identity, mute/demute, batched same-commit announce in both write orders), page suites for both families (pending cancel, foreign takeover, refresh keeps field/chip/query). Browser: `panel-counts-titles` now also pins real field geometry per page (full row at 320, ≤ 20 rem and off-full-row at 1280) and a typed-query → shared count line → Esc restore on the JavaScript page; the compact/wide chip-focus checks are unchanged and green.
- Gates: compile/lint/format; **2,780 unit/component tests pass** (one existing skip; the audit added three binding pins — own burst interleaved with a foreign delivery, a binding created during a pending commit, a second binding mirroring on the same store — and reworked the tie guarantee to the deterministic action-wins rule); Chromium build + budgets pass — panel **387.8 KiB raw/120.1 KiB gzip** (raw +0.1 from that rework), worker 356.3/72.6, whole build 967.5/272.4; ceilings untouched, 350 KiB stretch still unmet. Browser tier spot-runs pass (17 tests: counts-titles, search-relay, soft-refresh, list-reuse, a11y, lazyload-reasons; counts-titles re-verified after the rework). No cursor/next-previous API introduced (P6G.5 prerequisites untouched); no motion/style additions (bar D6); real native find-bar behavior stays P6G.10.

### P6G.4 — Virtual-list keyboard entry

Depends: B–F. Parallel: .2/.3/.6–.8. Size:S. Goal: Tab entry into scrolled list targets visible content, not offscreen overscan.

- [x] Reproduce in real browser first. Specify forward/reverse entry, partly visible rows and rows without controls.
- [x] Primitive-owned geometry/focus fix, no bespoke roving tabindex. Preserve sequential Tab/Shift+Tab exit, internal focus during refresh/measure, pointer scroll, noninteractive consumers, cleanup.

DoD/tests: deep scroll/both directions/overscan/variable heights/expanded code/filter-refresh/empty; focused control actually visible without jump, not just correct index. JS+resource+Headers keyboard/axe, deterministic helper/component pins, gates.

#### Receipt — 2026-10-17

- Shipped `components/ui/virtual-list-entry.ts`: pure `planEntryMask` (rows wholly outside the scroller's viewport → `inert` for that press; intersecting/focused rows kept, stand-down without a visible focusable) + `attachEntryMask` wiring mounted inside the primitive. No roving tabindex, no control-level heuristics; mask pops on focusin/scroll/pointerdown and the frame fallback, never outlives the press.
- Real-Chromium reproduction found two root causes the sandbox could not: (1) Solid refs run on template clones before adoption, so attach-time `scroller.ownerDocument` was the inert template document — the document-level listeners never received a real keydown (proven live by temporarily instrumenting the built bundle: mask count stayed 0 at press, adoption confirmed one tick later). Fix: adoption-gated lazy wiring — one microtask (usually sufficient, the clone adopts within the mount task), then a frame-pace timer fallback; press-time rAF scheduling reads `scroller.ownerDocument.defaultView`. (2) The band was planned against the scroller's border box; the real list's 1px rounded border left the seam row above the aligned band top 1px inside the band, so Chromium committed focus to that offscreen row and revealed it (−313 px jump measured). Fix: plan against the content box (`clientTop`, `clientHeight`), band edges are the content-rect edges.
- Unit/component: `virtual-list-entry.test.ts` 13 tests (plan semantics incl. stand-downs, and wiring: mask-on-entry, pop paths, interior walk spared, non-Tab stands down, per-spacer ownership, release idempotence, a content-box border pin — seam row masked despite a 1px border-box overhang — and an attach-before-insertion pin mirroring the template-clone contract; happy-dom client metrics are stubbed borderless, since its zeros collapse a real content band) and `virtual-list.test.tsx` 18 component pins (2 entry-mask). happy-dom never reflects `inert` to the attribute, so pins assert the property and the browser tier asserts `[inert]`.
- Browser tier `tests/e2e/suites/panel-list-entry.spec.ts` (6 tests, all real Chromium on unpacked build): deep forward entry lands the settled band-top row at zero scroll; backward entry from the status strip is pinned to the exact last content-band row (reveal amount is the browser's own control reveal); variable heights with an expanded code row keep entry geometry (fixture plants an inline code-bearing delay script every sixth row; expansion at/after the band top, where the virtual scroll never compensates upward); emptied list leaves no residue; resource lists enter from their top control the same way; a flooded 256-row headers capture enters at the band top and walks out through the top edge (the first interior Shift+Tab reaches the overscan-ahead row, the bounded walk reveals-and-follows to exit, zero final mask residue). Assertions pin rows/geometry, never implementation counts/mask sizes.
- `pnpm test` 2,795 pass + 1 pre-existing skip (coverage 97/96/99.5/97.8 over lib+utils); compile/lint/format green. Chromium build + `check:budgets` green — panel 389.4 KiB raw/120.6 KiB gzip, worker 356.3/72.6, whole build 969.1/272.9; ceilings unchanged, 350 KiB stretch unmet. Regressions re-run on the final build: list-reuse, counts-titles, a11y (axe), scrollbars, shortcuts — 21 pass. No interior-walk, roving-tabindex or refresh/measure behavior changed by P6G.2's focus-repair module; native docking and Firefox runtime acceptance remain P6G.10/P6.1.
- Audit round — 2026-10-17: the pass audit found **P2×2/P3×9**; both P2s and eight P3s fixed, one P3 dispositioned to TSDoc documentation (reasons inline below). Entry masking shipped code changed exactly once: `schedulePop` now cancels the in-flight pop frame before scheduling a second one, so two presses in one frame leave exactly one pending frame (the new one-pop-frame pin failed pre-fix — pending frames counted 2 → 1 after). Both P2 pins are closed: the template-clones adoption pin asserts the exact masked set (`0,1,9,10`; the audit's >0-length read is gone) and a new unit test pins the late-adoption arm of the wiring — attach detached, the unfaked microtask arm settles without inserting, the fake-clocked wiring retry runs while detached and re-arms, a late boundary insertion alone wires nothing, the next retry pass wires and the press masks the exact set (empirically confirmed interplay: vitest 5 fakes the wiring `setTimeout` and the view's rAF here, not `queueMicrotask`). Fixed P3s: the border stub now describes a real 1px-border 300 px scroller (`clientHeight` 297→298; assertions untouched); the rAF-fallback pop hop switched to fake-timer clock advances instead of a fixed 25 ms sleep; the wired rows' `inert` ownership assumption is documented in `attachEntryMask`/`pop` TSDoc — per the audit's disposition no delta-tracking machinery was added (nothing else sets row `inert` today; a future producer must ride this wiring, honoring "extensible ≠ speculative"); the entry suite's fixture route moved from a stacking worker-scoped `beforeEach` to per-test serve + `unroute` in `finally` (the sibling-suite pattern); the headers backward-walk budget gained the forward walk's headroom (aligned depth +10 → +60 presses); the P6.1 DoD line now points at the standing receipt number instead of a frozen "(last387.1 KiB not met)" snapshot; the duplicated component stub block became a local `renderEntryScenario` helper (both entry pins unchanged, 18 component pins total); the e2e README suite table gained the five shipped P6G-era surfaces (`panel-lazyload-reasons`, `panel-layout`, `panel-counts-titles`, `panel-list-reuse`, `panel-list-entry`), each attributed to its real parent receipt. Counts/gates re-green: `virtual-list-entry.test.ts` 13 → **15** (+2: the late-adoption arm, the one-pop-frame pin; `virtual-list.test.tsx` stays 18); `pnpm test` 2,797 pass + 1 pre-existing skip over 181 files, coverage unchanged at 97/96/99.5/97.8 over lib+utils; compile/lint/format green; build + budgets green — panel 389.5 KiB raw/120.6 KiB gzip (+0.1 raw: the cancel line), worker 356.3/72.6, whole build 969.2/272.9, ceilings unchanged, 350 KiB stretch unmet; the entry suite (6/6) and the shared mask surface's `panel-list-reuse` regression (5/5) re-run green on the rebuilt bundle.

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

DoD: suites green locally, per-check automated/manual annotation and measured perf table here; native/source-build comparison outcomes attached. P11.1 still owns new real-site merged detection. All B–F enhancement promises accounted,350 stretch explicitly reported against each receipt (standing measure at the P6G.4 audit round: panel389.5KiB raw/120.6KiB gz — unmet). Thumbnail skip retained; no structural changes require AGENTS except its usual triggers.
