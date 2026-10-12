# Phase 5 — Strip design brief: the on-page inspector strip's visual spec

**Status:** binding design deliverable of P5H (the study's still-open row — [`06a`](./06a-phase-5-ux-study.md) header) · produced 2026-10-12.
**Consumed by:** P12 ([`13-phase-12-on-page-inspector.md`](./13-phase-12-on-page-inspector.md)) implements this spec item by item; deviations are **reported, not invented** (§16 template). P15 audits the shipped strip against it.
**Constrained by:** the committed study (`UX-D6` motion/density, `UX-D7` status vocabulary, `UX-D9` no dead ends, `UX-D11` strip = same product on the page, `UX-D12` plugin-native naming, `UX-D14` registry-driven) · the master plan's mechanics row (§9 "Floating detection strip + tools row") · P12's own task list (opt-in per origin, extension storage, one shortcut, pointer drag, quick-action contract) · the P0 tokens ([`assets/css/tokens.css`](../../assets/css/tokens.css)).
**Second baseline audited for behavior, not style** (docs may reference it; code never does): the floating strip of the `wpr-inspector` source (v4.1.1 — `templates/inspector.html` + `css/inspector.css` + `js/draggable.js`, full-source read 2026-10-06 and re-walked design-time 2026-10-12): chip groups with verbatim labels, class-driven states (`enabled` green / `disabled` red / `unsure` amber / tool chips blue + clickable), a fixed column ~100 px wide, cookie-persisted drag position, per-tool panels with an outcome message strip. What carries over is **behavior and information structure** (groups, states, footer stamp, drag, outcome messages); the visual language below is a redesign on the P0 tokens — the source's hardcoded dark styling, `10px` squeeze and cookie state do not carry over (P12's quirk table owns the behavioral fixes).

## TL;DR

The strip is a small floating card on the host page — the same product as the panel (same tokens, same status vocabulary, same appearance model — `UX-D11`), compressed to a glanceable, drag-anywhere pill-card that must not fight the host: ~224 px wide, one inner scroll region, every interactive element a real button with a ≥ 24 px hit box and a visible focus ring, honest `unsure` states that explain themselves in tooltips, and exactly one outcome banner for tool results. Every decision is an `SB-Dn` id with its constraining `UX-D`/`F` ids recorded (§17 index); P12 implements the ids, reports deviations per §16, and redesigns nothing ad hoc.

## 1. Inputs the brief depends on (owned elsewhere — referenced, not re-specified)

| Input                                                              | Owner / source                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Chip labels (`shortLabel`, verbatim parity forms) + groups + order | P11 registry `hud` facet (one row → card, chip, report)                                                                               |
| Detection statuses per feature + cache timestamp + exclusion hints | P11 statuses + `formatCacheTimestamp` (panel/strip shared)                                                                            |
| Opt-in per origin, per-origin persistence, `Alt+H`, drag clamp     | P12 tasks §1/§3 (storage `local:on-page-inspector`)                                                                                   |
| Tool runtimes + outcome copy                                       | P13/P14 (§4 quick-action contract)                                                                                                    |
| Appearance model + `[data-theme]` semantics + live-follow          | P0 tokens + the P5H conformance fix (§13, `SB-D15`)                                                                                   |
| Isolation standard                                                 | [`06` §"Injectable-UI isolation standard"](./06-phase-5-devtools-panel-shell.md) — shadow root, adopted styles, no page CSS in or out |

## 2. Chrome, positioning, stacking — `SB-D1`

- One floating element. Because the shadow host is reset with `all: initial !important`, positioning rides an **inner "chrome" element** (`position: fixed`), exactly the shipped injected UIs' verified pattern (`kc-chrome`, `sbs-overlay`); the host element itself never receives styles and collapses to a zero-size box in the body flow.
- `direction: ltr` on the chrome (RTL hosts must not mirror the tool — source-verified fix, master §9 row).
- `z-index: 2147483647` — the int32 maximum, so **no host element can stack above the strip**. Verified against the baseline's source while deciding: its strip mounts at `999999999` (`css/inspector.css`), so the `2147483647` figure quoted in [`13` §Reference](./13-phase-12-on-page-inspector.md) is a doc error — the value here is this brief's own, chosen for the unbeatability property, not for source parity. Observed shipped pair: KC badge `999999`, SBS overlay `999999999` — not re-touched by this brief.
- Default position **top-left 12 px/12 px** (source-adjacent muscle memory); the user's persisted per-origin position always wins when valid (P12 validates/clamps the stored coordinates — the brief's visual contract is "the strip appears exactly where its stored position says, clamped 4 px inside the viewport").
- Width **224 px** fixed; `max-width: min(224px, 40vw)`; **max-height `min(70vh, 520px)`** with one internal `overflow-y: auto` region (SB-D2's scroll region) — the container itself never scrolls horizontally, and the page never scrolls because of the strip (`SB-D16`).

## 3. Anatomy — `SB-D2`

```
┌──────────────────────────────────────┐ ← chrome (fixed, dragged, rounded card)
│ ⠿ WPR-V-3.19   [Cached · 12 s]  ▾    │ ← header row (SB-D8)
│ ── Cache ──────────────────────────  │
│ (Cached) (Creation 12 s ago)         │ ← chips wrap per group (SB-D5)
│ ── File Optimization ──────────────  │
│ (CSS Minify) (RUCSS) (CPCSS) …       │
│ ── Media · Preload · CDN · Features  │ ← further groups, same pattern
│ ── Tools ──────────────────────────  │ ← divider above (SB-D5 tool chips)
│ (RUCSS Test) (Beacon Test) (LCP)     │
│ WPR 3.19 · WP 6.8 · FDT 1.2          │ ← footer micro-info (SB-D8)
└──────────────────────────────────────┘
   ⟶ outcome banner = sibling of the chrome, never its child (SB-D14)
```

- Group order is the study's set — Cache / File Optimization / Media / Preload / CDN / Features / Tools (registry-driven; `UX-D14`) — rendered top-down in one scroll region; Tools sit last, separated by a hairline divider (`--line-1`), visually distinct chips (`SB-D5`).
- The header row and footer live **outside** the scroll region (identity and versions never scroll away).
- Groups render only when they own at least one registered chip; the registry's order and grouping are the single rendering source — nothing hardcodes the feature list a second time.

## 4. Density, type ramp, spacing — `SB-D3` (compact, must not fight host pages)

- One density scale, absolute px (immune to host font cascades inside the shadow root):
  - **Base:** `--font-mono`, 12 px / line-height 1.5 (the shipped injected UIs' density — KC badge 12 px, SBS bar 13 px).
  - **Group headers:** 11 px, weight 600, `--fg-secondary`; icon 12 px at `--fg-muted`.
  - **Chip labels:** 12 px, weight 500, status text color (`SB-D5`).
  - **Footer / micro-info:** 10 px, `--fg-muted`.
- Spacing on a 4 px grid: container padding 8 px; gap between groups 8 px; gap between chips 4 px; chip height **22 px** (`padding-inline: 8px`, radius pill).
- Hit-area floor: interactive chips and controls are **≥ 24×24 CSS px** hit targets (WCAG 2.5.8 via padded dense visuals — 06a §5 accessibility floor): a 22 px chip is a dense visual whose padded hit box rounds to 24 px; header/footer controls are 24 px square.
- The whole chrome carries `user-select: none` (drag must never select host text — P12 checklist) and a `pointer-events: auto` boundary: only the chrome and its interactive descendants take events (`SB-D16`).

## 5. Surface, elevation, radius — `SB-D4`

- Card: `background: var(--surface-2)`; `border: 1px solid var(--line-2)`; `border-radius: 8px`; `box-shadow: var(--shadow-elev-3)` (a floating element must lift off any host surface; tokens make it correct in both palettes).
- Group divider (above Tools): `1px solid var(--line-1)`.
- While dragging: the same elevation, plus `cursor: grabbing`; no scale/opacity theatrics (`SB-D12`).

## 6. Chips: anatomy and state matrix — `SB-D5`

A chip is a pill: soft status background + status-colored text (`status text always sits on *-soft or a surface` — tokens.css), 12 px mono label, optional one-line value suffix (e.g. cache creation time) at 10 px `--fg-muted`. Chip content is the registry's `shortLabel` — the brief never invents label strings (`UX-D12`, P11 facet; full names live in tooltips).

| Chip state (semantic)                                                                                                  | Background                | Text                 | UX-D7 word  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------- | ----------- |
| Enabled / passing / applied                                                                                            | `--status-ok-soft`        | `--status-ok`        | ok          |
| Absent / failed / not detected                                                                                         | `--status-error-soft`     | `--status-error`     | error       |
| Degraded / unusual (partial coverage…)                                                                                 | `--status-warn-soft`      | `--status-warn`      | warn        |
| **Present but unsure** (the amber attention state — the baseline's `unsure`, reserved in P0 for exactly this semantic) | `--status-attention-soft` | `--status-attention` | warn family |
| Informational (e.g. loaded version)                                                                                    | `--status-info-soft`      | `--status-info`      | info        |
| Plain / idle ("Not detected" identity — matches the toolbar badge's gray, `UX-D1`)                                     | `--status-neutral-soft`   | `--status-neutral`   | neutral     |
| **Tool chip (actionable)**                                                                                             | `--accent-strong`         | `--on-accent`        | info        |
| Tool chip, run unavailable (P13/P14 not landed) or disabled                                                            | `--surface-4`             | `--fg-muted`         | neutral     |

- The cache chip's extra slot (`formatCacheTimestamp` output, "N/A" when uncached; exclusion-marker hint) renders as the chip's value suffix / tooltip — P12 §2's union, not a new chip kind.

## 7. Vocabulary boundary & honesty — `SB-D6` (constrains `SB-D5`)

- The rendered set stays **inside the P0 status vocabulary — no new colors, no invented seventh state**. UX-D7's "exactly five" governs the shared status language (`status-badge.tsx`); the amber `unsure` rendering is the P0 `attention` pair, whose declared purpose in `tokens.css`/P0 foundations is precisely the second baseline's amber unsure state. In words (tooltips, banner copy) the vocabulary is UX-D7's, in plugin-native naming (`UX-D12`).
- Every `unsure` chip **explains itself in its tooltip** (P12 binds the copy pattern: "optimized but cache signature missing — headers point to siteground"); a chip state a support engineer cannot resolve on the page is a defect.
- **The chip never shows more certainty than the scan has:** a zero-marker page renders honest `error`/`neutral` chips whose tooltips say what was looked for — no fabricated "enabled" anywhere (P12's checklist owns the walkthrough).

## 8. Group headers & iconography — `SB-D7`

- One icon set at one size grid (the design-craft bar, `UX-D6`): **24-viewBox / 1.5-stroke / round caps & joins** stroke geometry — the same family the shipped overlay icons render (`side-by-side/icons.tsx`) — carried as **inline path data**, not an icon package: the strip rides the isolated content script's hard bundle budget (P12: strip ≤ 10 KB raw on top of the budget), while `lucide-solid` stays the panel surfaces' prerogative. New glyphs enter as data rows beside the strip's view model.
- One glyph per group, 12 px box, `--fg-muted`: Cache = database; File Optimization = file/sliders; Media = image; Preload = download-cloud; CDN = globe; Features = puzzle; Tools = wrench. Utility glyphs: grip (drag affordance), chevron (collapse), close (banner), refresh — no more than needed.
- Group headers are **not focusable** and carry no interaction; they are scent (what am I looking at), not controls (`UX-D2`'s recognition-over-recall, page-float edition).

## 9. Header row & footer — `SB-D8`

- Header: drag-grip glyph + identity chip (WPR version — `WPR-V-x` ok / `WPR-V-NF` error; registry/tooltip carry the full form) + cache-state chip (ok / warn / attention per `SB-D5`, creation time in its tooltip) + collapse control (chevron, 24 px button). The header is the collapsed state's surviving bar (`SB-D11`).
- Footer (never scrollable away): WPR version · WP version · extension version — 10 px muted, one line, truncating with ellipsis over wrapping. No external links of any kind (P12's footer decision: docs live in the extension's own surfaces).
- Tooltips (`title` attributes — the shipped injected UIs' pattern; native tooltips cost zero budget and no floating layer): every chip's full feature name; every non-obvious state's one-line why; footer versions' full names.

## 10. Interactivity — `SB-D9` (kinds) / `SB-D10` (states) / `SB-D11` (collapse) / `SB-D12` (drag)

**`SB-D9` — no dead-end clicks.** Chips split into exactly three kinds:

1. **Buttons** (tool chips, "check scripts" when DJE is present, banner's Show-details): real `<button>`s — they trigger their tool/detail flows per P12 §2/§4; a flow that cannot run yet renders the chip disabled with its tooltip (never a click that does nothing).
2. **Detail-linked chips** (a feature with a panel route destination): `cursor: pointer`, click/Enter opens the panel route (the P12-documented mechanism; where no devtools instance is open, the tooltip says where the full view lives — a hint, not a fake action).
3. **Static chips** (every merely-informative status): not focusable, no pointer cursor, no click handler — an informative chip is text, and text does not pretend to be a button.

**`SB-D10` — interaction states.** Buttons only: hover = `--surface-3` background (palette-safe via tokens) or one `--surface-3` overlay step on accent chips; press = `--surface-4`; focus-visible = `2px solid var(--accent)` outline, offset 2 px (the shipped `sbs-switch-input` ring — the one focus treatment across injected UIs); disabled = 50% opacity + `cursor: not-allowed`. Static chips have no hover/press response at all (motion budget discipline — hovering text must never twitch).

**`SB-D11` — collapse.** The strip collapses to its header bar (identity + cache chip + grip + chevron). The collapsed/expanded swap is a **class toggle pinned immediately** — the shipped UIs' state-never-depends-on-a-transition rule (KC badge's `kc-collapsed`, SBS's `--open`); the chevron's rotation is the only decoration and runs at `--motion-fast`. Collapsed state is **not persisted** (session-shape, like the source's per-page feel; the persisted per-origin facts are enabled + position only — P12's store shape is the authority).

**`SB-D12` — drag & persisted position.**

- Affordance: the header's grip glyph + `cursor: grab` on every non-interactive chrome region; interactive elements (buttons, linked chips) never start a drag.
- While dragging: `cursor: grabbing`; the chrome follows the pointer 1:1 with **no transition on position** (a transitioned lag is broken drag feedback); text selection impossible (`user-select: none` + the pointer path's capture).
- Drop: position **clamped 4 px inside the viewport** (pure geometry, P12's clamp util) and **persisted per origin** on drop (P12's store — extension storage, never a host-visible cookie; the source's `<id>-Position` cookie is the lessoned anti-pattern).
- The persisted position is honored at the next mount exactly (validated coordinates against `SB-D1`'s clamped-viewport rule); right-click during a drag cancels it and restores the pre-drag position (source-parity nicety, P12's checklist row).
- Tool result cards (P13/P14) are **not** draggable — the strip's chrome is the single draggable element.

## 11. Motion — `SB-D13` (the study's motion discipline, page-float edition)

- **Entrance (mount-only, once):** `opacity 0 → 1` + `translateY(-4px → 0)`, `--motion-base` (180 ms) / `--ease-entrance`, one `@keyframes` run on the chrome when the strip appears (enable, Alt+H show). **No per-chip or per-group stagger** — the anti-pattern that made long lists animate seconds late (`F7`, master #31).
- **Exit (hide/unmount):** none required — the chrome is removed with its shadow host; a class-pinned instant hide is correct (the strip must never linger when told to disappear).
- **Interaction transitions:** background-color/border-color at `--motion-fast` (120 ms) / `--ease-standard` on buttons and the chevron only; **no transition on the strip's position** (drag is 1:1, `SB-D12`).
- **No infinite loops, no idle pulses, no shimmer** — there is no loading state that justifies one (detections render when the data hub has them; a not-yet-scanned chip renders its honest neutral/error state, not a spinner — `UX-D6` "skeletons only for real waits", and a page-floating element must never draw attention with looping motion).
- **`prefers-reduced-motion: reduce`:** the P0 tokens neutralize all of the above globally (verified token block); additionally, **no state ever rides a transition** — show/hide/collapse are class swaps an interrupted animation cannot strand (the shipped UIs' binding rule, restated for every strip state).
- Banner motion (`SB-D14`): slide-down + fade in at `--motion-base`, fade-out at `--motion-fast` on expiry — one-shot each, never a loop.

## 12. Outcome banner — `SB-D14` (tool results announce here)

- **One banner at a time** (latest outcome wins — tools run sequentially per P12's contract; the banner never stacks).
- **Placement trap, pinned:** the banner is a **sibling of the dragged chrome inside the shadow-root container — never a descendant of the chrome**. The chrome is a transformed/positioned element; a `position: fixed` descendant of a transformed ancestor becomes containing-block-bound and would ride the strip instead of the viewport.
- Position: `fixed`, **top-center of the viewport**, 8 px from the top; `max-width: min(480px, 90vw)`; card treatment like the strip (`--surface-2` / `--line-2` / radius 8 px / `--shadow-elev-3`); padding 8–12 px; 12 px mono text.
- States ride the `SB-D5` pairs on the banner's status edge: **running** = info (`--status-info`), **success** = ok, **failure** = error + the tool's actionable line. Copy is owned by each tool's phase (`UX-D12`; the brief owns the pattern only).
- Lifetime: **auto-hide 5 s**; **hover pauses** the timer, pointer-leave restarts a fresh 5 s (a support engineer reading a failure must not race the clock); an explicit close button (24 px, `SB-D10` states); a successful run's banner also carries **"Show details →"** where a panel route exists (devtools already open → opens the route by hash; otherwise the banner _says_ where the outcome landed — P12 §4's contract, never a dead link).
- A11y: `role="status"` live region (polite) — a background tool result announces without stealing focus; the running state re-announces as success/failure on the same node (one region, latest wins).

## 13. Palette & live appearance — `SB-D15`

- Both palettes, token-only: every color/motion/elevation value in this brief is a P0 token reference — **no hardcoded hex, no `prefers-color-scheme` queries in the strip's own CSS** (the token file owns scheme resolution).
- The content script resolves the stored appearance (`sync:options` → `appearance`) and sets `[data-theme]` on the strip's shadow-root container **before first paint** (no wrong-palette flash — master §8, `UX-D11`); `system` is declared as `data-theme="system"` (`color-scheme: light dark` on the container — the mount's `:host` reset aborts the documented scheme chain, so only the owned container's declaration rules; the shipped mount's verified contract).
- **Live honor (`UX-D11`):** the strip follows the stored appearance while mounted — the shared mount's live-theme leg (P5H's conformance fix: `entrypoints/isolated.content/ui/live-theme.ts` behind `mountShadowUi`) re-applies the container declaration when the options item changes (options page, panel palette cycle), no reload; OS-scheme changes resolve live by the browser under `system`. P12 inherits this by mounting through the shared mount — it implements no theme code of its own.
- Contrast: chip/banner pairs inherit P0's unit-tested AA pairs in both palettes — the strip **never restyles a token value** (a contrast defect is a P0 defect, fixed there, re-verified by the token tests).

## 14. Host-page coexistence — `SB-D16`

- The strip changes **nothing** about the host page: no scroll lock (compare with the SBS overlay, which locks by design and restores exactly), no body/html style writes, no host-DOM mutation outside its own shadow host, zero console output (P12's quirk table owns the behaviors; this brief pins the visual consequence: the strip is a fixed-position observer's UI, not a page takeover).
- Events: the shadow-root mount runs with event isolation on (`isolateEvents: true`, the shipped pair's setting); the strip never installs page-wide listeners of its own beyond its drag/toggle paths (P12's listener hygiene owns those).
- A hostile-CSS host must not change the strip (`:host { all: initial }` + token-only styling gives this; P12's checklist walks an `* { all: unset !important }`-style host and diffs computed styles), and the strip must not change the host (same diff, other direction).

## 15. What this brief does not decide

Exact chip/banner strings and wording (P11's registry + P12's tooltips + the P15 copy sweep own copy; parity short labels are pinned in P12 §2); the strip's storage shape, toggle plumbing and mount lifecycle (P12 tasks); tool runtimes and their outcome copy (P13/P14); the shipped KC badge's and SBS overlay's visuals (P3 surfaces — this brief binds future injected surfaces; it redesigns nothing that already shipped); the panel's status-badge component (P5B — the strip consumes the same tokens, not the component: the content script cannot import `components/ui/` across its budget).

## 16. P12 deviations — template (how deviations get recorded)

P12 implements the `SB-Dn` ids as written and **reports deviations in its own phase doc** ([`13-phase-12-on-page-inspector.md`](./13-phase-12-on-page-inspector.md)), appended under a copied "Strip design-brief deviations" section — the template it fills (one row per deviation, every deviation has a reason; an empty table is the conformance statement):

```markdown
## Strip design-brief deviations (P12 conformance pass, <date>)

| ID    | Brief says | Shipped | Reason (and the `UX-D`/`F` id it serves, if any) |
| ----- | ---------- | ------- | ------------------------------------------------ |
| SB-Dn | …          | …       | …                                                |
```

A deviation is a **deliberate, reasoned delta** — never a discovery mid-build. Where this brief and a later-committed study decision conflict, the study wins (06a §11 precedence) and the deviation row records the brief revision this forces (edit 06c, date-stamped) — the strip never silently diverges from either.

## 17. Decision index (SB-D1…SB-D16)

| ID       | Decision (one line)                                                                                                                            | Traces to                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `SB-D1`  | Inner fixed chrome; `direction: ltr`; `z-index: 2147483647`; default top-left 12 px; 224 px width + `min(70vh, 520px)` cap                     | master §9; 06a §5                       |
| `SB-D2`  | Anatomy: header / groups / tools / footer; one internal scroll region; registry-driven order                                                   | `UX-D14`; master §9                     |
| `SB-D3`  | 12 px mono base, 4 px grid, 22 px chips, ≥ 24×24 hit boxes, `user-select: none`                                                                | `UX-D6`; 06a §5 (WCAG 2.5.8)            |
| `SB-D4`  | Surface-2 card / line-2 border / radius 8 px / shadow-elev-3; Tools hairline divider                                                           | `UX-D6` (token-only)                    |
| `SB-D5`  | Pill chips: `*-soft` bg + status text; state matrix incl. amber attention; accent tool chips; value-suffix slot                                | `UX-D7`; `UX-D12`; master §9            |
| `SB-D6`  | Vocabulary boundary: P0 pairs only; unsure explains itself in tooltips; no certainty beyond the scan                                           | `UX-D7`; `UX-D12`; `UX-D9`              |
| `SB-D7`  | Group icons: 24/1.5-stroke inline path data (bundle-safe), one glyph per group, 12 px grid                                                     | `UX-D6`; `UX-D14`                       |
| `SB-D8`  | Header = grip + identity + cache chip + collapse; footer = versions, no links; native-tooltips everywhere                                      | `UX-D1`; `UX-D12`; P12 §2               |
| `SB-D9`  | Chip kinds: buttons / detail-linked / static; no dead-end clicks                                                                               | `UX-D9`                                 |
| `SB-D10` | Hover/press/focus-visible/disabled states on buttons only; one accent focus ring                                                               | `UX-D6`; 06a §5                         |
| `SB-D11` | Collapse = immediate class swap chevron at `--motion-fast`; not persisted                                                                      | `UX-D6`; P12 §1 store                   |
| `SB-D12` | Drag: grab/grabbing cursor, 1:1 follow, 4 px clamp, per-origin persisted position, right-click cancel                                          | master §9; P12 §3                       |
| `SB-D13` | Motion: one mount-only entrance, `--motion-fast` interaction transitions, no loops, reduced-motion honored, state never rides transitions      | `UX-D6`; `F7`; master #31               |
| `SB-D14` | Outcome banner: viewport top-center, sibling of the chrome (containment trap), one at a time, 5 s + hover-pause, `role="status"`, Show-details | `UX-D9`; P12 §4                         |
| `SB-D15` | Palette: token-only, `[data-theme]` resolved before paint, live follow via the shared mount's live-theme leg                                   | `UX-D11`; master §8; isolation standard |
| `SB-D16` | Host coexistence: no scroll lock, no page-wide listeners, hostile-CSS inert both ways, zero console output                                     | 06 standard; P12 quirk table            |

## 18. Standard clarifications recorded during the P5H pass

- **The wp-admin admin-bar entry (`entrypoints/isolated.content/improvements.ts`) is not an injected UI under the isolation standard:** it appends a host-native `<li>` (class `ab-item`, no styles of its own, no stylesheet) into WP Rocket's own admin-bar group so it inherits the admin bar's look by design — a host-native augmentation, not a shadow-isolated surface. The standard's shadow-root rule targets surfaces that carry our design (the strip, KC badge, SBS overlay); this classification is recorded so the P15 un-scoped-injection audit reads it correctly rather than flagging a stylesheet that does not exist.
- **SBS's `sessionStorage` continuity flag (`side-by-side/session-open.ts`) is a cleared boundary, not a leak:** it stores only the document's own href under one namespaced key, its sole effect is this overlay's own boot restore (a forged value equals-or-nots against the page's own URL), it is consumed once and removed, and broken storage degrades to "no continuity" — reviewed in the P5H pass against the standard's "no page globals in/out" with this analysis as the record.
- **The SBS overlay's scroll lock** writes and restores the page's inline `overflow` styles on html+body — a deliberate, restored-exactly feature behavior (captured at open, restored on close/invalidation), reviewed and cleared against this brief's host-coexistence rule (`SB-D16` reads "no scroll lock" for the strip; the overlay's lock is its own feature contract).
