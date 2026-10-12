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

| Fact                                                                                                                                                                                              | Source                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `declarativeNetRequestWithHostAccess`: same capabilities as the base permission, no install-time warning, acts only within declared host permissions (we declare http/https `URL_PATTERNS`)       | Chrome DNR docs                                                          |
| Session DNR + `tabIds` conditions + `modifyHeaders` are **cross-engine** — Firefox 113+ implements them too (BCD: `RuleCondition.tabIds`, `RuleAction.requestHeaders`, session-rule caps 113/128) | MDN browser-compat-data (`webextensions/api/declarativeNetRequest.json`) |
| Rule condition `tabIds` — "**Only supported for session-scoped rules**" → per-tab UA via `updateSessionRules` is native                                                                           | Chrome DNR docs, `RuleCondition`                                         |
| `HeaderOperation "set"` — "Sets a new value … removing any existing headers with the same name" → outright UA rewrite (the append-only list is the restricted operation)                          | Chrome DNR docs                                                          |
| Session rules survive service-worker idle restarts; are cleared on browser shutdown and on extension install/update; ceiling 5000 (one here)                                                      | Chrome DNR docs, "Rules and rulesets", limits                            |
| Scope boundary: DNR does not affect responses served by a page's own service worker (`onfetch`/`CacheStorage`)                                                                                    | Chrome DNR docs, "Interactions with service workers"                     |
| `defineWindowMessaging` bridge already connects MAIN↔isolated per frame world (P4); window-bridge sends with no listener never settle — receivers listen before senders send                      | `lib/messaging/window-bridge.ts`, protocol.ts body rules                 |
| The overlay's context menus/PSI gate exists as `isAutoFlowPage()`; per-side refresh (`refreshFrame`) produces fresh bodies (regenerated fixture token) and re-adopts listeners on `load`          | `entrypoints/isolated.content/side-by-side/index.tsx`, `sync-session.ts` |
| Main-frame navigation events already reach the background side (header capture wiring; badge clears ride it) → the sim service hooks the same signal; no `webNavigation` permission known today   | `entrypoints/background/headers.ts` wiring, `badge.ts` navigationStarted |
| The fixture marker for separate mobile cache: `wpr_mobile`/`wpr_desktop` hidden generator-metas emitted while `do_caching_mobile_files` is on (`inc/Engine/Support/Meta.php`)                     | `docs/plans/15b-phase-14-5-coverage-and-tooling.md`                      |

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

> **Shipped correction (2026-10-12):** the snippet above was written with the additive base; real-world verification overturned it. Chromium 156 hands out tab ids literally anywhere in the int32 range (observed: 34M – 2.04B across sessions within one browser major), so `base + tabId` crossed the session DNR id ceiling (`updateSessionRules` accepts ids ≤ 2 147 483 647 — verified live: INT32_MAX passes, INT32_MAX + 1 rejects with a binding error) and failed the rule add for the very tab it named — the reported "Mobile comparison could not be applied" toggle failure. The shipped encoding is `id == tabId` (`deviceSimRuleId`, `lib/device-simulation/rule.ts`); the family sweep no longer keys on the base (`getSessionRules` is extension-scoped, the device-sim family is the extension's only session-rule user). An earlier additive offset cannot be reintroduced without re-deriving the tab-id range first.

**`resourceTypes: ['main_frame', 'sub_frame']`** deviates from the first design's blanket tab rule on purpose: document requests are where mobile decisions happen; the open host page's own `fetch`/XHR traffic keeps its real UA while the overlay is up (least disturbance — the debugging engine stays in its real session). Recorded as the reason in the service's why-comment.

**Lifecycle (owner directive 4 — strict):**

- **On** = add the rule. Happens at: overlay open with the persisted setting on (rule _must_ be in place before the halves navigate — awaited ordering), or a header switch turning it on inside an open overlay.
- **Off** = remove the rule. Happens at: header switch off inside an open overlay; overlay close; overlay context invalidation; the tab's main-frame navigation (route below).
- **Main-frame navigation while sim was on** de-scopes the overlay by definition (the content script dies with its page): the service removes the rule on the tab's navigation signal, reusing the signal the badge already receives from the header-capture wiring — no `webNavigation` permission, no new listener infra.
- **Boot sweep** (belt and braces, per the docs-verified lifecycle): at service init, list session rules under the id base; for each, the owning tab must exist _and_ answer a lightweight ping of its isolated world — a rule whose script cannot be reached is an extension-reload ghost; remove it. A "CS reachable but overlay closed" residue is impossible under the close/invalidation paths; if one is ever witnessed it is a bug in those paths, logged as such.
- **`tabs.onRemoved`** → remove without ceremony (no browser call — `updateSessionRules` alone, tab gone).

**PSI side-by-side never affected (owner directive 4):** the overlay already knows its analysis-host mode (`psiMode`/`isAutoFlowPage()`); the switch does not render there (same gate shape as the scroll-sync switch) and the open path skips the sim step entirely beyond the sync/`psiMode` check it already makes. Defense in depth is cheap: the service's enable decision also refuses senders resolved on the analysis host (pure `canSimulate(senderAvailability)` — unit-pinned; the UI shape makes this branch unreachable in practice).

**Availability:** the capability is **cross-engine** (BCD, verified 2026-10-11 during the B2 audit): `RuleCondition.tabIds` (Chrome 92, Firefox 113), `RuleAction.modifyHeaders` request headers (Chrome 86, Firefox 113), session rules (Firefox 113+/128 caps). Chromium MV3 grants it via `declarativeNetRequestWithHostAccess` (no install-time warning, acts within host permissions); Firefox's MV2 build requests the same permission and carries its host permissions folded into `permissions`. Feature-detected once (`'declarativeNetRequest' in browser`) — an older engine without the namespace degrades explicitly: the ask returns `available: false`, the switch never renders, never half-working. A real-Firefox runtime spot-check is the recorded manual smoke row (05f's rewritten suite 5; the local e2e tier is Chromium-only).

### The one device

`lib/device-simulation/profiles.ts`:

| field     | value                                                                                                             | note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id        | `'phone'`                                                                                                         | single row; adding a device later is a row plus its tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| userAgent | `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36` | Chrome's reduced-UA phone shape (device-class tokens `Android` + `Mobile` — what UA decisions listen for; modern UA reduction keeps those exact tokens). Chrome major pinned at implementation (2026-10-11) to **155** — stable since 2026-10-06; **verified in B5 against the plugin's server-side decision on the P4.2 site before it is recorded as shipped** — a needed correction is recorded, never assumed. **B5's verification (2026-10-12, round green 6/6): the string passes as-is, no correction.** The plugin's vendored detector reads it phone-only (MobileDetect `isMobile=1/isTablet=0`, PHP-tested against the pinned 3.23.5.1 copy), the served separate mobile copy stamps `wpr_mobile` for exactly this UA (the desktop copy `wpr_desktop` for the browser's real one; both variant files listed in the cache tree), and the uncached echo endpoint read the byte-exact string back through both compare halves while the session was live. The `Android 10; K` pair is the static reduced-UA value (Chrome 110+), not an OS version to refresh |
| viewport  | `412 × 892` CSS px, portrait                                                                                      | Pixel-class; the frame is exactly this size and scaled to fit its half (see below). Not changeable at runtime — one honest device                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Not emulated, by the honesty rule (owner: "not trying to bring all the possible devices"): touch/pointer events, `devicePixelRatio`, keyboard shape, WebAuthn-origin trust, or Chrome full device mode. If a page's behavior needs those, that is what Chrome DevTools device mode is for — recorded where the switch's help honored.

### Resolution — real viewport in the halves

Sim mode re-presents each half as a **phone frame**: the iframe's element box becomes exactly 412×892 and is scaled with CSS `transform: scale(k)` to fit its half of the window (two-box structure: a wrapper box of 412·k × 892·k so layout matches visuals, transform-origin top-left, inner iframe 412×892 — the Solid-side compute is a pure helper, unit-tested).

- `k = min(columnWidth / 412, columnHeight / 892)`, clamped to `≤ 2.0` — fit first; beyond 2× the presentation stops growing so text stays crisp (live layout, not an image) and absurd blowups are impossible. The earlier 1.0 cap was too timid: a 4K-class window naturally wants ~3× fit, and 1:1 phones amid dead letterbox serve nobody — readability is the point of the compare.
- **Fit never clips.** By construction `412k ≤ columnWidth` and `892k ≤ columnHeight`, so at every window size both phones render complete and letterboxed by the theme tokens; readability is the only honest cost on a tiny window. (An earlier draft hedged a "clips past ~460 px" branch — that branch cannot exist under this scale formula; removed rather than carried.)
- **One layout — two columns — with the stacking tradeoff recorded, not hidden.** Stacked columns (`min(W/412, H/2/892)`) exceed the side-by-side scale (`min(W/2/412, H/892)`) exactly when the window is taller than the phone's own aspect (`H·412 > W·892`, i.e. `H/W > ~2.16`); up to that boundary columns always scale ≥ stacked (proof: for `B = H/892 ≤ A = W/412`, `min(A, B/2) = B/2 ≤ min(A/2, B)`, reversed by symmetry). In that rare tall-portrait window stacking would fit phones up to ~2× bigger — not taken: an aspect-triggered flip oscillates under live resize at the boundary (hysteresis) and breaks the overlay's two-halves model (side labels, per-side refresh); the phones there are smaller but complete. Never "improve" this into a stacked variant without owner direction.
- **Resize adapts live, with zero reloads** — a context-registered `ResizeObserver` per half recomputes `k` on any change that alters the column: window resize, maximize/restore, devtools docking, browser zoom, external-display changes are all the same element-size event. The phone stays 412×892 CSS px for the page; only the presentation scale moves (browser zoom renders the same CSS geometry larger on screen, as expected). In auto (non-sim) presentation nothing changes from today: the frames are fluid boxes and both loaded documents reflow natively as the window resizes — no JavaScript, no reload.
- Scroll sync is untouched by scaling: the engine reads the frame's _inner_ scroll facts (CSS px of its own viewport), which the transform does not change. A resize that _shortens_ a half makes the browser clamp its inner scroll position and fire real scroll events on both halves — the map is **round-trip idempotent** (grid-verified: one rebalancing round trip is final; a further round trip moves nothing, and equal ranges mirror exactly), so the clamped halves settle instead of fighting. A→B→A is _not_ position-preserving at extreme range disparities (tolerance = the target's rounding granularity) — the engine's scroll-gating is what prevents ping-pong, since it never re-maps uninvited. Pinned by test rather than trusted (the unit pin rides `scroll-sync.test.ts`).

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

- `lib/device-simulation/`: profile table shape; rule derivation exactness (id injectivity/id stability across calls, header/operation/condition pinned); validators vs hostile payloads; `canSimulate` matrix (available/unavailable × site/analysis tab); `scaleFit` matrix: fit invariant pinned (`412k ≤ w ∧ 892k ≤ h` at every column size — the never-clips property as a proven assertion, not prose), cap at 2.0 in oversized columns, monotone behavior while shrinking; in `lib/side-by-side/`, the proportional map's round-trip idempotence (one rebalanced round trip is final — the resize-clamp convergence property, pinned as an engine-level unit test from B1).
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
6. Window-size extremes: tiny/large windows — both phones complete (letterboxed), cap 2.0 respected; **resize while open** — continuous rescale with no reloads and no scroll-sync fight (clamped halves converge proportionally); narrow-window **header usability** (extra switch never traps the labels/controls — wrap or elision holds, visually recorded).
7. PSI host: auto-flow opens the overlay, no switch, no rule; a site tab's rule never leaks onto the PSI flows.
8. UA string vs the plugin's server decision (the B3 profile verification, recorded at B5 with the evidence).

**Round record (B5, 2026-10-12): green 6/6 over the local site before the throwaway
file was deleted (the permanent sim coverage is B6's rewritten P16.1 rows).** Fixtures
landed in the fixture mu-plugin (`/wp-json/fdt/v1/ua-echo`, the uncached `text/plain`
UA echo — the plugin's own `wp-json` cache rejection + `no-store` keep it per-request
truthful — and `?fdt-mobile-cache=1`, the per-request `do_caching_mobile_files` force)
plus their runbook rows. Witnessed live, in one real-Chromium run over the real site:
the pinned profile UA read back byte-exactly through both halves while the session was
live and the real UA with it off; the 412×892 dress never-clipping at tiny
(300×400), desktop, and oversized (2400×2000, cap 2.0 engaged) windows with no reload
while resizing and the sync engine live through the rescales; a second tab unaffected
while the session ran; the PSI surface auto-opening control-free and unshadowed with
no rule leak; the persisted-on first open gate-ruled with the re-open reveal preserved;
and the served copies flipping `wpr_mobile` ↔ `wpr_desktop` with the session direction
(both variant files listed under the cache tree, stamped per variant). The PSI leg ran
against a locally intercepted analysis host (the real host stays out-of-band); its flow
mechanics are what the stub proves, not the host's own page content. Screenshots of
the extremes and the wrapped narrow header recorded outside the repo (os tmpdir).

## Shipped (B1–B5, 2026-10-12 — this record is B6's publication)

Every block landed on `develop`; B5's fixtures, round record and UA verdict are above.
What the phase shipped, in one place:

- **Capability:** the compare overlay's Mobile-comparison switch → one session DNR rule
  (`declarativeNetRequestWithHostAccess`, why-commented in `wxt.config.ts`) rewrites the
  tab's document-request UA while the overlay is open and the setting is on; the halves
  re-render as 412×892 phone frames fitted to their column (cap 2.0, live rescale);
  `navigator.userAgent` is shadowed per half by the `ua-relay` (isolated world) /
  `ua-identity` (MAIN world) all-frames pair; every state change reloads both halves;
  closing the overlay or the tab's main-frame navigation tears the rule down (boot
  sweep + `tabs.onRemoved` as backstops); the PSI surface never renders the switch. The
  unit matrix pins the lifecycle state machine, the never-clipping fit (the
  `412k ≤ w ∧ 892k ≤ h` invariant), the rule/presentation invariants, and the
  rule derivation/validators.
- **Verified round:** the single green 6/6 run above (the throwaway spec, deleted after
  recording). The permanent browser pin for the sim is defined by 05f's rewritten
  device-sim rows; their suite execution stays the open browser-tier slot — every row's
  status is recorded there, nothing silently skipped.
- **Budgets** (derived at this publication; measured from a fresh `pnpm build` via
  `pnpm check:budgets`): two new raw-only rows in the small-script convention of the
  main-world row — `ua-identity` content script **6.5 KiB raw < 7**, `ua-relay` content
  script **10.3 KiB raw < 11**. The isolated script re-measured unchanged at
  **92.4 raw / 32.5 gzip < 95/34** (the row was raised at B4 for this phase's
  additions); the background worker holds its B2-derived 32 (**31.5** measured); the
  whole-build backstop **160.4 < 857**.
- **Firefox:** the runtime spot-check earlier assigned to B5's round is instead the
  manual smoke row recorded in 05f (suite 5) — not run yet, recorded, never silently.

### Shipped follow-ups (2026-10-12, post-B6 — same hardening round)

- **Rule-id encoding corrected** (recorded in full at the design's Shipped correction
  callout above): `id == tabId` shipped after the live overflow discovery; the encoding
  unit pin and the background sweep tests carry the regression rows now.
- **Reload continuity** followed the verified round's discovery that wp-rocket.me
  reloads itself at responsive breakpoints (reproduced without the extension — host-owned,
  not ours): the overlay now records its open state on the document URL
  (`entrypoints/isolated.content/side-by-side/session-open.ts`, tab `sessionStorage`,
  consume-once, exact-URL match, total-API degrade) and the boot path restores the
  overlay, letting the machine re-converge the persisted sim target. Verified live:
  6/6 restores across the host's self-reloads; permanent e2e rows added to
  `tests/e2e/suites/site-side-by-side.spec.ts` (reload-continues-the-compare incl. the
  `id == tabId` witness; a close leaves nothing behind).
- **Size gate latched** in the overlay view: the live gate held the first navigation
  only; a later squeezed measurement could strip a loaded frame's `src` (blank frame +
  a reload born from a layout transient). The view now latches the unlock and never
  re-locks — `src` removal belongs to nothing but the view's lifetime.
- **Budget re-derivation:** the background worker rose 32 → 34 KiB raw (audit-mandated
  hardening: the boot sweep's family identity became the rule's own shape through a
  `lib/device-simulation` predicate, and the store seam widened from id-listing to
  rule-listing; measured 32.3 fresh). No other row moved.

## Phases

| Phase  | Does                                                                                                                                                                                                                                                                                                                                                                                          | Depends | Parallelizable                                      | Definition of done                                                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | `lib/device-simulation/` pure core (profile, state+validators, rule derivation, `canSimulate`, `scaleFit`) + unit suites                                                                                                                                                                                                                                                                      | —       | B2 is factual-dependent but sequential commits fine | gates green; derivation/validators/scale pinned                                                                                                                                     |
| **B2** | Protocol rows + validators + background service (lifecycle incl. sweep/onRemoved/nav-hook) + manifest permission why-row + AGENTS.md permission note                                                                                                                                                                                                                                          | B1      | B3 ∥ B4                                             | service unit-pinned; `pnpm build` manifest carries the permission with its why                                                                                                      |
| **B3** | Identity pair entrypoints (allFrames verifications, doc-start timing) + composition/round-trip tests                                                                                                                                                                                                                                                                                          | B1, B2  | B4                                                  | both entrypoints unit/composition-pinned; `pnpm dev` loads them into real frames                                                                                                    |
| **B4** | Overlay integration: switch row + protocol wiring + reload orchestration + phone-frame presentation + resize observer                                                                                                                                                                                                                                                                         | B1, B2  | B3                                                  | state-machine tests green; scale recompute wired live on column resize (observer → helper → style) with clean teardown; presentation e2e-assertable in the mechanic suite's fixture |
| **B5** | Fixture additions (runbook lines) + verification round (throwaway probe) + UA-string verdict vs the plugin decision                                                                                                                                                                                                                                                                           | B1–B4   | —                                                   | round asserts green with evidence recorded; UA corrected if needed                                                                                                                  |
| **B6** | Publication: this doc's shipped record; 05e supersede annotation; 05f device-sim rows rewritten to this design; master-plan status; budget rows (two new content-script rows derived; isolated re-measured. The background re-derivation happened at B2 — its rule module, protocol rows, session service and the liveness probe grew the worker 27→32 KiB raw, the surface B2 owns); READMEs | B5      | —                                                   | all gates; budgets pass or re-derivations committed with reasons                                                                                                                    |

## Known edges (recorded, not hidden)

- One navigation request after a sim-on session converges to desktop — the request that kills the ghost rule was already written with the phone UA (header rules cannot retro-write an in-flight document load). The removal happens at the navigation signal it rides; the _next_ load is the tab's own again.
- The doc-start ask's answer outraces only some first-parsed page scripts; the server decision (the header rule) is timing-proof for every frame.
- DNR does not touch a page's own service-worker-served responses (`onfetch`/`CacheStorage`) — simulator scope on PWA-style sites is the tab's real network stack.
- Zoom vs transform: presentation uses `transform: scale()` (standard geometry, known hit-testing behavior), not `zoom`.

## Stack

No new dependencies. `browser.declarativeNetRequest` session rules (Chromium, Firefox; feature-detected at runtime), WXT content-script `defineContentScript` pair with all-frames injection (flag name verified against the installed WXT), Solid signals + Tailwind tokens (letterbox palette via the injected-UI theme model), Vitest (unit), Playwright (B5's throwaway round).
