# Side-by-Side: shipped P16–P16.4 and open verification

## TLDR

Scroll sync, overlay-scoped mobile comparison, the device label and desktop-width presentation shipped 2026-10-11/12. P16.1 is **partially verified**, not complete: permanent cross-origin/UA-copy coverage and Firefox/external smokes remain below. This record supersedes the original generic per-tab mobile proposal; it is not a new implementation plan.

Dependencies at delivery: P16 after P1–P4/P4.3; P16.2 after scroll sync (identity/UI work parallel); P16.3/16.4 after P16.2 (desktop geometry/state work parallel). No new dependency packages; DNR permission and two all-frame entrypoints were intentional additions. Optional P17 panel-home work stays decision-gated in master.

## Scroll sync (P16)

- `features.sbsScrollSync`, persisted, **default on** (owner changed original off). Header switch applies live; external setting writes apply next open, not via watcher. No PSI switch: analyses have unrelated structure.
- Pure mapping: source range=`scrollHeight-clientHeight`; target=`round(clamp(sourceY/sourceRange)×targetRange)`. Zero range cannot drive; direct invalid inputs throw. DOM adapter treats torn metrics as transient null.
- `lib/side-by-side/scroll-sync.ts` owns math/burst driver; entrypoint `sync-session.ts` owns DOM lifetime. Document-only capture-phase scrolling, rAF coalescing, fresh metrics/burst; ignore nested scrollers. Apply instant scrolling so host smooth behavior cannot feed back.
- Receiving-side suppression lasts two token-guarded animation frames; continued drive extends it, later user input retakes control. Round-trip rounding is idempotent after one rebalance, not necessarily position-preserving at disparate ranges. Refresh re-adopts; close/invalidation removes listeners/flags.
- Cross-origin attach/read/write refusal blocks that half once/session, displays “not synced (different origin),” no repeated-error storm; healthy half remains free. Register load/re-adopt before first contentWindow read so late frames join.
- Open must await async UI mount/ref registration **before** starting sync; otherwise default-on idempotently arms over empty slots. Permanent open→bottom mapping test requires no switch interaction.

Evidence: pure equal/unequal/invalid/zero/rounding/suppression/refresh/teardown tests; permanent mechanics+real-cache suites. One deleted dual-origin probe verified blocked marker, no storm, independent half and usable switch. Initial full tier36/36×3; later six green runs after one transient site failure. Budget85/30→88/31 KiB (87,140 B raw/30.1 gzip; +3,631 B engine/session/switch). Shared System-palette reset bug was fixed and permanently theme-pinned; unknown boolean feature keys now survive persistence.

## Mobile comparison (P16.2)

### Binding scope and identity

Owner refinement2026-10-11: **one phone, UA plus real viewport, overlay only**. Both halves reload when identity changes; close restores identity. No generic mobile-tab menu, simulated badge, popup row or standalone chip. Those tasks are **withdrawn**, not deferred. PSI untouched.

- `features.sbsMobileSim` defaults off. One tab-scoped **session** DNR `modifyHeaders/set` rule covers `main_frame`/`sub_frame` only: host fetch/XHR keeps real UA. `declarativeNetRequestWithHostAccess` acts only within declared HTTP hosts and avoids the base permission's install warning.
- Rule ID **equals tab ID**. Original `1_000_000_000+tabId` overflowed Chromium's int32 limit on real tab IDs up to2.04B; INT32_MAX succeeded, +1 failed live. Family sweep identifies owned rule **shape**, not the retired base. Do not reintroduce an offset without proving range safety or sweep unrelated future rules.
- Await add/remove before frame navigation. Remove on switch-off, close, invalidation, main-frame navigation and tab removal. Boot lists rules, verifies live tab+reachable isolated script and removes ghosts; session rules survive SW idle, not browser shutdown/install/update. No SW map as source of truth, no `webNavigation` permission.
- Additive sender-resolved get/set/push protocol; domain validators at both boundaries. PSI enable refused service-side too. Detect actual DNR availability; namespace-absent returns unavailable, no switch/rule attempts. Firefox supports the mechanism with permission (probe later confirmed); **runtime feature smoke remains open**.
- One profile in `lib/device-simulation/profiles.ts`: id `phone`, **Generic Android phone**, viewport412×892 portrait, UA `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36`. Major155 was verified at implementation; Android10/K is reduced-UA static shape, not a claim of emulating that OS/hardware.
- `ua-relay` isolated and `ua-identity` MAIN run document-start/all-frames, including redirects. Relay caches boot ask/live state; MAIN shadows/restores original navigator descriptor. Listen before send: no-listener window sends never settle. Messaging means earliest synchronous parsed script can still read real UA; **before first rAF**, not before every first script, is the browser-tested bound.
- Do **not** claim touch/pointer, DPR, keyboard, client hints, WebAuthn trust or full device emulation. DNR cannot change a page service worker's CacheStorage/onfetch responses. A navigation killing a live rule may already carry phone UA; next navigation is restored—rules cannot rewrite an in-flight request retrospectively. Inter-extension header precedence remains a release risk.

### Geometry and lifecycle

- Genuine iframe412×892 content box, wrapper at scaled size, top-left transform. `k=min(columnW/412,columnH/892,2)`, measured from layout/client box, not transformed bounding rect. Complete letterboxed phones even at tiny sizes; readability is the tradeoff. Live ResizeObserver rescale never reloads.
- Two columns always. Very tall portrait windows could fit stacked phones larger (H/W>892/412), but owner did not choose layout oscillation/new side semantics. Do not add stacking silently.
- Phone pair gathers toward shared edge with facing4px transparent borders (8px gap); fit uses reduced content box. `flex:0 0 auto` prevents both dressed frame widths from shrinking back to columns. Known retained nit: content-box phone border can bleed2px at exactly412px column.
- Presentation mirrors actual rule truth, not optimistic preference. Rejected commands expose failure/retry and retain honest active marks if rule still on. Close clears locally as well as best-effort removal. State machine serializes commands.
- Same-URL host self-reload continuity uses namespaced sessionStorage href, exact-match/consume-once; corrupt/unavailable storage means no restore. This reviewed host-storage exception stores no sensitive state. A close clears marker. First-navigation size gate latches open forever/view so later squeeze never removes `src`/blanks frames.
- Device tag lives inside switch label, derives from profile `displayName`, shows only settled phone presentation (including truthful still-active failure), disappears on disengage. Side labels `· mobile`; no separate label state/persistence/CSS. Owner approved “phone,” not “device.”

### Verification and budgets

2026-10-12 throwaway local-site round6/6 (deleted after recording): UA echo byte-exact both halves on/off,412×892 before-rAF shadow, persisted-on first open, second tab unchanged, tiny300×400/large2400×2000 fit+2× cap, resize without reload, `wpr_mobile`↔`wpr_desktop` served copies/cache files. Plugin MobileDetect returned phone1/tablet0. PSI flow was **locally intercepted**, proving mechanics only, not real PSI content.

Fixtures: uncached `/wp-json/fdt/v1/ua-echo` (no-store/plugin REST bypass) and `fdt-mobile-cache=1` force separate copies; runbook/CDP smoke owns them. Permanent `site-side-by-side.spec.ts` subset pins session rules/ID, reload continuity, close/reload clear, squeeze latch, device tag restore/off, identity reload via per-half time origins and side marks. Echo/mobile-copy/all-independence assertions are **once-verified, not all permanent**.

Unit coverage: profile/rule ID+exact header conditions, hostile inputs, availability/site/PSI decisions, fake-DNR lifecycle/sweeps, fit invariant/cap/monotonicity, descriptor restore, real-window relay composition and state-machine command ordering. Follow-ups fixed rule overflow, restore and gate defects.

Budget derivations: worker27→32 KiB for service/protocol/liveness, then34 (32.3 measured) for shape-safe rule sweep; isolated≤95/34 at initial mobile delivery (92.4/32.5 measured). New raw-only scripts identity6.5<7, relay10.3<11. Device tag~0.2 KiB plus desktop work required isolated97/34; final95.7/33.6. These are historical; use current budget table.

## Desktop width (P16.4)

Owner requested default-on desktop-width halves rather than tablet-sized columns; mobile must hide/yield this toggle. Shipped2026-10-12.

- `features.sbsDesktopWidth` true; label **Desktop width**, because CSS width only—not resolution/full device emulation. Tooltip names **1280px floor, scaled to fit below it** and unchanged requests. No side mark: no network identity change.
- `frameW=max(columnW,1280)`, `k=columnW/frameW≤1`, `frameH=columnH/k`. Wrapper fills column. Below floor, width fixed and transform changes (height remains fluid); above floor, natural1× layout. Iframe `matchMedia` reads the real content box: scaling a fluid iframe alone would be false simulation. No debugger permission, fixed-height letterbox or tab-innerWidth tracking.
- `presentationOf(session,desktop)=session?'phone':desktop?'desktop':'auto'`. Machine renamed `presentation-state.ts`, snapshot owns desktop preference. Desktop toggle never asks service/reloads; mobile identity flips reload both, then restore persisted desktop preference. Fresh/reopen/host-restore honor it; unchanged reopen is pure reveal only if fresh rule truth agrees. PSI skips; desktop still works without DNR.
- All three option writes (sync/mobile/desktop) share one serialized read-modify-write chain to avoid lost updates. Storage failure uses documented desktop default from owner `FALLBACK`; sync/mobile retain explicit-off degrade (possible future harmonization, not silently changed).
- Gate requires fits of the **current presentation kind**, not just any existing fit. Machine onChange drives remeasurement only while open; module-scope Solid effects have no reactive owner and did not work. Open remeasures after mount.
- Identity reload key captured **before await**: command's own push arrives before response and must not erase the flip. Reply is validated; failed settles remain retryable. Closing cannot re-arm presenter through settling onChange.

Evidence: geometry null/invalid/boundary/continuity tests, storage fallback/carry tests,44 machine rows after audit. Three permanent mechanics additions: live matchMedia flip/token-stable no-navigation+subfloor squeeze/off-return; mobile hides desktop then restores preference; persisted reload opens desktop without touching switch. Frame flex-shrink regression is pinned by actual client/MQ width, not style string. Final630 unit/48 browser tests (mechanics7/7), gates/budgets green. Isolated95→97 raw, gzip34 unchanged: feature code~2.9 KiB plus tag~0.2, no dead trim found. Configurable floor remains owner decision, not scheduled scope.

## P16.1: remaining verification

Do not mark the whole suite phase complete from mechanics passing:

- [ ] Permanent dual-origin sync-degrade pin: one blocked marker, no repeat errors, healthy half independent, switch usable. `fdt-redirect=cross` was dropped/not built; add a dual-origin fixture, not a false same-origin test.
- [ ] Promote once-verified UA echo/mobile-cache copy, second-tab independence and PSI-no-leak round to permanent assertions where feasible. Existing rule/continuity/tag subset does not prove every network/page-copy claim.
- [ ] Firefox manual: permission-gated DNR, mobile rule/identity/viewport, scroll sync, desktop width; absent namespace must return unavailable without calls. Playwright cannot load Firefox extensions. Record result in Firefox/P15, not build-only success.
- [ ] Authorized external real mobile-cache site, independent tab and restoration (P14.6/P15); real PSI production behavior. Stub flow evidence is insufficient.
- Real-device touch/DPR/etc. and PSI scroll semantics remain deliberate non-emulation, not test failures.
