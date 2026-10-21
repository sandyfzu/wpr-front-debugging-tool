# Plans: status and reading guide

## TLDR

Start here, then read **only the owning active plan**. [Master](./00-master-port-plan.md) owns order/common gates/stable defect IDs; [design decisions](./design-decisions.md) and [UI bar](../ui-ux-bar.md) own binding UX. Completed records are lookup references, not prerequisite reading for every task. Code/lockfile/budgets/runbooks override historical measurements.

Consolidated2026-10-16: implementation plans and their X.1 suites now share files; completed proposals/implementation/audit/fix/verification rounds become final decisions/evidence+explicit limits. Superseded instructions removed; detailed chronology remains in Git. No implementation or new completion claim follows from this edit.

## Active work

- **P6 closed** (2026-10-20): [panel](./07-phase-6-panel-pages.md). A/A.1/B–F and G.1–G.11 shipped (G.10 closed — owner's native-DevTools find-bar live-check, 2026-10-19, no issue); **P6.1 closed** (2026-10-20 receipt: three acceptance suites + harness helpers, full tier 178/178, rows 1–5 annotated) — remaining owner rows: native dock geometry + real AT. Source/history in completed pages; current work does not restore removed headers preview or solved layout/copy defects.
- **P9 closed** (2026-10-20): [options+9.1](./10-phase-9-options.md). P9A registry/model + P9B page + P9.1 suites shipped (receipts 2026-10-19/20) — options surface complete (persistence/palettes/badge/dbugger/KC/width+motion/a11y receipted); open owner items carried: model-save RMW window, KC `null`-outcome conflation, P15 visual polish, Firefox runtime release matrix.
- **P8 deferred** (owner2026-10-19: popup not settled): [popup+8.1](./09-phase-8-popup.md) moves to the **last phase beforeP15** — afterP5J, immediately before release; no longer parallel withP6/P9.
- **P10 replanned (2026-10-20, owner approval pending for G-1..G-5):** [Builder+10.1](./11-phase-10-exclusion-builder.md). Parked file/page design superseded: in-page session shell + response-interception apply (Chromium CDP `Fetch`, Firefox `filterResponseData`); shell/pipeline is the shared seam P13/P14 testers mount into (owner mandate: improve them all). **P10A spike closed 2026-10-20** (arms verified; two design findings: DevTools-open attach succeeded on CFT 156 — re-verify on stable Chrome before P10D; Firefox port-in-pattern silence widened to tabs/permissions — strip ports for builder-composed patterns; infobar/2b manual remainder). **P10B engine closed 2026-10-20** (audited + fixed, 3151 green, no consumers). Next: P10C contracts ∥ P10D/E backends — implementation still gated on owner G-1..G-5.
- **P11 shipped (P11A/P11B/P11C + P11.1 site matrix, 2026-10-20):** [detection+11.1](./12-phase-11-detection-coverage.md); P14.5 still owns its later corrections (P11.1 inputs M1–M4 recorded there; M5 resolved 2026-10-21).
- **P19 planned (owner 2026-10-20):** [on-page command palette + UI gate](./19-phase-19-page-command-palette.md) — after P10/P11; **G-1 resolved 2026-10-20** (plan approved); chord decisions resolved (in-page capture, default Alt+K); P19D serializes with P12M's mount edits.
- **P12 partial:** [widget+12.1](./13-phase-12-on-page-inspector.md); early P12A detections/session drag shipped; shared mount cleanup, final registry/persistence/shortcut/controls/tools/conformance pending.
- **P13/P14 planned:** [RUCSS+13.1](./14-phase-13-rucss-tester.md), [runtime+14.1](./15-phase-14-live-analysis-tools.md). Independent cores parallel; P14 integration follows P13 executor seam.
- **P14.5 planned/decision-gated:** [coverage audit+tools](./15b-phase-14-5-coverage-and-tooling.md). Candidate approval≠decision gate complete.
- **P14.6 planned:** [external track](./16-phase-15-hardening-release.md#p146-external-site-track), owner site or explicit scoped skip.
- **P7 deferred:** [Diagnoser+7.1](./08-phase-7-diagnoser.md), afterP14.6 and rebuilt plugin JSON; then **P5J planned** [final header/nav](./06d-phase-5j-panel-topbar-redesign.md); then **P8** in the last pre-release slot (above); then **P15 planned** [release gate](./16-phase-15-hardening-release.md#p15-hardeningrelease).
- **P18 closed** (2026-10-19): [exclusion original-path](./18-exclusion-original-path.md). P18.0–P18.4 implemented, gated, and the owner's live-check received — cross-origin mirror row copies the hostless original path, no pending/notice; `?nowprocket` host map retracted on live+source evidence (see the phase doc).
- **Firefox open:** [diagnosis/fixes](./17-firefox-runtime-parity.md), not optionalP17 SBS panel home. Floor150 ships. 2026-10-21 Firefox158 run: F0 answered, panel hang (null `lastError`) + content-script iterator crash fixed; add-on ID (F1), badge/menus (F2/F2.1), palette (F3), header race (F6) open.
- **Optional P17** panel home remains unscheduled/decision-gated, scope only in master.

Chosen train: ~~P6/P9~~ done→**P10 owner disposition**→P11→**P19 planned, after P11**→P12→P13/P14→P14.5→P14.6→P7→P5J→P8→P15. Technical dependency nuance in master, not repeated as competing order.

## Completed references (read on demand)

- [Core P0–P4](./completed-core.md): contracts/detection/Priority family, producers/capture/source deltas. P0/P1/P1.1 done; P2–P4 implemented/automated subsets, **manual remainder still open**.
- [Browser infrastructure P4.1–4.3](./completed-browser-infrastructure.md): delivered harness/site/producer suites, evidence/failure limits. Current operations: [e2e README](../../tests/e2e/README.md), [site runbook](../local-site-runbook.md).
- [SBS P16–16.4](./completed-side-by-side.md): sync/mobile/device tag/desktop width shipped; **P16.1 partial**, permanent dual-origin/UA-copy+Firefox/external verification open.
- [Shell P5A–I/P5.1](./completed-shell.md): delivered stores/nav/palette/status/primitives/tests; native/input/manual limits, root audit resolutions. P5J remains separate active work.
- [Pages P6A–F/G.1](./completed-panel-pages.md): final behavior/security algorithms/parity/budget rationale, candidate evidence. Not fullP6 completion.
- [UI acceptance](./completed-ui-acceptance.md): combined copy/toast/canvas/headings/scrollbars accepted for **primary Chromium**,144 clean browser tests plus native ready-docking smoke on the recorded tree. Firefox autohide/extension runtime and remaining native/AT limits explicit.

## Maintenance

Update status only with evidence. Active task receipt: decisions/deltas, tests/runtime source, sizes, open blockers—**one concise update**, not new audit/fix/verification files. Common rules/gates belong to master/AGENTS/UI bar, don't copy them into every receipt. Archive closed execution detail into its topical completed record; keep required unverified work actionable. Never commit/push merely because a plan says “commit.”
