# P12: on-page widget — shipped baseline and remaining work

## TLDR

**P12A detections/session drag shipped; full P12/P12.1 remain planned.** Extend the existing KC-style pill/card, origin store, single-pass hub and audited drag; do not rebuild the original narrow always-open strip. P11 supplies final hud registry; P9 supplies the options toggle surface (the popup's Detections row joins additively at deferred P8 — one shared item, no new runtime channel); P13/P14 supply shared executors. FullP12 depends:P11/P3/P5 (+options toggle surface; popup wiring at P8); can parallel P13/P14 after shared contracts. No dependencies planned; installed WXT/Solid/tokens/Vitest/Playwright.

Binding [UX/SB decisions](./design-decisions.md) and UI bar apply; this file owns explicit deviations/current implementation. Source v4.1.1 inspector template/styles/draggable behavior: groups/status/drag/Alt+H/tool feedback, not its fixed100px CSS, global keydown assignment, page cookies, incognito-only activation or console dumps.

## Shipped P12A (2026-10-13/14)

### Presentation and ownership

- Same-context `pageDataFor` joins capture→cached single-flight detection, **no second pass**. Producer is eager since2026-10-08, not lazy-until-widget. Labels promoted to `lib/detection/labels.ts`; provisional strip-items typed table deleted by P11C (strip reads `lib/detection/hud.ts`). WordPress-version parser shared, leading digit required.
- Marker pill default bottom-right16/16, opposite KC; opens grouped static-evidence report card. Width **min(352px,100vw−32px)**, not original224/40vw (7/15 labels elided there, measured need~349). Values separate18px info-pair pills/10px tabular at4px gap. At300px none elide;280px2/264px3 elide, value wraps first—not an unlimited “never elides” promise.
- Mood cached green/present-uncached amber/absent gray/scanning pulse/real pass failure red. Applied ok, collecting attention, not-applied/not-enabled neutral; cache warning distinct. Identity WPR version or **WPR (unknown version)**/WPR not found; unknown footer WPR—. Failure cache dash+named reason, never fabricated verdict. Static chips no dead clicks; rocket mark identity, not per-state icon.
- Shadow `wpr-fdt-inspector`, ins-* classes, LTR,z2147483647; shared token/live theme and focus helper. ESC/card/pill focus handoff attempts/verifies/retries next frame, context-owned. Held-visible departing leg/reduced-motion machinery-free card, **no row stagger**. Same-value origin writes don't re-read hub. Trusted-event gating ignores host synthetic reopen clicks; pointer-vs-keyboard distinguished by click.detail, not isTrusted alone.
- Arm-first origin watch; body-anchor wait/recheck handles document-start; capture waiter resolves only after serialization or invalidation. P12A guards its host-creation/enablement races, **not the shared asynchronous render/disposer race**; that remains P12M below.

### Origin state (reuse, do not fork)

`lib/storage/inspector-origins.ts`, **sync:inspector-origins**, origin→enabled; context-menu **Toggle the detection widget on this site** writes clicked document's origin. This is P12's established item, not a temporary alternative to resurrecting local:on-page-inspector.

Resolution (owner's 2026-10-17 turn-on): an explicit per-origin entry wins over the global default in **both** polarities; origins without an entry mount the chip (the interim `INSPECTOR_DEFAULT_ENABLED` constant until the options row lands). Corrupt storage degrades to no-entries — every origin follows the default — never to fabricated overrides. The toggle flips the site's **current effective state** (a right-click always changes the site's behavior; under default-on an unconfigured right-click writes `{enabled:false}`), never storage absence, and explicit entries outlive a later default change.

Original200-origin cap was false under sync8192-byte/item quota. Serialized **key+JSON byte budget with headroom**, insertion-oldest trim/newest retained; worst253-char hosts/120-toggle tests. Oversized singleton rejection propagates, not fake success. Extend with position/LRU metadata only after rederiving quota/eviction; keep backward-compatible enabled entries. No host cookies/localStorage for widget state.

### Drag and containment: final behavior

- One document-local controller, no persisted coordinates yet. Pill+noninteractive card header/footer handles; body retains touch scroll/close not handle. Capture on **grabbed shape**, not chrome (compat click retarget matters); listeners chrome/context-owned, handle-only touch-action none, no page-wide preventDefault.
  -5px slop (3,4 triangle **starts** drag), live1:1 pointer math rebased on current box. Full viewport containment4px air, layout viewport=documentElement.clientWidth/Height (exclude native scrollbar), not obsolete32px offscreen park. Pill click suppressed after moved pointer drag; keyboard click.detail0 bypasses pointer-only suppression so first Enter works after card drag.
- Escape/right-contextmenu/OS pointercancel/second pointer restore pre-drag position. Actual Chromium second-button path may be move(buttons3)+contextmenu, no pointerdown; compat click can precede settle, so suppression covers live moved drag.
- **lostpointercapture settles own pointer**, keeping last clamped position, not cancel/snapback. Healthy pointerup→loss no-op; stray pointer ID ignored, later release cannot move it. This fixed quick out-of-window macOS flick reproduced via trusted capture loss; cancel machine tests unchanged because wiring mapping was defect.
- At rest/resize/zoom/open/close/data growth, containment watcher awaits stable consecutive boxes then reclamps **resting layout geometry** (offsetParent-guarded transform-invariant offsets), never animated entrance pose. Active drag defers; direct manipulation never transitions position. Outside drag, owner-approved ins-resettle corrective token motion; next press clears it, reduced motion instant. This is explicit SB-D13 positional-motion exception, not permission to animate drag.
- Cap **1000ms wall clock**, not32 frames (120Hz outran280ms animation and conceded early). Stability wins even past cap; never-stable concedes/logs, future demand re-arms. Coalesced demand at concession gets **one fresh bounded cycle**, flag cleared at every conclusion; dead/stop/settle never restart, no input means at most two concessions. Measured three-leg thrash~885ms+stability~919ms, not old740 estimate.
  -1px quantum suppresses subpixel rewrites, not containment; integer edge quantization means actual worst air~2–2.5px, **not guaranteed3**. Null resting/offset-parent mismatch fails closed, no animated-rect fallback.200k randomized mounts kept nonnegative air; tests8.3/16.7/4.2ms pacing prove refresh-rate independence.

### Era/version record

WP Rocket **3.17.2 (2024-10-30)** introduced data-wpr-features (issue6879,commit a1bdab0). Conditional: bypass/DONOTROCKETOPTIMIZE/white-label/logged-in renders may omit it; version filter can remove digits without removing tag. Cache/attributed footprints still prove versionless presence, never fabricate version. Pre-3.17.2 pages remain inspectable by footprints; bypass+uncached/no evidence means not found at any version, not unsupported-version policy. Pre-2016 exhaustiveness unverified.

Fixture `fdt-wpr-versionless=1` uses real rocket_display_meta_generator_content_version filter; CDP smoke pins baseline/digits-free and bypass null separately. P11 must reuse parser/era evidence, not create another version implementation.

### Evidence/budget record

Initial8 site cases: hidden/menu ID/real detection rows/disable+reload/keyboard-reduce/KC coexistence/live themes; drag then containment/versionless/capture-loss grew strip suite to **20 passing**. Dispatch unit-pinned, native context-menu click itself not automated. Per-suite cookie wipe/relogin prevents cross-file admin-state leakage. Drag units cover slop/cancel/foreign IDs/negative ranges/shape growth/suppression; real trusted wiring proves capture-loss and trailing click. Built-artifact negative controls distinguish snapback position from click suppression (card verdict alone cannot distinguish settle/cancel).

Final early tree:1255 tests/121 files; build/budgets/Firefox green. Full run87 pass/3 known cache-warmth failures; affected files clean after documented~90s one retry, **not a clean first full run**. Strip pristine20/20 no retry. Earlier feedback70/70 twice; high-refresh86/86 after cold-cache rerun.

Budget derivations retained: strip estimate≤10KiB was optimistic; strip-less build verified **+12.9 raw/+3.8 gzip** (compiled view~9+state/copy~3). Isolated102/35→114/39 (113.1/38.6 measured with quota/wait/gate fixes); worker34→36 for menu/store (34.2 measured). Drag+3/+1.1→117/41; containment/value chips+1.5/+0.6→119/42; later resting-ms/quick-loss fixes118.3/40.5 fit unchanged. Whole-build857 backstop unchanged then. Current budget table supersedes these values; remaining tools need new measurement, not old10KiB claim.

Build-stamp audit fix: `pnpm build` itself writes fingerprint via scripts/build-stamp.ts; old harness-only stamp could trust manual strip-less output. Strict poisoned-build repro now refuses, normal gate rebuilds, warm gate skips. Do not undo this provenance requirement.

#### Default-on chip — 2026-10-17

Owner decision: the chip is **active by default** on every surfaced page (a fresh install reports with no opt-in step) and the planned options toggle ("show the detection chip on pages by default") takes over the unconfigured-origin default when the options page lands — until then `INSPECTOR_DEFAULT_ENABLED` is that default. Per-site right-click stays separate and **wins over** the default in both directions; toggling it off on one site does not change other sites. Shipped the same day: the resolution lives in `lib/storage/inspector-origins.ts` (`effectiveInspectorEnabled` — entry-over-default precedence; `originEnabled`'s absence-reads-hidden helper retired) and the context-menu toggle flips the **effective** state (previously it flipped the entry, which would no-op against a default-on entryless site). The mounted-widget's armed watch read moves with it. When the options row replaces the constant, precedence must not move.

Validation: the unit tier green with the origin-store suite retargeted to the new contract (unconfigured→default, both override polarities, the effective-state flip, corrupt→default, self-heal) and the strip browser suite's first leg inverted (`the widget mounts by default on every page`; suite table/header reworded). The **full browser tier passes — 151 legs** — which is the chip's coexistence proof: default-on now mounts it on every fixture and site page the other 34 suites drive, and none needed a change.

## Remaining full P12 slices

### P12M — Shared asynchronous mount cleanup

Depends: P3/P5H/shared mount. Parallel: P11 pure detection work; serialize injected-UI edits. Size: S. Goal: removal during the awaited appearance read cannot leave detached render work or a live watcher.

- [ ] Harden `components/injected-ui/mount.ts` and its callers: `onRemove` may run before `mountShadowUi` resolves and before its disposer is assigned. Stop a late follow/render immediately; dispose exactly once, preserve the original failure and run remaining cleanup even if one step throws. Cover KC, SBS and widget, not only the widget's host-creation guards.
- P19D landed first (2026-10-27): KC/SBS/widget mounts are now also driven by the on-page UI gate (`lib/page-ui/` gated surface; start/stop hooks in each module), KC gained an in-flight mount guard, KC/widget mount listeners ride a per-mount abort signal. Integrate with that shape (keep the gate re-check after `createShadowRootUi` resolves). Two residuals, both made user-reachable by the gate (P19D audit L2/L3), fixed here:
  - **Host retention (L2):** WXT 0.21.5 `dist/utils/content-script-ui/shadow-root.mjs` registers `ctx.onInvalidated(remove)` per created UI and discards the unsubscribe → each hide → show cycle (gate or per-site toggle) keeps the detached host + shadow root + its `<style>` (reset + the whole `isolated.css`, re-fetched per create under `cssInjectionMode: 'ui'`) + the `onMount`/`onRemove` closures reachable: ~25 KB strings per surface per cycle (≤ 3 surfaces), freed at page end; at invalidation each stale `remove` re-runs its `onRemove`. Fix: create each surface's shadow UI once and cycle `remove()`/`mount()` on that instance (WXT's mount functions re-append the host and re-run `onMount`), which also drops the per-cycle CSS fetch.
  - **Late disposer overwrite (L3):** `onMount: void mountShadowUi(…).then(d => disposeRoot = d)` vs `onRemove: disposeRoot?.()` — a remove (gate off) landing before the render resolves runs `onRemove` with no disposer; the late `.then` then stores the removed tree's disposer, the next mount overwrites it → that Solid root (effects on the module store) lives until page end. Fix: per-mount `disposed` flag; a render resolving after its remove disposes itself at once.

DoD: delayed-read/remove, render-failure, dead-context teardown and normal/live-theme tests; no leaked tree/watch or remount, UI bar/gates/browser regression green. This is the open P5H lifecycle requirement, not a new feature.

### P12B — Final registry/state/toggle integration

Depends:P11/P9 (existing P12A baseline; the popup's Detections row lands additively at deferred P8). Parallel:P13/P14 executor work. Size:S–M.

- [x] Repoint/delete provisional strip registry; native names/group ordering from hud, full-name/unsure reasons (done in P11C). No old SHGF/OCI/ALR tool-internal short labels restored.
- [ ] Extend existing validated origin item for persisted position/eviction metadata within real sync quota. Old entries parse. Global `features.onPageInspector` — the options page's **show the detection chip on pages by default** row — is **true by default** (owner 2026-10-17; the interim `INSPECTOR_DEFAULT_ENABLED` constant already ships that behavior with per-origin entries winning both ways); popup/Detections/options/context menu share one item/toggle, no new runtime channel; the stored option replaces only the constant's role, never the precedence.
- [ ] Complete collapse/session visibility and **Alt+H only**, capture:false listener, no document.onkeydown clobber; disabled origin no action, context cleanup. Original text mixed “session-only” and “persisted” shortcut visibility: decide/document that distinction before implementation; persistent activation and persisted position remain required, never silently invent second store.

DoD: storage origin/coord/quota/eviction/corrupt/legacy tests, mount/unmount/default overrides, same-origin/incognito behavior specified, keyboard host-handler preservation. UI bar §D/gates.

### P12C — Persisted drag/brief reconciliation

Depends:B. Parallel:independent tool executors. Size:S.

- [ ] Persist on settled drop; restore/reclamp through **existing** resting containment seam for current viewport/shape, sane finite coordinates. Session reset only until this lands; no new geometry engine.
- [ ] Reconcile every SB-D ID against owner-approved KC pill/card/width/value-chip/motion deviations above; controls≥24, one scroll region/header/footer, no host styles/cookies/scroll lock or console narration. Hostile CSS computed diffs both directions, source-class no-copy grep.

DoD: persistence/reload/new viewport/card growth/right-cancel/capture-loss/first Enter, no host text selection/link activation/page-scroll break, touch/multitouch tests+hardware limitation named. Style/focus/palettes/reduce and budgets green (new axe dropped — owner 2026-10-27: no screen-reader support).

### P12D — Tool hooks/banner

Depends:B/C; configs/executorsP13/P14 as available. Parallel:their internals, not shared files. Size:S.

- [ ] RUCSS/beacon/LCP/script overview controls; unavailable/configure-in-panel explanation until executable. Delay-only check-scripts affordance. Panel owns forms, strip calls **same** protocol/executors/persisted config, no second runtime.
- [ ] Latest single outcome banner as sibling of transformed chrome, top-center,5s pause/close/details per brief. Real route signal only when panel is already open; platform cannot open/focus DevTools, so otherwise location hint, never fake link. Tools/results not draggable. Footer versions/no Notion link; cache age/exclusion evidence shared formatter.

DoD: config/run/timeout/error/unavailable/state→banner tests, no duplicate test-mode copy, renderer-boundary guards, clean teardown/theme/reduce/budgets (keyboard walk/new axe dropped — owner 2026-10-27: no screen-reader support). FullP12 not declared done before these integrations or explicit named blockers.

## P12.1 — Browser acceptance

Depends: P12M/B–D/P4.1/P4.2; parallel P13/P14 independent work.

- [ ] Default on for unconfigured origins; per-origin entries override the global default in both directions and the toggle surfaces live mount/hide/reload per origin, other origin unaffected; persisted drag/restore+clamp, right cancel, no text/link/pan side effects, touch-emulated narrow screen.
- [ ] Alt+H enabled only; host editor-like keydown handler still fires. Hostile reset/high-specificity page: identical strip, no unscoped style, host computed diff none.
- [ ] System/Dark/Light live Options writes+OS flips; reduced motion shadow UI (keyboard walk/new axe dropped — owner 2026-10-27: no screen-reader support); zero-marker honest states/tooltips; tool/banner states.
- [ ] Brief deviation receipt/size delta and UI bar D1–D7; keep early20 cases, not replace with shallow smoke.

Manual/open: native context-menu clicks, incognito origin sharing, glance≤2s/perceptual resettle at real60/120Hz, real touch/multitouch, Firefox installed-extension smoke. Build-only parity is not runtime. Update privacy README/AGENTS when adding real option/state structure, and index only to actual verification level.
