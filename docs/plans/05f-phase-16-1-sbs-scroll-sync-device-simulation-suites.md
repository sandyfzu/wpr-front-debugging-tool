# Phase 16.1 — SBS scroll-sync & mobile-comparison browser suites

**Depends on:** P4.1 (harness), P4.2 (site), P16 (05e) + P16.2 (05g). **Effort:** S.

> Fixes P16's browser-observable half: scroll-sync mechanics over real frames, and the
> mobile comparison's round trip over the local site. Each item names its assert
> surface; manual rows are recorded with reasons, never silently skipped.
>
> **Rewritten at P16.2's publication (B6, 2026-10-12):** the device-sim rows below now
> describe the shipped overlay-scoped design (05g) — the pre-refinement rows described
> a control surface (menu flip, badge mark, overlay chip, popup row) that never
> shipped. Every suite's status is recorded on its row.

## TLDR

Automate what the unit suites cannot reach: proportional sync across real frames
(shipped), and the comparison round trip over the local site — while the overlay is
open, its header switch turns one session DNR rule on (document requests carry the
verified phone UA), both halves reload into 412×892 phone frames, the page world's
`navigator.userAgent` matches inside every half, and WP Rocket's separate-mobile-cache
served copy flips to `wpr_mobile`; switch off or close the overlay and the tab is its
own again (arrives as `wpr_desktop` under the flag). Everything else stays untouched.

## Site fixtures (recorded in the P4.2 doc's fixture list)

- **UA-echo endpoint** — shipped (P16.2 B5): `GET /wp-json/fdt/v1/ua-echo`, the
  uncached `text/plain` echo of the requesting UA (+ marker line); runbook rows in
  `docs/local-site-runbook.md`, permanently pinned by the site smoke
  (`docker/scripts/cdp-smoke.mjs`, scenario 3).
- **Separate-mobile-cache flag** — shipped (B5): `?fdt-mobile-cache=1` forces
  `do_caching_mobile_files` on per request; the `wpr_mobile`/`wpr_desktop` generator
  markers are the round trip's verdict.
- **Cross-origin redirect flag** (`?fdt-redirect=cross`) — **dropped, never built.**
  The scroll-sync degrade's evidence ran live once over a throwaway dual-origin
  fixture (05e's audit record, 2026-10-11); no permanent flag was built afterwards.
  Recorded here, not silently skipped; the standing pin is suite 2 below.

## Suites

1. **Scroll-sync mechanics** — **shipped:** pinned by
   `tests/e2e/suites/side-by-side.spec.ts` — message-driven open mounts the shadow
   overlay with both cache states; per-side refresh keeps the other side's body; close
   restores `html`/`body` overflow and scroll exactly and a re-show keeps the frames;
   and the open-path case proves sync arms from the open itself with the persisted
   default on (open → drive one half to its bottom → the other reaches its mapped
   bottom, no switch interaction). The real-cache truths ride
   `tests/e2e/suites/site-side-by-side.spec.ts` (cached/bypassed frame pair, the
   served footprint, per-side refresh re-navigation, close restore). **The suite
   grew three desktop-width rows in the 05i round (2026-10-12, suite still green
   7/7):** the dress's live `matchMedia('(min-width: 1280px)')` flips without
   navigation (token-stable) incl. a transform-only squeeze below the floor and
   the live off-return; the desktop switch's yield to (and return after) the
   mobile session; and the persisted dress surviving the fixture's own reload
   (the restore path re-opens dressed with no switch interaction).
2. **Cross-origin degrade** — **not run permanently; verified live once** through the
   throwaway dual-origin probe (05e's audit record): the affected half flips once to
   its per-side "not synced (different origin)" state, the other half keeps syncing,
   no console error storm, the toggle remains functional. The permanent pin stays an
   open browser-tier row (assert surface as stated; the dropped flag above is the
   missing fixture).
3. **Mobile-comparison round (P4.2 site)** — **verified live once** by 05g's green
   round (6/6, 2026-10-12; permanent execution open):
   - open with the setting persisted on: both halves reload, the echo body reads the
     profile UA byte-exactly in every half, the frames present 412×892 (fit-scaled),
     and the in-half `navigator.userAgent` matches — the shadow pinned to land before
     the page's first animation frame;
   - switch off: both halves reload to the browser's real UA and the fluid frames;
   - under `?fdt-mobile-cache=1` the served copy flips `wpr_mobile` ↔ `wpr_desktop`
     with the session direction (the served-copy assert surface);
   - close with the session on: a subsequent navigation's echo reads the real UA (the
     rule cannot survive the overlay — owner directive 4);
   - rule-level asserts ride CDP the way the mechanics tier asserts service-worker
     state (session rules carrying the tab condition + the profile header).
   - **Permanent subset shipped (2026-10-12, the 05g follow-up round):** the
     compare-continuity rows in `tests/e2e/suites/site-side-by-side.spec.ts` pin the
     rule-level asserts through the store (`getSessionRules` — the rule id equals the
     owning tab id, the encoding the toggle bug pinned), the reload re-engagement, the
     close-then-reload clear, and the latched size gate under a real squeeze. The echo
     body / mobile-cache served-copy asserts above stay the recorded once-verified
     evidence until their permanent rows land.
   - **Device-tag rows (2026-10-12, 05h):** the round's `expectPhoneSession` helper
     now also asserts the engaged device's name beside the switch (restored sessions
     included) and a dedicated row pins the disengage branch (tag leaves, switch
     stays rendered and unchecked, the rule retracts).
4. **State honesty** — **verified live once** (05g's round): a second tab's requests
   and page identity are unaffected throughout; on the PSI host the switch never
   renders and no session rule leaks to the auto-flow. Visibility lives in the overlay
   itself (the side labels' `· mobile` suffix while the phone presentation holds) —
   the superseded design's badge mark, chip, menu row and popup row are dropped by
   owner refinement.
5. **Unavailable path (Firefox)** — **manual smoke, recorded not run:** an engine
   without the DNR namespace must return `available: false` to the boot ask, never
   render the switch, never attempt a rule call. Reason: Playwright cannot load
   extensions into Firefox and the temporary add-on is a GUI flow — the tier's
   documented limitation; the smoke lands with the release's manual smokes (P15's
   browser matrix).

## Definition-of-done state (2026-10-12)

- Suite 1 is green in the permanent tier (**7/7** since the 05i desktop rows); suites 2–4
  carry their once-verified evidence (05e's audit record, 05g's round record) with the
  newly-shipped permanent subset landed this day; the standing open browser-tier slot
  remains the cross-origin degrade's permanent pin (suite 2 — it needs the dual-origin
  fixture), and suite 5 is the recorded manual smoke (P15's release matrix).
- The shipped fixtures' runbook rows landed at B5; the budget rows were derived at the
  same publication — `ua-identity` 6.5 KiB raw < 7, `ua-relay` 10.3 < 11, isolated
  re-measured unchanged under 95/34 (05g's Shipped section). The follow-up round
  re-derived the background worker 32 → 34 KiB (its Shipped section).
- No row here is silently passed or skipped; every non-green row states why.

## Stays manual

Real-phone-vs-simulation subtleties (touch, DPR, keyboard shape are not emulated — the
honesty rule keeps the visible difference; the viewport _is_ emulated in the halves);
PSI-analysis scroll semantics (no toggle there, per 05g's recorded reason); the Firefox
runtime (suite 5).
