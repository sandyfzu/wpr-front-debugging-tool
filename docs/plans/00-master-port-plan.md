# Master port plan

## TLDR

Port both behavioral baselines, improve correctness/speed/safety/UX, never copy structures. [Index](./README.md) owns status/read routing; active plans own tasks and colocated browser suites; completed records own compact decisions/evidence/open verification. Current code/lockfile/budget table—not old receipts—own implementation facts.

Remaining train: **P6G/P6.1 + independent P9 → owner P10 disposition → P11 → P12 → P13/P14 → P14.5 → P14.6 → deferred P7 → P5J → deferred P8 → P15**; **P20 independent** (any time, parallel the train). P8 is the last implementation, immediately before release (owner2026-10-19: popup not settled); optional P17 SBS panel home decision-gated. **P21** [WP Rocket simulation](./21-phase-21-wpr-simulation.md) (owner idea 2026-10-21) **before release** (owner 2026-10-22): after P10, closed before P8, gated by P15. Technical dependencies/parallelism below do not override chosen slots or authorize delegation.

## 1. Baselines and stack

- First: `../wpr-front-debugging-tool-legacy` **v2.2.5**, WXT0.19/React18. v2.2.4 initial2026-08-31 audit, full2026-10-06 reread; root source/build, not stale on-disk ZIP. v2.2.5 fixes WP7 plugin-title selector. Inventory: background/menus/headers/KC, DevTools+Elements, panel pages/Diagnoser, popup/options/Builder, isolated hub/KC/SBS/admin improvement, MAIN undefined capture.
- Second: `../wpr-inspector` **v4.1.1**, source audited2026-10-06; feature meta+footprints, cache context, floating strip/drag/visibility, RUCSS, beacon/LCP/runtime. No placeholder popup/incognito-only gate/Notion link/ad-hoc experiments/host-console narration. Useful executed/failed classification retained.
- Current stack/versions/layout/pins in [AGENTS](../../AGENTS.md), package+lockfile; Node24/pnpm/strictTS5.9/WXT/Solid/Tailwind4, Kobalte wrappers, per-icon lucide, Shiki worker/TanStack, typed webext messaging/WXT storage, Vitest/local Playwright. No extra router/motion/toast/highlighter packages. Verify installed/current APIs, engine/peer/latest-stable compatibility before any addition. Only planned second-baseline runtime package wp-rocket-scripts, exact pin/one internal adapter.
- Source measured isolated122KB raw/35gzip, MAIN1.5KB,background17.4KB,panel1.61MB. Initial port ceilings legitimately grew as required stack/features/correctness arrived. **scripts/budgets.json authoritative**, every raise measured/reasoned, never silently nudged. Panel600KiB hard/350stretch retained; checks-phase detection ratio≤0.70 (not total parse speed).
- Omit dead source channels/material:11 unused plus receive-only getDiagnoserData (inside FDT already), duplicate133-row DB (root137-row snapshot was imported), React/demo/dead style/component/dependency artifacts. Completed records explain source mappings and justified deltas, not code comments.

## 2. Architecture

MAIN capture→validated window batch→isolated snapshot/data hub→typed tab/runtime requests/pushes→panel/popup/background badge. Background owns bounded headers/KC fetch+packaged seed/menus/device session rules/live-test fetch. Options owns synced settings; designed injected UIs shadow-isolated; Builder engine/file I/O separate.

Detection eager/single-flight at capture (owner2026-10-08), one parse/cache shared, serialized snapshot released after processing; panel request joins same work. Heavy repair lazy where build permits, highlighting only bounded worker, large lists virtualized. Page-derived state dies with context; listeners/observers/disposers failure-aware. KC seed never embedded in consumers. UA identity all-frame pair separate from reference capture.

## 3. Dependencies and order

- Completed foundation chain:P0→P1→P1.1→P2/P3/P4 parallel. HarnessP4.1 and independent local siteP4.2→real-siteP4.3→P16 comparison→P5A–I/P5.1. [Core](./completed-core.md), [browser](./completed-browser-infrastructure.md), [SBS](./completed-side-by-side.md), [shell](./completed-shell.md).
- P6 dependsP5/liveP3; remaining G pieces have [local dependencies](./07-phase-6-panel-pages.md#p6g-order-and-ownership). **P6G.12–.13 planned** (owner 2026-10-21): Detections optimization filter + Adaptive/List layout modes — two small slices (P6G.13 after P6G.12), parallel with P10/P19, own tests/DoD in the P6 doc. **P20 planned** (owner 2026-10-21): [nowprocket context-menu entry](./20-phase-20-nowprocket-context-menu.md) — one page-scoped menu row + URL transform, depends shipped P2; independent, parallel P6G.12–.13/P10/P19; P19C carries the menu-only row. P8 dependsP1/P3/P5 and is **deferred to the last pre-release slot** (owner2026-10-19: popup not settled); P9 dependsP1/P5; independentP6/P9 work may parallel. P10 (dependsP1/P5) active: P10A–G done 2026-10-21; next P10K (K.1–K.5a done → K.5b; K.6 CI parity job, parallel) → P10L → P10M → P10H → P10.1 → P10J ([plan](./11-phase-10-exclusion-builder.md)).
- P11 dependsP1/P1.1/P6; chosen after P10 resolution. **P19 planned** (owner 2026-10-20): [on-page command palette + UI gate](./19-phase-19-page-command-palette.md) afterP11 — dependsP10 disposition/P11, gate G-1; P19D serializes with P12M injected-UI edits. P12 dependsP11/P3/P5 (+P9 options toggle surface; the popup's Detections row joins additively at deferred P8 — one shared item, no rework); earlyP12A shipped without moving fullP12 slot. P13/P14 needP11/P12/P3/P5/P6; **P14 integration additionally requires P13 executor pattern**, although independent pure work may parallel. No contradictory blanket “fully parallel” promise.
- Each X.1 suite depends own implementation+P4.1 (+P4.2 if site), runs with/after feature; focused regression ships with change. Suites live in **same phase file**, not separate planning track. Chromium local-only, never CI; Firefox installed-extension smoke explicit/manual unless new verified harness.
- P14.5 dependsP11–P14, decision gate first. P14.6 dependsP14.5+owner site or explicit scope skip; then rebuilt-plugin-gatedP7, thenP5J, then deferredP8, then all-requiredP15. External/Firefox/parked work cannot silently vanish.
- **P21 WP Rocket simulation** dependsP10 (session pipeline + overlay mode registry)/P10K (row semantics); only P21A (investigate/decide) planned, it plans P21B+; **before release** (owner 2026-10-22): any slot after P10, closed before deferred P8 (the last pre-release implementation), so P15 gates it.
- Optional **P17 Compare panel home** dependsP5/P6/P16; no doc/implementation until scheduled. Filename17 Firefox workstream is unrelated. Its technical fixes may parallel independent work but strict Chromium nonregression gate applies.

## 4. Cross-cutting commitments

AGENTS owns coding/error/security/testing/appearance rules; [design decisions](./design-decisions.md) owns UX-D/SB-D, [UI bar](../ui-ux-bar.md) shared values/§D. Do not duplicate them per plan. Specific port commitments:

1. Recheck **both source HEADs** before each phase/P15; real builds on same fixtures prove behavior. Preserve useful strings/behavior except explicit fixed defect/native-label decision; reshape types/names/layout, provenance only in plans.
2. One declaring domain per constant/type/table/selector/helper. Reference engine duplicates **control flow only**, imports vocabulary/types, never port logic. Unknown future data tolerated where safe, boundary failures explicit.
3. Strict typed additive contracts, sender-resolved tabIDs; panelSearch inspected-tab payload is documented exception. Guard page/storage/message/file/network inputs, least privilege, no sensitive logging/persistence/export.
4. Async errors handled/results, no dead-end UI/fake waits. System(default)/Dark/Light before content paint/live persisted across surfaces; only panel/options writers. Complete source copy distinct from bounded display.
5. Plugin/settings/KB naming beats inherited abbreviations/typos. Native names include Optimize critical images/Automatic Lazy Rendering/Preload fonts/Preconnect to external domains/Priority Elements; option maps/verified labels own rendering strings. Labels need real install recheck, not internal OCI/ALR/LRC/DJE/RUCSS/CPCSS/SHGF name invention.

## 5. Verification/definition of done

- Every implementation slice independently goal/dependencies/parallelism/tests/DoD; pure logic tests first, integrations and browser regressions with change. Common gates **pnpm compile, lint, format:check, test**; runtime/bundle change **build+check:budgets**, cross-browser/shared primitives Firefox build. No commit/push unless asked.
- Fixture/reference/snapshot plus actual engine-output→boundary contracts; compiled-source normalization audit and real same-page builds. happy-dom parse/count limitation retained in core record, so no browser parity inferred from runner alone.
- Checks benchmark local≤0.70 aggregate, release actual-page≥5 loads/build; no machine speed bench/e2e in CI. CI common gates/build/budgets every PR, Firefox build added/verifiedP15.
- Raw/gzip/perf receipts with source revision/context/known limits,5000-row no-task>50ms/TBT<200ms; cold-start500ms measured from entry execution (imports earlier). Worker no main-thread fallback; shared-chunk/whole-build accounting audited.
- UI changes receipt bar D1–D7; zero axe violations and named reviewed incomplete exceptions only, keyboard/themes/reduced motion/hostile CSS/native topology distinct from standalone shim. Actual native docking now proven reachable; old impossibility claims superseded.
- Every requirement/enhancement delivered or **explicitly dispositioned** with evidence/reason at owning phase/P15; manual/open checks stay open, no build=runtime/store approval. Current-tree final gates not historical-run reuse.

## 6. Stable source defect IDs

IDs retained for tests/old references; these describe **source defects, not all open port bugs**. Status/evidence in owning active/completed records:

1. P2: KC updater stuck on failure.
2. P2: missing host coverage.
3. P2: swallowed menu send.
4. P7: conditional React hook.
5. P7: server-load badge tests wrong object.
6. P6: zero-script loader never resolves.
7. P6: module analysis/interval leaks.
8. P6: search next/previous unused.
9. P6: Preloaded badge says Lazyload.
10. P6: truncation typo/layout thrash.
11. P4: unenforced error cap.
12. P3: wrong `__blank` target.
13. P3: DB content rendered as HTML.
14. P1: repeated 23× image serialization.
15. P8: inaccessible toggle.
16. P9: fake save/swallowed error.
17. P6: module animation flags.
18. P6: unclean search debounce/reset.
19. P3: refresh/animation timer hacks.
20. P2: unbounded header map.
21. P4: singular sentinel payload ignored.
22. P6: mismatched inline magic string/broken link.
23. P7: arrays always expanded.
24. P5: observer leak.
25. P5/P15: dropped built stylesheet.
26. P8: unhandled tab query/debug dump.
27. P8: all-off flash/duplicate IDs.
28. P8: fixed body clips.
29. P6: fake 1000ms result gate.
30. P7: string/item counts and inconsistent expansion.
31. P5: stagger/idle loops/no reduced motion.
32. P5: handlers after data/drop early search/Esc.
33. P5/P6: invalid utility classes.
34. Owners/P15: copy typos/abbreviations.
35. P10: error laundering/stream cleanup/working/external-edit loss.
36. P5: ignored eval exception.
37. P9: mutable sections/no load state.
38. P7: triple tab state.
39. P6: magic card IDs/CSS-delivery absent branch.
40. P5: observer null-ref attachment.
41. P0/P4: cross-world CustomEvent risk.
42. P1/P5: unscoped panel pushes.
43. P1: dead getDiagnoserData.
44. P1: unescaped KC regex names.
45. P2: spoofed/tabless headers and wrong menu tab.
46. P2: import-time listeners/unhandled boot/laundered fetch errors.
47. P3: retained multi-MB HTML.
48. P3: whole-DOM HelpScout rescan/leak/stale DB/late WP table.
49. P3: transition-dependent state/listener buildup.
50. P3: root-relative admin link.
51. P1.1: shared beacon falsely proves Optimize critical images (fixed dedicated family model).

## 7. Residual risks

Read owning records only when relevant: core manual120-tab/HS/in-place reload/baseline timing; SBS permanent dual-origin/UA-copy and external/Firefox runtime; P6 search/copy candidates/stretch; P12 touch/host CSS/persistence; Firefox ID/MV2 namespace/mount/panel cause; RUCSS endpoint/API availability; package internal churn/lazy IIFE build seam; P15 native/high-contrast/minimum-browser/AT/long-session checks. “Collecting”/applied-empty/unknown is normal honest evidence, not automatically an error.

## 8. Committed extensions

P15 evidence/disposition ledger must include:

- Three-state restart-safe toolbar dot and console state/count summary:P1/P2/P3/P9.
- Support report/summary/full headers+names-only cookies/redaction/reference exclusion bridge/complete script copy:P6; Elements Rocket/WPR inventory:P5.
- KC freshness/refresh:P1/P2/P9; CI:P0/P15; synced live three-way appearance:all surfaces/P9.
- SBS default-on proportional sync/mobile overlay UA+412×892/device identity/desktop1280-floor:P16–16.4; open verification retained.
- Meta precedence/source/cache context/native feature coverage:P11/P14.5; opt-in persisted strip+tools:P12; safe-fetch RUCSS TEST MODE:P13; beacon/LCP/live scripts/current-visit CWV:P14.
- `nowprocket` page-scoped context-menu entry:P20.

Non-goals retained:i18n until public-distribution need, in-PSI split page (two tabs instead), commands-API shortcuts (menus suffice — superseded only for the on-page palette by P19 G-2, owner2026-10-20), differential KC sync (full hourly simpler). T8 phone snapshot deferred/T9 speculation viewer dropped inP14.5. Shipped overlay simulation does not approve snapshot or optional panel home.

## 9. Second-baseline acceptance

P11–P14 preserve useful behavior but deliberately change: no incognito-only gate/host-state cookies; per-origin opt-in; stronger per-check fingerprints; no beacon-as-applied claim; panel forms/results+on-page triggers; background-validated fixed endpoint/fetch-before-strip; instance beacon harness suppresses real finalize/write; cleaned optional highlight/observers; all script groups/structured data retained; Alt+H only. Phase plans own exact proof, not a second checklist here.

## 10. Coverage/tooling owner

[P14.5](./15b-phase-14-5-coverage-and-tooling.md) contains the2026-10-07 plugin coverage matrix/evidence, D1–D7/T1–T9, BUILD/DROP/DEFER gate and P11 corrections. Reverify current plugin first; do not copy its full plan back into master or execute candidates without decisions.
