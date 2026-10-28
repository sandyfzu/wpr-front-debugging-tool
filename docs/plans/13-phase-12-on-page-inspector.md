# P12: on-page widget — shipped baseline and remaining work

## TLDR

**P12A detections/session drag shipped; full P12/P12.1 remain planned.** Extend the existing KC-style pill/card, origin store, single-pass hub and audited drag; do not rebuild the original narrow always-open strip. P11 supplies final hud registry; P9 supplies the options toggle surface (the popup's Detections row joins additively at deferred P8 — one shared item, no new runtime channel). No tools on the chip (P12D dropped, owner 2026-10-28). FullP12 depends:P11/P3/P5 (+options toggle surface; popup wiring at P8); can parallel P13/P14 after shared contracts. No dependencies planned; installed WXT/Solid/tokens/Vitest/Playwright.

Binding [UX/SB decisions](./design-decisions.md) and UI bar apply; this file owns explicit deviations/current implementation. Source v4.1.1 inspector template/styles/draggable behavior: groups/status/drag (tool feedback dropped with P12D; its Alt+H shortcut not ported — owner decision deferred to P15D), not its fixed100px CSS, global keydown assignment, page cookies, incognito-only activation or console dumps.

## Shipped P12A (2026-10-13/14)

### Presentation and ownership

- Same-context `pageDataFor` joins capture→cached single-flight detection, **no second pass**. Producer is eager since2026-10-08, not lazy-until-widget. Labels promoted to `lib/detection/labels.ts`; provisional strip-items typed table deleted by P11C (strip reads `lib/detection/hud.ts`). WordPress-version parser shared, leading digit required.
- Marker pill default bottom-right16/16, opposite KC; opens grouped static-evidence report card. Width **min(352px,100vw−32px)**, not original224/40vw (7/15 labels elided there, measured need~349). Values separate18px info-pair pills/10px tabular at4px gap. At300px none elide;280px2/264px3 elide, value wraps first—not an unlimited “never elides” promise.
- Mood cached green/present-uncached amber/absent gray/scanning pulse/real pass failure red. Applied ok, collecting attention, not-applied/not-enabled neutral; cache warning distinct. Identity WPR version or **WPR (unknown version)**/WPR not found; unknown footer WPR—. Failure cache dash+named reason, never fabricated verdict. Static chips no dead clicks; rocket mark identity, not per-state icon.
- Shadow `wpr-fdt-inspector`, ins-* classes, LTR,z2147483647; shared token/live theme and focus helper. ESC/card/pill focus handoff attempts/verifies/retries next frame, context-owned. Held-visible departing leg/reduced-motion machinery-free card, **no row stagger**. Same-value origin writes don't re-read hub. Trusted-event gating ignores host synthetic reopen clicks; pointer-vs-keyboard distinguished by click.detail, not isTrusted alone.
- Arm-first origin watch; body-anchor wait/recheck handles document-start; capture waiter resolves only after serialization or invalidation. P12A guarded host-creation/enablement races; the shared async render/disposer race shipped in [P12M](#p12m--shared-asynchronous-mount-cleanup).

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

- [x] Shipped 2026-10-28. One seam, `components/injected-ui/shadow-surface.ts` (`createShadowSurface`): each surface creates its WXT shadow UI **once** (first show; concurrent shows share the creation, a failed creation retries) and cycles `mount()`/`remove()` on it; context + caller predicate re-checked after the creation wait (gate/visibility). Each mount is a record (abort scope, disposer, render settlement): `onRemove` before the render resolves aborts it — `mountShadowUi` gained an optional `signal` and skips the render (follow stopped) when removed during the appearance read — and a late resolve disposes itself, never stored (L3). Disposal exactly once; `onRemove` on an unmounted instance (WXT's invalidation hook after a hide) is a no-op; teardown steps (view disposer, owner hook) are guarded/logged so WXT's host removal always runs; render failures reach `onRenderError` with the original cause, then the failed mount's host is removed (surface reads hidden) and shows latch to `'refused'` until the owner's next `hide()` (gate/per-site cycle, navigation out, notice dismissal, SBS degrade) — a failure never self-retries; `onRenderError` itself guarded. Invariant: every mount shares WXT's container and Solid's disposer empties it, so a late dispose must never follow a newer render — held by `mountShadowUi`'s synchronous signal re-check right before `render()`. Callers migrated: KC (show predicate = gate on AND URL still in scan scope; HelpScout observer ignores its own host joining/leaving `<body>` — `pageChurned`), SBS (`viewMounted` = `surface.rendered()`), widget (drag controller/containment watch/Escape now per mount via `onMounted`/`onRemoved`; one shared body wait), palette notice. Runtime overlays (`mountOverlay`) unchanged: one UI per injection.
- L2 verified in installed WXT 0.21.5 `shadow-root.mjs`: `ctx.onInvalidated(remove)` per created UI, unsubscribe discarded; `mount` re-appends the same host + re-runs `onMount`; `remove` runs `onRemove(mounted)`, detaches the host and empties the container, re-runnable on an unmounted instance; `mount` without `remove` would re-run `onMount` (seam guards). Now one registration per surface, no per-cycle CSS fetch.
- Tests (+28; tree 8295 pass/1 skip, 370 files): seam 13 over WXT's real factory + real context (cycles reuse one instance, remove during read/render, late disposer never overwrites, render failure, throwing disposer/hook, concurrent shows, refused after creation wait, dead context, failed creation/anchor); `mount` +3 (removed before/during read, dead-context stop); per-surface wiring KC 3, widget 4, SBS 3, notice 2 (real setup + gate/per-site storage writes, deferred render stand-in `deferred-mount.testing.ts`); KC/widget/SBS tests fail against the pre-fix code. Budgets: isolated 164865→165821 B (+0.9 KiB raw, gzip 55.1→55.4 KiB), ceilings 161.2/55.2→162.1/55.5; whole build 1629.0→1630.0 (1668988 B). Browser regression (strip/KC/SBS/palette-gate suites) pending supervisor run.
- Audit fixes (+7 tests): test stand-in made Solid-faithful (disposer empties the container; an aborted settle renders nothing); `mount` test pins the re-check invariant against a container-clearing disposer; seam + KC/widget/notice failed-render → host removed + retry; KC out-of-scope during first creation → no badge. Re-audit (+6): render-failure latch (seam, notice resumes after dismissal, HelpScout always-failing render = 1 attempt/1 error across page churn, gate cycle retries), own-host churn = no rescan, throwing `onRenderError` still removes + latches.

### P12B — Final registry/state/toggle integration

Depends:P11/P9 (existing P12A baseline; the popup's Detections row lands additively at deferred P8). Parallel:P13/P14. Size:S–M.

- [x] Repoint/delete provisional strip registry; native names/group ordering from hud, full-name/unsure reasons (done in P11C). No old SHGF/OCI/ALR tool-internal short labels restored.
- [ ] Extend existing validated origin item for persisted position/eviction metadata within real sync quota. Old entries parse. Global `features.onPageInspector` — the options page's **show the detection chip on pages by default** row — is **true by default** (owner 2026-10-17; the interim `INSPECTOR_DEFAULT_ENABLED` constant already ships that behavior with per-origin entries winning both ways); popup/Detections/options/context menu share one item/toggle, no new runtime channel; the stored option replaces only the constant's role, never the precedence.
- [ ] Complete collapse/session visibility; disabled origin no action, context cleanup. **No chip keyboard shortcut** (owner 2026-10-28: context menus + the Alt/⌥+K palette already cover it) — whether to add one at all (e.g. Alt+H) is an open owner decision for just before release ([P15D](./16-phase-15-hardening-release.md#p15d--docsrelease)); persistent activation and persisted position remain required, never silently invent second store.

DoD: storage origin/coord/quota/eviction/corrupt/legacy tests, mount/unmount/default overrides, same-origin/incognito behavior specified, UI bar §D/gates.

### P12C — Persisted drag/brief reconciliation

Depends:B. Parallel:P13/P14. Size:S.

- [ ] Persist on settled drop; restore/reclamp through **existing** resting containment seam for current viewport/shape, sane finite coordinates. Session reset only until this lands; no new geometry engine.
- [ ] Reconcile every SB-D ID against owner-approved KC pill/card/width/value-chip/motion deviations above; controls≥24, one scroll region/header/footer, no host styles/cookies/scroll lock or console narration. Hostile CSS computed diffs both directions, source-class no-copy grep.

DoD: persistence/reload/new viewport/card growth/right-cancel/capture-loss/first Enter, no host text selection/link activation/page-scroll break, touch/multitouch tests+hardware limitation named. Style/focus/palettes/reduce and budgets green (new axe dropped — owner 2026-10-27: no screen-reader support).

### P12D — dropped (owner 2026-10-28)

No tool buttons or result banner on the chip: it stays the detection report. RUCSS tester (P13) and beacon/LCP/script tools (P14) are separate surfaces.

## P12.1 — Browser acceptance

Depends: P12M/B–C/P4.1/P4.2; parallel P13/P14 independent work.

- [ ] Default on for unconfigured origins; per-origin entries override the global default in both directions and the toggle surfaces live mount/hide/reload per origin, other origin unaffected; persisted drag/restore+clamp, right cancel, no text/link/pan side effects, touch-emulated narrow screen.
- [ ] Hostile reset/high-specificity page: identical strip, no unscoped style, host computed diff none.
- [ ] System/Dark/Light live Options writes+OS flips; reduced motion shadow UI (keyboard walk/new axe dropped — owner 2026-10-27: no screen-reader support); zero-marker honest states/tooltips.
- [ ] Brief deviation receipt/size delta and UI bar D1–D7; keep early20 cases, not replace with shallow smoke.

Manual/open: native context-menu clicks, incognito origin sharing, glance≤2s/perceptual resettle at real60/120Hz, real touch/multitouch, Firefox installed-extension smoke. Build-only parity is not runtime. Update privacy README/AGENTS when adding real option/state structure, and index only to actual verification level.
