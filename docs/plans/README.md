# Porting Plans — wpr-front-debugging-tool (modernized port of legacy v2.2.4)

Plans to port **every** feature of [`wpr-front-debugging-tool-legacy`](../../../../wpr-front-debugging-tool-legacy) (WXT 0.19 + React 18, v2.2.5) to this repo's stack (WXT 0.21 + SolidJS), with every feature improved: faster, lighter, more secure, more reliable, a far better UI — and extended where it pays for itself (master §8). Full plan audit completed 2026-10-06: legacy re-read end-to-end, all §1 facts re-verified, master §6 extended with bugs #25–#50, and the §8 extension set committed.

Read `00-master-port-plan.md` first. Then execute phases in the dependency order of the master plan's graph (§3): P0 → P1 → {P2, P3, P4 in any order/parallel} → P5 → {P6 → P7, P8, P9, P10 in any order/parallel once their deps are done} → P11. The files below are the single source of truth for what each phase delivers and what "done" means.

## Documents

| File                                                                               | Phase | Scope                                                                                                                |
| ---------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| [00-master-port-plan.md](./00-master-port-plan.md)                                 | —     | TL;DR, goals, verified baselines, architecture, decisions, phase order, conventions, verification methodology, risks |
| [01-phase-0-foundations.md](./01-phase-0-foundations.md)                           | P0    | Manifest/permissions, tooling (Vitest), Tailwind v4 + design tokens, utils                                           |
| [02-phase-1-domain-contracts.md](./02-phase-1-domain-contracts.md)                 | P1    | `lib/`: types, typed messaging, storage, WP Rocket detection engine, data files                                      |
| [03-phase-2-background.md](./03-phase-2-background.md)                             | P2    | Service worker: header interceptor, known-conflicts DB updater, context menus                                        |
| [04-phase-3-isolated-content-scripts.md](./04-phase-3-isolated-content-scripts.md) | P3    | Isolated world: data hub, improvements, Known Conflicts UI, Side-by-Side                                             |
| [05-phase-4-main-world-capture.md](./05-phase-4-main-world-capture.md)             | P4    | MAIN world: undefined-references error capture + cross-world bridge                                                  |
| [06-phase-5-devtools-panel-shell.md](./06-phase-5-devtools-panel-shell.md)         | P5    | Devtools entrypoint, panel app shell, design system components                                                       |
| [07-phase-6-panel-pages.md](./07-phase-6-panel-pages.md)                           | P6    | Panel pages: Detections, JavaScript, Lazyload, Preloaded Resources, Undefined References                             |
| [08-phase-7-diagnoser.md](./08-phase-7-diagnoser.md)                               | P7    | Diagnoser: General Info + Optimizations Info pages                                                                   |
| [09-phase-8-popup.md](./09-phase-8-popup.md)                                       | P8    | Popup: toggle optimizations via Diagnoser URL params                                                                 |
| [10-phase-9-options.md](./10-phase-9-options.md)                                   | P9    | Options page: improvements toggles                                                                                   |
| [11-phase-10-exclusion-builder.md](./11-phase-10-exclusion-builder.md)             | P10   | Exclusion Builder: engine + unlisted page UI                                                                         |
| [12-phase-11-hardening-release.md](./12-phase-11-hardening-release.md)             | P11   | Cross-surface hardening, perf/security audits, docs, release prep                                                    |

## Status

Update the Status column as phases complete (`⬜ planned → 🟨 in progress → ✅ done`).

| Phase | Status |
| ----- | ------ |
| P0    | ⬜     |
| P1    | ⬜     |
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

## Rules that apply to every phase

1. **Never guess.** Verify APIs against installed packages and official docs; verify behavior against the legacy build (`pnpm dev` in both repos, load both extensions, compare). Cite evidence when declaring parity.
2. **Definition of done for every phase:** `pnpm compile` + `pnpm lint` + `pnpm format:check` + `pnpm test` all pass; manual runtime verification done per the phase's checklist; docs updated (CLAUDE.md when it lists scripts/deps/permissions/structure; README when setup changes); Conventional Commits per logical unit.
3. **Port + enhance, never copy.** Every legacy behavior has a checklist item; every phase has an explicit _Enhancements_ section that must ship in that phase, not "later".
4. **Tests first for logic.** All parsing/detection/messaging-contract/exclusion logic is pure and unit-tested; only entrypoint wiring and thin UI glue may go untested.
5. **Security & least privilege always.** Validate every message/storage/DOM payload at the boundary; every manifest permission has a why-comment; no new permission without a phase justification.
6. **Legacy is a moving target.** Before starting a phase, re-verify its _Legacy reference_ against legacy HEAD — it moved once already (v2.2.4 → v2.2.5 shipped a WordPress-7.x Known-Conflicts selector fix after the original audit). Fold any newer legacy commits into the phase doc before building from it; P11 re-checks before release.
