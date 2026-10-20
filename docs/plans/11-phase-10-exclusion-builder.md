# P10: Exclusion Builder — in-page overlay, interception-based (re-plan)

## TLDR

Full re-think of the parked design, agreed with the owner 2026-10-20. The old flow (separate unlisted page + file pick/rewrite + Chrome overrides to load edited HTML) is **superseded** — too many steps, unused in practice. New shape: the builder lives as a **shadow-isolated overlay injected into the inspected page** (same machinery as the on-page strip), the user picks scripts/elements and composes exclusions in place, then clicks **Apply**: the page reloads and the extension **rewrites the served HTML in flight before parse/render**, so the render is a real page with the exclusions applied. Backends per browser — Chromium: `chrome.debugger` + CDP `Fetch` (response-stage intercept → transform → fulfill); Firefox: `webRequest.filterResponseData` streaming rewrite. When interception is unavailable, there is **no fallback** — a first-class warning state names the cause and remedy (G-3, decided 2026-10-20). All http(s) hosts are already host permissions (`URL_PATTERNS`); Chromium needs the new `debugger` permission (Chromium manifest only, gated on spike + owner acceptance G-2). Implementation **starts only after G-1** (owner approval of this plan). Technically parallel with P11 (disjoint modules; additive contract rows only).

**Shared session surface (owner mandate 2026-10-20):** the overlay is a **tool shell on one in-page session**, and the interception backend exposes a **transform-pipeline seam** — P10 ships the shell + Exclusions mode; the inspector-baseline testers (RUCSS test, beacon/LCP test, live script/LCP views) plug into the same shell/session per their owning phases P13/P14, improved per the owner mandate ("target to improve them all" — code/UI/UX). Their implementations, contracts, and gates stay in P13/P14; P10 owns only the shell, the session lifecycle, and the pipeline seam.

## Decision gates (G-*, not to be confused with the UI bar's §D receipt ids)

- **G-1 (owner, blocks implementation): APPROVED 2026-10-20** — replan approved (in-page overlay surface, per-browser interception backends, phased order), with two owner amendments:
  1. **The panel's "Open Exclusion Builder" command-palette row must be removed** (it opens the old unlisted page; from a devtools-attached panel a `chrome.debugger` build can never attach that tab — structurally wrong once the builder is the in-page overlay). Removal lands at P10G's surfaces integration, together with retiring the old unlisted `exclusion-builder.html` entrypoint; the **context-menu** "Exclusion Builder" entry stays and re-points to the in-page overlay.
  2. **DevTools-open must be managed explicitly at apply time**: P10D resolves the mode by _attempting_ the attach (per-browser reality decides, not an assumption — the spike found attach succeeding with DevTools open on CFT 156, pending stable-Chrome confirmation), and every outcome (interception armed / the G-3 warning state) is surfaced honestly in the overlay indicator and the panel status row.
- **G-2 (owner): ACCEPTED 2026-10-20, conditional on store review** — owner accepts both warnings provided store approval is not blocked. Policy status: the `debugger` permission is store-legal (no policy prohibition), but it puts the submission under deeper review (justification/review notes, possible longer review; the broad-data warning is already shown by the existing all-hosts permissions). If store review ever blocks it, the fallback decision is split distribution (store build without interception, self-distributed build with it) — revisit only if it happens.
- **G-3 (owner): DECIDED 2026-10-20 — no fallback, no simulation.** When interception is unavailable, Apply does nothing destructive: the overlay shows a first-class warning state naming the cause (attach denied / debugging policy / cancelled infobar / no support on this page) and the remedy, with Retry where the cause is transient — never a dead end (UX-D9), never a silent no-op. No DNR simulation, no DOM-hook simulation. Rarity rationale: the spike found interception available even with DevTools open (CFT 156); the realistic unavailable paths are managed-browser policy and a cancelled infobar — a clear warning beats building an approximate mode.
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
- `lib/storage/` — typed items (established pattern): per-origin exclusion sets (`local:`) + per-tab session records (`session:`, see P10C receipt).
- `lib/messaging/` — additive channels: overlay↔background (session start/stop/apply/status), background→panel (builder-active push). Contracts validated at boundary.
- `entrypoints/background/` — interception backends (Chromium CDP session lifecycle; Firefox streaming listener) + session state machine. (No DNR simulation — G-3 decision 2026-10-20.)
- `entrypoints/isolated.content/exclusion-builder/` — overlay wiring only: mount/teardown via the existing `ui/` machinery, click-to-pick, renders from store.
- Dependency direction and thin-entrypoint rules unchanged. Removing the feature = deleting the folder + its registry rows.

## Phases

### P10A — Spike: backends on the live docker site (no product code)

Depends:—. Parallel:P10B. Goal: turn every "not yet verified" above into recorded evidence before anything is built.

- [x] Chromium: `chrome.debugger` attach while DevTools is open (exact error/detach behavior); attach → `Fetch.enable` (Document/Response) → reload docker page → `getResponseBody` → engine-shaped transform → `fulfillRequest` → verify the render used the modified HTML; `onDetach` arms.
  - [x] Infobar wording while the debugger is attached (owner read, 2026-10-20, `headed --devtools-first` arm): `P10A CDP Spike comenzó a depurar este navegador` — Chrome's own localizeable template "«extension name» started debugging this browser"; the leading token is the attached build's manifest name, and the wording is Chrome UI copy that follows the browser's language (this macOS install renders Spanish off the system locale) — never extension-owned copy, so acceptance reads it as-is in the user's locale.
  - [ ] Infobar persistence across a reload while attached — still manual (reload, re-read; trigger-file procedure in the manual-remainder evidence line below).
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
- **Manual remainder (arm 2b + infobar text)**: this session had no GUI automation — orca computer-use denied at every accessibility call (permissions endpoint reported granted; helper relaunch did not help), `osascript` keystrokes denied ("not allowed to send keystrokes"), `screencapture` captured wallpaper only (no Screen Recording for window pixels). Manual steps: `node .scratch/p10a-chromium/harness.mjs headed` (opens a headed window, auto-attaches, holds) → a human reads the infobar text; Cmd+Option+I (DevTools) while attached → `touch .scratch/p10a-chromium/TRIGGER-EVIDENCE.0` dumps the `onDetach` reason; `touch TRIGGER-ATTACH` then exercises attach-while-DevTools-open; `touch TRIGGER-STOP` closes. 2026-10-20: the 45 s service-worker flake (last bullet) reproduced on the owner's first headed launch — an unclean shutdown had left stale `Singleton*` locks in the persisted profile, and the next launch raced the dead process; the harness was hardened (fresh profile per run by default, `P10A_REUSE_PROFILE=1` to reuse; explicit service-worker kick through the extension's own page when the lazy MV3 worker defers; one automatic retry on a brand-new profile) — manual steps unchanged. 2026-10-20 (hold fix): the hold was not actually holding — the owner's window self-closed right after auto-attach because the harness never consumed its trigger files, so a leftover `TRIGGER-STOP` ended the hold on its first poll tick; the harness now sweeps stale triggers at hold start and consumes them on use, `headed`/`headed hold` is hold-by-default with the four manual steps printed in-window (instructions tab) + on the terminal (infobar wording stays a human-only read; programmatic attach-state transitions print live), and the DevTools-first case is the explicit invocation `node .scratch/p10a-chromium/harness.mjs headed --devtools-first` (`P10A_DEVTOOLS=1` still selects it). Verified 2026-10-20: e2e arm green; hold held with a planted stale `TRIGGER-STOP` (swept at arm), `TRIGGER-EVIDENCE.0` dump + `TRIGGER-STOP` end + Ctrl+C all clean.
- **`debugger` install-time warning (arm 4)**: developer.chrome.com/docs/extensions/reference/permissions-list (fetched 2026-10-20; page updated 2026-09-09), `"debugger"`: _"Access the page debugger backend."_ and _"Read and change all your data on all websites."_ Unpacked/local installs may not surface store-style warnings.
- **Firefox `filterResponseData` (arm 5)**: MV3 event page, `webRequest` + `webRequestBlocking` + `webRequestFilterResponse` (MDN: MV3 needs the latter from FF 110) + host permission; streaming rewrite on main_frame Document (2 chunks buffered → transform → `write` once → `close` exactly once) → content-script readbacks: marker comment in DOM, fixture style present, computed `--p10a-stage: ffx` on every intercepted load (8 tabs, readback cycles 1–4 incl. +60 s reloads); **zero** `onerror` over the whole run.
- **Firefox event-page suspend/wake observed**: `event-page-evaluated` re-fires 51.7–64.3 s apart — the event page is torn down and re-evaluated, listeners re-register on wake without any manual reload; `runtime.onSuspend` never reported (absent or silent). Every **navigation-woken** evaluation (6/6) intercepted the waking main_frame **at wake** — `stream-rewritten` 20–28 ms after `event-page-evaluated` (entry timestamps), marker+fixture confirmed by that load's readback. The hazards observed are elsewhere: (a) the **install/first-load race** — only the pre-install first load rendered unmodified (`cycle:1, markerComment:false`); (b) **navigation-less wakes** — 1 of 7 wakes fired with no navigation in flight and intercepted nothing until the next load. Every +3 s rewrite was the scratch's `startup-open` tab-creation arm (`startup-reload` fired 0 times — finding 2); 8 tabs, readback cycles 1–4. → P10E: re-register listeners on wake; verify first-navigation coverage during P10E.
- **MV2 discriminating arm re-run (2026-10-20, bounded `web-ext run --arg=-headless`, Firefox 158.0, web-ext 10.8.0, docker site)**: MV2 persistent background — `filterResponseData` streaming rewrite end-to-end (2 chunks → `write` once → `close` once, `markerApplied:true`, readback `stageVar:ffx` cycles 1–3 across 2 tabs incl. +60 s reloads; zero `stream-error`); port-pattern silence reproduced (finding 2). The retained MV2 `evidence.log` was a byte-copy of MV3-era heartbeat lines in the old collector format (deleted 2026-10-20) — MV2 conclusions rest on this fresh run.
- **Composed pipeline (arm 6)**: two transforms in one CDP session — T1 (marker + fixture `<style>`) then T2 (rewrote T1's style body + second marker); T2 saw T1's output; computed var = t2. Scratch note: a stray `;` between the two CSS rules invalidated the second rule (real CSS error recovery; first run computed `t1`) — transforms authoring must not join rules with stray separators.
- One-off flake (recorded, not a design fact): the first headed Chromium launch timed out waiting for the extension service worker (45 s); a fresh-profile relaunch connected instantly.

#### P10A findings (design-impacting, flagged 2026-10-20)

1. **Challenges the "DevTools-open ⇒ interception impossible" premise (feeds G-3)**: on Chromium for Testing 156, `chrome.debugger` attach + full CDP intercept succeed **with a real DevTools window open on the tab** (multi-client CDP; both orders probed — DevTools-first attach attempt and second-client-attach-while-armed). The feasibility table's conflict row and the mode-resolution rule ("DevTools open → degrade") must be re-verified on stable Chrome with real user interaction (manual remainder above) before P10D bakes the degradation in; the seam stays, the trigger condition may not. Owner's headed `--devtools-first` re-run (2026-10-20) adds the UI cost the API surface hides: the auto-opened native DevTools window **closed moments after the attach** (`getTargets` flips the `devtools` target's attach flag true→false) — the native frontend yields its client slot and our session never errors. G-3's trigger stays an owner decision (a silent window-close is a UX cost even where the multi-client CDP allows the attach); either way the overlay's mode words must promise the honest state.
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

- [x] `lib/storage/` items (per the established precedent): per-origin exclusion sets in **`local:`**; last-applied session state per **tab** in **`session:`** (decision below) — both machine-local, never synced; tolerant read-back of unknown fields; corrupt/absent handling per storage conventions.
- [x] `lib/messaging/` channels with payload bounds/validation: overlay↔background session lifecycle + status; background→panel builder-active push. Sender-resolved tab IDs; no-receiver/timeout arms typed.
- [x] Unit tests at each boundary (validate + fuzz precedents).

DoD: contracts green, additive only, zero consumers beyond tests. Effort S · difficulty easy.

#### P10C receipt (2026-10-20)

Uncommitted on `feat/p10` (supervisor commits). New: `lib/messaging/exclusion-session.ts` (+fixtures/test), `lib/messaging/bounded-ask.ts`, `lib/storage/exclusion-sets.ts`, `lib/storage/exclusion-sessions.ts`, `lib/storage/write-queue.ts` (each +test); additive: 8 `ProtocolMap` rows, `isHttpOrigin` (`utils/urls`), `resolveTopFrameSender` + `isExtensionPageSender` (`lib/messaging/sender`), fuzz block; `options.ts` now rides the shared write queue (behavior unchanged). Engine types (`ExclusionSet`, `TransformReport`, `InvalidExclusionRow`) re-validated, never re-declared. Zero consumers outside tests.

Contract decisions downstream phases build on:

- **Session state is per tab in `session:` (deviation from the `local:`/per-origin box text).** G-5 scopes a session to a tab (persists across navigations until Stop/tab close). `session:` is in memory (never on disk/synced), survives SW/event-page suspension, is cleared on browser shutdown and extension disable/uninstall (MDN); clearing on extension **reload/update is not verified** for either browser. Hence the **backend rule: a stored record is a hint** — on wake the backend re-validates it (no live attachment/listener for the tab ⇒ stale: clear it, serve unmodified); G-5's "reload restores unmodified rendering" rests on that, not on the area. Default access is extension contexts only → content scripts ask the background, never read a record. Per-origin persistence stays in `local:exclusion-sets` (restore source).
- **Status union** (`ExclusionSessionStatus`): `inactive` (no record) · `active {origin, set, startedAt, document}` · `unavailable {cause, at}` (G-3 warning, kept until Stop or the next apply). `document` = last top-level document: `null` (armed) · `rewritten {reports}` · `over-budget {feature, row|null, budgetMs}` · `failed {reason: body-unavailable|decode-failed|engine-failed}` — served unmodified, session stays active. Reports must come from the record's set (rows ⊆ that feature's rows, one report/feature, `featureWide` ⇒ no rows, Σmatches ≤ candidates — engine invariants, verified).
- **Unavailable causes** (`INTERCEPTION_UNAVAILABLE_CAUSES`, with `retryable`): `attach-denied`✓, `debugging-policy`✗, `infobar-cancelled`✓, `detached`✓, `unsupported-page`✗, `unsupported-browser`✗ (G-2), `session-limit`✓. UI copy maps over this table.
- **Channels** (overlay rows: tab+origin via `resolveTopFrameSender`, top frame only; asked through `boundedAsk` + `EXCLUSION_SESSION_DEADLINES_MS` → `reply|no-receiver|timeout|invalid-reply|failed`; an internal background failure surfaces as `failed` — P10F renders it): `applyExclusionSession({set})→applying|invalid{rows}|unavailable{cause}` (answer `invalid` via `invalidApplyReply`, reasons wire-bounded), `stopExclusionSession()→status`, `getExclusionSession()→status`, `getSavedExclusionSet()→{set|null}` (restore before any session), `saveExclusionSet({set})→saved|not-saved{unsupported-page|invalid-request|storage-failed}`; `exclusionSessionChanged(status)` (bg→tab push, sent with `frameId: 0`); `getExclusionSessionForTab({tabId})→status` (answered only for `isExtensionPageSender`) + `exclusionSessionUpdated({tabId,status})` (panel drops it from senders with a tab and for other tabs).
- **Saving**: the background is the only reader/writer of both stores. Apply saves the origin's set **only when answering `applying`** (`invalid`/`unavailable` save nothing); `saveExclusionSet` stores any wire-valid draft (engine-invalid rows included, so restore hands them back to fix).
- **Reset needs no channel**: re-apply with the session's stored `set`.
- **Bounds**: set ≤ 500 rows/feature, ≤ 2 048 chars/row, ≤ 64 Ki chars total (running budget), printable rows → ≤ ~200 KiB JSON; active record ≤ 512 KiB worst case (pinned, measured 488 307 B); reason cap = row cap + 512. `local:exclusion-sets` ≤ 4 MiB (LRU, just-saved kept); `session:` ≤ 8 **active** records (new live session past it → `limit-reached` → `session-limit`, never evicting one) + ≤ 32 warnings (oldest other dropped) → ≤ ~4 MiB under Chrome's 10 MiB `QUOTA_BYTES`. Messages: exact keys, own properties only; storage: unknown keys ignored; tab ids safe integers, canonical decimal keys.

Audit (adversarial, 2026-10-20): 2 MAJOR + 5 MINOR + 8 NOTE (n8 skipped — over-counts in the safe direction), all fixed with regression tests: M1 reason over the wire cap (engine echoed the 2 KiB row + doubled "Invalid regular expression:" prefix — V8 already leads with it; engine now emits `Invalid regular expression: <detail>`); M2 saved-set rows; m1 warnings no longer take live slots; m2 report↔set invariants + honest size; m3 running char budget; m4 docs softened + hint rule; m5 fuzz asserts real properties; n1 sender helpers; n2/n3 push/drop/`failed` docs; n4 `boundedAsk` skips send after a sync timeout and maps sync-throw/non-thenable to `failed`; n5 store writers reject, never throw; n6 safe-integer tab ids, `1e+21` keys refused; n7 own properties only.

Gates: compile/lint/format green; `pnpm test` 205 files, 3246 tests (+1 skipped) green, coverage ≥ 90 %; `build` + `check:budgets` green (no consumers).

### P10C.1 — Fix: sparse-array holes in message validators ✅

Depends:—. Parallel:—. Done 2026-10-20.

Receipt: `isStringArray` (`lib/messaging/validate.ts`) skipped holes via `.every` and scanned before its callers' count caps. Reach: structured-clone runtime messaging — Firefox, Chrome only if the manifest opts into `message_serialization: structured_clone` (not set; default JSON turns holes into `null`) — from the extension's own content script, so defense in depth; the window bridge carries only error words (`parseErrorWords`, already hole-safe) and `DeviceSimState` (no arrays). Effects (reproduced): a hole threw `TypeError` in `preloadedImages` and every `parseCappedStringList` list (`fonts`, `domains`, beacon config lists) and was copied as `undefined` from `excludedReasonsFound`; a cloned `['x']` with `length` 2^32−1 cost ~64 s. Fix: `isStringArray(value, maxCount)` checks the cap first, then every index (hole ⇒ reject); `preloadedImages` + `parseCappedStringList` check count bounds first and reject a bad member at its index (`…fonts[1]`, was `…fonts`); absent `fonts`/`domains` only accept `[]` (no scan). Sweep of `lib/messaging/` + `lib/storage/`: no other hit — other untrusted-array guards are cap-first and use `for…of`/`.entries()` (holes read as `undefined`, then fail); storage array guards (`parseKnownConflicts`, `parseExclusionSet` → `parseRowList`) are those messaging guards. Tests (each regression fails on the old guard; the dense control and the cookie/words/headers/KC hole pins pass on both): `validate.test.ts` — per-field hole rejections over `structuredClone`, over-cap lists rejected with zero member touches (counting proxy) and a cloned 2^29-length sparse list rejected < 1 s (old guard: ~7.3 s), member-index explained paths; `fuzz.test.ts` — a hole in the hostile set and an exhaustive path × hostile sweep asserting no throw and no hole/`undefined` in any accepted output (the seeded random run alone missed the bug). Expectation changed: explained path for `fonts: [1]` is now `…fonts[0]` (a non-array row added to keep the field-level path pinned).

### P10D — Chromium interception backend (next)

Depends:P10A, P10C-C.1. Parallel:P10E. Goal: a reliable, fully failure-aware CDP session in the background.

- [ ] `debugger` permission added (Chromium manifest only, `wxt.config.ts` comment: why + G-2 receipt; Firefox build unchanged).
- [ ] Session state machine: attach → `Fetch.enable` (Document/Response) → reload/fulfill transform via engine → detach (or persist per G-5); every step's failure arm typed and surfaced (attach denied/target gone/no receiver); `onDetach` (DevTools opened, user Cancel on the infobar, navigation, crash) stops cleanly, never retries against a dead context. The engine apply runs under a wall-time budget; an overrun is a typed session failure naming the offending feature/row — never a hung navigation.
- [ ] Fidelity on fulfill: preserve the response's charset (`getResponseBody` base64 → decode with the original encoding → transform → encode back; `Content-Type`/headers passed through) — a wrong-charset fulfill corrupts the render.
- [ ] Mode resolution: mode decided at apply time by attempting the attach (G-1 amendment 2 — never assumed): armed → intercept; unavailable → the G-3 warning state (cause + remedy + Retry); every outcome in the overlay indicator + panel status row (W-1, never color-only).
- [ ] Unit tests for the state machine with injected command ports; manual runtime evidence on the docker site.

DoD: apply-and-render works end-to-end on Chromium with DevTools closed; every failure arm observed and handled; charset round-trip proven; no silent failures. Effort M · difficulty hard.

### P10E — Firefox streaming backend

Depends:P10A, P10C-C.1. Parallel:P10D. Goal: `filterResponseData` rewrite with the same engine and the same session semantics.

- [ ] Streaming transformer: buffer bounded, transform once, close/error exactly once (old stream-cleanup defect class explicitly closed); request filter = main frame, host patterns reused; charset/headers untouched (transform operates on the decoded stream per Firefox's TextDecoderStream contract, re-encoded on output). The engine apply runs under a wall-time budget; an overrun is a typed session failure naming the offending feature/row — never a hung navigation.
- [ ] Listener registration on event-page wake; session persistence per G-5 (active-session flag consulted per navigation, detached observers/rules cleaned up on Stop/tab close); applied-state persisted for the reload's overlay.
- [ ] Unit tests with injected stream shims; manual runtime evidence on the docker Firefox build.

DoD: parity apply on Firefox; cleanup contract proven; `pnpm build:firefox` green. Effort M · difficulty medium.

### P10F — Overlay UI in the inspected page

Depends:P10B+C (+G-3/G-4 decisions). Parallel:P10D/P10E wiring-free parts. Goal: the whole builder UX, shadow-isolated, per the UI bar.

- [ ] `entrypoints/isolated.content/exclusion-builder/`: mount/teardown via existing `ui/` machinery; tokens + live theme; top frame only; z-index/cleanup contract for hostile pages.
- [ ] Editor: per-feature pattern/literal rows with inline validation, disable toggles (G-4), counts from the engine report; virtualized when >100 rows (P-2).
- [ ] Click-to-pick: pick a script/element in the real page → candidate exclusion row (Delay/Defer/Lazyload/ALR lane per target); Esc cancels; works over SPAs (observer cleanup).
- [ ] State matrix (S-1): loading, error + retry, feature absent, empty, populated, applied-active, applied-with-no-match warnings, **interception-unavailable warning** (G-3: cause + remedy + Retry, per-arm words); mode indicator never color-only (K-5).
- [ ] Apply/Reset/Stop controls: Apply → session start; Reset → re-apply from stored original; Stop → detach + restore original on next reload; every control keyboard-complete (K-1/K-2).
- [ ] UI bar §D receipts (D-1..D-7) in this doc.

DoD: full editor + states green in isolation (engine + contracts injected), bar receipts recorded. Effort L · difficulty hard.

### P10G — Chromium apply wiring + surfaces integration

Depends:P10D+F. Parallel:—. Goal: the agreed flow live end-to-end.

- [ ] Overlay Apply → background session → reload → fulfilled render → overlay re-injects at `document_start` and shows applied state (from persisted session state, not heuristics).
- [ ] Shell mode registry: Exclusions mode (P10) plus the plug-in seam for P13/P14 tool modes (config + results panels); no second editor surface per tool.
- [ ] Mode matrix wired: attach attempted at Apply → armed (interception) or the G-3 warning state (cause + remedy + Retry); indicator + honest words (W-1); session persistence per G-5 reflected in the active-state indicator.
- [ ] DevTools panel: builder entry/status row (link + active state via push channel); context-menu "Exclusion Builder" item opens the overlay (re-points the existing `contextMenus` consumer comment). **Remove the panel command-palette "Open Exclusion Builder" row** (`entrypoints/panel/palette/actions.ts` + `palette/exclusion-builder.ts`) and retire the old unlisted `exclusion-builder.html` entrypoint + its budgets row (G-1 amendment 1) — from a devtools-attached panel the overlay is the only correct surface; no second editor surface.
- [ ] E2E-adjacent manual receipts on the docker site; budgets: content-script + background deltas receipted.

DoD: owner flow "pick → apply → reload → real render with exclusions" works on Chromium; statuses honest in every mode. Effort M · difficulty medium.

### P10H — Firefox wiring

Depends:P10E+F, G for the shared wiring shape. Parallel:—.

- [ ] Firefox apply flow end-to-end; streaming backend's applied-state surfaced in the same overlay contract.
- [ ] Cross-browser receipt: same exclusion set, both engines, same engine report.

DoD: Firefox parity with the shared flow (no fallback exists — G-3); no Chromium regression. Effort S · difficulty easy.

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

- No file-import/export flow (superseded); no byte-identical old-notice mandate; **no simulation fallback of any kind — interception unavailable = the G-3 warning state** (DNR and DOM-hook simulation both rejected by owner 2026-10-20); no page-load performance instrumentation (P14's domain); no exclusion _recommendations_ engine (P6's copy-as-exclusion vocabulary remains the generator); no i18n; no new dependency; no POST-navigation applies (the apply targets a GET reload; POST endpoints out of scope).
- RUCSS tester, beacon/LCP, and script-runtime implementations stay in P13/P14 — P10 ships only the shell, session lifecycle, and pipeline seam (no tester config/results UI here).
