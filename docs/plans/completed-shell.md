# Completed panel shell: P5A–P5I/P5.1

## TLDR

Shell/design system shipped2026-10-12/13; browser suites closed2026-10-14. [Design decisions](./design-decisions.md) retain binding requirements; [P5J](./06d-phase-5j-panel-topbar-redesign.md): rail-only is the final form (owner 2026-11-17; wide/dual form parked), closed 2026-11-17. Later layout/feedback acceptance is [here](./completed-ui-acceptance.md); page behavior is [here](./completed-panel-pages.md).

Original sequencing: A(devtools)/B(light primitives)/H(strip brief) parallel; C(shell)→D(nav)→E(keyboard)/F(status) parallel→I(close-out); G(page primitives) after B. Real data needed P3/P4; mock work could parallel producers. Do not replay completed execution checklists.

## Devtools and transport (P5A)

- WXT devtools document registers **WPR FDT**→`panel.html`, Elements **WPR Lazyload**, search relay and warm-up independently guarded. Callbacks preserve Chrome145 compatibility (promise registration APIs require151/152); read lastError inside callbacks. No import-time DevTools access; feature-detected accessor handles standalone panel.
- Static `$0` eval embeds constants/exclusion list through JSON serialization, no page-controlled code interpolation. IMG returns lazyload/imageLoaded-or-reasons/src; other elements return Rocket/WPR/lazy attributes (including Delay type); exceptions/nonobjects produce `{evalError}`, not undefined. Exact substring exclusion semantics retained.
- Fallback wording finalized2026-10-15: **Select an img element**; other-element inventory remains.20 eval tests cover all selections/quoting/error shapes.
- Relay supports perform/cancel/next/previous. No-receiver debug, real failures warn; unknown actions warn/drop. Shared callback tab-send guard consumes runtime.lastError the library ignored, without changing response semantics.
- Important protocol exception added in P5C audit: `panelSearch` carries validated inspected **tabId in payload** because devtools runtime sender has no tab. Both senders/receivers changed together; foreign/malformed IDs refused. This is not authorization for page-origin spoofable tab IDs.

Evidence: eval executes against real test elements; fake-browser search/error tests; built Chrome/Firefox `devtools_page`, HTML/chunk/CSS checks. Devtools JS initially8.9 KB, ceiling24. Real Elements/native search interception remain separate manual checks.

## Shell/store (P5C)

- Appearance follow armed before read; racing write wins; failure degrades boot rather than blocking. Head CSS paint lock releases once on success/failure/crash. Final themed canvas paints OS surface before stored explicit choice resolves; possible **background-only** OS→explicit flip accepted, content never paints wrong. Render-blocking token link and per-icon lucide imports reduced dev requests2304→174 (warm FCP~1240→250ms); build/tree-shaking alone did not prove dev cost.
- Tiny signal hash router: empty/unknown→default without manufactured history; real anchors/back/deep-link; one cleaned hashchange listener. One typed route table drives nav/body/palette; reserved Diagnoser disabled with note until P7. Headers/Tools add rows locally.
- Injectable-edge state factory owns `idle|fetching|ready|refreshing|error`; pages read data/search contexts, never transport. Boundary validation first, sender-tab filtering. Every listener registered before boot flight so early search/push isn't silently lost. Full-state push channels buffer last value while no data, drain once onto first loaded settle, persist across failed settle, clear on stop.
- One250ms search store; immediate cancel clears query/cursor; route resets; P6G consumes cursor. `notifyPanelReload` refetches in place, dedupes flights, auto-recovers error when CS announces; refreshing keeps mounted page. Contract failure flags/logs hard reload exactly once. Expected no-CS misses never disappear merely because receiver normally exists.
- Content-only crash boundary preserves nav/status recovery; dedicated hidden status announces machine state, not entire page content. Current truthful fallback headings supersede original heading-less skeleton/error decisions.

## Navigation (P5D and owner revisions)

- One real anchor/registry row, AT-named groups, aria-current, disabled explained reserved row. Live selectors: delayed X/Y; undefined N/Monitoring/silent once settled; lazy/preload counts only when inventory known. No duplicated Detections identity/freshness badge. Throwing selector logs row/cause and degrades **that row** stateless, then can recover.
- Retired wide top bar/container morphology removed2026-10-13 after owner found ugly/scrolling wide form; tooltips moved **right**, never over next row. Browser pins320/300/280px tooltip gutter/hit-test and rail-only resize behavior. P5J redesigns, never restores deleted threshold blindly.
- Height overflow uses `visibleRowsInRail` pure prefix/suffix over **measured** row boxes; invisible pointer/AT-inert zero-box geometry stub follows real registry/layout. Degenerate measurements retain current slice, never hide rows. ResizeObserver seam cleans up.32px rows, group lead6+1+6,4px row gap.
- Rail never scrolls: More pages APG nonmodal menu owns hidden suffix with live chip, aria-current/reserved note. Trigger combines tooltip/menu semantics on one element; Kobalte owns click. Header z10 prevents status strip swallowing trigger at micro-heights. Measured sweep300→60px; menu internally scrolls when clamped (available-height74px at90px window), no stable phantom gutter. Pointer **and** keyboard tail reach pinned after audit caught overflow-visible plate losing pointer reach. Disabled APG items skipped, never fictitious tab stops.
- Symmetric group-spacing fixtures rederived from measured anatomy, not assertion relaxation: initial6 rows230px, seventh row266px. No orphaned separator when cut mid-lead; true mid-group cut separately pinned. Current DOM/registry determine thresholds.

## Keyboard/actions (P5E)

- Shared command palette: Kobalte dialog + own APG combobox (`components/ui/command-palette.tsx`; Kobalte's combobox dropped in P19B — its global live announcer writes into `document.body`, a host-page write once the palette is injected), token matcher over labels/keywords (substring scoring, **not fuzzy subsequence**), locale-independent fold, one open overlay. Highlight re-arms the top enabled row per query (pure rules in `command-palette-model.ts`); Enter never dead-ends.
- Tab capture dismisses palette rather than letting combobox reset query under modal; route action closes/restores then focuses destination h1 (same-route action explicit). Route focus never runs on ordinary refresh. `/` help and unadvertised `?` alias follow design record; exact modifiers/editable guard tested. Host interception is not inferred from standalone keys.
- Commands snapshot once/open through `untrack`: mid-open push cannot rebuild list/yank selection. Sync throws and rejected promises share handled failure; clipboard constructed lazily inside recovery. Action registry adds rows, no sibling branching.
- Reload, JSON export, appearance cycle, Builder, help; P6 adds report. Blob+anchor download, finally cleanup/revoke, clipboard fallback, double-failure toast. Filename pure/pinned. Builder page path single-owned with menu opener. Real attached download/tab-opening/scoring feel remain manual unless separately receipted.
- Accepted minor: opening palette/help while More pages open can leave that separate menu underneath; overlay-store dismissal is a candidate, not a claimed fix.

## Status (P5F)

- Full-width persistent footer outside content/rail; four segments through pure selectors, each contained against failure. Identity/cache/platform link to Detections; freshness text only. Unknown header values vs no capture are distinct; server then x-powered-by, case-insensitive first wins.
- Cached with valid stamp shows age; without representable stamp Cached only; absent plugin cache dash, not “Not cached.” Shared representability guard prevents hostile finite epoch crashing all answers.64-char versions elide inside chip.
- Clock30s while loaded+visible only, pause/resume immediate read, cleanup/idempotence; non-keyed Solid children read accessors, not frozen narrowed const. Stale threshold **10min**, owner changed2min2026-10-14. Freshness time is last **full settle**, patches do not freshen snapshot; remedy accessible, not hover-only.
- Own480px content-box query; page480px tier is a different concept. Shell sync guard excludes pages; pages use named regular/wide tokens. Four answers wrap at compact; actual native geometry later tested.

## Primitives/isolation (P5B/P5G/P5H)

Kobalte0.13 wrappers only, lucide per-icon panel imports, tested token AA roles. Current code/AGENTS own API list; key non-obvious decisions:

- Button danger uses soft/error, not failing white-on-error fill; disabled explanatory triggers retain hover. Menu/dialog/palette APG ownership stays in wrappers. Tooltip anchor mode must suppress built-in button `type` with null, not undefined (Solid mergeProps falls through undefined).
- Toast queue≤6, contextual dismiss names, wall-clock timer; later roles/hover-focus fixes in UI acceptance supersede initial implementation. ErrorState requires actionable retry; full-page h1 opt-in doesn't create duplicate headings in embedded uses.
- Shared Switch uses real hidden-input/control naming/focus,24px target; FilterBar chips aria-pressed+text, later keyed-by-value and accessible-name/contrast fixes in page record. Copy uses injected clipboard/outcome; later async/full-source/focus rules supersede native-disabled pending state.
- JSON renderer depth32/nodes5000/cycle bounds, visible truncation+once warning, search opens matching branches without destroying local disclosure state. No “Map is JSON” claim. VirtualList exposes optional list/feed role (caller owns row roles); natural heights/measurement and later keyboard entry changes belong to page/P6G records.
- CodeBlock language table **shiki-free**; first consumer proved static import leak (~166.6 KB), fixed type-only highlighter edge; no-consumer grep was vacuous. Two languages/two palettes; escaping real-shiki-tested, no arbitrary transformers. Worker+validated class-rule implementation in completed pages supersedes original lazy-main-thread design. No extra intersection-observer package: small one-shot gate with injected observer/disconnect was enough.
- happy-dom animationName empty keeps Kobalte presence nodes mounted: assert state/description, not removal. IO has no layout; virtualizer/options seams injectable. TanStack options use getters; snapshots would break reactivity.
- H delivered strip brief/live theme/isolation conformance. Arm-first shared injected follow prevents racing writes; failed read unsubscribes/rethrows (Firefox planned degrade not implemented). Teardown guards keep a failed unwatch from skipping WXT cleanup or masking a render failure. **Removal before async mount returns its disposer remains open in P12M**; P12A's host-creation guards did not close this shared race. Native admin-bar/SBS storage/overflow exceptions documented in design record.

## P5I/P5.1: acceptance and evidence

- Typed500ms cold-start budget measured by `panel-cold-start.spec.ts`; once marks in **raw buffer order/count**, not dictionary that hides repeats. Mark/measure failures warn but cannot block boot. Budget parser rejects mixed byte/timing fields symmetrically.
- Span starts **after ESM graph evaluation**, which is disclosed in absolute mark startTime. Initial error17ms; ready34.3ms (marks38.5/59.7/72.8ms). Pre-mark timing cap remained a candidate, not implemented.
- Ready harness stamps only genuine inspected tab ID on both browser/chrome namespace objects via init script; real capture→tab messaging→boundary→store, never injected detections. `tests/e2e/helpers/panel-data.ts` owns seam. Standalone without ID broadcasts and cannot reach CS; this explains early error-only measurements, not inability to automate ready data.
- P5.1 suites: boot/deep-link/retry; soft-refresh realm/route/focus/scroll+two-instance isolation; palette navigation/reload/export gate; four status facts/navigation; all four wire search actions/scoping/malformed rejection; keyboard/axe; cold-start. Original native Ctrl/Cmd+F UI and Elements `$0` remain separate checks.
- Axe: whole ready document strict0 violations/**0 incomplete**. Modal scopes keep **exact reviewed rule+target allowances**, not blanket incomplete waiver (aria-hidden-focus/root, real combobox-controls needsReview, obscured/token-only contrast cases). Audit discovered unasserted incompletes; changed gate names targets and rejects every other unresolved. Later UI acceptance's fallback strict audits have no exclusions.
- Reload freshness assert derives rounded-second boundary before action; raw-second comparison flaked. Negated-run proves missing reload fails. Palette runs poll actual aria-activedescendant rather than timed guess.
- P5.1 closing audit:1245 unit tests/121 files; coverage95.11 statements/96.71 lines/94.39 branches/100 functions;106 browser tests **three clean full runs**, no retries. Panel228.6 raw/70.2 gzip KB<600; whole442.6<857, no suite-induced bundle growth; Firefox build green. `axe-core` is dev-only and AGENTS updated.
- Earlier fixture failures traced to running Docker bind mount pointing at a **deleted worktree**, not extension code; canonical down/up+smoke restored it. Don't accept old server health without verifying marker response/mount. Scratch tests described as deleted were untracked, not removed from Git; misleading history wording corrected with no tree change. Original root audit findings retain per-finding resolution evidence; links now point here.

Historical budget changes: UI libraries grew panel under600 without raising that row; injected gzip34→35 KiB justified by arm-first/disposal/transport correctness (6-byte real breach masked by rounding), raw97 unchanged then. Code/current budget table supersedes these snapshots.

## Open checks

P5J final shape and all-docking design; actual native find-bar/host shortcut behavior; Elements IMG/non-IMG/eval error; real panel export/Builder creation; two actual DevTools windows; real10min freshness (screen-reader speech dropped — owner 2026-10-27: no screen-reader support); Firefox installed-extension smoke. **Later actual right/bottom docking28 ready-route samples passed** in UI acceptance, so old “cannot open native DevTools programmatically” statements are superseded, not permanent blockers. Undocked/full-state/native-input matrices remain broader than that smoke.
