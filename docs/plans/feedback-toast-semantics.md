# Notification semantics remediation — 2026-10-15

The full-script copy verification exposed an existing shared notification defect. Real Copy report success and a browser clipboard denial reproduced axe 4.14's `aria-allowed-role` findings on both `<li role="status">` and `<li role="alert">`, plus a serious `list` violation on their parent `<ul>`.

Keep the native list/list-item structure and move the per-tone live role onto the existing message wrapper. Success/info remain polite status messages; errors remain assertive alerts. Atomic announcement includes the title and remedy together; the dismiss control sits outside the message. Queue state, layout classes, timer lifecycle, pointer/focus pause handlers and dismissal remain unchanged. This is custom Solid markup; inspecting installed Kobalte 0.13.14 confirmed its toast primitive is not used here, so no dependency change is needed.

The component regression covers all three tones, native direct list children, title/description announcement, and dismiss controls outside the message. Existing tests now look up tone metadata on its owning list item and send hover/focus events to the unchanged handler-owning list item. Their behavioral assertions remain intact; this necessary selector adjustment follows the corrected semantics rather than weakening a failed behavior assertion.

## UI bar receipts

- D-1: real browser at 320/480/768/1280 px, document horizontal overflow absent with both success/failure notifications visible. Attached DevTools docking remains a manual surface; the test drives the actual standalone panel document.
- D-2: System/Light/Dark switched live; reduced motion enabled; no running animation. No visual tokens/classes changed.
- D-3: Copy report activated with Enter, copy retains focus, error dismiss activated with Enter. Existing component tests retain hover/focus pausing, timeout and close behavior.
- D-4: actual notification region audited in Chromium under each palette, zero axe violations and zero unresolved results after the fix. The same test fails on the baseline with the concrete defects above.
- D-5: no refresh/state ownership changes; existing queue cap/dismiss/clear tests remain intact.
- D-6: changed component/test files contain no barred colors, motion or viewport utilities.
- D-7: no unbounded list added (queue remains capped at six); Chrome build and size budgets pass. No performance benchmark change is warranted for moving two attributes between existing elements.

## Verification

`pnpm compile`, `pnpm lint`, `pnpm format:check`, `pnpm test`, Chrome/Firefox builds and `pnpm check:budgets` pass with Node 24.21.0 / pnpm 12.9.1. The full test gate reports 173 files, 2,632 passed / one existing skipped test; lines 97.69%, branches 95.95%, functions 99.49%. `pnpm exec vitest run components/ui/toast.test.tsx` passes all 12 tests. `tests/e2e/suites/panel-toast.spec.ts` drives real success and failure through the shipped Copy report action; only the browser clipboard denial is supplied by the harness. Firefox runtime and actual assistive-technology speech remain manual; an axe result proves DOM semantics, not a particular screen reader's speech output.
