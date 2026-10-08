# Phase 16.1 — SBS scroll sync & device simulation browser suites

**Depends on:** P4.1 (harness), P4.2 (site), P16. **Effort:** S. **Parallelizable with:** nothing (it closes P16).

> Fixes P16's browser-observable half: scroll-sync mechanics over real frames and the UA-simulation round trip over the local site. Each item names its assert surface; manual rows are recorded with reasons, never silently skipped.

## TLDR

Automate what P16's unit suites cannot reach: proportional sync across real same-origin and cross-origin frames, the per-tab DNR UA rewrite end-to-end (the server sees the phone, the page world agrees, everything else stays untouched), and the honesty surfaces (menu flip semantics, badge mark, overlay chip, unavailable path).

## Site additions it needs (recorded in the P4.2 doc's fixture list)

- An **UA-echo fixture page** (server-side echo of the request's `User-Agent`) — the assert surface for the rewritten header.
- A **separate-mobile-cache fixture state** (WP Rocket `do_caching_mobile_files` on via the fixture plugin) — the served-copy difference is the round trip's verdict; turns off cleanly between rounds.
- A **cross-origin redirect fixture flag** (`?fdt-redirect=cross` — redirects the half to the sibling of P4.1's dual origins) — the mono-cause for the scroll-sync degrade state.
  Same self-resetting pattern as every other fixture (no admin hand-configuration between runs).

## Suites

1. **Scroll-sync mechanics** (fixture + real cached page): the toggle is off on the first rendered frame; on → driver→target proportional mapping asserted across differently tall halves (driver at X % ⇒ target lands at X % of its own range; near-equal halves land within a few px); a programmatic application never bounces back (no oscillation over a scroll burst); per-side refresh resets that half's ranges (mapping stays proportionate); overlay close detaches cleanly (host page unaffected, scroll restored) and re-open honors the persisted setting.
2. **Cross-origin degrade** (dual-origin trick + `?fdt-redirect=cross`): the affected half shows its per-side "not synced (different origin)" state, the other half keeps syncing, no console error storm, the toggle remains functional for the pair.
3. **Device-sim round** (P4.2 site): menu flip on → (SW-state assert via CDP) a session rule exists carrying the tab's condition and the profile header; reload → the UA-echo fixture returns the profile string and `navigator.userAgent` equals it (pinned: the page-world override lands before the first animation frame); with separate-mobile-cache on, the served copy flips to the mobile variant and back to desktop when off; toggle off → rule, badge mark, and chip all clear; a reload returns the browser's real UA.
4. **State honesty surfaces** (two tabs): independent per-tab rules (opposite states coexist), the badge mark tracks its own tab only, the overlay chip shows iff the state is on, and on the PSI host the chip may show but the sync toggle never renders.
5. **Unavailable path** (Firefox — Playwright cannot load extensions there, so a **manual smoke row**): the control logs the typed unavailable result, no rule call is attempted, the popup row (once P8 ships it) renders its explicit unavailable state with the fallback hint — recorded, not skipped.

## Definition of done

- Suites green under `pnpm test:e2e`; P16's checklist annotated with the run results; both budget rows re-measured post-suite unchanged; the P4.2 runbook gains the three fixture lines (URLs + reset semantics unchanged).

## Stays manual

Real-phone-vs-sim subtleties (viewport/touch/DPR are out of scope by design — the honesty rule keeps them visibly different); PSI analysis scroll semantics (no toggle there per P16's recorded reason); the Firefox runtime (item 5).
