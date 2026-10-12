# Phase 16.4 — Side-by-Side desktop-width presentation ("Desktop width", default on, auto presentation only)

**Depends on:** P16.2 (05g — shipped 2026-10-12: the overlay machine, the phone-fit machinery, the switch/latch patterns). **Effort:** M. **Parallelizable:** D1 ∥ D2. **Doc number:** the 05-family slot after 05h; the phase number continues the P16.x run (16 → 16.1 → 16.2 → 16.3). **Suites:** the mechanics rows ride `tests/e2e/suites/side-by-side.spec.ts`; no new suite. Coexists with 05h (P16.3, the engaged-device tag — it renders only inside the mobile switch while `phone()`, exactly where this phase's switch hides; never simultaneous).

## Request directives (verbatim intent, 2026-10-12)

1. The halves of the normal (auto/desktop) presentation show the page at half the panel width — tablet-like. Add an **extra toggle, ACTIVE BY DEFAULT**: ON ⇒ both halves render as if the browser had a real desktop-width viewport (the user suggested using the scale); OFF ⇒ today's plain fluid iframes.
2. When "Mobile comparison" is active, this toggle **MUST NOT RENDER** at all.
3. If active before mobile comparison, activating mobile must **not conflict** — the toggle yields to phone mode cleanly (verify in the state machine).
4. Think deeply about the **name** and propose it with rationale.

## TLDR

One new persisted option `features.sbsDesktopWidth` (**default on**) with a bar switch beside "Mobile comparison". It opinionates only the auto presentation: ON renders each half as a **1280px-floor desktop viewport** (iframe element width = `max(columnWidth, 1280)`, height fluid, scaled down by `transform: scale()` to fill the column) so in-frame media queries resolve at a real desktop width; OFF is today's fluid iframe. It is **layout-only** — no UA, no DNR, no reload, no background involvement: frames reflow live exactly as on a window resize. Mobile comparison overrides the visuals entirely (the machine's `session ? 'phone'` wins) while the option stays persisted and re-applies on the phone→auto return. The switch does not render on the PSI host and does not render while the phone presentation holds.

## Verified facts (code read 2026-10-12)

| Fact                                                                                                                                                                                                                                                                                                   | Source                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Presentation state is one machine field `presentation: 'auto' \| 'phone'`; the session↔presentation pairing `mirrorOf(session) = session ? 'phone' : 'auto'` is the contract every state change converges to                                                                                           | `lib/side-by-side/mobile-sim.ts:27,105-111,147-185,305-321`                                                                                              |
| The machine reloads both halves whenever the ask resolves to the wanted truth (`if (truth === wanted) io.refreshHalves()`) — keyed on _truth match_, not on a session flip                                                                                                                             | `lib/side-by-side/mobile-sim.ts:175-181`                                                                                                                 |
| Open reads `features.sbsMobileSim` fresh, asks availability, converges; a re-open with the setting unchanged must stay a pure reveal (no ask, no reload)                                                                                                                                               | `entrypoints/isolated.content/side-by-side/index.tsx:303-321`; `mobile-sim.ts:234-238`                                                                   |
| The overlay's persisted write-offs live on two different persist paths: sync on a serialized read-modify-write chain (`sbsPersistTail`), mobile sim unchained — a latent cross-write lost-update, exercised as soon as a third writer joins                                                            | `index.tsx:124-138` vs `index.tsx:205-225`                                                                                                               |
| Close removes the rule and mirrors the presentation to `auto`; the machine's `desktop` knowledge should survive close and re-apply on the next open                                                                                                                                                    | `mobile-sim.ts:263-303`                                                                                                                                  |
| The restore path (a host page reloading itself on the same URL) rides the same `openOverlay`: reads persisted options → `machine.open` → mounts → `presenter.syncNow()` → reveal                                                                                                                       | `index.tsx:288-339,483-495` (session flag: `session-open.ts`)                                                                                            |
| The size gate holds the first navigation until both fits exist and the view latches the unlock (never re-locks a loaded frame); auto navigates immediately                                                                                                                                             | `presentation.ts:83-86`; `ui.tsx:77-92`                                                                                                                  |
| `phoneFrameStyles` returns empty records in auto; the phone dress sizes a wrapper box to `viewport × scale` and transforms the frame from the top-left origin; fits come from `scaleFit` over the column's **layout** box (never `getBoundingClientRect` — the transform would poison the measurement) | `presentation.ts:55-69,219-221`; `scale-fit.ts:42-55`                                                                                                    |
| The presenter measures columns regardless of presentation (auto included) and re-measures live via a per-half `ResizeObserver` collapsing onto one re-measure                                                                                                                                          | `presentation.ts:96-118,166-209`                                                                                                                         |
| Media queries inside an iframe resolve at the **element's content box** (the iframe is its own viewport) — so a fixed larger element width + `transform: scale()` is a real viewport change, while scaling a fluid iframe is purely visual (MQs still see the half-panel width)                        | platform behavior; the phone half already proves in-page boxes drive in-frame layout                                                                     |
| The bar hides its controls on the PSI host under one `<Show when={!props.psiMode()}>`; the mobile switch additionally requires `sim().available === true`; switches are native checkboxes (`role="switch"`) restyled by tokens-only CSS                                                                | `ui.tsx:126-159`; `side-by-side.css:90-150`                                                                                                              |
| The mobile session's truth is server-visible: the DNR UA rule + the `· mobile` side tags; the desktop dress changes nothing on the wire                                                                                                                                                                | 05g's design + `ui.tsx:104-108,177-181`                                                                                                                  |
| Storage: option keys + fallback + tolerant validator (all rows seeded from documented defaults; unknown boolean keys carried)                                                                                                                                                                          | `lib/storage/options.ts:16-19,51-61,86-126`                                                                                                              |
| Budget headroom: isolated content script ≤ 95 raw / 34 gzip, last measured **92.4 raw / 32.5 gzip** at B6                                                                                                                                                                                              | `scripts/budgets.json:26-31`; 05g's Shipped record                                                                                                       |
| Neither behavioral source has this feature: the source's compare is a plain fluid iframe pair (no transform/width simulation anywhere), the second baseline has no compare at all ⇒ **net-new enhancement**                                                                                            | `../wpr-front-debugging-tool-legacy/content-scripts/sideBySide/` (repo-wide grep: no scale/width-sim); `../wpr-inspector` (grep: no compare/sim surface) |

## Recommendation

### Name — "Desktop width" (switch label); storage key `features.sbsDesktopWidth`

| Candidate           | Verdict                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop width**   | **Recommended.** States the exact mechanism (a desktop-width viewport), cannot be over-read (no device/DPR/UA claim), scans in two words, and survives future tweaking (it stays true if the floor number changes). Pairs cleanly next to "Mobile comparison" as the two mutations of what the halves show. |
| Desktop resolution  | The user's example. "Resolution" is device-pixel vocabulary (2048-wide _screen_, DPR); this simulates a CSS **viewport width** and nothing else — the label would promise a fidelity the option does not deliver.                                                                                           |
| Desktop viewport    | Technically exact, but "viewport" is jargon on a control surface whose sibling label is plain English ("Mobile comparison").                                                                                                                                                                                |
| Real desktop layout | Overclaims: layout follows media queries, but the switch fixes the viewport width — "layout" invites "everything is desktop" (fonts, DPR, pointer).                                                                                                                                                         |
| Full desktop width  | "Full" lies at the floor regime (the content is scaled down) and grows confusing when the column already exceeds 1280 (where it genuinely is full).                                                                                                                                                         |
| Desktop comparison  | Wrong shape: nothing new is compared — the same cached/bypassed pair re-presents itself.                                                                                                                                                                                                                    |

Exact user-facing strings: switch text **`Desktop width`**; switch `title` (tooltip, wording corrected at the 2026-10-12 audit round to state the floor instead of implying a fixed width): _"Render both halves at a desktop-width viewport (1280px floor, scaled to fit below it) — pages resolve their desktop media queries; the real requests never change."_ No side-label tag: unlike `· mobile` (a real request-identity state), the desktop dress is visually self-evident and adds nothing to the wire.

### Simulated width — canonical **1280px floor** with fluid-follow above

`frameWidth = max(columnWidth, 1280)`, `scale = columnWidth / frameWidth` (≤ 1 by construction), frame height `columnHeight / scale` so the scaled box fills the column exactly.

| Alternative                                | Why not                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Follow the real tab `innerWidth` live      | The host window's `innerWidth` is the whole window (the overlay covers the page, not a device); every resize tick would rewrite the iframe element width and re-layout both framed documents live (re-layout storms, unstable in-frame breakpoints mid-drag), and inside a narrow panel it would simulate _nothing_ — the toggle would no-op exactly where it is needed. |
| Fixed 1280×800 canonical box (letterboxed) | Wastes the column vertically (phones letterbox because the device has a shape; a desktop window has none) and fakes a fixed height that vh-units and height media queries would falsely honor.                                                                                                                                                                           |
| **Floor model (chosen)**                   | Below 1280 the width is canonical → rescale is **transform-only** (zero in-frame re-layout during resize — strictly more stable for scroll-sync than today's fluid halves); above 1280 it is the page's natural full-width desktop (visually identical to auto, `scale(1)` is inert). The scale recomputes live through the existing rescale presenter.                  |

1280 justification: the largest common breakpoint class (1200/1280 laptop CSS-px viewports) — every desktop media query in real themes resolves, and a deterministic width makes the behavior verifiable. **Height is deliberately fluid** (column height ÷ scale): desktop-ness is a width decision; the zoom-out math makes the frame see a proportionally taller viewport — exactly what a real desktop browser at that zoom shows (vh units and height queries see the honest zoomed height).

### Mechanism (the honest media-query facts)

The iframe's internal viewport **is** its element content box: `@media` and `matchMedia` inside the frame resolve against the element's width, and re-evaluate live when the element resizes — no reload, no navigation. The plan's dress sets a fixed element width larger than the half column and scales it down with `transform: scale(k)` (the same two-box structure the phone dress already uses: wrapper box = column size, frame = `frameWidth × columnHeight/k` scaled from the top-left origin). Alternatives rejected on honesty: scaling a **fluid** iframe (`width: 100%` + scale) changes nothing semantically — MQs still resolve at the half-panel width, a purely visual shrink (a lie); the browser's own device emulation is not reachable without `chrome.debugger` attach (the "is being debugged" infobar, tab takeover, a fight with the user's own devtools, and a new permission — least-privilege says no). Scroll behavior is standard: the frame's scrollbar is its own and renders scaled with the content; horizontal overflow past 1280 behaves as on a real desktop. Hit-testing inside transformed frames is the proven behavior the phone dress already relies on.

### State machine (where the new option slots in)

The machine owns the option as a field derived at open: snapshot gains `desktop: boolean`; presentation type becomes `'auto' | 'phone' | 'desktop'`; the pairing becomes

```
presentationOf(session, desktop) = session ? 'phone' : desktop ? 'desktop' : 'auto'
```

Events (all serialized on the machine's existing chain):

- **`open(psiMode, simTarget, desktopTarget)`** — PSI ⇒ return untouched (no option application there). Read-ask as today; `session = truthPhone`; `wanted = presentationOf(false, desktopTarget)`; if `wanted !== presentation`: a session transition or a leftover rule (`wanted === 'phone' || truthPhone`) goes through `command(wanted)`; otherwise the dress is **adopted without any set ask** (keeps the re-open reveal ask-free and reload-free — the previously loaded frames reflow live).
- **Mobile switch** `toggle(true)` → `command('phone')`; `toggle(false)` → `command(presentationOf(false, machineDesktop))` — the persisted option re-applies on the phone→auto return (directive 3's verified answer). `command`'s reload condition changes from _truth match_ to **session flip** (`sessionBefore !== answer.enabled` ⇒ `refreshHalves()`): phone↔auto/desktop reload (UA identity changed); a pure dress command (auto↔desktop, `applyState(false)` on an already-off rule) reloads nothing — the desktop toggle never reloads the halves.
- **`toggleDesktop(next)`** (new) — no ask, no reload, ever: update the option field; `presentation = session ? 'phone' : next ? 'desktop' : 'auto'` (a phone session _yields_ — directive 2/3 — the switch is not even rendered then, so this branch is defense); persist (read-modify-write); notify.
- **`pushed` / close / unavailable** — converge presentation through `presentationOf`; on an engine without DNR the machine still honors the desktop option (the mobile switch hides — as today — but the desktop switch renders and works: **Firefox takes this feature for free**, an explicit degrade in the right direction).

**Interaction matrix** (settled states; column = option value at rest):

| Event / situation                             | Desktop option off        | Desktop option on                                                                                                                                                                        |
| --------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile session off, fresh open (plain `auto`) | fluid halves (today)      | desktop dress; no ask beyond today's read; first open gated until both fits exist                                                                                                        |
| Re-open (same document, frames loaded)        | pure reveal, no ask       | pure reveal; dress re-applied live without reload                                                                                                                                        |
| Mobile session turns on                       | phone presentation        | phone presentation (option stays persisted; switch never rendered)                                                                                                                       |
| Mobile session turns off                      | `auto` + reload (UA back) | desktop dress + reload (UA back, then reflow) — the re-applied dress follows the reload's new inner facts                                                                                |
| Overlay closed                                | session removed; auto     | session removed; the option survives close and re-applies on next open                                                                                                                   |
| Host self-reload (restore)                    | today's restore           | same restore; open re-reads both options and converges the dress before the reveal                                                                                                       |
| PSI host                                      | switch absent; auto       | switch absent; auto (PSI never affected)                                                                                                                                                 |
| Engine without DNR                            | switch (mobile) hidden    | mobile switch hidden; **desktop switch renders and works**                                                                                                                               |
| Storage read fails at open                    | option ⇒ off              | option ⇒ its documented default (**on**) — matching what the validator's fallback would answer; sync/sim keep today's explicit off (owner's existing deliberate degrade, unchanged here) |

### UI

One `<label class="sbs-switch">` after the mobile switch, inside the non-PSI `<Show>` (`ui.tsx:126-176`), wrapped in its own `<Show when={!phone()}>` — **not rendered** (never `disabled`) while the phone presentation holds (directive 2). `checked = props.sim().desktop`; no busy/disabled state (no ask behind it; events serialize on the machine chain anyway). No new CSS: the shared `.sbs-switch*` classes and the wrap already recorded for narrow windows (`side-by-side.css:39-61`); tokens only, both palettes; the frame edge keeps the phone box classes minus the device border (the desktop box fills its column — a device-edge border would be a lie; either subclass or omit, verified visually at implementation).

### Plumbing

**Zero** message-contract rows, zero background work, zero manifest/permission changes, `wxt.config.ts` untouched: no DNR (UA untouched — the desktop cache copy is what the desktop dress correctly shows), no UA shadow, no storage beyond the options row. The persistence folds **all three** overlay feature writes (sync / sim / desktop) onto the one existing serialized chain (`index.tsx:205-225`) — the second writer joining the chain removes the latent sim-vs-sync lost-update too.

## Tests

Unit (first, co-located):

- `lib/side-by-side/desktop-fit.test.ts` — pure math matrix: floor regime (`scale = c/1280`, box fills the column, in-frame height `H/k`), fluid regime (`scale(1)`, width = column), continuity at the 1280 boundary (no jump, no oscillation under resize), zero-space column ⇒ `null`, invalid measurement throws with the offending numbers.
- `presentation.test.ts` — `frameStylesFor` (renamed) per presentation: auto empty; desktop wrapper = column box, frame = floor width ÷ scaled height, top-left origin; `framesMayNavigate` requires both per-side fits in desktop like in phone.
- `presentation-state.test.ts` (renamed from `mobile-sim.test.ts`) — the full matrix above as machine rows: open converge (desktop-on first open gated, no set ask, stale-rule descope), both toggles (no-reload for dress, reload keyed on session flip), phone yield + return re-application, close/close-reopen, pushed convergence, unavailable-engine desktop, PSI no-op, persisted-write chain order (sim toggle + desktop toggle write in event order).
- `lib/storage/options.corrupt.test.ts` — `sbsDesktopWidth` seed default on, tolerant carry, wrong-typed ⇒ default.

Browser tier (`tests/e2e/suites/side-by-side.spec.ts`, mechanics — no site truths exist for a layout-only feature):

- Flip Desktop width on → both halves report `matchMedia('(min-width: 1280px)').matches === true` _through the open shadow root's frames_, without any navigation (matchMedia flips live — the reflow-without-reload proof); off → false, same liveness.
- Mobile comparison on → the desktop switch is absent from the shadow DOM (never hidden-but-disabled); the '· mobile' state holds; desktop off again and mobile off → the dress returns per the persisted option (matrix rows 3–4).
- Persistent option: desktop on → reload the fixture page → the restore path re-opens with the desktop dress (matchMedia true again) with no switch interaction.
- Narrow-window sanity alongside 05g's wrap row (no trap).

## Phases

| Phase  | Does                                                                                                                                                                                                                                                                                                                                                                                                            | Depends | Parallelizable | Definition of done                                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | Pure geometry: `lib/side-by-side/desktop-fit.ts` (floor constant + `desktopFit`), combined per-side fit record, `frameStylesFor` rename + per-presentation dispatch in `presentation.ts`, `framesMayNavigate` extension                                                                                                                                                                                         | —       | D2             | compile/lint/format/test gates green; floor/continuity/null matrices pinned                                                                                                |
| **D2** | Storage row (`lib/storage/options.ts` + validator + corrupt tests); machine rework: rename `mobile-sim.ts` → `presentation-state.ts`, `SimPresentation` → `FramePresentation`, snapshot `desktop` field, `presentationOf`, reload-keyed-on-session-flip, `toggleDesktop`, `open` signature, unavailable/PSI branches; persist chain fold for all three writes in `index.tsx`                                    | —       | D1             | machine matrix unit-pinned end to end; corrupt-storage rows green                                                                                                          |
| **D3** | Bar UI: the switch (hidden-when-phone, non-PSI inherited), checked binding, tooltips, wiring of combined fits into styles + the latch/gate plumbing in `ui.tsx`/`index.tsx`; presentation-change recomputes fits (measure once → both fits — no race)                                                                                                                                                           | D1, D2  | —              | e2e-assertable toggle behavior on the fixture; no reload on dress change (assert surfaces above); theme tokens only; `pnpm dev` visual check both palettes + narrow window |
| **D4** | Continuity restore row + publication: e2e rows in `side-by-side.spec.ts`; `pnpm build && pnpm check:budgets` (isolated re-measure; expected ≈ +1–2 KiB raw against 2.6 KiB headroom — re-derive with reason if breached, KC-seed precedent); `docs/plans/README.md` doc-table + status rows; 05f suite-1 paragraph gains the desktop rows; AGENTS.md needs nothing (no script/deps/permission/structure change) | D3      | —              | all gates + budgets green or re-derived; e2e rows green in `pnpm test:e2e`; README rows landed                                                                             |

Touched files per phase — D1: `lib/side-by-side/desktop-fit.ts` (new), `entrypoints/isolated.content/side-by-side/presentation.ts`, both `.test.ts`. D2: `lib/storage/options.ts`(+test), `lib/side-by-side/presentation-state.ts` (renamed, +test), `entrypoints/isolated.content/side-by-side/index.tsx`. D3: `ui.tsx`, `presentation.ts` (styles dispatch), `index.tsx`, `side-by-side.css` (at most a border subclass). D4: `tests/e2e/suites/side-by-side.spec.ts`, `docs/plans/README.md`, `docs/plans/05f-…suites.md`, `scripts/budgets.json` (only on breach).

## Risks / open questions

- **Reload-rule change touches shipped behavior** (truth-match → session-flip keyed): the difference is only observable as "no reload where the UA never changed" — covered by re-pinned matrix rows plus the standing phone-suite rows (05f), so a regression cannot hide.
- **Wrapped desktop floor** (1280) is a constant, not a setting. Owner may later want it configurable or per-breakpoint — recorded as an open decision; the floor model makes that a one-constant change.
- vh/height queries inside the frame see the zoomed-out height (honest zoom-out, not a real second monitor's height) — recorded in the tooltip wording, not hidden.
- The dress change reflows framed documents live (standard iframe element-resize behavior); the fix's round asserts matchMedia flips without navigation — if an engine ever full-reloads on element resize (non-standard), the round catches it.
- Column wider than 1280 renders the page at native scale (`scale(1)`) — indistinguishable from auto by design; the switch then no-ops visually. Documented, not a bug.
- Storage-failure degrade for the desktop option differs from sync/sim's explicit off (their default flipped to on after their code was written). Left untouched deliberately; flagged for the owner as a possible follow-up harmonization — not this phase's job.

## Stack

No new dependencies: TypeScript/Solid signals in the existing modules, one pure helper, tokens-only CSS, Vitest unit rows, Playwright mechanics rows. Chromium + Firefox both first-class here — the feature is engine-neutral where the mobile comparison is not.

## Shipped (D1–D4, 2026-10-12)

Implemented as planned, with the deviations the verification round earned:

- **The flex-clamp finding (D3's visual/e2e round):** the dressed frame's `width: 1280px` was being **flex-shrunk back to the column width** inside `.sbs-viewport`'s flex layout — the style attribute showed the desktop width while `clientWidth` (what `@media` and `matchMedia` resolve against) reported the clamped half column, so the dress rendered but simulated nothing. The frame's inline record now carries `flex: 0 0 auto` in **both** dressed presentations (the phone dress had the same latent defect below ~500 px windows, where it had gone unnoticed — no row measured the frame's own box there). Both `frameStylesFor` pins now carry the property; the mechanics suite's matchMedia rows are the regression pins.
- **The re-measure wiring:** a first implementation used a module-scope `createEffect(on(...))` — outside any Solid reactive root it never registers; the presentation-change re-measure lives in the machine's `onChange` callback instead (a `measuredFor` key guards it to actual changes). The open path's own `syncNow()` keeps arming the first measurement after the mount.
- **Machine rework (D2) as planned:** `mobile-sim.ts` → `presentation-state.ts` (`presentationOf` exported), `SimPresentation` → `FramePresentation` (+ `'desktop'`), the snapshot's `desktop` field, the reload re-keyed on the session flip (the re-open "already on, still re-navigate" and the descope rows pinned both ways), `toggleDesktop` (never asks, never reloads; a phone session yields and the dress re-applies on the return), the unavailable-engine degrade still honoring the persisted dress (the desktop switch works there — Firefox takes this free), and the psi branch untouched. The open path adopted the dress **before** the capability branch (knowledge, not a request) and assigns `session = truth` only where the flip keying needs it (the descope), never between the fresh already-on command's key.
- **Persist fold (D2) as planned:** one `persistFeatures` chain helper owns all three writers (scroll sync, mobile, desktop) — the latent sim-vs-sync lost-update folded away.
- **Tests:** `desktop-fit.test.ts` (both regimes + boundary continuity + throws), `presentation.test.ts` rewritten for `frameStylesFor` + the flavored `measureColumnFit` dispatch + the foreign-flavor empties, `presentation-state.test.ts` the full matrix (41 rows — **44 after the audit round**), storage pins extended for `sbsDesktopWidth` (seed/absence/wrong-type/tolerant-carry rows all green — the contract extension the commit message records), `badge.test.ts` exact-write rows updated for the required key. Vitest: **627/627** (55 files) at publication, **630/630** after the audit round.
- **E2e (D4):** three new mechanics rows (live matchMedia flip without navigation + the transform-only squeeze pin + the off return; the yield-to-mobile and persisted return; the reload-restore dress) ride the standing suite; the full tier at publication: **48/48**.
- **Budget re-derivation (the KC-seed precedent):** isolated content script **95 → 97 raw** (gzip ceiling untouched at 34). Reason: two same-day feature phases consumed the surface's headroom — 05h ≈ +0.2 KiB and this phase's machine rework + switch + fit dispatch ≈ +2.9 KiB (measured 95.7 at the first gate, 95.5 after the final build and 95.7 after the audit round; forecast by this doc's plan at ≈ +1–2 KiB against pre-05h headroom). The growth is the feature itself — the flex `0 0 auto` properties, the desktop-fit module, and the machine's third presentation state — with no dead code found for a trim (the presentation-state + desktop-fit code paths are all live). Raising is the gate's documented owner-directed-growth path, recorded here as the row's history.

## Shipped follow-ups (the audit round, three independent adversarial auditors + fixes, 2026-10-12)

- **MAJOR — the reload key could be corrupted by the command's own push:** the
  background notifies the tab's settled state **before** the set ask's reply resolves
  (`device-simulation.ts` dispatches `deviceSimulationChanged`, then returns); the
  flip key was read from the machine field after the await, so a push landing
  mid-await would silence the identity reload — phone-dressed frames showing
  real-UA documents, in both directions, undetectable by the pinned rows. The key
  is now captured at the command's entry (`flipFrom`), immune to the push's
  correction; every pinned row re-derived green against it.
- **MAJOR — the first-load gate's own pin contradicted its comment:** the comment
  promised "a foreign flavor does not ungate the dress" while the gate was
  existence-only and the pin asserted the violation. `framesMayNavigate` is now
  **kind-aware** (enforcing "loads once, at its rendered size" by construction);
  the pin asserts the enforced contract.
- **Real minors, all fixed:** the re-open pure reveal required the fresh truth's
  agreement (a rule that died without pushing can no longer settle
  `session:false` under `presentation:'phone'` — it converges through the add
  command instead); `toggle`'s no-op ignores `failed` (the switch's retry copy
  can no longer dead-end on a failed settle); the machine's settling close no
  longer re-arms the rescale presenter after the wiring stopped it
  (`isOpen()` gates the onChange-driven re-measure; the open path re-measures
  unconditionally); the `setDeviceSimulation` reply passes the boundary
  validator (`parseDeviceSimState`, malformed → the machine's failed branch);
  close's early branch now writes `session = false` locally.
- **Pins added:** the command's own mid-flight push cannot skip the reload
  (unit); the reveal-with-dead-truth convergence (unit); the failed settle's
  switch flip commands rather than no-ops (unit); the disengage's reload is
  asserted in the browser tier (a fresh `performance.timeOrigin` per half —
  the reload-keying regression class is no longer invisible to e2e);
  `expectPhoneSession` pins the two `· mobile` side marks.
- **Copy/records:** the desktop switch's tooltip states the floor
  ("1280px floor, scaled to fit below it") instead of implying a fixed width
  at the ≥1280 regime (where `scale(1)` is inert and the viewport is the
  column's own width) — the plan's quoted string updated with it; the stale
  "two switches" headers (ui.tsx, index.tsx, side-by-side.css) and the
  gate-latch comment now name all three dressed presentations; the storage
  degrade's desktop default is imported from `options.ts`'s exported
  `FALLBACK` (the one-declaring-site rule) instead of a re-typed literal;
  the master plan's shipped row corrected to 3 mechanics e2e rows.
- **Verified-with-limitations finding, no action owed:** the pre-existing
  05g geometry nit (`.sbs-viewport--phone` is content-box, so at a column of
  exactly 412 px the 1 px border bleeds 2 px outside the half) — recorded in
  the audit as pre-existing, deliberately untouched this round.
- **Gates at this round's close:** compile/lint/prettier green; vitest
  **630/630** (55 files); budgets isolated **95.7 < 97** raw / 33.6 < 34 gzip;
  full e2e tier **48/48** (mechanics 7/7).
