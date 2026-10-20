# P10: Exclusion Builder — in-page overlay, interception-based (re-plan)

## TLDR

Full re-think of the parked design, agreed with the owner 2026-10-20. The old flow (separate unlisted page + file pick/rewrite + Chrome overrides to load edited HTML) is **superseded** — too many steps, unused in practice. New shape: the builder lives as a **shadow-isolated overlay injected into the inspected page** (same machinery as the on-page strip), the user picks scripts/elements and composes exclusions in place, then clicks **Apply**: the page reloads and the extension **rewrites the served HTML in flight before parse/render**, so the render is a real page with the exclusions applied. Backends per browser — Chromium: `chrome.debugger` + CDP `Fetch` (response-stage intercept → transform → fulfill); Firefox: `webRequest.filterResponseData` streaming rewrite. When interception is impossible (DevTools open on the tab on Chromium), the surface **degrades explicitly** (mode indicator; optional simulation mode — decision gate G-3). All http(s) hosts are already host permissions (`URL_PATTERNS`); Chromium needs the new `debugger` permission (Chromium manifest only, gated on spike + owner acceptance G-2). Implementation **starts only after G-1** (owner approval of this plan). Technically parallel with P11 (disjoint modules; additive contract rows only).

**Shared session surface (owner mandate 2026-10-20):** the overlay is a **tool shell on one in-page session**, and the interception backend exposes a **transform-pipeline seam** — P10 ships the shell + Exclusions mode; the inspector-baseline testers (RUCSS test, beacon/LCP test, live script/LCP views) plug into the same shell/session per their owning phases P13/P14, improved per the owner mandate ("target to improve them all" — code/UI/UX). Their implementations, contracts, and gates stay in P13/P14; P10 owns only the shell, the session lifecycle, and the pipeline seam.

## Decision gates (G-*, not to be confused with the UI bar's §D receipt ids)

- **G-1 (owner, blocks implementation): APPROVED 2026-10-20** — replan approved (in-page overlay surface, per-browser interception backends, phased order), with two owner amendments:
  1. **The panel's "Open Exclusion Builder" command-palette row must be removed** (it opens the old unlisted page; from a devtools-attached panel a `chrome.debugger` build can never attach that tab — structurally wrong once the builder is the in-page overlay). Removal lands at P10G's surfaces integration, together with retiring the old unlisted `exclusion-builder.html` entrypoint; the **context-menu** "Exclusion Builder" entry stays and re-points to the in-page overlay.
  2. **DevTools-open must be managed explicitly at apply time**: P10D resolves the mode by _attempting_ the attach (per-browser reality decides, not an assumption — the spike found attach succeeding with DevTools open on CFT 156, pending stable-Chrome confirmation), and every outcome (interception armed / degraded to G-3 fallback / blocked) is surfaced honestly in the overlay indicator and the panel status row.
- **G-2 (owner): ACCEPTED 2026-10-20, conditional on store review** — owner accepts both warnings provided store approval is not blocked. Policy status: the `debugger` permission is store-legal (no policy prohibition), but it puts the submission under deeper review (justification/review notes, possible longer review; the broad-data warning is already shown by the existing all-hosts permissions). If store review ever blocks it, the fallback decision is split distribution (store build without interception, self-distributed build with it) — revisit only if it happens.
- **G-3 (owner, by P10F): PENDING** — simulation-fallback scope when interception is unavailable — (a) DNR session rules for URL-pattern exclusions only, honest notice for attribute-level ops (recommended), (b) full DOM-hook simulation, or (c) no fallback — "close DevTools to apply" message only.
- **G-4 (owner): APPROVED 2026-10-20** — keep the source's three feature-wide disable toggles (Delay JS / Defer JS / Automatic Lazy Rendering; no Lazyload toggle).
- **G-5 (owner): APPROVED 2026-10-20** — the applied rewrite persists across navigations in the tab until **Stop** or tab close; cleanup contract: Stop, tab close, or extension reload restores unmodified rendering.

## Verified feasibility (2026-10-20)

| Mechanism                                                                                           | Rewrites response body before parse?             | Chromium                                                                 | Firefox                                          |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------ |
| `webRequest.filterResponseData`                                                                     | Yes (streaming transform)                        | API does not exist                                                       | ✅ with existing `webRequest` + host permissions |
| `chrome.debugger` + CDP `Fetch` (`requestStage: "Response"` → `getResponseBody` → `fulfillRequest`) | Yes (fulfilled navigation)                       | ✅ needs `debugger` permission; conflicts with open DevTools on that tab | n/a (FF uses the row above)                      |
| `declarativeNetRequest` session rules                                                               | No (block/redirect/headers only)                 | ✅ permission already held                                               | ✅                                               |
| Content script at `document_start`                                                                  | No raw-stream access; runtime approximation only | ✅                                                                       | ✅                                               |

Grounded in this repo: `declarativeNetRequestWithHostAccess` and `webRequest` already in `wxt.config.ts`; `URL_PATTERNS = ['https://*/*','http://*/*']` already in host permissions; typed storage precedent `lib/storage/*.ts`; injected-UI precedent `entrypoints/isolated.content/ui/mount.ts` (shadow mount/teardown), `live-theme.ts`, `focus.ts`; typed message registry `lib/messaging/protocol.ts`. **Not yet verified — spike P10A:** exact CDP attach failure mode with DevTools open; `chrome.debugger` coexistence with Playwright's CDP (decides P10.1 scope); Firefox MV3 event-page `filterResponseData` availability/wake behavior; `debugger` install-warning text.

## Behavioral reference for the engine (source-inventoried, unchanged ownership)

Operations transform **WP Rocket's served HTML** (un-optimization): applying exclusion X simulates "X were configured" by reversing its served effect.

- **Delay JS:** matches whole delayed-script markup (both Delay types); restores `data-rocket-type`/`data-rocket-src` to a live script.
- **Defer JS:** matches effective URL (`data-rocket-src` or `src`); removes `data-rocket-defer` + `defer`.
- **Image Lazyload:** matches **literal substring** (not regex) on the clone with lazy src restored; restores `src`/`srcset`/`sizes`; `srcset`-only case in parity tests.
- **Automatic Lazy Rendering:** matches child-cleared outerHTML; removes `data-wpr-lazyrender`; feature-wide disable also removes the runner scripts and `rocket-lazyrender-inline-css`. **Correction 2026-10-20:** the "runner scripts" premise is retracted — a fresh read of the disable routine (utils.ts:318-326) plus a plugin-zip grep (2026-10-20) found no lazyrender runner-script asset; the disable removes the attribute and `rocket-lazyrender-inline-css` only.
- **Exclusion attribute accumulates CSV**; doctype serialization preserved; feature-wide disable toggles = the source's three (G-4).
- `data-rocket-status` stays a delayed-candidacy marker — snapshot-only evidence, inert for served HTML; kept for future-proofing (dispositioned 2026-10-20).
- Delay candidacy matches the delay-type vocabulary by substring, so `;charset=…`-suffixed type values match too, rather than the served exact-match selector — detection-vocabulary reuse, documented divergence (dispositioned 2026-10-20).
- Old **file-I/O surface dies with the flow** (disposition, incl. defect #35 error laundering/stream cleanup/working/external-edit loss): no file pick/read/working file — the engine input is the live served HTML; Reset = re-apply from the stored unmodified original; external edits don't exist. The old overwritten-page notice is superseded by the overlay's own applied-state indicator (byte-identical notice was never an approved mandate).

### What the session backend adds to each tester (P13/P14 own them)

Source v4.1.1 inventoried 2026-10-20 (`RUCSSTester.js`, `BeaconTester.js`, `inspector.js`). None of these needs the debugger today — they run post-render in the page. The P10 session makes each strictly better:

| Tool                              | Source behavior                                                                                                                            | Owning phase                                                                     | What the P10 session adds                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RUCSS tester                      | Strip `style`/`link[rel=stylesheet]` from the live page → POST to the endpoint → inject `shakedCSS` post-render (FOUC, ordering artifacts) | P13 (already: background-validated endpoint, fetch-before-strip, typed outcomes) | Optional **before-parse TEST MODE**: same strip/preserve/inject as pipeline transforms → the reloaded page renders with only used CSS from first paint — a render-faithful test. Owner-gated addition to P13. |
| Beacon tester (ATF/LRC)           | Real beacon, prototype-patched to suppress DB writes, results only to `console.table`                                                      | P14 (already: instance adapter, no writes, panel tables)                         | Run **inside an applied session** (exclusions and/or RUCSS-shaken CSS from the reload) — "does LCP/LRC pass under these exclusions" in one flow.                                                              |
| LCP viewer                        | PerformanceObserver + hardcoded lime border + sub-parts table to console                                                                   | P14 (already: cleaned highlight, panel breakdown)                                | Observes the session-rendered page; highlight uses tokens; session teardown restores.                                                                                                                         |
| Script listings (grouped/delayed) | `console.table` dumps, DOM expandos                                                                                                        | P14 runtime views (+P6 snapshot page)                                            | Feeds the overlay's **click-to-pick**: pick a delayed/deferred script → exclusion row candidate.                                                                                                              |

All four also inherit the shell's shared bar: pure logic in `lib/`, honest states (no console-only results), per-origin opt-in, token UI. Source quirks already dispositioned in P13/P14 (defaults lost on empty preserve input, `classList.remove` assignment typo, comma-join storage corruption, prototype patching, leaked observers) — not re-listed here.

## Architecture

- `lib/exclusion-builder/` — self-contained domain module: exclusion-set types, cached regex compilation, per-operation transforms, all-at-once prevalidation with inline invalid-pattern feedback, typed errors. Transforms compose into an ordered **pipeline** (`servedHtml + set → { html, report }` per transform; session = list of transforms + per-transform reports) — the seam P13's before-parse TEST MODE plugs into. No I/O, no DOM, no `browser.*`.
- `lib/storage/` — typed items (established pattern): per-origin exclusion sets + last-applied session state (inspector-origins vocabulary).
- `lib/messaging/` — additive channels: overlay↔background (session start/stop/apply/status), background→panel (builder-active push). Contracts validated at boundary.
- `entrypoints/background/` — interception backends (Chromium CDP session lifecycle; Firefox streaming listener), session state machine, DNR session rules for the simulation mode.
- `entrypoints/isolated.content/exclusion-builder/` — overlay wiring only: mount/teardown via the existing `ui/` machinery, click-to-pick, renders from store.
- Dependency direction and thin-entrypoint rules unchanged. Removing the feature = deleting the folder + its registry rows.

## Phases

### P10A — Spike: backends on the live docker site (no product code)

Depends:—. Parallel:P10B. Goal: turn every "not yet verified" above into recorded evidence before anything is built.

- [x] Chromium: `chrome.debugger` attach while DevTools is open (exact error/detach behavior); attach → `Fetch.enable` (Document/Response) → reload docker page → `getResponseBody` → engine-shaped transform → `fulfillRequest` → verify the render used the modified HTML; `onDetach` arms.
  - [ ] Infobar wording/persistence while the debugger is attached — manual (no GUI automation this session): `node .scratch/p10a-chromium/harness.mjs headed` (auto-attach, holds) → a human reads the infobar wording, reloads, re-reads for persistence; trigger-file procedure in the manual-remainder evidence line below.
- [x] Chromium: `chrome.debugger` from a Playwright-loaded extension while Playwright drives the browser (coexist or conflict — decides P10.1's interception arms).
- [x] `debugger` permission install-time warning text (for G-2).
- [x] Firefox: `filterResponseData` in the MV3 event page — streaming rewrite end-to-end on `pnpm dev:firefox` + docker site; event-page wake re-registration; error/cleanup contract (transformer `close`/`error` exactly once).
- [x] Composed pipeline in one session (exclusion transform + a fixture strip/inject transform) — mechanics only, fixture CSS; the RUCSS endpoint itself stays P13's validation.
- [x] Record all evidence in this doc with dates; flag any finding that invalidates a design choice instead of working around it silently.

DoD: evidence recorded; G-2 inputs ready; no product-code change — spike code lives in a disposable scratch build (never `entrypoints/` product tree, never merged). Effort M · difficulty medium.

#### P10A evidence (2026-10-20)

Environment: Chromium for Testing 156.0.8078.4 (Playwright 1.64.1, `channel: 'chromium'`, persistent context); real Firefox 158.0 (release, macOS) via `npx web-ext run` (web-ext 10.8.0, temp profile, temporary add-on); docker site `http://127.0.0.1:8493` up throughout; scratch code in `.scratch/p10a-chromium/` + `.scratch/p10a-firefox{,-mv2}/` (untracked, never merged). All evidence lines = command → observation.

- **Chromium CDP end-to-end (headless)**: attach → `Fetch.enable` (`urlPattern '*'`, `Document`, Response stage) → reload `/fdt/` → `requestPaused` (Document) 88 ms after the armed reload → `getResponseBody` (base64, 67 394 bytes) → two-transform pipeline → `fulfillRequest` (200, original headers minus `content-encoding`/`content-length`, 67 512 bytes out) → `Fetch.disable` → detach, 143 ms attach→detach total → page asserts: marker comment + second-transform comment in the rendered DOM, `#p10a-fixture` text = post-pipeline CSS, computed `--p10a-stage: t2` — the render used the fulfilled HTML.
- **Self-detach vs `onDetach`**: `chrome.debugger.detach()` does **not** fire `onDetach` (evidence log: `session-end-self-detach` with no `onDetach-external` after it).
- **Playwright coexistence (arm 3)**: with Playwright driving the persistent context, `chrome.debugger.attach` succeeded; after the attach/detach probe Playwright still drove the tab (reload + evaluate). The whole intercept ran under Playwright (the fulfilled navigation was the extension's own `chrome.tabs.reload` — Playwright kept driving the tab and never navigated it) → P10.1 can include interception arms.
- **DevTools open BEFORE attach (headed, real DevTools window via `--auto-open-devtools-for-tabs`)**: attach **succeeded** (no error), and the full pause → pipeline → fulfill → clean detach ran → **no attach conflict on this Chromium build** (multi-client CDP). See findings.
- **Reverse-order probe (headless approximation for "DevTools opened after attach")**: extension session armed (`Fetch.enable` held), then a second debugger client (Playwright `newCDPSession` + `Debugger.enable`): no `onDetach`, and the extension's Fetch interception still fulfilled a later reload. Mechanism-class evidence only; a real DevTools window was not drivable (below).
- **Manual remainder (arm 2b + infobar text)**: this session had no GUI automation — orca computer-use denied at every accessibility call (permissions endpoint reported granted; helper relaunch did not help), `osascript` keystrokes denied ("not allowed to send keystrokes"), `screencapture` captured wallpaper only (no Screen Recording for window pixels). Manual steps: `node .scratch/p10a-chromium/harness.mjs headed` (opens a headed window, auto-attaches, holds) → a human reads the infobar text; Cmd+Option+I (DevTools) while attached → `touch .scratch/p10a-chromium/TRIGGER-EVIDENCE.0` dumps the `onDetach` reason; `touch TRIGGER-ATTACH` then exercises attach-while-DevTools-open; `touch TRIGGER-STOP` closes.
- **`debugger` install-time warning (arm 4)**: developer.chrome.com/docs/extensions/reference/permissions-list (fetched 2026-10-20; page updated 2026-09-09), `"debugger"`: _"Access the page debugger backend."_ and _"Read and change all your data on all websites."_ Unpacked/local installs may not surface store-style warnings.
- **Firefox `filterResponseData` (arm 5)**: MV3 event page, `webRequest` + `webRequestBlocking` + `webRequestFilterResponse` (MDN: MV3 needs the latter from FF 110) + host permission; streaming rewrite on main_frame Document (2 chunks buffered → transform → `write` once → `close` exactly once) → content-script readbacks: marker comment in DOM, fixture style present, computed `--p10a-stage: ffx` on every intercepted load (8 tabs, readback cycles 1–4 incl. +60 s reloads); **zero** `onerror` over the whole run.
- **Firefox event-page suspend/wake observed**: `event-page-evaluated` re-fires 51.7–64.3 s apart — the event page is torn down and re-evaluated, listeners re-register on wake without any manual reload; `runtime.onSuspend` never reported (absent or silent). Every **navigation-woken** evaluation (6/6) intercepted the waking main_frame **at wake** — `stream-rewritten` 20–28 ms after `event-page-evaluated` (entry timestamps), marker+fixture confirmed by that load's readback. The hazards observed are elsewhere: (a) the **install/first-load race** — only the pre-install first load rendered unmodified (`cycle:1, markerComment:false`); (b) **navigation-less wakes** — 1 of 7 wakes fired with no navigation in flight and intercepted nothing until the next load. Every +3 s rewrite was the scratch's `startup-open` tab-creation arm (`startup-reload` fired 0 times — finding 2); 8 tabs, readback cycles 1–4. → P10E: re-register listeners on wake; verify first-navigation coverage during P10E.
- **MV2 discriminating arm re-run (2026-10-20, bounded `web-ext run --arg=-headless`, Firefox 158.0, web-ext 10.8.0, docker site)**: MV2 persistent background — `filterResponseData` streaming rewrite end-to-end (2 chunks → `write` once → `close` once, `markerApplied:true`, readback `stageVar:ffx` cycles 1–3 across 2 tabs incl. +60 s reloads; zero `stream-error`); port-pattern silence reproduced (finding 2). The retained MV2 `evidence.log` was a byte-copy of MV3-era heartbeat lines in the old collector format (deleted 2026-10-20) — MV2 conclusions rest on this fresh run.
- **Composed pipeline (arm 6)**: two transforms in one CDP session — T1 (marker + fixture `<style>`) then T2 (rewrote T1's style body + second marker); T2 saw T1's output; computed var = t2. Scratch note: a stray `;` between the two CSS rules invalidated the second rule (real CSS error recovery; first run computed `t1`) — transforms authoring must not join rules with stray separators.
- One-off flake (recorded, not a design fact): the first headed Chromium launch timed out waiting for the extension service worker (45 s); a fresh-profile relaunch connected instantly.

#### P10A findings (design-impacting, flagged 2026-10-20)

1. **Challenges the "DevTools-open ⇒ interception impossible" premise (feeds G-3)**: on Chromium for Testing 156, `chrome.debugger` attach + full CDP intercept succeed **with a real DevTools window open on the tab** (multi-client CDP; both orders probed — DevTools-first attach attempt and second-client-attach-while-armed). The feasibility table's conflict row and the mode-resolution rule ("DevTools open → degrade") must be re-verified on stable Chrome with real user interaction (manual remainder above) before P10D bakes the degradation in; the seam stays, the trigger condition may not.
2. **Firefox match patterns with an explicit port silently never match** (Firefox 158; MDN Match patterns, fetched 2026-10-20: _"Firefox doesn't support the inclusion of a port number"_ — bugs 1362809, 1468162 — and _"Ports are supported in Chrome, not in Firefox."_): `http://127.0.0.1:8493/*` delivered **zero** webRequest events and zero content-script injections — and the failure is not webRequest-specific. MV3 run: the port pattern matched **zero** of the 7–8 open `http://127.0.0.1:8493/fdt/` tabs in `tabs.query` at every wake (`startup-open` ×7, snapshot tab count 2→8) and `permissions.contains` returned `granted:false` 7/7; MV2 re-run (2026-10-20): port-pattern `tabs.query` again found 0 of 2 open fdt tabs (`startup-open` duplicated the tab) while `permissions.contains` returned `granted:true` (MV2 `<all_urls>` leniency, not pattern matching). Port-less `http://127.0.0.1/*` matches the ported URL everywhere; `<all_urls>` also works. Consequence for P10E: the repo's port-less `URL_PATTERNS` are safe, but **all** builder-composed patterns consumed by match-pattern-style APIs on Firefox (webRequest, content scripts, `tabs`, `permissions`, …) must strip the port. Evidence trail: narrow-pattern runs silent → `<all_urls>` runs flow → port-less narrow runs flow.
3. **Playwright coexistence verified (feeds P10.1)** — interception arms belong in the browser suite; no "manual-only" carve-out needed for Chromium.
4. **G-2 input ready**: the two `debugger` warnings above (owner acceptance decision).
5. web-ext operational notes (spike-only): the file watcher reloads the add-on when a log lands inside the source dir (churn loop); `--url` navigates before the temporary install completes, so the extension misses the first load (the scratch's +3 s bootstrap re-drove the site; it ran as `startup-open` tab creation — finding 2).

### P10B — Pure engine (`lib/exclusion-builder/`)

Depends:—. Parallel:P10A/P10C. Goal: the whole transformation vocabulary pure, typed, fully unit-tested.

- [x] Exclusion-set types per feature (patterns + literal rows + disable toggles), one declaring site; cached compiled matchers; all-at-once prevalidation naming the invalid row/line; typed errors (`@throws`).
- [x] The four operations above as pure transforms composing into the pipeline (order declared once; combined per-transform reports feed UI/status); doctype and CSV behaviors pinned. A second fixture transform proves composition mechanics without importing P13.
- [x] Full unit matrix: source inventory cases + adversarial fixtures (nested/duplicate tags, minified single-line HTML, charset-neutral byte handling — operate on strings only after decode is owned by the backend, never here), each operation's negative/empty/no-match arms.
- [x] **Test-first** per AGENTS; no consumer wiring in this phase.

DoD: engine green with the full matrix; consumers untouched. Effort L · difficulty medium.

#### P10B receipt (2026-10-20)

Implemented `9c93263`, adversarially audited (1 BLOCKER + 6 MAJOR + 10 MINOR + 3 NOTE, all legacy/spec-verified with citations), fixed `30a459f`, merged `814c216`. `lib/exclusion-builder/`: 11 modules (set/errors/validate/compile/html-scan/tag-edit/report/delay-js/defer-js/lazyload/lazy-render + pipeline) + 11 colocated test files. Audit outcome: ALR rows are **literal** (B1), scanner matched to WHATWG §13.2.5 raw-text/comment closers (M1/M2), feature-wide Delay JS removes the three controller scripts (M3), lazyload candidacy/clone per legacy (M4), ALR disable = attributes + inline CSS only — the plan's runner-script premise retracted (M5, correction above), wall-time contract recorded for P10D/P10E (M6), pipeline order Delay→Defer→ALR→Lazyload, CSV `, ` separator, all 10 minors fixed. 3151 tests / 200 files green; module coverage 99.2% stmts; `build`+`check:budgets` green (no consumers, no bundle shift). No consumer wiring — imports of `lib/exclusion-builder/` exist only in tests.

### P10C — Contracts: storage + messaging

Depends:P10B (types). Parallel:P10A. Goal: typed, additive, validated seams.

- [ ] `lib/storage/` items (per the established precedent): per-origin exclusion sets + last-applied session state in the **`local:`** area (per-origin, never synced — support-site data stays on the machine), tolerant read-back of unknown fields; corrupt/absent handling per storage conventions.
- [ ] `lib/messaging/` channels with payload bounds/validation: overlay↔background session lifecycle + status; background→panel builder-active push. Sender-resolved tab IDs; no-receiver/timeout arms typed.
- [ ] Unit tests at each boundary (validate + fuzz precedents).

DoD: contracts green, additive only, zero consumers beyond tests. Effort S · difficulty easy.

### P10D — Chromium interception backend

Depends:P10A+C. Parallel:P10E. Goal: a reliable, fully failure-aware CDP session in the background.

- [ ] `debugger` permission added (Chromium manifest only, `wxt.config.ts` comment: why + G-2 receipt; Firefox build unchanged).
- [ ] Session state machine: attach → `Fetch.enable` (Document/Response) → reload/fulfill transform via engine → detach (or persist per G-5); every step's failure arm typed and surfaced (attach denied/target gone/no receiver); `onDetach` (DevTools opened, user Cancel on the infobar, navigation, crash) stops cleanly, never retries against a dead context. The engine apply runs under a wall-time budget; an overrun is a typed session failure naming the offending feature/row — never a hung navigation.
- [ ] Fidelity on fulfill: preserve the response's charset (`getResponseBody` base64 → decode with the original encoding → transform → encode back; `Content-Type`/headers passed through) — a wrong-charset fulfill corrupts the render.
- [ ] Mode resolution: mode decided at apply time by attempting the attach (G-1 amendment 2 — never assumed): armed → intercept; unavailable → G-3 behavior; every outcome in the overlay indicator + panel status row (W-1, never color-only).
- [ ] Unit tests for the state machine with injected command ports; manual runtime evidence on the docker site.

DoD: apply-and-render works end-to-end on Chromium with DevTools closed; every failure arm observed and handled; charset round-trip proven; no silent failures. Effort M · difficulty hard.

### P10E — Firefox streaming backend

Depends:P10A+C. Parallel:P10D. Goal: `filterResponseData` rewrite with the same engine and the same session semantics.

- [ ] Streaming transformer: buffer bounded, transform once, close/error exactly once (old stream-cleanup defect class explicitly closed); request filter = main frame, host patterns reused; charset/headers untouched (transform operates on the decoded stream per Firefox's TextDecoderStream contract, re-encoded on output). The engine apply runs under a wall-time budget; an overrun is a typed session failure naming the offending feature/row — never a hung navigation.
- [ ] Listener registration on event-page wake; session persistence per G-5 (active-session flag consulted per navigation, detached observers/rules cleaned up on Stop/tab close); applied-state persisted for the reload's overlay.
- [ ] Unit tests with injected stream shims; manual runtime evidence on the docker Firefox build.

DoD: parity apply on Firefox; cleanup contract proven; `pnpm build:firefox` green. Effort M · difficulty medium.

### P10F — Overlay UI in the inspected page

Depends:P10B+C (+G-3/G-4 decisions). Parallel:P10D/P10E wiring-free parts. Goal: the whole builder UX, shadow-isolated, per the UI bar.

- [ ] `entrypoints/isolated.content/exclusion-builder/`: mount/teardown via existing `ui/` machinery; tokens + live theme; top frame only; z-index/cleanup contract for hostile pages.
- [ ] Editor: per-feature pattern/literal rows with inline validation, disable toggles (G-4), counts from the engine report; virtualized when >100 rows (P-2).
- [ ] Click-to-pick: pick a script/element in the real page → candidate exclusion row (Delay/Defer/Lazyload/ALR lane per target); Esc cancels; works over SPAs (observer cleanup).
- [ ] State matrix (S-1): loading, error + retry, feature absent, empty, populated, applied-active, applied-with-no-match warnings; mode indicator (interception vs G-3 fallback) never color-only (K-5).
- [ ] Apply/Reset/Stop controls: Apply → session start; Reset → re-apply from stored original; Stop → detach + restore original on next reload; every control keyboard-complete (K-1/K-2).
- [ ] UI bar §D receipts (D-1..D-7) in this doc.

DoD: full editor + states green in isolation (engine + contracts injected), bar receipts recorded. Effort L · difficulty hard.

### P10G — Chromium apply wiring + surfaces integration

Depends:P10D+F. Parallel:—. Goal: the agreed flow live end-to-end.

- [ ] Overlay Apply → background session → reload → fulfilled render → overlay re-injects at `document_start` and shows applied state (from persisted session state, not heuristics).
- [ ] Shell mode registry: Exclusions mode (P10) plus the plug-in seam for P13/P14 tool modes (config + results panels); no second editor surface per tool.
- [ ] Mode matrix wired: DevTools closed → interception; open → G-3 behavior; indicator + honest words (W-1); session persistence per G-5 reflected in the active-state indicator.
- [ ] DevTools panel: builder entry/status row (link + active state via push channel); context-menu "Exclusion Builder" item opens the overlay (re-points the existing `contextMenus` consumer comment). **Remove the panel command-palette "Open Exclusion Builder" row** (`entrypoints/panel/palette/actions.ts` + `palette/exclusion-builder.ts`) and retire the old unlisted `exclusion-builder.html` entrypoint + its budgets row (G-1 amendment 1) — from a devtools-attached panel the overlay is the only correct surface; no second editor surface.
- [ ] E2E-adjacent manual receipts on the docker site; budgets: content-script + background deltas receipted.

DoD: owner flow "pick → apply → reload → real render with exclusions" works on Chromium; statuses honest in every mode. Effort M · difficulty medium.

### P10H — Firefox wiring + simulation fallback (G-3)

Depends:P10E+F, G for the shared wiring shape. Parallel:—.

- [ ] Firefox apply flow end-to-end; streaming backend's applied-state surfaced in the same overlay contract.
- [ ] G-3 outcome implemented at the P10D seam: DNR session rules for URL-pattern rows (+ honest notice for attribute-level ops), or the chosen fallback; rules cleaned up on Stop/detach/session end.
- [ ] Cross-browser receipt: same exclusion set, both engines, same engine report.

DoD: Firefox parity + fallback per G-3; no Chromium regression. Effort M · difficulty medium.

### P10.1 — Browser suites (this file, local tier)

Depends:P10G(+P10H); P4.1 harness. Scope shaped by P10A's Playwright-coexistence finding:

- [ ] Overlay editor suites: compose/validate/counts, pick flows, state matrix arms, Stop/Reset, mode indicator (backend stubbed at the message seam).
- [ ] If CDP coexists: one interception arm asserting the fulfilled document applied the engine transform; else interception stays manual-evidenced and the suite covers everything around it — the gap stated, never hidden.
- [ ] Keyboard/axe (D-3/D-4), width matrix (D-1), reduced motion (D-2); Firefox arms manual per harness rules unless re-verified.

DoD: suites green with the tier; suite scope vs manual evidence recorded. Effort M · difficulty medium.

### P10J — Gates, budgets, docs

Depends:all above. Parallel:—.

- [ ] Full gates: `pnpm compile && pnpm lint && pnpm format:check && pnpm test`; `pnpm build` (+ `:firefox`) and `pnpm check:budgets` with new rows/receipted deltas.
- [ ] AGENTS.md: `debugger` permission (why + warning), new lib module, any new script; runbook rows (apply modes, DevTools interplay, Reset semantics); README active-work line closed with receipts; master train slot confirmed by owner.
- [ ] Every G-gate receipted; every behavior delta vs the source inventory dispositioned with evidence.

DoD: all gates green, docs current, P10 closable pending owner live-check. Effort S · difficulty easy.

## Non-goals

- No file-import/export flow (superseded); no byte-identical old-notice mandate; no DOM-hook full simulation unless G-3 chooses it; no page-load performance instrumentation (P14's domain); no exclusion _recommendations_ engine (P6's copy-as-exclusion vocabulary remains the generator); no i18n; no new dependency; no POST-navigation applies (the apply targets a GET reload; POST endpoints out of scope).
- RUCSS tester, beacon/LCP, and script-runtime implementations stay in P13/P14 — P10 ships only the shell, session lifecycle, and pipeline seam (no tester config/results UI here).
