# Porting Plans — wpr-front-debugging-tool (modernized port of legacy v2.2.4 + wpr-inspector v4.1.1)

Plans to port **every** feature of [`wpr-front-debugging-tool-legacy`](../../../wpr-front-debugging-tool-legacy) (WXT 0.19 + React 18, v2.2.5) to this repo's stack (WXT 0.21 + SolidJS), with every feature improved: faster, lighter, more secure, more reliable, a far better UI — and extended where it pays for itself (master §8). Full plan audit completed 2026-10-06: legacy re-read end-to-end, all §1 facts re-verified, master §6 extended with bugs #25–#50, and the §8 extension set committed. The **second behavioral baseline** [`wp-media/wpr-inspector`](https://github.com/wp-media/wpr-inspector) (v4.1.1) was audited the same day and lands as phases **P11–P14** (master §9): meta-tag-driven detection coverage, the on-page inspector strip, the RUCSS live tester, and the runtime analysis tools.

Read `00-master-port-plan.md` first. Then execute phases in the dependency order of the master plan's graph (§3): P0 → P1 → P1.1 → {P2, P3, P4 in any order/parallel} → P5 → {P6 → P7, P8, P9, P10 in any order/parallel once their deps are done} → P11 → P12 → {P13, P14 in any order/parallel} → P14.5 → P15. The files below are the single source of truth for what each phase delivers and what "done" means.

## Documents

| File                                                                                     | Phase | Scope                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00-master-port-plan.md](./00-master-port-plan.md)                                       | —     | TL;DR, goals, verified baselines, architecture, decisions, phase order, conventions, verification methodology, risks                                                                                 |
| [audit-feature-coverage.md](./audit-feature-coverage.md)                                 | —     | Feature-coverage audit vs WP Rocket 3.23.5.1 (2026-10-07): full settings inventory × detection status, proposed checks D1–D7, tool proposals T1–T9, corrections for P11/P1.1 — **pending approval**  |
| [01-phase-0-foundations.md](./01-phase-0-foundations.md)                                 | P0    | Manifest/permissions, tooling (Vitest), Tailwind v4 + design tokens, utils                                                                                                                           |
| [02-phase-1-domain-contracts.md](./02-phase-1-domain-contracts.md)                       | P1    | `lib/`: types, typed messaging, storage, WP Rocket detection engine, data files                                                                                                                      |
| [02b-phase-1-1-beacon-priority-elements.md](./02b-phase-1-1-beacon-priority-elements.md) | P1.1  | Beacon & Priority Elements: shared-beacon detection + the four beacon-backed features (OCI, ALR, Preload fonts, Preconnect domains) detected independently, with lifecycle states                    |
| [03-phase-2-background.md](./03-phase-2-background.md)                                   | P2    | Service worker: header interceptor, known-conflicts DB updater, context menus                                                                                                                        |
| [04-phase-3-isolated-content-scripts.md](./04-phase-3-isolated-content-scripts.md)       | P3    | Isolated world: data hub, improvements, Known Conflicts UI, Side-by-Side                                                                                                                             |
| [05-phase-4-main-world-capture.md](./05-phase-4-main-world-capture.md)                   | P4    | MAIN world: undefined-references error capture + cross-world bridge                                                                                                                                  |
| [06-phase-5-devtools-panel-shell.md](./06-phase-5-devtools-panel-shell.md)               | P5    | Devtools entrypoint, panel app shell, design system components + committed UX studies and the strip design language                                                                                  |
| [07-phase-6-panel-pages.md](./07-phase-6-panel-pages.md)                                 | P6    | Panel pages: Detections, JavaScript, Lazyload, Preloaded Resources, Undefined References                                                                                                             |
| [08-phase-7-diagnoser.md](./08-phase-7-diagnoser.md)                                     | P7    | Diagnoser: General Info + Optimizations Info pages                                                                                                                                                   |
| [09-phase-8-popup.md](./09-phase-8-popup.md)                                             | P8    | Popup: toggle optimizations via Diagnoser URL params                                                                                                                                                 |
| [10-phase-9-options.md](./10-phase-9-options.md)                                         | P9    | Options page: improvements toggles                                                                                                                                                                   |
| [11-phase-10-exclusion-builder.md](./11-phase-10-exclusion-builder.md)                   | P10   | Exclusion Builder: engine + unlisted page UI                                                                                                                                                         |
| [12-phase-11-detection-coverage.md](./12-phase-11-detection-coverage.md)                 | P11   | Second baseline: per-check merged detection (meta source + strongest footprints), new checks, cache context                                                                                          |
| [13-phase-12-on-page-inspector.md](./13-phase-12-on-page-inspector.md)                   | P12   | Second baseline: completely redesigned on-page inspector strip (opt-in per origin, drag, toggle, tool chips)                                                                                         |
| [14-phase-13-rucss-tester.md](./14-phase-13-rucss-tester.md)                             | P13   | Second baseline: RUCSS live tester (panel page + CS executor + background fetch + TEST MODE)                                                                                                         |
| [15-phase-14-live-analysis-tools.md](./15-phase-14-live-analysis-tools.md)               | P14   | Second baseline: beacon tester, LCP breakdown, script runtime view                                                                                                                                   |
| [15b-phase-14-5-coverage-and-tooling.md](./15b-phase-14-5-coverage-and-tooling.md)       | P14.5 | Full feature coverage & new tooling — self-contained phase (decisions gate → detection rows D1–D3 + fingerprint upgrades D4–D7 + tools T1–T7) from the [coverage audit](./audit-feature-coverage.md) |
| [16-phase-15-hardening-release.md](./16-phase-15-hardening-release.md)                   | P15   | Cross-surface hardening, perf/security/UX audits (incl. injected-UI isolation), docs, release prep                                                                                                   |

## Status

Update the Status column as phases complete (`⬜ planned → 🟨 in progress → ✅ done`).

| Phase | Status |
| ----- | ------ |
| P0    | ✅     |
| P1    | ✅     |
| P1.1  | ⬜     |
| P2    | ⬜     |
| P3    | ⬜     |
| P4    | ⬜     |
| P5    | ⬜     |
| P6    | ⬜     |
| P7    | ⬜     |
| P8    | ⬜     |
| P9    | ⬜     |
| P10   | ⬜     |
| P11   | ⬜     |
| P12   | ⬜     |
| P13   | ⬜     |
| P14   | ⬜     |
| P14.5 | ⬜     |
| P15   | ⬜     |

## Rules that apply to every phase

1. **Never guess.** Verify APIs against installed packages and official docs; verify behavior against a real build of the source you are porting (`pnpm dev` in both repos, load both extensions, compare). Cite evidence when declaring parity.
2. **Definition of done for every phase:** `pnpm compile` + `pnpm lint` + `pnpm format:check` + `pnpm test` all pass; manual runtime verification done per the phase's checklist; docs updated (AGENTS.md when it lists scripts/deps/permissions/structure; README when setup changes); Conventional Commits per logical unit.
3. **Port + enhance, never copy.** Every source behavior has a checklist item; every phase has an explicit _Enhancements_ section that must ship in that phase, not "later". Neither source is ever mentioned in code or comments — mappings and parity evidence live here in `docs/plans/` only (AGENTS.md, "No legacy in code").
4. **Tests first for logic.** All parsing/detection/messaging-contract/exclusion logic is pure and unit-tested; only entrypoint wiring and thin UI glue may go untested.
5. **Security & least privilege always.** Validate every message/storage/DOM payload at the boundary; every manifest permission has a why-comment; no new permission without a phase justification.
6. **Sources are moving targets.** Before starting a phase, re-verify its reference against both behavioral sources' HEAD — the legacy tool moved once already (v2.2.4 → v2.2.5 shipped a WordPress-7.x Known-Conflicts selector fix after the original audit), and the second baseline (`wpr-inspector`) may drift the same way. Fold any newer commits into the phase doc before building from it; P15 re-checks both before release.
7. **Enhancement discipline covers both baselines.** The P11–P14 phase files carry their own _Source quirks fixed_ and _Explicit enhancements_ sections with the same discipline rule 3 gives every other phase — parity behavior first, improvements mandatory within the phase; P15's re-audit walks them like all others.
8. **One declaring site.** Every constant, data table, regex/selector, type, and helper is declared exactly once — in the module that owns the concept — and imported wherever needed; the same value typed twice under any name is a defect. Test assertions may repeat literals to pin behavior, and the test-only reference engine (`lib/detection/reference/`) is the sanctioned exception for control flow only: it imports its vocabulary and contract types from `lib/wp-rocket/`. Source structures are reshaped when ported, never mirrored (master §4, conventions 9–10).
