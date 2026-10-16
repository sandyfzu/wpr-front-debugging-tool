# Phase 5 — UX study: the panel's committed design decisions

**Status:** binding P5–P15 decision record, produced 2026-10-12; P5 owns it. **Consumers:** P5 shell, P6–P10 pages/satellites, P11–P14 integration/strip, P15 audit. The separate [P5H strip brief](./06c-phase-5-strip-design-brief.md) owns visuals; this study constrains language, status vocabulary, and interaction counts (`UX-D7`, `UX-D11`).

## TL;DR

Three role-based personas; opening questions answered at first paint with **0 interactions** (`UX-D1`), first-tier answers within **≤ 1–2** (§6). Eighteen verified frictions (`F1–F18`) inform the Nielsen/DevTools audit (§5), hierarchy (§7), and binding decisions (`UX-D1…UX-D16`, §8). Later phases must revise this study before contradicting it (§11). P15 owns the copy sweep; plugin/KB naming remains authoritative.

## 1. Method & sources

- **Read this round:** original `entrypoints/fdt/App.tsx` (fetch machine/menu at `18–25`, search bounce/route reset, handlers inside data `.then` at `40–73`); `components/app/devtools/menu.tsx` (flat labels); `pages/Error.tsx` (close/reload/reopen, no Retry); `pages/Fetching.tsx`; `components/app/devtools/FetchingComponent.tsx` (`repeat: Infinity`, 0.5 s entrance). Deeper page behavior comes from [07's Legacy reference](./07-phase-6-panel-pages.md#legacy-reference-page-by-page) and [06's Legacy reference](./06-phase-5-devtools-panel-shell.md#legacy-reference), bugs #6–#42.
- **Second baseline:** strip chip states, drag persistence, and version status audited in master §9; the strip brief re-walks them at design time.
- **Standards:** Nielsen's 10 heuristics (NN/g, 1994); information scent/foraging (live previews avoid blind clicks); WCAG 2.2 contrast 1.4.3/1.4.11, Target Size 2.5.8, Animation from Interactions 2.3.3/reduced motion; WAI-ARIA APG (verified 2026-10-12): combobox palette with wrapping arrows, Home/End, Enter, Esc preserving input, `aria-activedescendant` keeping caret focus; roving tabs with automatic activation (cheap sub-views). Chrome DevTools docs inform keyboard/docking context.
- **Installed API evidence:** `chrome.devtools.panels.themeName` is typed in `node_modules/@types/chrome/index.d.ts` (Chrome 59+), supporting §9's observation.
- **Limit:** no interviews. Personas/jobs derive from P5's Goal and master §8's support-report audience. P15 re-walks budgets against real usage and revises this study for deltas.

## 2. Personas (fixed by the P5 Goal)

- **A — Support engineer (primary):** diagnose customer-page caching and provide ticket evidence. Questions: WP Rocket/version? Cached/since when? Platform/server? Fresh data? Success: ticket answer + copyable report within **2 interactions** of panel open.
- **B — QA engineer:** verify setting/purge changes. Questions: cache age advanced? Feature applied/deferred/delayed? Change in served copy? Success: same-position verification after reload, no re-navigation.
- **C — Developer:** inspect scripts, undefined globals, and selected-element attributes to fix Rocket-induced behavior. Questions: undefined count? Delayed/excluded scripts? Element's Rocket attributes? Success: error → fix on clipboard within **3 interactions**.

Opening questions must require ≤ 1 interaction. Detailed gates are in §6.

## 3. Journey maps

DevTools/panel opening is the shared baseline, not an interaction. `0*` means visible at first paint (§6).

**A — “Is it caching, and what do I tell the customer?”**

1. **A1, 0:** skeleton → ready, correct palette, ≤ 500 ms interactive (`UX-D13`; `F11`, `F7`).
2. _*A2, 0*:_* status bar shows WP Rocket/version, cache age, platform, freshness (`F1`).
3. **A3, 0–1:** cache-segment hover tooltip; click → Detections' relative/absolute timestamp (`F1`).
4. **A4, 1:** Detections/palette `Copy report` → markdown + toast (`UX-D9`, `UX-D12`; `F14`).
5. **A5, 1:** stale marker → palette `Reload data`/retry (`F18`).

**B — “My change — did it take effect?”**

1. **B1, 0:** inspected-page reload → soft refresh retaining route/scroll/focus (`UX-D5`; `F8`).
2. _*B2, 0*:_* updated status bar/cache age (`F1`).
3. **B3, 1:** owning nav row → feature status/subtitle, plugin-native name (`UX-D12`).
4. **B4, 1–2:** JavaScript → filter → counts/rows; search cursor navigates hits (`F4`).
5. **B5, 1 each:** RUCSS/Beacon Tools rows arrive additively in P13/P14 (`UX-D14`).

**C — “Fix this page's Rocket headache.”**

1. _*C1, 0*:_* Diagnose badge previews `Undefined References · N` (`F2`, `F17`).
2. **C2, 1:** page renders word cards immediately when computed (`F6`).
3. **C3, 1:** offending URL's `Copy as exclusion` → Builder Delay JS field (`F14`).
4. **C4, 1–2:** JavaScript → Delayed filter → inline source; external links open safely (`F4`, `F15`).
5. **C5, 0 + selection:** Elements shows IMG lazyload object or any-element attribute inventory; eval failure returns an error object (`F12`).

**Cross-persona:** `Cmd/Ctrl+K` launches pages/actions. The shortcuts overlay advertises `/` (re-owned 2026-10-13; DevTools reserves `?`); `?` remains an unadvertised alias. Esc closes overlays and clears search (`UX-D3`, `F4`).

## 4. Verified legacy friction inventory (what "improve over legacy" is made of)

Each arrow names the binding answer in §8 unless another owner is given.

- **F1:** opening answers buried in a Detections card grid, not reliably above fold at docked-right widths → `UX-D1` status bar.
- **F2:** six bare menu labels, no icons/groups/state (`menu.tsx`) → `UX-D2`.
- **F3:** `Error.tsx` requires close DevTools/reload/reopen; no Retry → `UX-D9`.
- **F4:** Esc no-op/stale filters; data-`.then` handler registration drops early searches (`App.tsx`, #8/#32) → `UX-D4` streaming/cursor search, mount-time handlers.
- **F5:** triple-sourced Diagnoser tabs (#38) → `UX-D10` shared APG tabs.
- **F6:** computed results hidden behind 1000 ms wait (#29) → `UX-D6` real waits only.
- **F7:** per-index stagger delays long-list tails; infinite empty/error pulses; no reduced motion (#31, `FetchingComponent.tsx`) → `UX-D6`.
- **F8:** inspected-page navigation calls `window.location.reload()`, losing context (original main) → `UX-D5`.
- **F9:** unscoped pushes reload another DevTools window (#42) → `UX-D2` tab ownership.
- **F10:** hardcoded dark/inline `gray-950` gradient → `UX-D6`, master §8 appearance.
- **F11:** authored stylesheet absent from built HTML (#25) → P15 built-output gate.
- **F12:** non-IMG “Select an IMG element” dead end; ignored eval errors (#36) → P5 sidebar inventory/error object (original task §2.1).
- **F13:** captured headers/cookies never displayed → P6 Headers & Cookies + Detections preview.
- **F14:** manual support transcription/no tool bridge → `UX-D9` report/exclusion/copy feedback.
- **F15:** “FDT legacy”, “Trucated”, “Resouces”, “ocurred”, Preloaded's “Lazyload” badge (#9…) → `UX-D12`, P15 copy-delta sweep.
- **F16:** focusable links but no keyboard-first palette/shortcuts → `UX-D3`.
- **F17:** labels preview no answer (NN/g information scent) → `UX-D2` live nav and navigating status segments.
- **F18:** no answer-age signal → `UX-D1` freshness/stale/captured-at.

## 5. Usability-heuristics audit of the planned IA

Nielsen heuristic → evidence → binding answer:

1. **System status:** `F1/F6/F18` → status bar, real-wait skeletons, stale/captured-at (`UX-D1/D13`).
2. **Real-world match:** `F15` → plugin/KB names, no rendered abbreviations (`UX-D12`, master §4.12).
3. **Control/freedom:** `F4` → Esc/combobox cancel, Retry, preserved route (`UX-D3/D5/D9`).
4. **Consistency:** `F5/F7/F10` → shared status/tabs/appearance/motion (`UX-D6/D7/D10`).
5. **Error prevention:** `F3/F12` → reserved rows disabled with explanation; validate before render (`UX-D9`).
6. **Recognition:** `F2/F17` → live previews, label+state tooltips, navigating status segments (`UX-D2`).
7. **Efficiency:** `F4/F16` → palette, `/` help, hash deep-links, streaming search (`UX-D3/D4`).
8. **Minimalism:** `F7/F10/F11` → dense data, semantic accent, tokens; no decorative gradients/pulses (`UX-D6`).
9. **Error recovery:** `F3/F12` → actionable Retry, explicit context-invalidated remedy, side-effect toasts (`UX-D9`).
10. **Help:** `F16` → `/` overlay, one-line page explanations, useful empty states (`UX-D3/D9`).

DevTools context adds three constraints:

- **Variable geometry** (bottom/right/undocked): container-query morphology and 480 px glanceability (`UX-D2/D8`; original ignored docking).
- **Keyboard-first users:** APG combobox/tabs, roving focus, route-switch `h1` focus (`UX-D3`; `F16`).
- **Data is the aesthetic:** monospace/tabular values, virtualization ≥ 100 rows, P6's 5,000-row gate: no task > 50 ms, TBT < 200 ms (`UX-D6/D13`; original unvirtualized lists).

**Mechanical accessibility floor (P11/P15):** WCAG 2.2 AA token contrast; ≥ 24×24 CSS px hit areas (2.5.8); disable motion under `prefers-reduced-motion` (2.3.3); resolve appearance before mount, no wrong-palette flash (master §8).

## 6. Interaction-load budget (the gate)

One interaction = deliberate click/keypress **after ready**; hover, movement, waiting excluded. `0*` = visible without scroll at ≥ 480 px container width; narrower layouts wrap, never horizontal-scroll (`UX-D8`). Source counts derive from §4. Exceeding a gate is a defect, not permission to re-budget.

| #   | Task (persona)               | Original path/count                                  | Port path/count                          | Gate         |
| --- | ---------------------------- | ---------------------------------------------------- | ---------------------------------------- | ------------ |
| 1   | Cached? (A)                  | Grid scan, above-fold uncertain: 0 + scan            | Status bar: 0*                           | ≤ 1          |
| 2   | Version/platform/server (A)  | Cards: 0 + scan                                      | Status bar: 0*                           | ≤ 1          |
| 3   | Cache build age (A/B)        | Cached subtitle: 0–1                                 | Tooltip/Detections: 0–1                  | ≤ 1          |
| 4   | Feature state (A/B)          | Owning page/card: 1–(scroll)                         | Nav → page: 1                            | ≤ 2          |
| 5   | Re-verify change (B)         | Reload/re-navigate/re-scroll: 2–4                    | Soft refresh: 0                          | ≤ 1          |
| 6   | Delayed count (C)            | JS page: 1                                           | Nav badge: 0*                            | ≤ 1          |
| 7   | Delayed source (C)           | Page/expand: 2                                       | Also copy: 2–3                           | ≤ 3          |
| 8   | Undefined count (C)          | Page: 1 + 1000 ms wait                               | Nav badge: 0*                            | ≤ 1          |
| 9   | Exclusion fix (C)            | Transcribe: manual                                   | Copy as exclusion: 1                     | ≤ 2          |
| 10  | Support report (A)           | Transcribe: manual                                   | Copy report: 1                           | ≤ 1          |
| 11  | Full-data JSON (A)           | Unsupported                                          | Palette: 2                               | ≤ 2          |
| 12  | Jump page (all)              | Menu: 1                                              | Nav: 1; palette ≤ 3 keys                 | ≤ 2          |
| 13  | Search/next/prev/clear (all) | 400 ms stream; Esc no-op, navigation to clear: 1 + 1 | 250 ms stream; Esc clears: 1             | Clear ≤ 1    |
| 14  | Error recovery (all)         | Close/reload/reopen/waits: ~5                        | Retry: 1                                 | ≤ 1          |
| 15  | Appearance (all)             | Impossible                                           | Palette cycle/options, live restyle: 2   | ≤ 2          |
| 16  | Keyboard (all)               | Links only                                           | Tab/arrow/palette/`/`                    | Complete     |
| 17  | First answer time (all)      | Unmeasured/unbounded fetch                           | Interactive shell + first state: ≤ 0.5 s | Measured row |
| 18  | Answer age (all)             | Absent                                               | Freshness/captured-at: 0*                | —            |
| 19  | Elements sanity (C)          | IMG-only/dead-end: 0 + select                        | IMG + any-element inventory: 0 + select  | —            |

## 7. Information hierarchy per surface

Each row lists **glanceable → one click → hidden until wanted**.

- **Status bar (`UX-D1`):** presence/version, cache/age, platform/server, freshness/stale → owning page → stale explanation.
- **Detections (P6):** same four-answer summary + card statuses → tooltip/focus detail, headers toggle → collapsed headers, Copy report (also palette).
- **JavaScript (P6):** nav `delayed X/Y`, summary counts/presence → filter → inline source, search cursor; P14 runtime states added later.
- **Lazyload (P6):** nav badge/summary → filter → exclusion details; thumbnails remain a flagged decision.
- **Preloaded Resources (P6):** counts → filter → link detail.
- **Undefined References (P6):** nav N/monitoring → word cards → Copy as exclusion.
- **Headers & Cookies (P6):** caching headers first/captured-at → row copy → virtualized inventory, names-only cookie note (values redacted; HttpOnly invisible, stated in-page).
- **Diagnoser (P7):** disabled row + “returns with the Diagnoser plugin v2” tooltip → reserved/no navigation → content waits for v2.
- **Tools (P13 RUCSS, P14 Beacon/LCP, P17 Compare):** rows appear only when landed (`UX-D14`) → one click → no additional hidden tier.
- **Elements (P5):** parity object on selection → no extra click → non-IMG inventory/eval-error object.
- **Strip (P12):** per-origin opt-in grouped chips, Alt+H, persisted drag → detail/outcome banner → full panel state; visuals owned by the separate brief (pending when this study was produced).
- **Toolbar (master §8, shipped):** per-tab green/blue/gray dot, neutral semantics shared with panel; no deeper tiers.

**Never glanceable:** cookie values (redacted at capture), logged page content, sensitive header secrets. This hierarchy exposes caching evidence, not surveillance.

## 8. Binding decisions

- **UX-D1 — Zero-interaction answers (P5; P6+ consumes).** Four status segments: presence/version, cached/relative age, platform/server, freshness/stale. Pure data-store selectors; segments navigate to owners. Render during boot before data settles; absent WP Rocket is neutral “Not detected,” matching the gray toolbar badge.
- **UX-D2 — Informative navigation (P5; P6/P13/P14 extend).** One typed Overview/Inspect/Diagnose/Tools registry, live counts/dots, tab-scoped pushes, reserved rows disabled with explanations. Original morphology: ≥ 768 px top tabs, below icon rail, by container query; subsequent owner changes are in P5/P5J.
- **UX-D3 — Keyboard-first (P5; P6–P10 reflect).** APG combobox palette (wrapping arrows/Home/End/Enter/Esc, `aria-activedescendant`); route switch focuses page `h1`. One shortcuts declaration drives listener, overlay, palette hint: advertise unshifted `/`, match `event.key` without layout/Shift assumptions; accept unadvertised `?` where the host does not claim it. Esc closes overlays and always clears search. Dated re-ownership evidence/manual limit in §11 and 06 P5E.
- **UX-D4 — Streaming, navigable search (P5/P6).** 250 ms debounce (original 400), next/prev cursor, scroll-to-hit, Esc clears, route change resets.
- **UX-D5 — Context-preserving refresh (P5).** Refetch inspected-page navigation in place, keeping route/scroll/focus; hard reload only on logged, actionable contract failure.
- **UX-D6 — Data-first density/motion (all UI, P5 pattern).** Compact spacing, mono/tabular values, semantic accent, tokens only. Mount CSS motion, no indexed stagger/infinite idle loops, honor reduced motion (#31); skeletons only for real waits (#29).
- **UX-D7 — Shared statuses (P5; P6–P14 consume).** `status-badge.tsx` owns exactly ok / warn (amber attention/unsure) / error / info / neutral, shared by nav/cards/chips/strip and toolbar semantics.
- **UX-D8 — Glanceability (P5, asserted P5.1).** Four status segments visible without scroll at ≥ 480 px; 320–480 px wraps to two rows; no horizontal scrolling at any docking geometry.
- **UX-D9 — No dead ends (P5; P6–P15 enforce).** Async errors have action/Retry; empty states explain next steps; copy/save/export confirm via toasts; context invalidation names the remedy.
- **UX-D10 — Shared mechanisms (P5; P6–P14).** APG automatic `tabs.tsx`, `virtual-list.tsx` ≥ 100 rows, `filter-bar.tsx`; no bespoke page variants (#38).
- **UX-D11 — Same product on-page (P12; P5 brief).** Shared tokens/statuses, per-origin opt-in, Alt+H only, persisted drag, full shadow isolation, live appearance; master §9 owns storage/mechanics.
- **UX-D12 — Plugin-native names (all UI/P15).** Master §4.12 overrides string parity; never render internal abbreviations. Track copy deltas, sweep in P15.
- **UX-D13 — Measured performance (P5, re-run P6/P15).** Typed cold-start row: ≤ 500 ms interactive + first data state, asserted by P5.1. Boot states precede expensive work; lists meet P6 long-task gates.
- **UX-D14 — Additive IA (P5 pattern, P6–P17).** Pages/chips/filters = registry rows + tests, not sibling branches; deletability proves locality.
- **UX-D15 — Small-height overflow affordance (owner, 2026-10-13; P5, P5J geometry, P6–P14 growth).** Rail never scrolls/clips rows. `visibleRowsInRail` computes fit from measured row/separator/gap boxes through an injected seam and registry—no hardcoded pitches/names. Overflow moves, registry-ordered, into rail-end “More pages”: same live chips, `aria-current`, disabled reserved rows with note. While shown, rail has `overflow: hidden`, `scrollHeight == clientHeight`, no native/designed scrollbar. Keep 32px pitch: compression weakens targets and still needs overflow; a scrolling icon rail hides destinations/scent (`UX-D2`, P5J's visible-scrollbar failure). Trigger is tabbable; APG menu supports wrap/Home/End/typeahead/Enter/Esc-to-trigger; palette works at every height. Content loses height first, then rows overflow; status/brand/trigger never shrink or scroll away. Right-floating bottom-edge tooltips stay inside the window (browser pin).
- **UX-D16 — Symmetric group spacing (owner, 2026-10-13; P5, fit thresholds, P6–P14 growth).** Separator lead = 6px top margin + 1px hairline + 6px bottom padding (13px; in-group gap 4px). Owner observed last-row hover touching the hairline. Geometry stub uses the same lead; overflow trigger breathes by the shell row gap. `--line-2` is decorative, outside AA pairs. Spacing only: row boxes/pitch/interactions unchanged.

## 9. Open observations for the owner (decision not required to proceed)

1. **Host theme mismatch:** System follows OS, not DevTools' independent theme. Verified Chrome-59+ `chrome.devtools.panels.themeName` could support “Match DevTools,” but the owner's exactly-three-options mandate (2026-10-12, master §8) stands. P9 would own any approved change.
2. **Undocked geography:** original 480 px glanceability/768 px morphology thresholds target common docking forms. Revise this study if usage disagrees, not ad-hoc CSS.

## 10. What this study does not decide

Exact cards/subtitles (P6/P15 copy); strip visuals (P5 brief, then pending); popup/options IA (P8/P9; shared UX-D7/D12 still bind); optional Compare P17; i18n (non-goal).

## 11. Traceability & change control

- Later tasks cannot contradict this study without editing it and dating the changed decision. P6–P15 tasks/PRs cite UX-D/F IDs; P5 live checks use UX-D1 first-paint answers and UX-D5 navigation survival.
- Precedence: **plugin/KB naming (master §4.12) > study > phase docs > implementation comments**.
- **UX-D15 addition, 2026-10-13:** native rail scrollbar appeared below ~313 px rail-plus-shell height. Hidden destination = trigger + row (2 interactions), within §6 row 12; no budget change.
- **UX-D15 audit, same date:** below roughly 220 px, the height-clamped menu plate may scroll internally with its token-thin scrollbar; rail/shell remain scroll-free. This exception never permits rail scrolling.
- **UX-D16 alternatives, same date:** top margin was 0px; retain existing 6px bottom padding and add 6px above. Rejected hover-box inset (changes all row paint/hit boxes) and first-row top padding (only adds below-space). Still 32px rows, no added interaction/shrunken target.
- **UX-D3 revision, same date:** `/` replaces advertised `?`; alias remains. Chrome docs (`developer.chrome.com/docs/devtools/shortcuts`, “Show Settings: ? or F1”) and the owner's Shift+/ → Settings report explain host reservation; common-layout Shift composition also violated the unshifted-key contract. `panel-shortcuts` pins raw Shift+/ (`Shift` + `/` keydowns) and rejects `'`. Whether host-intercepted chords reach the panel or panel `preventDefault` can matter remains **manual**, not proven by the harness. Still one keystroke (§6 row 16).
