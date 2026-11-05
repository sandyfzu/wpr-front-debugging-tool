# P13: RUCSS tester and P13.1 suites

## TLDR

Panel form (+ any on-page trigger — never on the chip, owner 2026-10-28; decided at P13C) share one validated config/executor: **fetch first, then strip/inject**, typed outcomes and TEST MODE. Depends:P11/P12/P3/P5/P6; technically parallel independent P14 cores, but P14 executor integration needs this pattern. Installed stack, no new permission expected (existing HTTPS hosts cover endpoint). Local synthetic WP key cannot exercise live service RUCSS; fixture failures/services honestly separated.

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

- [x] Domain constants, pure URL builder above, typed config: safelist/inlinePreserve/excludeFiles/preAppend/append/replacement pairs/mobile/home. Bounded strings/pair count, hostile/prototype guard. `local:rucss-tester-config`, validated defaults; panel debounce-writes, any on-page trigger reads the same cross-site config.
- [x] One shared line-list parser trim/nonempty/order-dedupe, consumed by P14 selectors too. Preserve descriptors/predicate, all defaults+wpr-usedcss carve-out; raw exclusion regex compile once before run; ordered g replacements+applied count.
- [x] Response guard code numeric200/string contents.shakedCSS, cap≤2MB; non200/network/malformed/oversized typed outcomes naming failure, never trusted nested access.

DoD: empty/whitespace/comma/newline/dedupe, regex invalid/raw wildcard, defaults-empty+user, replacements order, response hostile/size/code, config/storage tests green. No dependency on parked Builder implementation; reuse generic proven validation pattern only.

**Receipt (P13A, 2026-11-05):** `utils/line-list.ts` `parseLineList(text): string[]` (CR/LF/CRLF split, trim, drop blank, first-occurrence dedupe; commas never split — shared with P14A). `lib/rucss-tester/`: `config.ts` (raw-text config `{safelist, inlinePreserve, excludeFiles, prepend, append, replacements[{search,replacement}], mobile, home}`, caps list 32 Ki / CSS 128 Ki chars, ≤50 pairs, search 4 Ki / replacement 8 Ki; tolerant per-field `parseRucssTesterConfig` + strict `findRucssTesterConfigProblem`, which also holds the stored JSON to `RUCSS_CONFIG_BYTE_BUDGET` 1 MiB UTF-8 — field caps alone allowed ~5.8 MB of escaped JSON in the shared 10 MiB `local` area), `endpoint.ts` (`RUCSS_ENDPOINT`, `buildRucssEndpointUrl`, `toUnixSeconds`, `buildRucssRequestInit`), `run-plan.ts` (`prepareRucssRun` compiles all patterns once → plan or every problem; `decideRucssStyle` → `remove|preserved|excluded`; `buildRucssCss` → ordered `g` pairs + per-pair counts, prepend/append outside replacements, 8 Mi-char cap refused before a pair's output is built (count pass bounds the length: exact without capture tokens), engine throw → `pattern-failed`), `response.ts` (`parseRucssResponse(httpStatus, CappedTextRead)`, `RUCSS_RESPONSE_MAX_BYTES` 2 MiB, `rucssTransportFailure`: `TimeoutError` → `timeout`, plain `AbortError` → `cancelled`). `lib/storage/rucss-tester-config.ts` (`local:rucss-tester-config`, get/set(strict, RangeError)/watch). `RUCSS_USED_CSS_ID` added to `lib/wp-rocket/constants.ts`. Deltas vs source: page fragment dropped before `?<seconds>` (a `#` swallowed seconds+flags); page credentials (`user:pw@`) stripped (never sent to a third-party service); empty replacement now deletes (source dropped the pair), empty search = unfinished row, skipped; source's own panel-style default marker dropped (our UIs are shadow-isolated, never matched); service `code` decides even on non-2xx; code must be a number. 104 tests, new files 100 % lines; no bundle delta (nothing imports it yet). Open (P13.1): live endpoint contract — the unencoded `url=` is source parity, but a standard query parser cuts a multi-parameter page address at its second `&` (and a page param named `home`/`mobile` would set the flag); verify against the live service before changing the encoding. User patterns have no ReDoS time box (self-inflicted, source parity) and `buildRucssCss` runs them twice (measure + replace; `(?:a|[a-z])*$` on `'a'×30+'!'` blocked 59.7 s) — P13B must run it (and exclusion matching) off the page's main thread or time-boxed, decide and record; P13B aborts only via `AbortSignal.timeout`/`AbortSignal.any` (never `setTimeout`+`abort()`, which reads as `cancelled`); P13.1 checks Firefox `fetch` rejects with `TimeoutError` (not `AbortError`) on timeout. Store writes validate one `structuredClone` snapshot; endpoint errors never echo the page URL.

### P13B — Executor/background protocol

Depends:A/P3. Parallel:panel local form after contracts agreed. Size:M.

- [ ] Add validated runRucssTest(panel/on-page trigger→tab,config from store) and fetchRucssShakenCss(CS→background pageUrl/safelist/mobile/home/time). Background validates HTTP page URL/builds **fixed** endpoint, no arbitrary proxy URL; bounded fetch/failure handling. No page-CSP/CORS assumption.
- [ ] Validate/compile **everything**→fetch/parse→prepare transformed CSS→remove selected styles→inject result→update hub test-mode→answer. Fetch/invalid/config failures leave styles intact. Preserve/exclude interplay and wpr-usedcss carve-out. Propagate page/context loss as handled result.
- [ ] Same executor for any on-page trigger, no console URL/results. Host-permission why-comment names endpoint, user-trigger privacy disclosure pageURL+flags+safelist only, never DOM; no automatic requests.

DoD: fake-DOM/background integration proves failure no mutation, success exact removals/injection/config defaults, validated sender/payload/no open proxy; both-browser build and budget delta. Original executor estimate≤6KiB raw **measured**, not guaranteed.

### P13C — Panel UI

Depends:A/B/P5/P6/P12. Parallel:independent P14 UI after executor seam. Size:M.

- [ ] Registry route rucss-tester; form lists/wrappers/ordered add-remove pairs/live regex validation/mobile/home, Run/Inspect page styles. Shared textarea auto-grow only if actual primitive supports it; verify current API, don't invent existing behavior.
- [ ] Idle/running/success/error, run state-derived—not latched toggle. Copyable built endpoint/status, affected style count, typed recovery (review patterns/reload inspected page). Verify tabs.reload real DevTools availability without added permission, else instruction.
- [ ] Live style inventory tag/id/class/href/inline preview in panel, not console. After success additive rucssTestMode page-local hub state; Detections `(TEST MODE)` once; the chip mirrors the Exclusion Builder's pattern (owner 2026-10-28) — a distinct glyph on the closed pill + a tab-level card line ("RUCSS test applied — reload to restore"), reusing its builder-hint seam (`strip-state` model + pill glyph), both glyphs side by side when both apply; no chip buttons, reload clears. Repeat-run warning offers clean reload and explicit proceed, not silent second destructive pass.

DoD: state/form/validation/retry/config persistence/TEST MODE tests, UI bar §D, no duplicate tool runtime; native wording/typo sweep.

## P13.1 — Browser/service acceptance

Depends:A–C/P4.1/P4.2; parallel independent P14. Size:S–M.

- [ ] Fixture default/variants safelist/mobile/home, style ID/sheet size/affected count, repeated-test-mode/reload lifecycle. Mock non200/shape/network **at documented harness boundary**; styles unchanged on failure; invalid replacement blocked pre-run, message/retry honest.
- [ ] Current endpoint live contract: query-containing page, literal second?, mobile/home parse, empty body accepted/non200 behavior. Record authorized real-service result separately from local fixture; source-build same-page CSS visual+sheet-size comparison, no synthetic-local-license claim.
- [ ] TEST MODE Detections + chip glyph/line once across repeat, reload reset; background fetch works despite page CSP/CORS; Firefox installed-extension fetch/flags manual; themes/reduce (full keyboard/new axe dropped — owner 2026-10-27: no screen-reader support).

DoD: gates/build/current raw+gzip tables, local green+manual annotations, endpoint contract either evidenced or named blocker. README user-trigger external data disclosure, permission rationale/AGENTS actual triggers, index status updated. Production service/source visual judgments and Firefox are not silently counted automated.
