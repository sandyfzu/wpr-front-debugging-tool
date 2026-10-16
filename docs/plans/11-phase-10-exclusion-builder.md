# P10: Exclusion Builder — parked

## TLDR

**Do not implement this historical design.** Owner2026-10-08 rejected the engine/UI planning approach and requires a fresh re-think/re-plan. P10.1 browser suites are parked too. Private-window launch already enabled; do not restore old incognito skip. Dependencies if reapproved:P1/P5, technically parallelP6–P9; installed stack, no proposed dependency approval here.

## Behavior inventory for the re-plan

Source `entrypoints/exclusion-builder/{utils.ts,pages/…ExclusionBuilderPage.tsx,override-notice.html}` is a behavioral reference, not a structure/API to copy:

- Parse HTML, trim nonempty lines, validate all regexes before changing anything.
- Delay matches **whole delayed-script markup**, supports both Delay types; restore data-rocket-type/src and tag FDT exclusion.
- Defer matches effective URL (data-rocket-src or src); remove data-rocket-defer+defer, tag exclusion.
- Image Lazyload matches **literal substring**, not regex, on clone with restored lazy src; restore src/srcset/sizes. Include srcset-only case in parity tests.
- Automatic Lazy Rendering matches child-cleared outerHTML, removes data-wpr-lazyrender. Feature-wide disabling removes relevant runner scripts; Lazy Rendering also removes rocket-lazyrender-inline-css. Source UI has three disable toggles, **no Lazyload disable toggle**; don't infer a fourth from old contradictory task text.
- Exclusion attribute accumulates CSV; preserve doctype serialization behavior unless explicit delta. Notice script/style warns overwritten page; original invalid timing function/transition-gated removal are quirks to reassess, **byte-identical notice is no longer an approved mandate** under the parked design.
- File pick/readwrite permission, empty/HTML validation, Apply from original snapshot, Reset/unselect, working guard. Defects to fix rather than preserve: empty-file error laundered as write error, writable never closed/aborted on failure, Reset strands working, external edits silently overwritten.

## Re-plan checklist (not implementation authorization)

- [ ] Agree new workflow/safety/UX and small independent phases/DoD first. Preserve useful behaviors or explicitly disposition deltas, not old file/type layout.
- [ ] Pure testable engine, cached regex compilation, typed honest errors, all-at-once prevalidation, inline invalid-line feedback; distinguish literal image matching. Counts/feedback and target notice behavior need decisions.
- [ ] Safe file lifetime/close-abort-finally, re-read/stat external edits before Apply/Reset, confirm destructive Reset, no false success. Evaluate FSA Chrome plus feature-detected Firefox file-input/download fallback/limitation and drag-drop; these were old proposals, not active approval.
- [ ] Accessible responsive/theme-correct unlisted full page, no auto-close. Current launch surface remains; no permissions/dependencies added speculatively. Re-derive≤50KiB target only through approved budget policy.

## P10.1 acceptance to re-derive with the new plan

Depends:newP10/P4.1 (+site fixturesP4.2). Engine fixture×operation match/unmatch/whitespace/CSV/doctype/disable/source-output comparison; invalid regex names line and blocks Apply; external disk edit warns; pick→apply→reopen targeted behavior gone/notice→Reset restores; every write failure cleans up/resets working. Source byte-diff only for behavior deliberately retained, documented notice/UI deltas excluded. Firefox installation/file flow manual (Chromium can byte-check output), keyboard/axe and UI bar §D, browser budget/gates. No suite is “done” before its rejected flow is reapproved/replaced.
