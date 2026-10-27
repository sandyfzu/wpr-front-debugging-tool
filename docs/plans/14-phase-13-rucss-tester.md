# P13: RUCSS tester and P13.1 suites

## TLDR

Panel form+strip trigger share one validated config/executor: **fetch first, then strip/inject**, typed outcomes and TEST MODE. Depends:P11/P12/P3/P5/P6; technically parallel independent P14 cores, but P14 executor integration needs this pattern. Installed stack, no new permission expected (existing HTTPS hosts cover endpoint). Local synthetic WP key cannot exercise live service RUCSS; fixture failures/services honestly separated.

> **NOTE FROM DEV:** P10 replanned (2026-10-20) as an in-page session shell + interception backend. When P10 ships first, this phase's on-page trigger mounts into that shell (its mode registry) instead of standing alone, and the executor's strip/inject transforms must fit P10's pipeline seam. A **before-parse TEST MODE** (apply strip/inject during a P10 interception session so the reloaded page renders with only used CSS from first paint) is an owner-gated addition on top of this phase's fetch-first post-render flow — decide at P13C, implement only if approved.

## Verified source contract (v4.1.1)

RUCSSTester.js/utils, audited2026-10-06:

- Endpoint `https://mega.wp-rocket.me/support/wpr-rucss-v2.php`; source assembles **`?url=<unencoded page URL>?<unix seconds>[&mobile][&home]`**, including literal second?. **Live verification is a release blocker before changing or trusting this parser contract**, especially page URL already with query. It was source-verified, not proof of current server behavior.
- POST JSON Content-Type, body **only `{safelist}` or `{}`**, redirect follow.200 `contents.shakedCSS` expected; preserve/exclude/prepend/append/replacements client-side. Inject style id **rucss_test_result_style**; successful test marks `(TEST MODE)`.
- Strip `style,link[rel=stylesheet]`; links excluded by raw regex lines (old wildcard helper discarded return); inline preserve matches serialized style substring, but **wpr-usedcss always removable**. Defaults: `#wpcb-quick-actions-menu`, `wpr_rucss_style`, `admin-bar.min.css`, `dashicons.min.css`, `inspector_style`, `rocket-lazyrender-inline-css`. Always apply defaults+user lines (source empty input accidentally removed defaults).
- Ordered global-regex replacement pairs. Original persistence CSV/page localStorage, console tables/URL logs, sticky-disabled submit/classList assignment/unchecked response all replaced, not parity targets.

## Slices

### P13A — Pure config/transforms/storage

Depends:P1 contracts. Parallel:independent P14 math. Size:S–M.

- [ ] Domain constants, pure URL builder above, typed config: safelist/inlinePreserve/excludeFiles/preAppend/append/replacement pairs/mobile/home. Bounded strings/pair count, hostile/prototype guard. `local:rucss-tester-config`, validated defaults; panel debounce-writes, strip reads same cross-site config.
- [ ] One shared line-list parser trim/nonempty/order-dedupe, consumed by P14 selectors too. Preserve descriptors/predicate, all defaults+wpr-usedcss carve-out; raw exclusion regex compile once before run; ordered g replacements+applied count.
- [ ] Response guard code numeric200/string contents.shakedCSS, cap≤2MB; non200/network/malformed/oversized typed outcomes naming failure, never trusted nested access.

DoD: empty/whitespace/comma/newline/dedupe, regex invalid/raw wildcard, defaults-empty+user, replacements order, response hostile/size/code, config/storage tests green. No dependency on parked Builder implementation; reuse generic proven validation pattern only.

### P13B — Executor/background protocol

Depends:A/P3. Parallel:panel local form after contracts agreed. Size:M.

- [ ] Add validated runRucssTest(panel/strip→tab,config from store) and fetchRucssShakenCss(CS→background pageUrl/safelist/mobile/home/time). Background validates HTTP page URL/builds **fixed** endpoint, no arbitrary proxy URL; bounded fetch/failure handling. No page-CSP/CORS assumption.
- [ ] Validate/compile **everything**→fetch/parse→prepare transformed CSS→remove selected styles→inject result→update hub test-mode→answer. Fetch/invalid/config failures leave styles intact. Preserve/exclude interplay and wpr-usedcss carve-out. Propagate page/context loss as handled result.
- [ ] Same executor for strip, no console URL/results. Host-permission why-comment names endpoint, user-trigger privacy disclosure pageURL+flags+safelist only, never DOM; no automatic requests.

DoD: fake-DOM/background integration proves failure no mutation, success exact removals/injection/config defaults, validated sender/payload/no open proxy; both-browser build and budget delta. Original executor estimate≤6KiB raw **measured**, not guaranteed.

### P13C — Panel/strip UI

Depends:A/B/P5/P6/P12. Parallel:independent P14 UI after executor seam. Size:M.

- [ ] Registry route rucss-tester; form lists/wrappers/ordered add-remove pairs/live regex validation/mobile/home, Run/Inspect page styles. Shared textarea auto-grow only if actual primitive supports it; verify current API, don't invent existing behavior.
- [ ] Idle/running/success/error, run state-derived—not latched toggle. Copyable built endpoint/status, affected style count, typed recovery (review patterns/reload inspected page). Verify tabs.reload real DevTools availability without added permission, else instruction.
- [ ] Live style inventory tag/id/class/href/inline preview in panel, not console. After success additive rucssTestMode page-local hub state; Detections+strip `(TEST MODE)` once, reload clears. Repeat-run warning offers clean reload and explicit proceed, not silent second destructive pass.

DoD: state/form/validation/retry/config persistence/TEST MODE tests, UI bar §D, no duplicate tool runtime; native wording/typo sweep.

## P13.1 — Browser/service acceptance

Depends:A–C/P4.1/P4.2; parallel independent P14. Size:S–M.

- [ ] Fixture default/variants safelist/mobile/home, style ID/sheet size/affected count, repeated-test-mode/reload lifecycle. Mock non200/shape/network **at documented harness boundary**; styles unchanged on failure; invalid replacement blocked pre-run, message/retry honest.
- [ ] Current endpoint live contract: query-containing page, literal second?, mobile/home parse, empty body accepted/non200 behavior. Record authorized real-service result separately from local fixture; source-build same-page CSS visual+sheet-size comparison, no synthetic-local-license claim.
- [ ] TEST MODE Detections/strip once across repeat, reload reset; background fetch works despite page CSP/CORS; Firefox installed-extension fetch/flags manual; themes/reduce (full keyboard/new axe dropped — owner 2026-10-27: no screen-reader support).

DoD: gates/build/current raw+gzip tables, local green+manual annotations, endpoint contract either evidenced or named blocker. README user-trigger external data disclosure, permission rationale/AGENTS actual triggers, index status updated. Production service/source visual judgments and Firefox are not silently counted automated.
