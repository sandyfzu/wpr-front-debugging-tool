# P14.6 external verification and P15 release gate

## TLDR

P14.6 verifies production-only behavior **after P14.5**; then deferredP7→P5J→P15. If owner site unavailable, record scoped skip and carry survivors into P15, never imply runtime pass. P15 closes every required promise across browsers, not just compile/build. No implementation/commit/tag/push/publication authorized merely by this checklist.

## P14.6 external-site track

Depends:P4.1/P14.5+owner-authorized site/spawner. Parallel:—chosen slot. Size:S to scope, then small per-flow suites if needed. Existing local browser harness only, no CI.

- [ ] Owner supplies disposable site/credentials through ignored env, never logs. At execution enumerate every external-tagged survivor from core/SBS/P11–P14; decide automatable suites vs manual reasons.
- [ ] Real PSI framing/auto-flow/cross-origin refresh; real hosting/CDN/stripped cache signature; live RUCSS/beacon service behavior; mobile-cache identity/independent tab/restoration. Local intercepted/stub/fixture tiers stay offline regressions, not replaced or misrepresented as production proof.
- [ ] If available: local external suites green+survivors documented here. If unavailable: **skipped-by-scope / reason / surviving P15 rows**, explicit owner scope, no fabricated acceptance.

DoD: one of those two evidenced outcomes, secret-safe site cleanup/preconditions. HelpScout authenticated mailbox ergonomics, visual judgment, publication/OS accidents remain manual owner verdicts, not automatically covered by site availability.

## P15 hardening/release

Depends:all required phases inclP14.5/P14.6 disposition/P7/P5J/P21 WP Rocket simulation (before release, owner 2026-10-22); P10 needs owner replan/disposition, not silent skip; P17 optional. Parallel:—final gate. Installed Node24/pinned pnpm/TS5.9/WXT/Solid/test tools, no speculative upgrades.

### P15A — Budgets/performance

Depends:implementation complete. Parallel:—.

- [ ] Fresh both-browser builds, `pnpm check:budgets`, committed raw/gzip table per surface; panel600KiB hard/**350 stretch met/not with measured reason**. Last historical panel387.1KiB exceeded stretch; worker near368/75 row. Remeasure, not receipt reuse.
- [ ] Reaudit whole-build accounting including worker/assets and shared web/types chunks only backstop-counted. Evaluate precompiled grammar/raw-engine lever only with dependency/size evidence; no silent ceiling nudge. Current budget table authoritative.
- [ ] `pnpm bench:detection` checks median ratio≤0.70 table; real same-machine/source+port at least5 page loads each, timing medians, counts and source-compiled normalization comparison. happy-dom fixture parity alone not absolute browser count/perf proof.
- [ ]5000-row view/filter/search/navigation gate no task>50ms/TBT<200ms; worker-only highlight/on-demand network, byte/timeout/abort/cache boundaries. Startup listener registration/no blocking top-level await; measure CS document-start and disclose cold-start pre-mark import cost.
- [ ] CI common gates/build/budgets+**add/verify Firefox build** on release revision, green run link. E2E and machine benchmark remain local-only.
- [ ] P10 carry-overs ([list](./completed-exclusion-builder.md#follow-ups-owners)): remove the ~30 KiB in-process exclusion engine from the Firefox background (plan there, M) — **owner 2026-10-27: no fallback**: no `Worker` ⇒ Apply leaves the page unchanged with a G-3 unavailable warning (cause + remedy); Chromium sizes ±0.1 KiB, Firefox apply re-proven with the [owner script](./completed-exclusion-builder.md#owner-firefox-check-script). Re-measure the Defer set reading (> 50 ms ⇒ slice/off-thread). Inner-`.*` rows: owner-accepted 2026-10-27 (budget names the row), revisit only with perf evidence.

DoD: current measured table/protocol/CI evidence and all ceilings green, stretch explicitly accounted.

### P15B — Security/reliability/browser matrix

Depends:A baseline and all boundaries. Parallel:—.

- [ ] Inventory messages×senders/storage/KC JSON/DOM/file inputs with tested validators/caps. Redaction at capture/export/report/DOM/copy, intentional full-source clipboard distinguished; hostile word/header/DB fixtures. Least privilege why-comments/CSP/remote-code/data separation, exact wp-rocket-scripts pin/adapter. Dependency-ban listing diff vs master choices, no React/router/motion/toast/highlighter replacements creeping back.
- [ ] Shadow/adopted-style isolation+hostile CSS for every injected surface; no unscoped style/font/property leak. Respect documented native admin-bar/SBS overflow/session-continuity exceptions and intentional tester style mutation. Grep review **does not blindly reject** validated Shiki-generated HTML/token sheets or RUCSS's requested style injection; verify safe boundaries/allowlist, not source string absence alone. External links noopener/noreferrer, explicit window.open targets.
- [ ] P19 carry-over: Kobalte's mounted dialog close (`restoreBodyPointerEvents`) removes the host body's `style` attribute whenever `body.style.length === 0` (`style=""`, whitespace-only, invalid-only declarations) — pin it with a unit (host body `style=" "` / `style="foo:bar"` across palette open/close) and fix or owner-accept. Also pin: in mounted (non-pointer-blocking) mode the original body `pointer-events` is never captured, so close assigns `body.style.pointerEvents = undefined` (the string `"undefined"`, invalid → ignored in Chrome); assert a page's inline `pointer-events` survives open/close.
- [ ] Reload extension10×/navigate20×: unique menus/admin entries, observer cleanup/HS heap. Panel50 navigations memory stable/header LRU bounded. Native reload limitation/race distinguished from profile relaunch proxy; no retry masking.
- [ ] Tooltip first cold-import test can approach Vitest5s (observed0.88–3.8s). Reproduce/warm import once if needed, **never raise timeout** just to hide it; pull forward if CI fails. No unrelated test weakening.
- [ ] Installed Firefox every surface inclMAIN/message/mount/DNR/badge/clipboard/FSA fallback/host grants; [Firefox workstream](./17-firefox-runtime-parity.md) may close named rows only with actual results. `web-ext lint` clean or explicit exceptions; current floor150 vs MAIN API128 distinct. Gecko ID/data-collection declarations remain AMO gates.
- [ ] P10 open verification ([list](./completed-exclusion-builder.md#manual-and-open-verification)), manual/owner: `DeveloperToolsAvailability = 2` policy block (deferred, owner 2026-10-21; how-to in that list); a real DevTools window on an intercepted tab on stable Chrome + the debugger infobar text/persistence across an attached reload (P10A); 2.5–4.3 MiB retained after the overlay closes (profile retainers first); Chromium DevTools panel `sender.url` shape before any Chromium relay.
- [ ] Both built HTML trees reference real emitted CSS; no silent dropped source links. Chrome145 floor, touch/RTL/native popup/docking/undocked/find-bar limits (Windows high contrast + AT dropped — owner 2026-10-27: no screen-reader support) from UI acceptance either verified or explicitly dispositioned.

DoD: all required security/reliability/runtime rows pass or owner-approved scoped disposition, no false build=runtime/store acceptance.

### P15C — UI/copy/enhancement audit

Depends:B. Parallel:—.

- [ ] Every surface/state visible focus, one truthful h1/page; existing axe assertions stay strict 0 violations, incomplete results fail unless exact evidence-reviewed target allowance (keyboard-completeness audit + new axe coverage dropped — owner 2026-10-27: no screen-reader support). UI bar D1–D7: required widths/dockings, live System/Light/Dark (System under both OS palettes), reduce, state recovery/refresh, perf.
- [ ] All **four** remaining quality checks (axe + full keyboard dropped — owner 2026-10-27: no screen-reader support): large-list gate, approved token motion only, palette tokens+committed screenshots, design-craft hierarchy/spacing/type/icons/async states. Current bar wins over old literal-zero-animation/bare-transition grep wording; real-wait busy motion/finished animation objects documented, no idle theater.
- [ ] P10 UI carry-overs: global `line-*` tokens < 3:1 as component boundaries (WCAG 1.4.11, every surface; P10F); the strip pill below 320 px and single-long-word ellipsis (owner-accepted 2026-10-27; the visual audit may still revisit it).
- [ ] Copy sweep: no source suffix/Trucated/ocurred/Know conflict/Resouces/double periods, inconsistent Non-delayed/Non-Deferred, “in there are any,” garbled D-bugger label; product/native names consistent. Header freshness **captured vs fetched** wording from P6F explicitly resolved here. No accidental new abbreviated feature names.
- [ ] Ledger every master extension/second-baseline integration and completed/active plan enhancement **DELIVERED/DEFERRED/DROPPED+test/measurement/runtime evidence+reason**. Include badge/log/report/headers/exclusion bridge/element inventory/KC/CI/appearance/SBS/strip/testers/CWV/coverage tools. Cross-phase deferrals can't disappear; required owning-phase work needs explicit scope decision, not automatic P15 backlog.

DoD: quality checks/ledger/copy/visual receipts complete, master promises each evidence-linked.

### P15D — Docs/release

Depends:A–C. Parallel:—.

- [ ] README actual features/screenshots/setup/build/zip/browser/privacy notes; concise architecture/detection/protocol references from owning code, no duplicate implementation diary. AGENTS final scripts/deps/permissions/structure/conventions sync; paths/commands checked.
- [ ] Recheck both behavioral sources past audited v2.2.5/v4.1.1; fold drift into owning scope first. Refresh live KC seed verbatim, format, repin exact row count/comment/asset budget as AGENTS requires.
- [ ] Authorized1.0.0 version/changelog, both store ZIPs free of development output/secrets;128px icon/listing assets (actual implemented surfaces), manifests/Firefox consent identity/policy review. Build success not store approval.
- [x] Owner decision (2026-10-28): **no** chip keyboard shortcut (source had Alt+H) — context menus + Alt/⌥+K palette cover it.
- [ ] CI on release revision, artifacts validated, Conventional history; tag v1.0.0/commit/push/publish **only when separately requested**.

DoD: budgets/speed/security/reliability/UI/ledger/docs/browser artifacts all complete, remaining limitations explicit, no claimed release until owner authorizes.
