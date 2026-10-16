# Firefox runtime parity

## TLDR

**Open workstream, not optional SBS phase P17.** Firefox154 temporary-install probe confirmed sync storage needs stable add-on ID, MV2 badge namespace is browserAction, and failed appearance read can abort every injected mount. Panel failure cause still needs real DevTools capture. No execution receipts were present in the original plan.

Current code rechecked during consolidation: wxt.config.ts has Firefox-only **floor150.0**, **no gecko.id**; badge still action-only; injected appearance read still unsubscribes/rethrows. Thus do not retain old proposed128 floor as current configuration or call these fixes shipped. Stack installed WXT/TS/Vitest/web-ext, no new dependency. Chromium must not regress.

## Evidence and strict gate

2026-10-13 Firefox154 temporary MV2 scratch probe: sync get rejects without ID/works with; local works; action absent/browserAction methods present; DNR absent **without permission**, present with declared WithHostAccess. Callback tab send/async response/handler-error envelopes/no-receiver classification/2MB response worked. MAIN world supported since128 (API capability floor, **not current owner floor150**). DevTools-context panel flight was not proven by that scratch probe.

Chromium requirements: manifest byte-identical to pre-work build; action path chosen first; successful palette-read arm-first/racing-write/disposer behavior unchanged; messaging additive with existing tests unchanged; bundle ceilings and full e2e green with no weakened rows. Failure on any rejects Firefox change, not a tradeoff.

## Small phases

- **F0 capture:** deps—; parallelF1–F3. Load current Firefox build, Browser Console panel Page-data request failed **cause**, Firefox version and tab's processed-data evidence. DoD: exact cause or documented unsettled flight. No warn→DevTools transport probe, known missing receiver text→classification case, other fault→named boundary fix. Don't guess validator/transport blame.
- **F1 identity:** deps—; parallelF0/F2/F3. Owner selects stable GUID/id@domain (old proposal wpr-front-debugging-tool@wp-media.com **not approved/installed**); Firefox-only manifest hook, retain150 floor, warn identity changes affect sync/AMO. DoD: emitted ID/floor, Chromium manifest pre/post byte-diff clean, common gates. Data-collection permissions required for newer AMO submissions remains release gate, not fixed by ID.
- **F2 badge:** deps—; parallelF0/F1/F3. Small structural API resolve action first→browserAction, actionable missing-both init failure; pure badge machine unchanged. DoD: action-only/browserAction-only/neither test shapes, Chromium writes identical, gates.
- **F3 palette failure:** deps—; parallelF0–F2. Rejected initial read degrades to owner FALLBACK System, warns once, **keeps watcher armed** so later write works; preserve write-wins-read race/success/disposer semantics. DoD: sabotaged source still mounts every UI, later write/live follow, no escaped rejection, existing success tests unchanged.
- **F4 panel:** depsF0 (+F1 if causal); parallel—last code change. Captured missing pattern→single no-receiver registry+regression; actual failure→owning boundary; never-settled DevTools context→probe sender edge before fixing. No library fork/validator relaxation. DoD: Docker+public site real Firefox panel loads, standalone/no-CS retains correct recovery, Chromium messaging green.
- **F5 matrix/docs:** depsF1–F4; parallel—. Chromium proof **first**, then installed Firefox: cached/absent badge; SBS/sync; PSI mount; KC scan; real panel/data/live cross-surface theme; permission-gated mobile rule/identity/viewport; desktop width; MAIN undefined capture. Record per row pass/fail/cause/version, not just build. DoD: all gates/both builds/web-ext checks, README real deltas, current receipts here.

## Limits/decisions to retain

Temporary add-on identity must be stable; don't silently change existing users' sync identity. Missing-flight timeout is **not preauthorized** unless F0 shows actual hang; transport fix first, separate bounded-timeout proposal. chrome-global library primitives worked in Firefox MV2, not proof every DevTools-context behavior works. Native scrollbar autohide remains an explicit secondary limit from [UI acceptance](./completed-ui-acceptance.md), not solved by these fixes. No Firefox runtime completion claimed by consolidation.
