# P14: live analysis and P14.1 suites

## TLDR

Panel/strip-triggered beacon test, LCP breakdown, script runtime and current-visit CWV share validated CS executors. Depends:P11/P12/P3/P5/P6; **P13 executor pattern before integration**. Pure cores can parallel P13; full integration is not independently executable before that seam. Reuse installed stack; only proposed new runtime dependency is exact-pinned latest-compatible **wp-rocket-scripts**, reverified at execution (1.2.2 was latest at2026-10-06 audit, source used1.0.6).

> **NOTE FROM DEV:** P10 replanned (2026-10-20) as an in-page session shell + interception backend. When P10 ships first, the shell's mode registry is these tools' on-page mount surface (the strip keeps its triggers; P14C wires into the registry, no second host), and the beacon/LCP tools gain an owner-gated "run under an applied P10 session" arm (exclusions/RUCSS CSS in effect during the reloaded render). Executors, results, and gates stay owned here.

## Reference and non-negotiable deltas

v4.1.1 BeaconTester/inspector tools, source/package audited2026-10-06. Source prototype-patches global BeaconManager, sticky mobile singleton, host console dumps, gate-script-mutating finalize, leaked LCP observers/borders, live script expandos, dropped Other group/JSON-LD. Replace all with instance subclass/adapter, fresh config, panel tables, cleaned observers/highlight, plain records/explicit Other/structured-data.

Package1.2.2 added fonts/preconnect subbeacons; finalize sets beacon-completed and throws if gate absent; save POSTs subbeacon getResults. **Only one adapter may touch internals**; upgrades local and source-verified, no prototype mutation/real DB write. Initial test surface ATF/LRC; fonts/preconnect schema allowed but result UI **gated on real-site verification**.

## Slices

### P14A — Pure models and dependency seam

Depends:P11, P13 shared line-list parser for config; parallelP13 independent work. Size:S–M.

- [ ] Verify latest stable license/engines/peers/ESM, pin exact, thin adapter. Required lazy-on-run separate beacon bundle target≤30KiB raw (~26 at audit), no beacon bytes at boot. **WXT content IIFEs previously could not split dynamic imports:** prove chosen build path/network behavior before claiming baseline unchanged; resolve bounded lazy execution seam, not merely write import(). Budget dedicated row.
- [ ] Fresh validated config thresholds≥1, selectors via P13 trim/order-dedupe parser, debug true, status booleans/at-least ATF or LRC. Defaults desktop1600×700,LRC1800, mobile false, selectors img/video/picture/p/main/div/li/svg. Old array passes querySelectorAll via list coercion; preserve actual selector semantics, not copied config layout/placeholders.
- [ ] Bounded result validator ATF records (type-key filter)/LRC selectors≤500 each, string limits, supported unknown fields readonly. No raw host HTML.
- [ ] Pure LCP max chain: ttfb=nav.responseStart; request=max(ttfb,res.requestStart||res.startTime||0); response=max(request,res.responseEnd||0); render=max(response,lcp.startTime||0). Parts:ttfb/request−ttfb/response−request/render−response. Percent **Math.round(1000×duration/total)/10**, not round-before-division typo. Missing/text resources/duplicates/zero/unsupported explicit; first matching URL source parity, candidate startTime dedupe.
- [ ] Script classifier: both Delay types or status attr→delayed; executed/failed/pending with raw unknown status. Verify **real current status set** (local site already observed failed-network/failed-transform/skipped), not assume only failed. Source data-rocket-src??src; converted base64 label;80char preview/full expansion, id/classes, structured-data retained. Case-insensitive theme/plugin, inline/no-src, **Other never dropped**; no DOM expandos.
- [ ] Current-visit LCP/CLS/INP observer reducer golden/unavailable per API. Owner called this “field CWV”; don't present one visit's entries as population/CrUX field data. Verify current metric semantics before implementation, not arbitrary sums/maxes.

DoD: math boundaries/rounding/candidates/golden, fresh mobile/config/selector validation, hostile results/classifier/Other/base64/JSON-LD/CWV fixtures; adapter/package/lazy-build decision verified, gates.

### P14B — Executors

Depends:A/P13. Parallel:local panel composition after contracts. Size:M.

- [ ] Add runBeaconTest/runLcpAnalysis/getScriptRuntimeStatuses (runtime list cap1000), owning validators. Beacon subclass overrides generated-before→false (no admin-ajax check), watchdog→safe finalize, finalize cancel-only, save→resolve validated results. No host gate attributes, DB POST or console narration. init→outer15s guard returns timeout+partial results; page-scrolled/screen-size bail explicit, not silent empty success. At-least-one option reason preserved with copy discipline.
- [ ] One buffered LCP observer→compute→disconnect. Safe element descriptor tag/id/limited classes/source, never outerHTML. Optional highlight session-only/defaultoff,5s and invalidation cleanup restores exact original style; current tokens/isolation bar wins over source hardcoded lime. Record intentional visual delta.
- [ ] Runtime read on demand/live DOM, no snapshot mutation; cancellation/disposal/rejections handled. Shared strip calls same executors/config; typed unsupported when entry type absent.

DoD: fake-module integration proves per-instance overrides/no writes, watchdog+outer timeout/partial, observer cleanup/highlight restore, runtime refresh and hostile boundaries.

### P14C — Surfaces

Depends:B/P5/P6/P12. Parallel:— shared routes/strip owned serially. Size:M; split by page if review grows.

- [ ] Registry Beacon test form native feature names (ATF/LRC internals not invented on-screen abbreviations), thresholds/selectors/mobile, same P13 async state pattern; ATF src/type/label table+LRC list search/virtualization.
- [ ] Performance/LCP route candidates/four parts/total/current-visit CWV, explicit unsupported, opt-in cleaned highlight. Registry/tab design decided locally with shared primitives, no extra modal form on host.
- [ ] JavaScript **Runtime states** section: executed/failed/pending/not-delayed filters + Theme/Plugins/Inline/Other groups, id/source/classes/preview/full detail. Label **Live DOM state (not the snapshot passed to detection)**; rerun after interaction reflects real state.
- [ ] Strip tool outcomes banner/configure-first hints, no host dumps. No tool-specific copy of P13 config/parser/state machinery.

DoD: component/state/filter/accessibility tests, UI bar §D/budgets, actual lazy bundle+network receipt.

## P14.1 — Browser acceptance

Depends:A–C/P4.1/P4.2/P13; parallelP14.5 technical decision work, not closure override. Size:M.

- [ ] Network no beacon bytes before run, on-run lazy load; no real generated-before/save POST. Pre/post gate DOM **no new beacon-completed**, no harness logs; with/without gate, empty/timeout/bail/config errors.
- [ ] LCP golden/live parts/candidates, optional highlight applied→exact restored5s/invalidation; per-metric unsupported/reducer states. Source same-page comparison counts/depth differences explicit, not all values forced equal across timing-varying visits.
- [ ] Real delayed fixture pending→interaction→executed/failed ground truth, rerun; Other/structured data/groups retained.
- [ ] Chromium keyboard/axe/themes/motion, chunk/perf budgets; Firefox actual supported-entry outcome/beacon lazy loading/runtime manual. Never call build-only evidence runtime.

DoD: local suites green, all parent acceptance annotated, real second-baseline/service depth judgment recorded; new dependency+adapter/permission rationale/layout in AGENTS, README rationale, index status. P14.5 viewer/metrics are later extensions, not second implementations.
