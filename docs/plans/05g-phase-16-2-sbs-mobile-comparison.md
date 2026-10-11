# Phase 16.2 — Side-by-Side mobile comparison (UA + viewport, single device, overlay-live)

**Depends on:** P1 (contracts), P2 + P3 + P4.3 (the surfaces it extends), P16-A (scroll sync). **Effort:** M. **Parallelizable:** B3 ∥ B4. **Supersedes:** the first Feature B design in 05e (owner refinement, 2026-10-11). **Suites:** the permanent browser pin rides P16.1's rewritten device-sim rows (05f).

**Owner directives (2026-10-11):**

1. The capability exists for Side-by-Side to compare the mobile version: UA **and** correct resolution. Not a generic per-tab spoof.
2. **One device** — one mobile profile, not a device zoo. No attempt to duplicate Chrome's full device emulation.
3. Simulation state changes **must reload both halves** to take effect.
4. The UA may only be rewritten while **the overlay is open and simulation is on**. Closing the overlay resets the UA to its default. PSI Side-by-Side is never affected.
5. Handle small and large window sizes for the emulated frames.
6. A plan file owns this phase (this document), not conversational memory.

## TLDR

A "Mobile comparison" switch in the compare overlay's header, next to scroll sync. While it is on (and only while the overlay is open), one **session DNR rule** rewrites the tab's `user-agent` header on document requests, and the overlay's two halves re-render as **genuine phone-frame viewports** (412×892 CSS px, scaled to fit their half of the window). Every state change (switch on/off, open with the setting on, close) reloads both halves exactly when needed; the page world inside each half sees the same phone UA through a tiny `navigator.userAgent` shadow injected at document start. One device row; badge-mark/context-menu/popup per-tab ideas from the superseded design are dropped — visibility lives in the overlay itself.

## Verified facts (2026-10-11, Chrome-for-Developers docs + installed code)

| Fact                                                                                                                                                                                            | Source                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `declarativeNetRequestWithHostAccess`: same capabilities as the base permission, no install-time warning, acts only within declared host permissions (we declare http/https `URL_PATTERNS`)     | Chrome DNR docs                                                          |
| Rule condition `tabIds` — "**Only supported for session-scoped rules**" → per-tab UA via `updateSessionRules` is native                                                                         | Chrome DNR docs, `RuleCondition`                                         |
| `HeaderOperation "set"` — "Sets a new value … removing any existing headers with the same name" → outright UA rewrite (the append-only list is the restricted operation)                        | Chrome DNR docs                                                          |
| Session rules survive service-worker idle restarts; are cleared on browser shutdown and on extension install/update; ceiling 5000 (one here)                                                    | Chrome DNR docs, "Rules and rulesets", limits                            |
| Scope boundary: DNR does not affect responses served by a page's own service worker (`onfetch`/`CacheStorage`)                                                                                  | Chrome DNR docs, "Interactions with service workers"                     |
| `defineWindowMessaging` bridge already connects MAIN↔isolated per frame world (P4); window-bridge sends with no listener never settle — receivers listen before senders send                    | `lib/messaging/window-bridge.ts`, protocol.ts body rules                 |
| The overlay's context menus/PSI gate exists as `isAutoFlowPage()`; per-side refresh (`refreshFrame`) produces fresh bodies (regenerated fixture token) and re-adopts listeners on `load`        | `entrypoints/isolated.content/side-by-side/index.tsx`, `sync-session.ts` |
| Main-frame navigation events already reach the background side (header capture wiring; badge clears ride it) → the sim service hooks the same signal; no `webNavigation` permission known today | `entrypoints/background/headers.ts` wiring, `badge.ts` navigationStarted |
| The fixture marker for separate mobile cache: `wpr_mobile`/`wpr_desktop` hidden generator-metas emitted while `do_caching_mobile_files` is on (`inc/Engine/Support/Meta.php`)                   | `docs/plans/15b-phase-14-5-coverage-and-tooling.md`                      |

## Design

### Core mechanism — a session rule with overlay-strict lifecycle

One rule per sim-on overlay session:

```ts
const DEVICE_SIM_RULE_ID_BASE = 1_000_000_000; // injective: ruleId(tabId) = base + tabId
rule = {
  id: DEVICE_SIM_RULE_ID_BASE + tabId,
  priority: 1,
  action: {
    type: 'modifyHeaders',
    requestHeaders: [{ header: 'user-agent', operation: 'set', value: PROFILE.userAgent }]
  },
  condition: { tabIds: [tabId], resourceTypes: ['main_frame', 'sub_frame'] }
};
```

**`resourceTypes: ['main_frame', 'sub_frame']`** deviates from the first design's blanket tab rule on purpose: document requests are where mobile decisions happen; the open host page's own `fetch`/XHR traffic keeps its real UA while the overlay is up (least disturbance — the debugging engine stays in its real session). Recorded as the reason in the service's why-comment.

**Lifecycle (owner directive 4 — strict):**

- **On** = add the rule. Happens at: overlay open with the persisted setting on (rule _must_ be in place before the halves navigate — awaited ordering), or a header switch turning it on inside an open overlay.
- **Off** = remove the rule. Happens at: header switch off inside an open overlay; overlay close; overlay context invalidation; the tab's main-frame navigation (route below).
- **Main-frame navigation while sim was on** de-scopes the overlay by definition (the content script dies with its page): the service removes the rule on the tab's navigation signal, reusing the signal the badge already receives from the header-capture wiring — no `webNavigation` permission, no new listener infra.
- **Boot sweep** (belt and braces, per the docs-verified lifecycle): at service init, list session rules under the id base; for each, the owning tab must exist _and_ answer a lightweight ping of its isolated world — a rule whose script cannot be reached is an extension-reload ghost; remove it. A "CS reachable but overlay closed" residue is impossible under the close/invalidation paths; if one is ever witnessed it is a bug in those paths, logged as such.
- **`tabs.onRemoved`** → remove without ceremony (no browser call — `updateSessionRules` alone, tab gone).

**PSI side-by-side never affected (owner directive 4):** the overlay already knows its analysis-host mode (`psiMode`/`isAutoFlowPage()`); the switch does not render there (same gate shape as the scroll-sync switch) and the open path skips the sim step entirely beyond the sync/`psiMode` check it already makes. Defense in depth is cheap: the service's enable decision also refuses senders resolved on the analysis host (pure `canSimulate(senderAvailability)` — unit-pinned; the UI shape makes this branch unreachable in practice).

**Availability:** Chromium-only capability, feature-detected once (`'declarativeNetRequest' in browser`). Everything degrades explicitly: the ask returns `available: false`, the switch never renders, Firefox is never half-working. The permission row lands in `wxt.config.ts` with its why (`declarativeNetRequestWithHostAccess` — no new install warning, same host permissions).

### The one device

`lib/device-simulation/profiles.ts`:

| field     | value                                                                                                             | note                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id        | `'phone'`                                                                                                         | single row; adding a device later is a row plus its tests                                                                                                                                                                                                                                                                                                                                       |
| userAgent | `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36` | Chrome's reduced-UA phone shape (device-class tokens `Android` + `Mobile` — what UA decisions listen for; modern UA reduction keeps those exact tokens). Chrome major pinned at implementation time vs the then-current stable; **verified in B5 against the plugin's server-side decision on the P4.2 site before it is recorded as shipped** — a needed correction is recorded, never assumed |
| viewport  | `412 × 892` CSS px, portrait                                                                                      | Pixel-class; the frame is exactly this size and scaled to fit its half (see below). Not changeable at runtime — one honest device                                                                                                                                                                                                                                                               |

Not emulated, by the honesty rule (owner: "not trying to bring all the possible devices"): touch/pointer events, `devicePixelRatio`, keyboard shape, WebAuthn-origin trust, or Chrome full device mode. If a page's behavior needs those, that is what Chrome DevTools device mode is for — recorded where the switch's help honored.

### Resolution — real viewport in the halves

Sim mode re-presents each half as a **phone frame**: the iframe's element box becomes exactly 412×892 and is scaled with CSS `transform: scale(k)` to fit its half of the window (two-box structure: a wrapper box of 412·k × 892·k so layout matches visuals, transform-origin top-left, inner iframe 412×892 — the Solid-side compute is a pure helper, unit-tested).

- `k = min(columnWidth / 412, columnHeight / 892)`, clamped to `≤ 1.0` — on a large display the phone renders 1:1 rather than drifting toward a giant poster.
- **Small windows** (owner directive 5): scale-to-fit _always_ keeps both phones fully visible (letterboxed by the overlay's theme tokens). Below ~206×446 px of half-column the floor of readability is behind us: the phone still fits until roughly a 460-tall window; past that, the wrapper clips (`overflow: hidden`) and the page scrolls inside its own 892-px viewport exactly as a phone would — the model stays true, the presentation degrades.
- **Large windows**: cap 1.0; letterbox grows, the compare stays phone-truth.
- Recompute on window/column resize — a context-registered `ResizeObserver` per half (teardown on invalidation; removed on overlay close).
- Scroll sync is untouched by scaling: the engine reads the frame's _inner_ scroll facts (CSS px of its own viewport), which the transform does not change.

### Page-world identity (the "UA" half of "UA + resolution", done honestly in-page)

The DNR rule covers the **network** hop (server decision). The **page** hop — UA-sniffing site code inside a half reading `navigator.userAgent` — needs the same truth or some sites render desktop inside a 412 px phone. Two tiny content-script entrypoints, both `allFrames` (they must run _inside_ each half, not just the top document; exact WXT flag name verified at implementation against the installed WXT):

- `entrypoints/ua-relay.content.ts` (isolated world, `document_start`, allFrames): one boot ask to the background — sender-resolved, no payload; keeps the answer cached; listens for live pushes (only the _open overlay's_ session ever changes state mid-event — refresh machinery gives fresh frames the ask anyway). Answer-only weight: ~1–2 KB.
- `entrypoints/ua-identity.content.ts` (MAIN world, `document_start`, allFrames): window-bridge (P4's `defineWindowMessaging` pair) to ask its own frame's relay at boot and subscribe: `define`/`restore-original-descriptor` of `navigator.userAgent` per its device-sim state; wrapped in the same page-safety guard as the undefined-references capture (a failure logs, never reaches the page). Timing = document start, before the first page script of each frame — the same guarantee the capture already holds.
- Boot-ask precision limit, recorded honestly: the ask's answer arrives by messaging — a page whose _first parsed script_ reads `navigator.userAgent` synchronously may observe the real UA in that parse tick (the rendered document is still server-correct; the overlay reloads are what carries the state change). The pin "shadow lands before the first animation frame" (05f) stays the testable bound.

The halves occasionally redirect cross-origin (the scroll-sync degrade): both entrypoints match every http/https document, so the identity still lands inside redirected halves — key reason the pair must be its own allFrames registration and not a lift of the capture.

### Overlay integration & state machine

The compare module owns a small finitely-described machine, not scattered booleans:

```
framePresentation: 'auto' | 'phone'        // what the frames render at
simRuleLive: boolean                        // what the tab's request header is right now
targetState(simEnabled, psiMode):
  !simEnabled || psiMode → presentation 'auto', rule OFF
  simEnabled && !psiMode && changed → presentation 'phone', rule ON, reload both halves
transition(open-args, switch events, close, invalidation):
  - open:  read persisted features.sbsMobileSim (default OFF; same options-store pattern as sync)
           compare with framePresentation → if differs: ensure rule (await) → refresh both halves → adopt presentation
  - switch: await ensure/remove rule → refresh both halves → adopt presentation (rule-before-refresh ordering, symmetric both ways)
  - close: remove rule (awaiting best-effort, logged), presentation reset — overflow/scroll restore stays identical to today
  - invalidation: the boot sweep + next open converges; nothing to persist
```

Two invariants pinned by its tests: **a rule never exists while `presentation === 'auto'` surveys the overlay (the tab's requests are its own again)**; and **a presentation change never happens without a rule matching it** (no half renders at 412×892 while sending desktop UA, no phone UA with desktop-sized frames).

The header switch reads/writes the persisted options value (live apply + write, identical mechanics to the sync switch); side labels gain a `· mobile` suffix while phone-presentation is active (visibility lives in the overlay — the superseded design's badge mark, context-menu row and P8 popup row are all dropped with the per-tab scope).

### Protocol, additive rows (P1 body rules)

- `getDeviceSimulation()` — content script → background; no payload; sender-resolved; resolves `{ available: boolean, enabled: boolean }`.
- `setDeviceSimulation(data: { enabled: boolean })` — content script → background; sender-resolved; resolves the same shape; refuse-and-log for unavailable/analysis hosts.
- `deviceSimulationChanged(data)` — background → tab push (the overlay UI consults it; the per-frame relays re-ask at document start, so no all-frame push machinery). Push sends catch the expected no-listener case per P1.

Validators live with `lib/device-simulation/` (the concept's owner) and are consumed at both boundaries per the single-declare rule.

## Tests (unit tier ships with each phase; browser pins stay P16.1's rewritten rows)

- `lib/device-simulation/`: profile table shape; rule derivation exactness (id injectivity/id stability across calls, header/operation/condition pinned); validators vs hostile payloads; `canSimulate` matrix (available/unavailable × site/analysis tab); `scaleFit` matrix (small column → fits letterboxed; large → cap 1.0; extreme → clipped-bound record).
- Background service: injected-deps ops around a fake DNR/tabs adapter (add/ensure/remove; sweep with dead tab / unreachable-script rules; navigation hook removal; `onRemoved`; refusal branches each logged not silent).
- Overlay integration: state-machine table (open persisted-on → rule then refresh, ordering pinned; switch on/off both await-before-refresh; close removes rule with presentation reset; PSI path untouched); the overlay's own switch-writing parity with the sync switch's storage behavior.
- Identity pair: descriptor define/restore unit (original descriptor returned intact; coexistence with the capture's listeners — both MAIN-world modules tolerate each other); relay ask/answer + push round trip over the real window (P4's composition-test pattern).

## Fixtures & verification round (B5)

Per the P4.2 fixture list (add, self-resetting, runbook lines):

- **UA-echo fixture** — a server endpoint echoing the request's `User-Agent` (+ marker), uncached in the site's cache. Assert surface: half-frame body text.
- **Separate-mobile-cache flag** — a fixture query-param state that turns `do_caching_mobile_files` on per request (mu-plugin filter; self-resets); the served copy's renderings `wpr_mobile`/`wpr_desktop` metas are the round's verdict (P14.5-verified markers).

The round (throwaway Playwright probe + the local site, recorded then deleted — the _permanent_ suites are P16.1's rewritten rows):

1. Toggle on → both halves reload → echo shows the phone UA in both halves; frames render 412×892 geometry (scaled) — `wpr_mobile` copy served under the flag, desktop copy without it.
2. Toggle off → both halves reload → echo shows the browser's real UA; geometry back to full-frame.
3. Open with the setting persisted on → rule precedes navigation (echo is phone on first open); re-open-without-reload behavior (suite-pinned reveal) preserved when the setting did not change.
4. Close the overlay with sim on → echo on a subsequent reload shows the real UA (rule gone) — owner directive 4.
5. Two-tab independence: a second tab's requests unaffected throughout.
6. Window-size extremes: tiny/large window letterbox + cap behavior as designed.
7. PSI host: auto-flow opens the overlay, no switch, no rule; a site tab's rule never leaks onto the PSI flows.
8. UA string vs the plugin's server decision (the B3 profile verification, recorded at B5 with the evidence).

## Phases

| Phase  | Does                                                                                                                                                                                                                                                            | Depends | Parallelizable                                      | Definition of done                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **B1** | `lib/device-simulation/` pure core (profile, state+validators, rule derivation, `canSimulate`, `scaleFit`) + unit suites                                                                                                                                        | —       | B2 is factual-dependent but sequential commits fine | gates green; derivation/validators/scale pinned                                        |
| **B2** | Protocol rows + validators + background service (lifecycle incl. sweep/onRemoved/nav-hook) + manifest permission why-row + AGENTS.md permission note                                                                                                            | B1      | B3 ∥ B4                                             | service unit-pinned; `pnpm build` manifest carries the permission with its why         |
| **B3** | Identity pair entrypoints (allFrames verifications, doc-start timing) + composition/round-trip tests                                                                                                                                                            | B1, B2  | B4                                                  | both entrypoints unit/composition-pinned; `pnpm dev` loads them into real frames       |
| **B4** | Overlay integration: switch row + protocol wiring + reload orchestration + phone-frame presentation + resize observer                                                                                                                                           | B1, B2  | B3                                                  | state-machine tests green; presentation e2e-assertable in the mechanic suite's fixture |
| **B5** | Fixture additions (runbook lines) + verification round (throwaway probe) + UA-string verdict vs the plugin decision                                                                                                                                             | B1–B4   | —                                                   | round asserts green with evidence recorded; UA corrected if needed                     |
| **B6** | Publication: this doc's shipped record; 05e supersede annotation; 05f device-sim rows rewritten to this design; master-plan status; budget rows (two new content-script rows derived; background/isolated re-measure with pre-recorded re-derivations); READMEs | B5      | —                                                   | all gates; budgets pass or re-derivations committed with reasons                       |

## Known edges (recorded, not hidden)

- One navigation request after a sim-on session converges to desktop — the request that kills the ghost rule was already written with the phone UA (header rules cannot retro-write an in-flight document load). The removal happens at the navigation signal it rides; the _next_ load is the tab's own again.
- The doc-start ask's answer outraces only some first-parsed page scripts; the server decision (the header rule) is timing-proof for every frame.
- DNR does not touch a page's own service-worker-served responses (`onfetch`/`CacheStorage`) — simulator scope on PWA-style sites is the tab's real network stack.
- Zoom vs transform: presentation uses `transform: scale()` (standard geometry, known hit-testing behavior), not `zoom`.

## Stack

No new dependencies. `browser.declarativeNetRequest` session rules (Chromium), WXT content-script `defineContentScript` pair with all-frames injection (flag name verified against the installed WXT), Solid signals + Tailwind tokens (letterbox palette via the injected-UI theme model), Vitest (unit), Playwright (B5's throwaway round).
