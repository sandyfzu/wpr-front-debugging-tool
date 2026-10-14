# UI/UX bar — every user-facing surface

**Status:** binding, the single declaring site of the project's UI/UX quality bar (owner mandate 2026-10-14: refined, fast, responsive, beautiful, motion that feels good — never a circus — and best-practice UX). **Applies to:** the devtools panel (shell + pages), popup, options, exclusion builder, every injected UI (strips, badges, overlays, side-by-side chrome) and any future surface. **Linked from:** `AGENTS.md` (Non-negotiable rules → UI/UX bar) and the master plan's design-bar principle; phase docs cite rule ids (`M-2`, `D-1`…) and keep only surface-specific decisions.

**Sources it builds on (never contradicts):** the committed UX study [`plans/06a-phase-5-ux-study.md`](./plans/06a-phase-5-ux-study.md) (`UX-Dn` decisions — precedence: plugin/KB naming > the study > this bar > phase docs), the tokens in `assets/css/tokens.css` (+ the Tailwind mapping in `theme.css`), and the primitives in `components/ui/`. Changing a value here = edit this file (date-stamped line in §Change log) in the same commit as the code that moves; a phase doc never re-declares a value.

**Reuse before invention.** A surface adds no token, keyframe or primitive ad hoc: use what ships; a real gap becomes a design-system change (token/primitive + its tests) owned by the phase that needs it, or a surface-local solution recorded as a **promotion candidate** in that phase's receipts.

## L — Layout & responsiveness

- **L-1 Container queries, not viewport queries.** Each surface's root (or region root) is the `@container`; viewport `sm:`/`md:`/`lg:`/`xl:` variants are banned in panel/injected code (devtools docking and host pages make the viewport meaningless). Layout tiers have one declaring site — the named container sizes `--container-regular: 480px` / `--container-wide: 768px` in `assets/css/theme.css`'s `@theme` — and surfaces write the generated variants, never the pixel literals: **compact (no variant, `< 480px`) · regular `@regular:` · wide `@wide:`** (`@max-regular:` for compact-only; Tailwind compiles them to `@container (width >= 480px)` etc.). The status bar's own glance threshold is a separate constant that happens to equal 480 (its `@min-[480px]:` stays local to `status-bar.tsx`). A query reads its **own container's content box**, never the panel width: the container sits outside any padding (panel pages: `PageFrame`'s unpadded root, so a page's breakpoints measure the content region = panel − the ≈ 49 px rail, i.e. regular from a ≈ 529 px panel, wide from ≈ 817 px; the status bar's `px-2` strip flips at a ≈ 496 px panel). `D-1`'s widths are panel widths — checkpoints, not breakpoints.
- **L-2 Geometry floors.** Panel: from a 320 px panel (≈ 270 px content beside the ≈ 49 px icon rail) up, at every docking (`UX-D8`). Other surfaces declare their supported range in their phase doc (popup's fixed width, options/exclusion-builder tab widths ≥ 320 px, injected UI at the host's narrowest viewport) and meet the same rules inside it.
- **L-3 Behavior by width.** Compact: one column; actions wrap under the title; chip groups wrap (never a horizontal chip scroller); row meta stacks under the row's main line; a copy control goes icon-only (accessible name kept) only where that truly saves title-row space — a page's primary action keeps its visible label at every width. Card grids: `grid gap-2 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]` (1→2→3→4+ columns, no breakpoint drift; 15 rem keeps feature names on ≤ 2 lines beside a status badge). A long grid of small cards renders at compact as **one grouped surface of divided rows** (`divide-y` inside one bordered surface, the cards' own borders dropped) — a stack of a dozen bordered cards in a ≈ 270 px column is chrome, not content.
- **L-4 No horizontal scroll** on any surface's content region at any supported width; the only sanctioned horizontal scroller is a code block with wrap off. Long URLs `truncate` (full text in `title` + the accessible name); payload values (e.g. header values) `break-all`.
- **L-5 Heights.** Surfaces lose height in a declared order (panel: `UX-D15`); a list's scroller has a floor (`min-h-48` on panel pages) below which the region's own scroll takes over — never a clipped list, never nested scrollers when one scroller can hold the content.

## T — Typography & density

- **T-1 Scale.** `text-base` page `h1` only · `text-sm` section `h2` · `text-xs` body · `text-2xs` meta/chips/code. Nothing else on data surfaces (the theme overrides `2xs/xs/sm` for devtools density).
- **T-2 Roles.** `fg-primary` content, `fg-secondary` supporting, `fg-muted` labels/meta only. URLs, code, header names/values, versions, identifiers → `font-mono`; every count → `tabular-nums`.
- **T-3 Density without cramping.** List rows `min-h-8` (32 px, the rail's pitch), hairline-separated (`border-b border-line-1`) — never a card per row; cards keep `Card`'s `p-2.5`; spacing rhythm `gap-3` between sections, `gap-1.5` inside. Hit areas ≥ 24×24 CSS px always (WCAG 2.5.8 — `Button`/`IconButton` sizes comply; never shrink them).
- **T-4 One heading tree.** Exactly one `h1` per page (`PageHeader` on panel pages), no skipped levels.

## M — Motion (closed list; values pinned)

- **M-1 Tokens only.** `--motion-fast` 120 ms · `--motion-base` 180 ms · `--motion-slow` 280 ms; `--ease-standard` `cubic-bezier(0.2, 0, 0, 1)` · `--ease-entrance` `cubic-bezier(0, 0, 0.2, 1)`. No literal ms/easing in surface code (an injected feature may alias tokens locally, as `inspector.css` does).
- **M-2 The sanctioned moments** (Tailwind surfaces import the three constants from `components/ui/classes.ts` — landed there by P6A.1, never re-typed; shadow-root CSS writes the same tokens):

  | Moment                                                            | Mechanism                                                                                                                                                | Values                                               |
  | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
  | Page/view mount                                                   | the panel's `.fdt-page` (`entrypoints/panel/style.css`); other pages the same keyframe shape                                                             | `--motion-base`, `--ease-entrance`, 4 px rise + fade |
  | Revealed content (disclosure body, an async result's first paint) | `MOTION_REVEAL = 'transition-opacity duration-[var(--motion-base)] ease-[var(--ease-entrance)] starting:opacity-0'`                                      | 180 ms fade on insert (`@starting-style`)            |
  | Disclosure chevron                                                | `MOTION_TURN = 'transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)]'` + `rotate-90`/`rotate-180` when open                    | 120 ms                                               |
  | Hover on a whole-card link                                        | `MOTION_LIFT = 'transition-[box-shadow,border-color] duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:shadow-elev-2 hover:border-line-3'` | 120 ms, shadow only — no translate                   |
  | Floating chrome open/close (injected strips, overlays)            | class-driven transitions, state never waits on `transitionend` (master #49)                                                                              | enter `--motion-slow`, exit `--motion-base`          |

- **M-3 Everything else is instant:** hover/press colors (no primitive transitions them), data swaps (filter, search, refresh), counts (no tweening), expand/collapse heights.
- **M-4 Properties.** Animate `opacity`/`transform` only (plus `box-shadow`/`border-color` for the lift); never `height`/`max-height`/`width`/`top`/`margin`.
- **M-5 Bans.** Per-row/per-index entrances (virtual rows remount on scroll — any row fade, `MOTION_REVEAL` included, replays on every scroll); stagger; `transition-all`; infinite loops except during a real wait (shipped: `Skeleton`'s pulse, `Button`'s busy spinner, the inspector strip's scanning pulse); JS `scrollIntoView`/`scrollTo` with `behavior: 'smooth'` (the reduced-motion reset cannot reach an explicit JS option — use the default or `block: 'nearest'`).
- **M-6 Reduced motion.** `prefers-reduced-motion: reduce` is collapsed globally by `tokens.css` (shadow roots included via `:host`); surfaces verify it, never re-implement it, and never encode state in a transition (reduced motion must not strand a container).

## S — States (no dead ends `UX-D9`, no theater `UX-D6`)

- **S-1 Every async surface has a state matrix**, listed in its TSDoc and tested state by state: loading (only for a real wait — `Skeleton` compositions shaped like the final layout, never a timer), error (`ErrorState` naming the failure + Retry; extension-context-invalidated named with its remedy), **feature absent**, **empty**, **filtered-empty** (names the filter and query, offers `Clear search` / `Show all` — one click back), populated.
- **S-2 Refresh is invisible.** A data refresh keeps the view mounted and its UI state (selection, query, expanded rows, open disclosures, scroll, focus) — no flash, no surface-level spinner when a freshness signal exists elsewhere (`UX-D1`, `UX-D5`). Row UI state lives with the owner of the list, keyed by row id, never in a virtual row (rows unmount on scroll).
- **S-3 Copy for states:** a title line + one sentence (what would be here / what failed) + a forward action when one exists. Side effects (copy, save, export) confirm with a toast; failures toast the remedy.

## K — Keyboard, focus, ARIA (`UX-D3`)

- **K-1** Keyboard-complete: every action reachable, Tab order = reading order; Esc closes overlays and clears search.
- **K-2** Every interactive element carries `FOCUS_RING` (`components/ui/classes.ts`); focus never moves on data changes; a collapse keeps focus on its toggle; route/view switches land on the `h1`.
- **K-3** Patterns: disclosures `button[aria-expanded][aria-controls]`; tabs/menus/combobox/dialog via the `components/ui` APG wrappers only; virtual lists `scrollerRole="list"` + `aria-label`, rows `role="listitem"` with `aria-setsize`/`aria-posinset`; sequential Tab must traverse ≥ 200 consecutive virtual rows without escaping (raise `overscan`; never a bespoke roving model).
- **K-4** Result-count changes announce once, politely (`sr-only role="status"`), after the committed query — never per keystroke.
- **K-5** Status is never color alone (vocabulary icon or text, `UX-D7`); external links open in a new tab with `rel="noopener noreferrer"`, an icon and "(opens in a new tab)" in the accessible name; controls are never hover-revealed only.
- **K-6** Hover affordances only on controls: a non-interactive card never lifts, changes cursor or takes a tab stop.

## C — Color, contrast, themes

- **C-1 Tokens only** — no hex/`rgb()`, no `opacity-*`/`/NN` alpha on text, no gradient text on data. `assets/css/theme.test.ts` pins every `fg-*`/`accent`/`status-*` text token at AA 4.5:1 on every `surface-*` and `*-soft` background in both palettes, so a token pair passes by construction and anything else is unverified.
- **C-2 One status vocabulary** (`UX-D7`) through `StatusBadge`/`Badge` and the `STATUS_*` tables; an optional feature being off is `neutral`, never `error`.
- **C-3 Themes:** verified in `system`, `dark`, `light`, switched live (AGENTS.md UI-themes rule); injected UIs honor it inside their shadow roots.

## P — Performance (`UX-D13`)

- **P-1** One source, one `createMemo` chain (rows → filtered rows → counts in one pass); nothing derived in row renderers; no `createEffect` writing what a memo can derive; stable row keys.
- **P-2** Lists whose source can exceed 100 rows always render through `components/ui/virtual-list` (one code path, no count-switched dual rendering — `UX-D10`). Per-row cost O(rendered rows): no Kobalte `Tooltip` per virtual row (use `title`), no per-row observers beyond `CodeBlock`'s own.
- **P-3** On a 5,000-row fixture, filter change / search commit / view switch: no long task > 50 ms, TBT < 200 ms. Heavy deps load lazily (shiki only via `CodeBlock`); every surface stays under its `scripts/budgets.json` row and receipts its delta.
- **P-4** Images and other remote fetches from extension surfaces are lazy, fixed-size (zero layout shift) and `referrerpolicy="no-referrer"`.

## W — Words (`UX-D12`)

- **W-1** Sentence case; feature names only from the option map/verified labels (never re-typed); digits for numbers; present tense; no "please", no exclamation marks, no blame; toasts `"<Thing> copied"`.
- **W-2** Every string delta vs a reference surface is listed in the phase's receipts; P15's copy sweep owns final wording.

## D — Definition of done (every UI change, receipted in its phase doc)

- **D-1 Widths:** the surface's floor, 480, 768 and a wide size (panel: 320 / 480 / 768 / 1280 px, docked right and bottom): the content region never scrolls horizontally (`scrollWidth === clientWidth`), every control reachable.
- **D-2 Themes + motion:** `system`/dark/light, then `prefers-reduced-motion: reduce` emulated — `document.getAnimations()` (or the shadow root's) empty after mount.
- **D-3 Keyboard-only walk** of every state; focus always visible.
- **D-4 axe:** 0 violations per state (by hand, automated in the phase's browser-suite sub-phase).
- **D-5 Refresh** keeps UI state (S-2).
- **D-6 Grep gate** over the change's own files, empty: `rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(|transition-all|animate-|duration-[0-9]|\b(sm|md|lg|xl):|behavior: 'smooth'" <files>` (shadow-root CSS: the colour and `transition-all`/smooth terms apply; hits on token definitions themselves are out of scope).
- **D-7 Performance:** where the surface lists rows, the P-3 check on the 5k fixture; budget delta receipted.

## Change log

- 2026-10-14 — created (owner mandate); values derived from the shipped tokens and primitives; first consumers P6B–P6F.
- 2026-10-14 — `L-1` tiers declared once as `@theme` container sizes (`@regular:`/`@wide:`), replacing scattered `@min-[480px]:`/`@min-[768px]:` literals; values unchanged — P6A.1.
- 2026-10-14 — `L-1` states what a breakpoint measures (the container's content box; panel pages: the content region, not the panel) — P6A.1 audit round; no value moved.
- 2026-10-14 — `L-3` card-grid track 13 rem → 15 rem (13 rem wrapped feature names to 3 lines at 1000–1400 px panels, measured on the Detections page) and the compact grouped-rows form for long card grids — P6B audit round.
- 2026-10-14 — `L-3` copy-controls clause aligned with what ships: icon-only only where it truly saves title-row space; primary actions keep their label (Detections `Copy report`) — P6B verification round.
