# Phase 8.1 — Popup browser suites

**Depends on:** P4.1, P4.2, P7, P8. **Effort:** S. **Parallelizable with:** P9–P10 implementation.

## TLDR

Automate the popup checklist: open/interact the browser action as its extension page, assert toggle states against detections, the applied-URL contract into the diagnoser plugin, layout/keyboard constraints, and the first-frame fidelity rule.

## Suites

1. **State & render:** popup page opened (extension-page drive) on capture-backed state; toggles reflect detections identically; rows sourced from detection show the detected-first-frame rule (no all-off flash — asserted on the first rendered frame).
2. **Apply/Reset contract:** resulting URL after Apply / Reset is asserted against the diagnoser plugin's parameter contract (the P4.2 site + plugin carry the target — URL shape and state reflected in `wp-admin` are checked by url contract + one site round).
3. **Incompatible states:** no valid active context → the tool's incompatible/error state with the retry affordance (asserted from the page state machine, per the port's enhancement).
4. **Layout + keyboard:** 576-px viewport holds 12 rows + footer with the mandated scroll behavior; keyboard-only tab/space/Apply pass.

## Definition of done

- Suites green under `pnpm test:e2e`; P8's checklist annotated; budget row unaffected.

## Stays manual

Firefox runtime (URL param flow smoke), the menu/toggle feel, and the exact `chrome://`-tab topology (asserted via state machine instead — record the proxy).
