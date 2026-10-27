# P19: on-page command palette and the on-page UI gate

## TLDR

One keyboard-and-menu-driven control layer for everything this extension injects into inspected pages. Two deliverables, one vocabulary:

1. **On-page command palette** — a shadow-isolated palette over the inspected page (mounted by the isolated content script), listing the same actions the context menu offers (open Side-by-Side, open its PSI flow, toggle the detection widget, the future builder) plus the new **on-page UI master gate** — "turn off all on-page UI". Triggered by a context-menu entry and by a customizable keyboard chord. The menu stays untouched as the mouse/rescue path; the palette adds the keyboard path (owner mandate 2026-10-20).
2. **On-page UI master gate** — one synced boolean: off ⇒ the chip, the known-conflicts card, the Side-by-Side overlay, the future builder overlay and the palette itself stop injecting and unmount live on open pages; per-feature/per-site settings stay but lose their consumers. Owner-decided consequence: turning it off **also disables this palette**; the arming message says so, and the context menu (browser chrome, outside the gate) is the rescue path.
3. **Options integration** — the master gate rides the options Features card as an instant-apply switch; while it is off, the other on-page-UI rows disable (cannot be toggled) with a reason — the cascade is data-driven so P12's planned chip-default row (and any future on-page row) inherits it. A chord-capture row lets the user rebind the palette shortcut; the chord re-applies live (properties: no reload).

Owner decisions already taken (2026-10-20): the palette lives **on the inspected page**, not panel-side; gate-off kills the palette, the menu rescues; a context-menu row opens the palette; the chord is a content-script capture (default **Alt+K**, rebindable in options, G-2/G-3 resolved). The **panel palette's "Open Exclusion Builder" row is removed by P10** with its dead flow — from a devtools-attached panel a `chrome.debugger` build can never attach, so the row is structurally wrong once the builder is the in-page overlay; the **action-menu builder entry stays** and always opens the in-page overlay — a live one is revealed, never toggled closed (owner 2026-10-21; P10's click-router edit — its trigger surface, not a P19 change).

**Depends: P10 disposition (the builder's in-page session — the palette's builder row and the menu entry's open re-point gate on it), P11 (train slot per owner). Technically parallel with P13/P14 (disjoint modules; additive contract rows only). P19D serializes with P12M on the shared mount machinery — both edit isolated-content mount flows; whoever lands second integrates the first's shape. No dependencies planned; installed stack.**

Chosen train slot: after P11 (P19 → P12). P19A–C and E have nothing to edit in P12's files; P10 interplay is the builder row's availability gate (the panel-row removal and the action-menu entry's open re-point are P10's edits).

## Decision gates (G-*, phase-local; not the UI bar's §D receipt ids)

- **G-1 (owner, resolved 2026-10-20):** plan approved — palette scope, gate semantics (gate-off kills the palette), options cascade and chord model stand as written below.
- **G-2 (owner, resolved 2026-10-20):** chord mechanism and default — **(a)** the content-script capture chord (rebound from this extension's options page, fully gate-integrated, zero manifest changes; the chosen chord is ours to police — it intercepts the host page for that one combination), default **Alt+K** (⌘K was rejected as the default: GitHub, Notion, Slack, Linear, Gmail and the WordPress 6.4+ editor own it in their own palettes; ⌘K stays selectable).
- **G-3 (owner, resolved 2026-10-20):** capture validation — **modifiers mandatory**: at least one modifier or an F-key, so a bare letter can never hijack typing into the page.

## Grounded in this repo (verified 2026-10-20, re-verified 2026-10-27 by P19A)

| Fact                                                                                                                                            | Anchor                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| In-page features are registry rows with ctx-owned cleanup (`setup(ctx)`)                                                                        | `entrypoints/isolated.content/index.ts` (`ISOLATED_WORLD_MODULES`) — adding the palette is one row   |
| The menu already owns the action vocabulary (ids, titles, URL patterns, click router)                                                           | `entrypoints/background/context-menus.ts` (`MENU_ENTRIES`, `menuActionFor`, `dispatchMenuClick`)     |
| The SBS overlays open via the tab-targeted rows `openSideBySide`/`openSideBySidePerformance`; the receive side is the palette's exact call path | `lib/messaging/protocol.ts:97-100`, `entrypoints/isolated.content/side-by-side/index.tsx:518-526`    |
| The chip's per-site toggle mechanics exist (entry-over-default precedence, RMW, byte budget)                                                    | `lib/storage/inspector-origins.ts` (`toggleInspectorOrigin`, `effectiveInspectorEnabled`)            |
| The palette combobox primitive is surface-agnostic (injected matcher, dialog focus trap/Escape, mount-driven)                                   | `components/ui/command-palette.tsx` (APG combobox over Kobalte)                                      |
| The matcher is shared (promoted by P19A); focus logic stays panel-local                                                                         | `components/ui/command-matcher.ts`, `entrypoints/panel/palette/focus.ts`                             |
| Options = registry rows over storage contracts; the chip's global-default row deliberately joins through P12 (`features.onPageInspector`)       | `lib/options/registry.ts`, `docs/plans/10-phase-9-options.md` (§ Receipts), `lib/storage/options.ts` |
| Background already watches options storage to apply a binary toggle live (toolbar badge)                                                        | `entrypoints/background/badge.ts` pattern                                                            |
| The isolated content script is budgeted as one surface                                                                                          | `scripts/budgets.json` row "isolated content script" (140.1 raw / 48.0 gzip)                         |
| P12 remaining owns the widget's Alt+H visibility chord, `capture: false`, no `document.onkeydown` clobber, plus P12M mount hardening            | `docs/plans/13-phase-12-on-page-inspector.md` (remaining scope + P12M)                               |
| P10 owns the in-page builder session and the DevTools-attach conflict degradation                                                               | `docs/plans/completed-exclusion-builder.md` (TLDR, G-3)                                              |

## Design: one command vocabulary, three consumers

- **`lib/page-commands/`** — the single declaring site of the on-page command set: id, user-facing label, keywords, availability (`(ctx) => boolean | disabledNote`), on-page and menu binding notes. Rows: `side-by-side`, `psi-side-by-side`, `toggle-detection-widget`, `page-ui-gate` (master toggle), `open-command-palette` (menu-only trigger), `open-nowprocket` (menu-only; P20 ships the menu row first — carry it unchanged), `exclusion-builder` (added/gated by P10's session; this phase scaffolds the row shape behind `builderAvailable()`). Adding a command = one row + tests; the menu, palette and options rows stay consumers.
- **Menu** (`entrypoints/background/context-menus.ts`): renders browser rows from the table (its `id`/`contexts`/`documentUrlPatterns` stay menu-native). New: `open-command-palette` (`contexts: ['all']`, page-scoped) and `page-ui-gate` (the rescue toggle). When the gate is off, the page-scoped entries and the palette trigger disable (`contextMenus.update` on a gate watch, badge-watch pattern) — **only the `page-ui-gate` rescue entry stays enabled**, retitled "Turn on all on-page UI". The standalone **action-menu builder entry stays** — P10 re-points it from open-the-tab to opening (or revealing) the in-page overlay — never a toggle, owner 2026-10-21 (its click-router edit; not an edit here).
- **Palette** (`entrypoints/isolated.content/palette/`): the registry row mounts a lazy shadow UI over the promoted matcher; rows call the **same mechanisms** the menu's tab-messages call — the tab-message receive paths delegate into the palette's executor registry, so trigger fan-in never forks semantics. The palette itself watches the gate and dies with it (owner decision; the off-confirm and its transit notice are that module's last breath — the notice names the menu rescue before teardown).
- **Options** (`entrypoints/options/`): the master switch (instant-apply switch row kind, watching `sync:page-ui-gate` — the appearance-choice precedent, not the draft/save boolean cycle) plus the cascade: rows carry an `onPage: true` marker the page model reads to disable-with-reason while the gate is off. The chord row (G-2a) writes `sync:palette-chord`; the content script's listener re-arms live from the storage watch.
- **Gate item** (`lib/storage/page-ui-gate.ts`): `sync:page-ui-gate: boolean`, default `true` (tool unchanged until a user opts out), validator + watch; precedence documented once here — **gate > per-site/per-feature settings**; nothing resurrects a closed surface.

## Implementation slices

### P19A — Contracts (no behavior change)

Depends: —. Parallel: P19B groundwork, P13/P14, P12 pure work. Size: S.

- [x] `lib/storage/page-ui-gate.ts` (+ tests): item, validator (non-boolean → default), `readPageUiEnabled`, `setPageUiGate`, watch; TSDoc carries the precedence rule and the gate-off consequences.
- [x] If G-2(a): `lib/storage/palette-chord.ts` (+ tests): shape `{ code, mod?, shift?, alt? }` (`mod` = Cmd on macOS / Ctrl elsewhere; `alt` is the browser's `altKey` — Option on macOS, Alt elsewhere — a single flag, not per-OS codes), validator (G-3 baked in: at least one modifier or an F-key), default `alt+k`, watch. Matching rides `event.code` + the effective modifier **flags**, so an OS-level modifier remap (System Settings → Modifier keys) is transparent: the chord follows the remap's meaning, never a physical label.
- [x] Promote the panel matcher to `components/ui/command-matcher.ts` (+ its tests re-homed; the panel palette re-points, behavior identical); `focus.ts` stays panel.
- [x] `lib/messaging/protocol.ts`: additive row `openCommandPalette(): true` (background → tab, tab-targeted, no payload) with the boundary note; no other channel — everything else is two storage items.
- [x] `wxt.config.ts`: nothing — G-2 resolved to the capture chord, no `commands` row and no new manifest permission.

DoD: unit suites green; compiler/lint/format green; no menu/panel/page behavior change; budgets untouched.

**Receipt (2026-10-27, done):** gate item `parsePageUiGate`/`readPageUiEnabled`/`setPageUiGate`/`watchPageUiGate` (watch validated; removal/corrupt → on). Chord module owns the shared rules for B/E/F: `parsePaletteChord` (canonical: only `true` flags stored; wrong-typed flag rejects the chord; unknown fields ignored), `captureChord` (E's field: `unsupported-key` | `needs-modifier` | `unsupported-modifier`), `matchesChord` (F's keydown: exact flags, repeat/`isComposing` refused; `isTrusted`/top-frame stay the listener's), `formatChord` (`symbols` ⌥⇧⌘K / `words` Option+Shift+Command+K for accessible names; Ctrl+Alt+Shift+K elsewhere), `detectChordPlatform` (injected navigator: UA-CH platform → `navigator.platform`; the one platform read — modifier conventions can't be feature-detected). Decisions: G-3 read as **`mod` or `alt`**, or F1–F12 alone — Shift alone types a capital; bindable keys = closed table (A–Z, 0–9, F1–F12, 11 US punctuation codes; Escape/Tab/Enter/Space/arrows excluded); Ctrl on macOS / Meta elsewhere are outside the vocabulary (held ⇒ no match). `setPaletteChord` throws on an invalid chord. Known limits for E/F: key labels are US legends of `event.code` (non-US layouts show the physical key's US label — E may add a layout-map label); Windows AltGr = Ctrl+Alt, so a Ctrl+Alt chord also fires on AltGr. Gates: 328 files / 7654 tests green, `palette-chord.ts` 100 % lines; budgets: every Chromium row byte-identical to `develop` @ 08f7b1b (new modules unimported; protocol row type-only). Anchor drift fixed in the table above (protocol/SBS lines, budget row 140.1/48.0, matcher path).

### P19B — In-page palette (menu-open, no chord yet)

Depends: A. Parallel: C, E. Size: M.

- [ ] `lib/page-commands/` (+ tests): the table above (sans builder row, which tracks P10) and the in-page executor contract — SBS/PSI/chip/master rows verified by a unit harness over the shipped mechanisms (`toggleInspectorOrigin`, the SBS open triggers, the gate write), never re-implemented.
- [ ] `entrypoints/isolated.content/palette/` (+ tests): registry row `setup(ctx)`; lazy shadow mount of `components/ui/command-palette` inside the established `ui/` machinery (tokens, live theme, reduced motion, `K-1..K-3`), z-order above every sibling surface (their own ceiling), Esc/outside/mount-on-close; receive `openCommandPalette` → open.
- [ ] Master-off choreography (owner decision encoded): the watch leg renders one self-removing, at-rest notice (`S-3` copy: what happened, where to turn it back) — the notice fires on the off-write whatever its trigger (palette, menu, options), and then the module tears itself down; the inline pre-arming confirm naming the consequence ("this also turns off this command palette — the context menu turns on-page UI back on") exists only in the palette's own path.
- [ ] Row availability honesty: mutely disabled rows render with `disabledNote` (e.g. the future builder's "needs the builder session"; SBS absent-when-gate-off can never happen — the palette is dead by then).

DoD: unit + palette module suites; §D/1-6 receipted at this tier (theme/motion/keyboard/axe/grep); isolated-script budget delta receipted; host-page zero-change outside the open overlay.

### P19C — Menu integration

Depends: A. Parallel: B, E. Size: S.

- [ ] `entrypoints/background/context-menus.ts`: new registry-driven entries + click-router arms; the entry table reads labels from `lib/page-commands` (titles stay identical to today's user-facing strings); gate watch re-titles and disables/enables rows (`lastError` honored; watch rides the badge pattern); gate-off leaves only the rescue entry enabled. The existing P20 `open-nowprocket` row is carried into the registry unchanged (menu-only; its click arm and URL transform stay P20's).
- [ ] The two SBS/chip entries route into the same mechanism modules as before (their behavior does not shift); `open-command-palette` send fails exactly as today's sends fail (logged `no-receiver` path).

DoD: existing dispatcher tests extended (gate off/on, retitle, disabled state, send paths); rebuild/menu smoke on the docker site.

### P19D — Feature boot/live gating

Depends: A (B/C optional but sequenced with them). Parallel: P13/P14 — but **not** P12's mount edits (P12M): serialize injected-UI edits, whoever lands second adapts. Size: M.

- [ ] The gated modules read the gate before any mount and unmount live on a close write: `known-conflicts`, `side-by-side` (boot triggers + the reload-restore continuity — a gate-off boot must not resurrect the overlay and clears its continuity marker), `inspector` (gate composes with `effectiveInspectorEnabled(origin)`), the future builder (P10's mount consults the gate — coordination row in P10's doc, not an edit here). `improvements` and the device-simulation tools stay out: they are behavior, not on-page UI.
- [ ] Every arm is honest state, never a fake wait; unmount keeps pages clean (no leaked observers; the shared `ctx` remains the invalidation path).

DoD: browser suites: boot-off mounts nothing (page pristine), live-off unmounts each visible surface while the page runs, gate-on restores, per-site chip settings still hold under a later re-enable, SBS continuity cannot survive a gate-off boot; menu disabled-state snapshot arms; unit precedence tests.

### P19E — Options integration

Depends: A. Parallel: B, C. Size: M.

- [ ] Registry: `page-ui-gate` lives in the Features section card as the instant-apply switch (watch read; write through the RMW queue so a dirty draft survives), with the cascade marker (`onPage: true`) factoring per-row disable-with-reason — P12's chip-default row inherits the marker when it lands (cross-phase note in P12's doc belongs to P12, not an edit here). While gate-off: on-page rows render disabled with the action-honest note; the badge/D-bugger rows unaffected.
- [ ] Chord capture row: a `chord` kind row + capture control (press-a-combination field, G-3 validation baked in — modifier or F-key required — **platform notation**: ⌥/⌘ glyphs on macOS, Alt/Ctrl on Windows/Linux, always describing the effective (post-remap) meaning — a remapped physical key displays as what it fires), instant write + toast like the appearance choice.
- [ ] Copy authored once, flagging P15's sweep (W-2); labels match the menu/palette strings from the shared vocabulary.

DoD: registry/page-model/component suites (capture field: focus/IME/Escape/blur/invalid states, `K-1..K-4`); §D receipts at this tier; the disabling cascade tested against the watched gate.

### P19F — Chord mechanism + suites/receipts

Depends: B, C, D, E. Parallel: P13/P14 cores. Size: M.

- [ ] G-2(a) capture chord: the palette module's keydown listener from boot (capture, top frame, trusted-only, no repeats/IME, never `document.onkeydown`, only the exact chord intercepted: Alt+K default or the stored rebinding) + live re-arm from the chord watch.
- [ ] The palette-title hint carries the active chord, rendered through the same platform-notation helper (⌥K until rebound on macOS — what actually works, not a hardcoded hope).
- [ ] Browser suites (docker site): open by menu and by chord; every row runs (keyboard-only walk, D-3/D-4 at the page tier); chord rebind live-re-arms (no reload claim); the P19D gate matrix on real pages; axe per state; reduced-motion arm.
- [ ] Receipts: budget delta for the isolated surface (row raised only on a measured need — the table is authoritative), README/master status notes, this doc §Receipts.

DoD: full tier green (`compile`/`lint`/`format:check`/`test`/`build`/`check:budgets`); no long task > 50 ms opening/typing/filtering the palette over the 5k-row fixture parity (`P-3` — rows are static and few, so this is the matcher's, not the list's).

## Non-goals

- No panel-side gate row and no panel-page rows in the on-page palette — the two palettes keep disjoint vocabularies (panel orphan rows die with P10's flow, not here).
- No per-site master-gate override (the chip keeps its per-site toggle; a gate override per origin is later-only if the owner asks).
- No popup wiring (deferred P8); no i18n; no bindings for browser-level zoom/devtools chords (the host owns those).
- The gate never touches device-simulation, UA relay or `improvements` — behavior, not injected UI.

## Open items

- Panel-side builder removal is **P10's**, not this phase's: the panel palette's "Open Exclusion Builder" row dies with the tab flow it opens (devtools-attached `chrome.debugger` conflict makes it structurally wrong after P10), and the standalone **action-menu builder entry stays**, re-pointed by P10 to always open (or reveal) the in-page overlay — no toggle (owner 2026-10-21). This phase deletes nothing panel-side and owns no builder flow; the `EXCLUSION_BUILDER_PAGE` entrypoint dies with P10.
- P12's chip-default options row (`features.onPageInspector`) inherits the cascade marker; if it lands mid-P19 the marker migrates in a one-row diff owned by whoever lands second.
