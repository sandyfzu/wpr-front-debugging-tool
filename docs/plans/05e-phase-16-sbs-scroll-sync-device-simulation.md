# Phase 16 — Side-by-Side scroll sync & mobile simulation

**Depends on:** P0/P1, implemented P2–P4, P4.3. **Effort:** M. **Runs:** after P4.3, before P5 (owner, 2026-10-08; 05e/05f denote insertion position). **Parallel:** no other phase in this slot; A/B independent internally. **Suites:** [P16.1](./05f-phase-16-1-sbs-scroll-sync-device-simulation-suites.md), P4.1 harness/P4.2 site.

Owner-requested new capabilities, no behavioral baseline: verify mechanisms empirically. This file owns scroll sync and the original mobile decision; [05g/P16.2](./05g-phase-16-2-sbs-mobile-comparison.md) owns the refined, shipped mobile contract.

## Goal (plain language)

1. **Scroll sync:** overlay-header switch, proportional “same part of page” mapping despite cached/bypassed/device height differences. **Default on** after the owner's 2026-10-11 decision (originally off).
2. **Mobile comparison:** phone request/page identity and viewport in the overlay. The original generic per-tab UA-only proposal (two-tab desktop/mobile comparisons, both overlay halves sharing the tab rule) was superseded; Feature B records the differences below.

## Feature A — Side-by-Side scroll sync

### Design

- [x] `features.sbsScrollSync: boolean` in `lib/storage/options.ts`, synced/persisted across pages/sessions, **default true** (owner 2026-10-11, originally false).
- [x] Labelled keyboard switch in the overlay header, plain Solid/P0 tokens. Live apply + persist; read on open. External writes apply **next open**, no watcher. No control animation/reduced-motion dependency.
- [x] Pure `lib/side-by-side/scroll-sync.ts`: `computeSyncTarget(source: FrameScrollState, target: FrameScrollState): number | null`. `range = scrollHeight − clientHeight`; `ratio = source.y/source.range`; target = `clamp(round(ratio × target.range))`. Zero-range source cannot drive; zero-range target does nothing. Invalid NaN/negative/out-of-bounds inputs fail fast. No DOM/API/listeners.
- [x] Same-origin frame-window scroll listeners cover wheel/drag/keyboard/touch through `ContentScriptContext`. Coalesce with rAF; suppress receiving-side programmatic scroll to avoid feedback, let subsequent user scroll retake control. Refresh re-reads metrics; close/invalidation remove listeners/reset flags; reopen honors persisted choice.
- [x] Cross-origin redirects: block that half once, show “not synced (different origin)”, no per-scroll error spam; other half remains independently scrollable, switch stays on.
- [x] No PSI switch: two analyses have no correlated page structure. Structure-aware PSI sync would require a new decision.

### Tests

- [x] `lib/side-by-side/scroll-sync.test.ts`: equal/different ranges, edge clamps/rounding, zero ranges, negative/NaN refusal, applied-scroll suppression, refresh metrics, complete teardown. Attach/settings glue remains thin wiring.

### Shipped (Feature A, 2026-10-11)

- **Ownership:** pure mapping/burst driver in `lib/side-by-side/scroll-sync.ts`; DOM lifecycle in `entrypoints/isolated.content/side-by-side/sync-session.ts`; overlay wires it. `CompareSide` replaces the duplicated `SideBySideOverlaySide` alias.
- **Suppression:** two receiving-side animation frames, token-guarded so only the latest clear closes the window. Continuous driving keeps it open; later user scroll retakes control. Read both halves each burst, no metric cache.
- **Scroll scope:** capture-phase window listener accepts only document scrolling, not inner scrollables. Apply `scrollTo({ behavior: 'instant' })` so host smooth-scroll cannot glide back into the feedback window.
- **Reads/errors:** DOM adapter treats torn NaN/negative/out-of-bounds reads as transient null; direct pure-engine calls throw. Cross-origin read/apply/attach flips the side once per session; tests pin both contracts.
- **Budget:** base 83,509 B → **87,140 B** (+3,631 B: engine/session/switch/markers), 85.1 KiB raw/30.1 gzip. Deliberate `scripts/budgets.json` raise **85/30 → 88/31**, not a silent nudge.
- **Initial verification:** gates green; full browser tier **36/36 ×3**. Deleted-after-recording throwaway Playwright probe verified original default-off, live toggle, 40%→40% proportional mapping across unequal ranges, no oscillation, reverse bottom→bottom, off stops sync, close restores overflow, next-page persisted choice. P16.1 owns permanent pins; cross-origin verified in the audit below.
- **Default change:** owner testing then set true in fallback/validators/pinned shapes (2026-10-11); explicit off still persists.
- **System-palette fix (owner, reproduced live):** shared `ui/mount.ts` rendered light under dark OS/System in SBS and KC. WXT `:host { all: initial !important }` reset broke `color-scheme: dark`; inherited `normal` selected the light branch. The owned container now declares `data-theme="system"` with token `color-scheme: light dark`, following OS live. Explicit Dark/Light and extension pages were unaffected. New `theme.spec.ts` permanently pins four cases including OS flip.
- **Default-on open fix (owner, reproduced before/after):** engine started after `ensureUi` but before async mount/render registered frame refs. It became idempotently “running” over empty slots, so no listeners/load re-adopt existed until an off/on cycle. Open now awaits mount before starting; missing slots log side-specific debug, and the interface documents ordering. Mechanics case 4 opens/drives to mapped bottom **without touching the switch**; it failed pre-fix.

### Audit record (2026-10-11, Feature A adversarial pass)

Two reproduced findings fixed and re-run:

1. **Future feature keys erased:** `parseStoredOptions` validated known feature flags but discarded unknown keys during read-modify-write persistence. It now mirrors `improvements`: seed defaults, retain every own boolean key, discard non-booleans, expose matching index signature. Tests pin present/absent/kept/dropped; hostile untyped values never cross.
2. **Late frame never adopted:** iframe `load` listener was registered only after a successful `contentWindow` read. Register re-adopt first; a cross-origin attach refusal intentionally tears it down because blocked is session-final.

A deleted-after-recording dual-origin redirect probe verified one blocked marker, no repeated-scroll growth/error storm, healthy half free-scroll, checked functional switch, and label-click toggling. Gates/budgets green (**87,140 B**, 30.1 gzip < 88/31); full tier **six consecutive green runs** after one transient initial site failure matching the pre-audit retry-normal family (no retained report). P16.1's permanent rows remain necessary to name residual flakes.

## Feature B — Mobile simulation (per tab)

> **Superseded by owner refinement, 2026-10-11; shipped as P16.2 B1–B5, 2026-10-12.** [05g](./05g-phase-16-2-sbs-mobile-comparison.md) owns design, code/test seams, UA verification, and shipped follow-ups. This heading is retained for historical links, not as unfinished work.

### Design

The original proposal reused mechanisms now specified once in 05g: a one-row extensible profile, deterministic tab/session DNR rules as state (no SW per-tab map), sweep/removal lifecycle, justified `declarativeNetRequestWithHostAccess`, validated sender-resolved protocol, and MAIN/isolated UA shadow/restore. Both designs accept the messaging race before earliest synchronous page reads; server UA is network-layer truth, and before-first-rAF is the browser pin.

**Differences retained as decision history:**

- Original: generic per-tab UA-only state; all tab requests/subframes rewritten; viewport/touch/DPR/form factor/client hints excluded. **Shipped:** overlay-only UA + real 412×892 viewports, document requests only, both halves reload on session changes; close/navigation resets identity; PSI untouched. Other emulation exclusions remain in 05g.
- Original controls/visibility: “Debug this tab as mobile” click-toggle menu (not checkbox: checked state is global), simulated toolbar mark, “mobile simulated” header chip, immediate P8 popup row **outside** Apply/Reset. **None shipped**; visibility moved into the overlay switch/side labels, later device tag. These menu/badge/popup integration tasks are withdrawn, not pending.
- Original identity lived beside reference capture, relayed from a data-hub sibling. **Shipped:** separate all-frame `ua-relay`/`ua-identity` entrypoints so redirected halves receive identity too.
- Original Firefox premise: MV2 lacked DNR, so explicit unavailable hint suggested native DevTools emulation. **05g's verified correction:** session/tabId/modifyHeaders are cross-engine; feature-detect actual availability, with runtime Firefox smoke still manual. Never infer support from the old premise.

### Tests

Current profile/rule-ID/state/hostile-validator/per-tab-independence, service lifecycle, descriptor restore, and real-window relay tests belong to 05g/P16.1. Original menu-routing/badge-mark/popup tests were withdrawn with their controls; do not reintroduce them. Re-check budgets with the owning feature.

## Explicit enhancements (both features are new capability — there is no parity baseline)

- Scroll: persisted default-on/live switch, proportional mapping, honest per-side degrade, cleaned listeners.
- Mobile: per-tab rule isolation, rule-as-state restart safety, matched network/page identity; shipped scope/visibility/Firefox contract in 05g, not the abandoned controls above.
- P14.5 D1's `mobile_cache` reports **which copy was served**; simulation changes the live request identity. Related, distinct from that detection and deferred background snapshot.

## Verification checklist

- [x] Feature A gates/build/budgets green (2026-10-11); deliberate 85/30 → 88/31 derivation above. Re-run for each feature.
- [x] P4.2 UA echo + separate-mobile-cache round trip closed by **05g B5, 6/6, 2026-10-12**: session on → profile echo/mobile `wpr_mobile`; off → real UA/desktop `wpr_desktop`. Old control surface superseded.
- [x] Scroll mechanics verified by the initial default-off/persisted probe and later default-on pin; P16.1 owns permanent/degrade coverage.
- [ ] External live-site mobile-cache round remains P14.6/P15 manual: verify scoped simulation, independent second tab, and restoration. The old menu/badge/chip recipe no longer applies.
- [ ] Firefox smoke remains unrun, recorded in 05f suite 5/P15: actual unavailable path must not render a switch or call rules. Playwright cannot load Firefox extensions.

## Docs to update

- AGENTS.md: DNR permission rationale and `ua-relay`/`ua-identity` entrypoints landed; domain modules follow master §1.5.
- P2/P3/P4/P8 historical forward notes point to the owning shipped/supersession record; no separate implementations.
