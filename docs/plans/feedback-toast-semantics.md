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

## Follow-up: overlapping pointer and keyboard pauses

Independent adversarial review found that the shared pause flag resumed dismissal when either interaction ended, even while the other remained. Three new unit regressions fail before the fix: pointer exit while focused, blur while hovered, and focus transfer within the same toast. Two production-build Chromium regressions reproduce both overlap failures through the real Copy report action; each notification disappears despite its remaining interaction.

Track hover and focus independently; run the countdown only when both are absent. A blur whose `relatedTarget` remains inside the toast retains the focus pause. The timer, queue, live-region semantics, visual classes and dismiss control retain their existing ownership. Unit coverage verifies preserved remaining lifetime after both interactions leave, timeout cleanup, explicit dismissal while paused, fresh enqueues and disposal/remount without inherited pause state. Existing tests and assertions remain intact.

The follow-up passes compile, lint, format, all 173 test files (2,636 passed / one existing skip), Chrome/Firefox builds and bundle budgets. Coverage remains lines 97.69%, branches 95.95%, functions 99.49%; all 16 focused toast tests pass. The panel chunk increases from 387.34 to 387.43 kB (rounded build output), within its 600 KiB budget. The real-browser suite retains the D-1–D-4 checks above and adds native hover/focus overlap, survival beyond the four-second lifetime, and automatic dismissal after the final interaction leaves. D-5 remains unchanged; D-6 grep is empty; the six-item queue remains bounded for D-7. Firefox runtime, attached docking and assistive-technology speech retain the manual limits above.
