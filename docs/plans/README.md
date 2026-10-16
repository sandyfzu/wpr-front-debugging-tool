# Porting plans — WPR Front Debugging Tool

## TLDR

Port every feature of [the original tool](../../../wpr-front-debugging-tool-legacy) (audited at v2.2.5, WXT 0.19 + React 18) and [wpr-inspector](https://github.com/wp-media/wpr-inspector) (v4.1.1) to WXT 0.21 + SolidJS: faster, lighter, safer, more reliable, with better UI and the extensions in master §8.

Start with the [master plan](./00-master-port-plan.md): §3 owns release order/dependencies; phase files own scope, acceptance, decisions, and evidence. The 2026-10-06 audit re-read both sources, re-verified master §1, added bugs #25–#50, and committed §8's extensions and P11–P14's second-baseline integration.

**Current ordering:** P5A–P5I shipped; P6 (P6A–P6G), P8, and P9 can proceed in parallel. P10 is parked pending an owner re-plan. P12A shipped early without moving full P12. P14.6 → P7 (rebuilt Diagnoser plugin required) → P5J → P15 closes the train; P5J is the last implementation phase. P17 is optional and decision-gated. Each feature's `X.1` browser suites run with/after it.

## Documents and status

`⬜ planned · 🟨 in progress / verification outstanding · ✅ done`. Update status here; keep detailed receipts in the owning file. Statuses below are retained from the phase register, not re-assessed by this documentation edit.

### Baselines and producers

- [Master plan](./00-master-port-plan.md) — goals, baselines, architecture, decisions, order, conventions, verification, bugs, risks, extensions.
- [Coverage audit](./audit-feature-coverage.md) — WP Rocket 3.23.5.1 settings × detection, D1–D7/T1–T9 proposals, P11/P1.1 corrections, approval outcome.
- **P0 ✅** [Foundations](./01-phase-0-foundations.md) — manifest/permissions, tests, Tailwind v4/tokens, utils.
- **P1 ✅** [Domain/contracts](./02-phase-1-domain-contracts.md) — typed messaging/storage, detection engine, data.
- **P1.1 ✅** [Beacon/Priority Elements](./02b-phase-1-1-beacon-priority-elements.md) — independent detection/lifecycle states for the shared beacon and four features. Engine/fixtures/gates shipped 2026-10-07; real-site and second-baseline comparison closed 2026-10-12. Evidence, factory-registration rule, and divergences are in the phase record.
- **P2 🟨** [Background](./03-phase-2-background.md) — headers, KC-DB updater, menus, badge. Implemented/audited/committed; P4.3 covers named site checks, with manual remainder. Includes the 2026-10-08 audit fixes.
- **P3 🟨** [Isolated content scripts](./04-phase-3-isolated-content-scripts.md) — data hub, improvements, KC UI, SBS. Same verification status as P2; owner decisions are in Shipped deltas.
- **P4 🟨** [MAIN-world capture](./05-phase-4-main-world-capture.md) — undefined references and cross-world bridge. Implemented/audited/committed; P4.1 covers browser checks, P4.3 the site capture leg.

### Browser infrastructure

- **P4.1 ✅** [Harness/fixture suites](./05b-phase-4-1-e2e-harness.md) — local Playwright + unpacked extension; five fixture suites. Audit: loopback bind, bounded launch, stronger assertions; deviations/environment recorded.
- **P4.2 ✅** [Local WP site](./05c-phase-4-2-local-wp-site.md) — Docker/wp-cli, apvm-built WP Rocket 3.23.5.1, mu-plugin fixtures, 62 KC plugins, Diagnoser slot. Live CDP verification and self-reset recorded; operating instructions in its linked runbook.
- **P4.3 ✅** [Retro site suites](./05d-phase-4-3-local-wp-suites.md) — headers (permanent P2-BLOCKER pin), badge, KC/DB, logs, improvements, cached-page SBS. Six suites, three consecutive full green runs; caught/fixed the data hub's headers-fetch race.
- The owner’s 2026-10-08 infrastructure decisions are recorded in P4.1–P4.3/P14.6; the absorbed proposal duplicated them and its provisional numbering no longer applies.

### Side-by-Side

- **P16 ✅** [Scroll sync/mobile design](./05e-phase-16-sbs-scroll-sync-device-simulation.md) — proportional overlay scroll sync; original per-tab mobile design superseded by P16.2.
- **P16.1 🟨** [Browser suites](./05f-phase-16-1-sbs-scroll-sync-device-simulation-suites.md) — mechanics/real-cache and compare-continuity coverage shipped. Open: permanent cross-origin-degrade pin (dual-origin fixture needed) and recorded manual Firefox smoke in P15.
- **P16.2 ✅** [Mobile comparison](./05g-phase-16-2-sbs-mobile-comparison.md) — persisted switch, tab-keyed session DNR rule, rescaled phone frames. B1–B6 published 2026-10-12; same-day follow-ups fixed rule encoding, reload continuity, size-gate latch, and audit findings.
- **P16.3 ✅** [Device label](./05h-phase-16-3-sbs-mobile-device-label.md) — profile `displayName` + engaged-device tag, “Generic Android phone”; shipped 2026-10-12.
- **P16.4 ✅** [Desktop width](./05i-phase-16-4-sbs-desktop-width.md) — default-on 1280px-floor scaled viewports, hidden during mobile sessions; shipped/audited 2026-10-12. Reload keying, persistence serialization, flavor-aware gate, reload-visible pin, and budget derivation are in the record.
- **P17 ⬜ optional** — SBS/mobile tools' panel home; decision-gated, one-line scope in master §3 until scheduled.

### Panel design and pages

- **P5 ✅ through P5I** [Panel shell](./06-phase-5-devtools-panel-shell.md) — devtools/Elements pane; wave-1/wave-2 primitives; shell/nav; palette, focus, shortcuts; status bar; strip brief/isolation; cold-start budget/close-out. Nine implementation slices shipped 2026-10-12/13, merged and audited. Subsequent owner/nav rounds retired the top bar, kept the icon rail, moved tooltips right, themed boot, replaced lucide barrel imports (2304 → 174 dev requests), and corrected shortcut ownership/menu handling. Detailed tests, budgets, and receipts stay in the phase record.
- [P5 UX study](./06a-phase-5-ux-study.md) — three personas/journeys, F1–F17 friction, Nielsen/DevTools/WCAG audit, interaction budgets, hierarchy, binding UX-D1…D14 and traceability.
- [P5H strip brief](./06c-phase-5-strip-design-brief.md) — binding visual spec; P12 implements/reports deviations, P15 audits conformance.
- **P5.1 ✅** [Shell suites](./06b-phase-5-1-panel-shell-suites.md) — boot/nav/deep-links, refresh, palette/status/search, keyboard/axe, geometry, cold start. Six automated suites via the devtools-contract data path; row 8/attached-devtools visuals remain manual. Receipts include the fixture seam `tests/e2e/helpers/panel-data.ts` and its honesty guarantee.
- **P5J ⬜** [Header/nav redesign](./06d-phase-5j-panel-topbar-redesign.md) — after P7, before P15 (owner, 2026-10-13). Icon rail is interim; wide-docking form requires this phase's design pass.
- **P6 ⬜, executing as P6A–P6G** [Panel pages](./07-phase-6-panel-pages.md) — Detections, JavaScript, Lazyload, Preloaded Resources, Undefined References, Headers & Cookies; split committed 2026-10-14.
- [P6G execution pieces](./07c-phase-6g-search-and-polish.md) — P6G.1–P6G.10: formatting/titles, shared list rules, search controls, virtual-list keyboard entry, next/previous results, compact code, copy feedback, headers polish, promotion decisions, integration. **P6G.1 complete 2026-10-16; P6G.2–P6G.10 planned.** Each piece owns dependencies, parallelism, tests, and acceptance; P6.1 still closes the wider phase.
- **P6.1 ⬜** [Page suites](./07b-phase-6-1-panel-pages-suites.md) — cards, report/markdown, headers rule, search, keyboard/axe, long-task gate.

### Remaining features and release

- **P7 ⬜ deferred** [Diagnoser](./08-phase-7-diagnoser.md) — General/Optimizations Info; requires rebuilt plugin. CS extraction/parser already built. **P7.1 ⬜** [Suites](./08b-phase-7-1-diagnoser-suites.md): plugin states, degenerate shapes, a11y.
- **P8 ⬜** [Popup](./09-phase-8-popup.md) — optimization toggles via Diagnoser URL params. **P8.1 ⬜** [Suites](./09b-phase-8-1-popup-suites.md): state, Apply/Reset URL contract, layout/keyboard, first frame.
- **P9 ⬜** [Options](./10-phase-9-options.md) — improvements toggles. **P9.1 ⬜** [Suites](./10b-phase-9-1-options-suites.md): persistence, appearance, KC refresh, badge/admin-bar effects.
- **P10 🟨 parked** [Exclusion Builder](./11-phase-10-exclusion-builder.md) — owner rejected the current engine/UI plan; re-think/re-plan pending. **P10.1 ⬜ parked** [Suites](./11b-phase-10-1-exclusion-builder-suites.md) — re-derive engine parity, regex, external-edit, Apply/Reopen/Reset coverage after re-plan.
- **P11 ⬜** [Detection coverage](./12-phase-11-detection-coverage.md) — meta/footprint precedence, new checks, cache context. **P11.1 ⬜** [Site matrix](./12b-phase-11-1-detection-site-suites.md): optimization rounds, stripped signatures, no-footprint honesty.
- **P12A ✅** [Early detection widget](./13a-phase-12a-inspector-strip-early-detections.md) — KC pill/card shell, strip states, session-local drag, per-origin opt-in via context menu/final storage item; shipped 2026-10-13. Base/drag audits and four owner-feedback fixes closed; site suite/budget receipts in §7. Full-P12 remainder unchanged.
- **P12 ⬜** [Full on-page strip](./13-phase-12-on-page-inspector.md) — redesigned, per-origin opt-in, persisted drag, toggle, tools. **P12.1 ⬜** [Suites](./13b-phase-12-1-inspector-strip-suites.md): Alt+H/drag, hostile CSS, live palettes, reduced motion/touch, zero-marker honesty.
- **P13 ⬜** [RUCSS tester](./14-phase-13-rucss-tester.md) — panel, CS executor, background fetch, TEST MODE. **P13.1 ⬜** [Suites](./14b-phase-13-1-rucss-tester-suites.md): variants, failure matrix, badge lifecycle.
- **P14 ⬜** [Live analysis](./15-phase-14-live-analysis-tools.md) — beacon, LCP, script runtime. **P14.1 ⬜** [Suites](./15c-phase-14-1-runtime-tools-suites.md): dynamic-import network, beacon hygiene, LCP highlight, script-state flips.
- **P14.5 ⬜** [Coverage/tooling](./15b-phase-14-5-coverage-and-tooling.md) — decisions gate, D1–D7 detections/fingerprints, T1–T7 tools from the coverage audit.
- **P14.6 ⬜** [External-site track](./15d-phase-14-6-external-site-track.md) — last test step before release; owner site/spawner required, else explicit scope skip.
- **P15 ⬜** [Hardening/release](./16-phase-15-hardening-release.md) — cross-surface perf/security/UX/isolation audits, docs, release.
- [Firefox runtime parity](./17-firefox-runtime-parity.md) — separate diagnosis/fix plan and receipts; not the optional P17 SBS panel-home phase.

## Reconciliation record (2026-10-08)

After producer commit `52da84a`, owner fixes/decisions landed in P2/P3's **Shipped deltas**: three-state toolbar badge with restart-safe clears; eager processing; `lib/detection/describe.ts` console summary; source-attributed `lib/uncaught-errors.ts`; private-window builder access. Master §2/§8 reflects these changes.

Budget derivations remain in their owning records: P2/P3 background/isolated/seed changes; P5H's 2026-10-12 gzip raise (34 → 35 KiB). `scripts/budgets.json` is authoritative, not historical targets or measurements in these plans.

## Rules that apply to every phase

The [master §4–§5](./00-master-port-plan.md#4-cross-cutting-conventions-enforced-in-every-phase), [AGENTS.md](../../AGENTS.md), and [UI/UX bar](../ui-ux-bar.md) own conventions and gates. In particular:

1. **Verify:** installed packages/current docs for APIs; real builds for behavior (`pnpm dev` in both repos; load/compare). Cite parity evidence.
2. **Done:** compile/lint/format:check/test green, required runtime checks/docs complete; build/budgets for bundle changes. Update AGENTS.md for scripts/dependencies/permissions/structure, README for setup. Conventional Commits per logical unit **only when requested**.
3. **Port + enhance, never copy:** preserve behavior, reshape structures, improve within the owning phase—not silently “later.” Every source behavior needs a checklist item. Provenance stays in `docs/plans/`, never code/comments.
4. **Test first:** pure parsing/detection/contracts/exclusions; only thin wiring/UI glue may be exempt.
5. **Safety:** validate message/storage/DOM boundaries; justify every permission; follow shared error/appearance/accessibility rules.
6. **Moving sources:** re-check **both** sources' HEAD before each phase; fold drift into its reference before implementation. P15 re-checks before release (v2.2.4 → v2.2.5's WP-7.x KC fix demonstrated the risk).
7. **Both baselines:** P11–P14's quirks/enhancements follow rule 3 and the same P15 evidence-backed re-audit.
8. **One declaring site:** each constant/type/helper/table/selector belongs to one owner. Reference-engine control flow is independent but imports vocabulary/types; tests may repeat assertion literals (master §4.9–§4.10).
