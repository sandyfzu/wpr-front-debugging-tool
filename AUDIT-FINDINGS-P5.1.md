# AUDIT-FINDINGS-P5.1 — adversarial audit round (2026-10-14)

Independent audit of `feat/p51-panel-shell-suites` (HEAD `5b3b370`, base `9469aa7`, tree clean).
**Nothing was fixed or modified in this round** — every finding below carries its own reproduction;
all probes and temporary instrumentation were reverted byte-for-byte before this file was written.

---

> **Closing round (2026-10-14).** Every finding below is resolved on this branch — `4cbdf00` (the P1-1 derived pin + the S-1/S-2 audit gates), `654e938` (the modal axes' reviewed unresolved allowances), `61dd76d` (the AGENTS.md dependency-trigger line), the history reword of `7ce3b80` → `7c3fac0` (P2-3, message-only, tree byte-identical) and the `docs(plans)` receipts commit. The P2-1 failure was an environment fact (the running docker stack's `mu-plugins` mount pointed at a deleted worktree's path — the fixture mu-plugin was absent from every served page), restored through the runbook's documented lifecycle. The full per-finding record lives in `docs/plans/06b-phase-5-1-panel-shell-suites.md` § "P5.1 receipts — the closing audit round"; this round's own tier figure is **106/106 three times consecutively** (the total +1 for S-1's new leg). The auditor's evidence text below is untouched; each finding carries a `RESOLVED` line.

---

## Gate figures I measured (cold, in order — never from the receipts)

| Gate                           | Receipts' claim                                                                              | Measured here                                                                                                                                                                                                                         | Verdict                                                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                 | ✓ axe-core `^4.14.0` verified on registry                                                    | "Already up to date"; `npm view axe-core@latest` = 4.14.0 (no bump missed); lockfile diff adds only axe-core@4.14.0 (+integrity, engines node>=4)                                                                                     | ✓ reproduced                                                                                                                                                                                                                                                                      |
| `pnpm compile`                 | ✓                                                                                            | ✓ exit 0                                                                                                                                                                                                                              | ✓                                                                                                                                                                                                                                                                                 |
| `pnpm lint`                    | ✓ zero findings                                                                              | ✓ exit 0                                                                                                                                                                                                                              | ✓                                                                                                                                                                                                                                                                                 |
| `pnpm format:check`            | ✓                                                                                            | ✓                                                                                                                                                                                                                                     | ✓                                                                                                                                                                                                                                                                                 |
| `pnpm test`                    | 1245/1245 in 121 files; coverage 95.11 % stmts / 96.71 % lines / 94.39 % branches / 100 % fn | **1245/1245 in 121 files** (recount via dedicated vitest run, coverage=false); coverage matrix re-run: 95.11 % (1402/1474) stmts / 96.71 % (1207/1248) lines / 94.39 % (994/1053) branches / 100 % (217/217) fn                       | ✓ reproduced exactly                                                                                                                                                                                                                                                              |
| `pnpm build` + `check:budgets` | panel chunks 228.6 KB raw / 70.2 gzip vs 600; whole build 442.6/146.3 vs 857                 | panel **228.6 / 70.2**, whole build **442.6 / 146.3**                                                                                                                                                                                 | ✓ figures reproduced; **moved-nothing proven**: a temp clone of base `9469aa7` outside the repo (`$TMPDIR/p51-base-audit`), install+build+`check-budgets` → panel **228.6 / 70.2**, whole build **442.6 / 146.3** — byte-identical totals (both prints "Σ Total size: 626.72 kB") |
| `pnpm test:e2e` (full)         | **105/105 in one clean pass (55.8 s)**, serial, retries 0, no flake policy invoked           | 105 total tests ✓ (recount: 103+2), `playwright.config.ts` `retries: 0` ✓ — **but NOT a clean pass here** (findings P1-1, P2-1): run 1 = 103 pass / 2 fail; policy re-run after ~95 s = still failing (plus one recorded-shape flake) | ✗ **not reproducible**                                                                                                                                                                                                                                                            |
| `pnpm build:firefox`           | ✓ `devtools_page: devtools.html`                                                             | ✓ built, manifest carries `devtools_page: devtools.html`                                                                                                                                                                              | ✓                                                                                                                                                                                                                                                                                 |

---

## The probe list (each executed with reproduction)

1. **DATA-PATH fabrication hunt** — read `helpers/panel-data.ts` in full: it imports only harness code
   (`openFixturePage`/`panelPageUrl`), stamps exactly one value (`devtools.inspectedWindow.tabId` onto
   both namespace objects), and is imported by no shipped module (grep). The panel's accessor
   (`entrypoints/panel/state/edges.ts` `devtoolsInspectedTabId`) reads `browser.devtools?.…?.tabId`
   — the stamped value — and everything downstream is shipped code. `entrypoints/panel/state/fixtures.ts`
   (`makeFdtData`) has **zero non-test importers**. No suite writes any store.
2. **Validator sabotage** (rebuilt app): `parseFdtData` patched to always `return null` → every payload
   = contract failure → `panel-boot` "renders the ready state…" **FAILED** at the settle poll (the panel
   can never reach ready). _Reverted + rebuilt._ The suites' ready state is unreachable with fabricated data.
3. **Fixture sabotage** (no build): `markers.html`'s `<meta name="generator" content="WP Rocket 3.20.1">` removed →
   the same boot test **FAILED** at `toContain('WP Rocket 3.20.1')` (the strip honestly rendered the
   fixture's real absence output). _Reverted._ The detection output IS the fixture.
4. **tabId-stamp leak** — live probe: the fixture page reads `chrome.devtools…tabId=undefined`,
   `browser.devtools…tabId=undefined`; a brand new origin page too (`undefined`); the panel page itself
   carries the stamp on **both** namespaces (`chrome=…` / `browser=…`). `page.addInitScript` is
   Page-scoped; no cross-origin/cross-frame leak. Hostile-prefix attack held: cannot leak.
5. **Reload-leg race bisection** (the P1) — see P1-1: pointer-run vs Enter-run discriminators,
   silence-of-warns check, patched-in instrumentation traces (later reverted), and ~20 executed
   iterations of the arm (6-loop, 4-loop, 8-loop, full tier ×2) establishing a ~29–40 % failure rate
   and the exact failing microsecond stamps.
6. **Two-instance master-#42 cross-talk** — `panel-soft-refresh`'s third test + `panel-search-relay`:
   the sibling's tab navigation drives only the sibling (own strip verbatim, own realm sustained);
   the relay drops foreign scope with both ids named. Cross-talk attack held (no cross-drive).
7. **CPU-throttle flake hunt** — CDP `Emulation.setCPUThrottlingRate` at 4× and 16× on both driven
   targets: boot settle 129 ms, palette-jump OK, soft-refresh settle 573 ms, freshness text
   `Updated just now` at 16× — every poll budget holds with ≥ an order of magnitude margin. Slow CI
   does not break the boot/soft-refresh/palette-jump legs; the one real flake (P1-1) is a
   second-alignment race, not a slowness race.
8. **Contract conformance vs standing suites** — every delegation reference is real:
   `panel-nav` owns the recorded-error render (its test asserts `Couldn't load page data`), the rail
   geometry/keyboard/overflow affordance and the overflow-height palette jump;
   `panel-shortcuts` owns Ctrl/Cmd-K, `/`, `?` and the hint-matches-binding rows;
   `panel-palette`'s `OVERLAY_ROW_COUNT = 11` equals `PANEL_SHORTCUTS.length` (11 rows counted in
   `entrypoints/panel/palette/shortcuts.ts`); `state/search.test.ts` exists with the 250 ms debounce
   pin; the row map's file→row mapping is accurate per file (verified against each suite's headers/tests).
9. **Budget/scope discipline** — `git diff 9469aa7..HEAD` touches ONLY the sanctioned set (6 suites +
   cold-start extension + helper + README ledger rows + 06b + docs/plans/README status row + package.json
   - pnpm-lock). No shipped source imports `tests/**`; the sole axe consumer is `panel-a11y.spec.ts`
     (`require.resolve` + `page.evaluate`, dev-time only — no bundle path). `side-by-side.spec.ts`'s
     "axe" matches are prose ("axes").
10. **Human-factor honesty** — row 8 stays manual with its recorded `$0`-in-real-DevTools reason ✓;
    the relay row's manual share shrank to the DevTools-native Ctrl/Cmd+F interception only — honest:
    the envelope + scope can be driven over the wire, a real DevTools window's find bar cannot be
    opened by this harness.

---

## Findings

### P1 — contract/suite-invalidating

**P1-1 `panel-palette` "runs the Reload action" is a high-rate flake; its "guaranteed second
advance" is voided by the panel's own rounded stamp — and the receipts' tier-gate figure
(105/105 in one clean pass) is therefore not reproducible evidence.**

- _Reproduction:_ `pnpm test:e2e` twice on this tree — the test failed **both** times
  (`Expected: not "2026-10-14 18:16:53"` / timeout at `tests/e2e/suites/panel-palette.spec.ts:176`);
  isolated loops of the single arm: ~5 failures / 14 passes (≈ 30–40 %). A run that hits the
  alignment windows fails deterministically for the full 15 s poll.
- _Root cause (mechanism, proven with instrumented traces):_ the strip's freshness stamp is rendered
  via `absoluteStampFromMs` → `formatCacheTimestamp(Math.round(ms / 1000))`
  (`entrypoints/panel/status-bar/selectors.ts:131`) — a settle in the **upper half of a wall second**
  ([.5 s, .999 s]) renders the **next** second. The suite's pre-guard
  (`expect.poll(new Date().getUTCSeconds()).not.toBe(Number(before.slice(-2)))`) compares the **raw**
  wall second against the **rounded** rendered stamp, so when the boot settle lands e.g. at second
  `48.656` the guard passes **instantly in the same true second** (rendered `…:49` ≠ wall `48`), and
  the fast reload settle (measured `48.656` → `48.717`, an ~60 ms flight) rounds to the **same string**
  `…:49` — the stamp the poll can never see change. No machine transition, announce, or error is
  observable (my instrumented failing trace: flight `refresh → refreshing → request → settled raw-null=false`,
  strip's `segments( ready <new fetchedAt> … )` recomputed — DOM text unchanged). The pointer-run of the
  same row and a push-driven control flight both re-stamp correctly, isolating the defect to the suite's
  **second-guarantee** (crumbling exactly the "decided, never a timing guess" standard deviations item 3
  set for this round).
- _Observed vs expected:_ expected — "the new settle must then stamp a different second, whatever the
  flight's latency" (suite comment) and receipts ✓; observed — the guarantee fails whenever the boot
  settle rounds ahead of the wall clock and the reload settles in the same true second.
- _Fix direction (for the closer, not applied here):_ make the guard compare the _rendered_ form
  (e.g. accept either the old or the old+1 s rendering), or assert on a stamp readback that is not
  second-rounded (the settle time is `ms`-exact in `state.fetchedAt`), or wait for the _strip text_
  itself to leave `before`'s ±1 s window before Enter.

> **RESOLVED — `4cbdf00`.** The arm's assertion now pins the app's real contract, derived not guessed: the strip renders the settle's second-ROUNDED stamp, so the guard polls raw wall ms past the rendered stamp's +0.5 s edge (any later settle then rounds to a different second whatever the flight's latency), and the flight must leave `before`'s claim on the RENDERED text — the poll decodes the rendered stamp, keeps polling on the vanished-marker null and the stale string, and the aging tick's re-renders cannot produce the change (only a `fetchedAt`-replacing refetch can). The false-premise comment is rewritten to the derivation. Negated-run probe: without the Reload action's flight the poll times out at the re-stamp assert — the leg still fails when the action stops stamping. Pins: 6/6 consecutive solo suite runs (18 reload arms; this finding's measured rate was ~5/14 failing) + the full tier ×3 (106/106, all green).

---

### P2 — correctness/robustness/docs-truth

**P2-1 The standing `site-data-hub` error-page leg fails deterministically on this machine — outside
the recorded flake class — and the phase status row's "every gate green incl. the full tier 105/105"
cannot be sustained by re-running.**

- _Reproduction:_ `pnpm test:e2e` → `site-data-hub › the real site error page delivers…` fails
  (2/2 full runs); solo runs of the suite: **3/3 failed** with the same timeout
  (`site-data-hub.spec.ts:138`). Running the identical suite in the **base commit's temp clone**
  (`$TMPDIR/p51-base-audit`, same docker site): **identical failure** — the branch did not cause it
  (environmental/local-site state), but it invalidates today's "every gate green" status claim and is
  not the README's recorded `timeOrigin` shape (no policy covers it).
- Second full run also hit `site-side-by-side › close restores the page scroll and inline overflow` —
  the _recorded_ shared-site flake shape (policy covers that one; it passed the clean pass recorded
  by the receipts).

> **RESOLVED — environment-fact fix (no code; verified 2026-10-14).** Diagnosed: the RUNNING docker stack's `mu-plugins` bind mount pointed at `…/worktrees/p6a-panel-foundations/docker/fixtures` — a worktree path the machine has since deleted — so the container served NO fixture mu-plugin: `?fdt-error=reference` pages carried no scripted ReferenceError and `fdtFixtureReference` could never arrive (identically on base, matching this finding). Restored per the runbook: `docker/scripts/down.sh` (volumes kept) + `docker/scripts/up.sh` from the canonical checkout — the mount rebinds, the bootstrap re-converges idempotently ("conflicts total=62 installed=0 failed=0"), and `cdp-smoke.mjs` answers `SMOKE OK` (every scenario flag + the UA-echo endpoint). The leg then passed three consecutive solo runs (all four legs green each time), and this round's own tier figure is 106/106 three times consecutively — replacing the not-reproducible receipts claim this finding named.
> **P2-2 "No AGENTS.md duty" is asserted against a dependency trigger that did fire.**

- AGENTS.md's "When to update this file" lists "add/remove a dependency" — `axe-core@^4.14.0` **was
  added** (the tier's engine). The receipts (deviation 7) waive it as "(agreed with the deliverable)",
  which the phase contract does not record. The Tests row of AGENTS.md's tech table
  (and/or `tests/e2e/README.md`'s env facts) naming the a11y engine would satisfy the trigger at a
  one-line cost. Reproduction: `git diff 9469aa7..HEAD -- package.json` (+1 devDep) vs AGENTS.md unchanged.

> **RESOLVED — `61dd76d`.** The trigger's own one-line form: AGENTS.md's Tests row now names axe-core where the tooling sits (the browser-tier context; a dev-time a11y engine read by the `panel-a11y` spec, never a bundle input). Nothing else in the file changed.
> **P2-3 The receipts' deletion story refers to repo history that does not exist.**

- 06b deviation 5 and the `feat(panel-e2e)` commit message claim "Two files deleted
  (`tests/e2e/suites/zz-probe10.spec.ts`, `tests/probe-resettle.test.tsx`)". Neither path exists in
  **any** commit reachable from this worktree (`git log --all -- <path>` empty; no `D` rows in
  `git diff 9469aa7..7ce3b80`). The files were untracked scratch — deleting them cannot be evidenced
  from git, and a reader attempting to verify "deleted" finds nothing. Phrasing should have been
  "untracked scratch removed", not "two files deleted"; receipts honesty (the mandate's one source of
  provenance) requires the verifiable form.

> **RESOLVED — history reword, `7ce3b80` → `7c3fac0`.** The commit message now says the verifiable thing: "Untracked in-flight probe scratch removed before this commit (… never existed in any commit, so NO tracked file was deleted …)". Reworded via `git rebase -i` on the unpushed branch, commitlint hooks green, 0-line tree diff between the pre- and post-reword commits; the receipts' deviation 5 carries the same correction.

---

### Smalls

**S-1 The a11y bookend never audits the shortcuts-overlay dialog.**
`panel-a11y` runs (a) the whole ready document and (b) the open palette scoped to `[data-fdt="dialog"]`.
The shell's second modal — the shortcuts overlay (11 rows, its own dialog semantics) — is never
mounted during a run, so it escapes every axe scope. It is only "audited clean" transitively-if-at-all.
One more scoped run while the overlay is open would close it (or one ready-shell run with it open).

> **RESOLVED — `4cbdf00`.** The real leg landed: the overlay opens from its advertised `/` binding in its own mount state and is audited scoped to the portaled dialog's surface (`[data-fdt="dialog"]`, the same include shape as the palette's run), strict under the shared gate.
> **S-2 The a11y assertions ignore axe `incomplete` entries.**
> Both runs assert `results.violations` empty; `color-contrast` cases axe cannot resolve land in
> `incomplete` (unasserted) — "strict" overclaims determinism. The settle guard makes the common case
> resolvable; asserting `incomplete` empty would make it a fact.

> **RESOLVED — `4cbdf00` + `654e938`.** The first gate (assert `incomplete` empty outright) surfaced what the unasserted "strict" claim rode over: the modal-scoped audits report DETERMINISTIC unresolvables (six identical successive evaluations per scope) — `aria-hidden-focus`/`#root` (the shared modal marks the app root `aria-hidden` over a still-focusable outside; the `focusable-modal-open` check asks what a static engine cannot answer), `aria-valid-attr-value`/palette input (the `aria-controls` listbox EXISTS, probed — the engine's `controlsWithinPopup` needsReview shape), and `color-contrast` ("partially obscured" span inside the highlighted palette row; "only non-text characters" on the overlay's arrows kbd). The settled gate: per scope, reviewed allowance rows keyed rule id + target shape (derived reason recorded beside each) — any other unresolved rule, node or shape fails named — while the no-modal whole-document run asserts `incomplete` empty outright (it resolves clean deterministically). The intermediate rejected run is in this round's history, never a silent skip.
> **S-3 `panel-status-bar`'s exact-phrase freshness assert is stricter than its own stamp tolerance.**
> The suite accepts the stamp within 60 s (`Date.now() − capturedAt < 60_000`) but requires the _rendered_
> phrase `Updated just now`, which the app guarantees only under `JUST_NOW_MAX_MS = 5_000` — a boot
> settle ≥ 5 s ( pathological CI) fails a suite whose own tolerance was 60 s. Measured boots are
> ~50–150 ms and 16×-throttled runs kept `just now`, so this is theoretical, but the two tolerance
> windows disagree by design. Recording, not a demanded change.

> **RECORDED — no code change (this round's decision).** The disagreement stands as designed: the 60 s readback is the suite's data-fact guard; the exact `Updated just now` phrase is the app's own just-now window (5 s). A pathological ≥ 5 s boot would fail the phrase before the 60 s guard matters — measured boots stay ~50–150 ms (and 16×-throttled runs kept the phrase), so the honest record is this line plus the receipts; widening the phrase assert would weaken the 0-interaction answer's strictness for a theoretical tier-level condition.
> **S-4 (informational, no action)** The panel's freshness segment re-renders only on state changes and
> the clock's 30 s cadence (`AGE_TICK_INTERVAL_MS`) — a displayed age legitimately reads stale for up to
> 30 s; the suites never depend on the cadence in a timing-sensitive way (poll-then-read), and the
> status-bar/soft-refresh suites poll data facts, not tick counts. Verified the displayed-stale behavior
> explains "just now frozen for seconds" observations that first looked like a render bug (they are not).

> **RECORDED — no code change (informational).** This round re-verified the poll-then-read shapes across its own runs; the 30 s cadence's displayed-stale window stays by design.

---

## Attacks that held (enumerated, per the mandate)

- **No fabricated detection can bypass the CS**: single-value stamp; validator sabotage → boot dies;
  fixture sabotage → strip renders the fixture's honest absence; no shipped import of any test helper;
  no suite writes a store; `state/fixtures.ts` is test-only.
- **The stamp cannot leak onto hostile pages/frames**: page-scoped `addInitScript`, verified live on
  the fixture page, a fresh origin page, and the panel itself.
- **No blind timing replaces the decided polls** on boot/soft-refresh/palette-jump legs: 16× CPU
  throttling keeps every settle inside its poll budget; the Enter runs decide via
  `aria-activedescendant` reads. **The one exception is P1-1's guard.**
- **No decorative assertions found**: every strip/nav/palette claim reads real semantics
  (`aria-current`, `aria-activedescendant` targets, computed ring, tooltip roles, `aria-disabled` is
  stamped by Kobalte on enabled rows — probed: `aria-disabled="false"` present); throw-guards in
  `panel-status-bar` are named and loud (`the served cache stamp vanished…`,
  `the served stamp is not representable…`).
- **No duplicate/weakened standing pins**: the receipts' row map and each suite's header describe the
  referenced legs accurately; the palette's overlay-run duplicates panel-shortcuts' row _count_ only
  with the sanctioned test-literal justification.
- **Budgets/verbatim**: sanctioned file set only; panel chunks byte-identical vs base in an external
  clone; axe-core dev-time-only; lockfile adds only the engine.
- **Row 8 manual + relay-row shrink: honest.**

## What I did NOT audit

- Beyond the six P5.1 suites + cold-start extension + helper, the standing suites' internals
  (`site-*`, `side-by-side`, `theme`, `undefined-references`, …) except where needed to attribute
  failures (site-data-hub on base; the recorded flake class) — their own phases' audits own them.
- The docker site's state itself (the P4.2 runbook contract was taken as given; I did not debug the
  WP stack behind `site-data-hub`'s stable failure).
- `pnpm zip` / store artifacts; CI workflow code (browser tier is local-only by contract).
- Firefox runtime behavior (no harness; the built manifest was verified only).
- Real-DevTools-window behaviors (`$0`, first-open visuals, native find interception) — the phase's
  recorded manual remainder.
- Receipts' e2e _duration_ figure ("55.8 s") — machine-dependent; not reproducible either way in an
  audit with meaning.

## Gate-state for the closer

After this round the tree is at `5b3b370` with no modifications (scratch probes deleted; all
instrumentation reverted; budgets re-verified post-revert: panel 228.6 / 70.2, whole 442.6 / 146.3).
The docker stack is up; the last full tier runs are recorded above.
