# P23: DevTools panel + options redesign (visual, UI, UX)

## TLDR

Owner 2026-11-18 rated the panel's look "3/10" and approved a full redesign of **the devtools panel and the options page** (options joined the same day: it shares the panel's styles; **injected UIs unchanged**). Reference mockup (before/after boards, 420/760/1100 px, both palettes): [FDT Panel Redesign canvas](https://claude.ai/artifact/D7zrRhaseFoB4iaxDXmbcv). Five owner-approved decisions (2026-11-18) override older rules and are written into the binding docs **first** (P23A):

1. **One top bar** (WP Rocket version, cache, server, freshness + ⌘K, Exclusions, Refresh, appearance toggle); the bottom status strip goes. Nav stays vertical.
2. **Labeled sidebar with live counts** on wide panels; folds to the icon rail (button, automatically on narrow panels and while a list detail pane is open, unless the user pinned it).
3. **Calm lists + master–detail**: no row hairlines, 58 px two-line rows, one muted preview line, ≤ 2 state chips + "+N"; a row opens a detail view (side pane when the content is ≥ 830 px, otherwise drill-in with Back/↑↓/Esc) holding syntax-highlighted code (JS, JSON, **CSS, HTML**), attributes, a source-link tile (Open in Sources / new tab) and copy actions. Root cause addressed: owner feedback of visual fatigue ("lines everywhere", a code box per row).
4. **Combinable facet filters** (e.g. Delay × Defer × Type); narrow panels fold them into a Filters button + bottom sheet.
5. **Larger stat numerals** (Detections/Vitals tiles).
6. **Options page in scope** (owner 2026-11-18): it gets the same tokens and primitives as the panel. The mockup has no Options board, so its layout is this plan's proposal (P23I): a sticky app bar with Save and the appearance menu, calm section rows, one column.

Pages not drawn in the mockup are restyled to the same system, never below today's level. No new dependency. Order: docs → tokens → primitives (parallel) → shell ∥ pure list logic → list pages → Detections ∥ tools ∥ options → sweep → acceptance. Slot: **before P15** (release gate).

## Start here (fresh session)

1. Read, in order: `AGENTS.md` → [plans index](./README.md) → this doc (whole) → [UI bar](../ui-ux-bar.md) → [design decisions](./design-decisions.md) UX-D1–D19. The owner decisions above are final — don't re-ask them.
2. Mockup: open the canvas with the Artifact tool (`action: "read"`, url above; boards are files `project/<Board>.dc.html`: `Main` (Detections), `JavaScript`, `Stylesheets` (light), `Rucss`, `Narrow`, `NarrowJs`/`NarrowJsDetail` (420 px), `MidJs`/`MidJsDetail` (760 px); `Before*` boards are screenshots of today's panel). Read only the boards your phase names.
3. Workflow (owner): the session supervises; each phase gets a **fresh** worker in its own worktree (inside Orca: `orca worktree create --branch <name> --base-branch feat/p23-panel-redesign`), then a fresh adversarial auditor, fixes, verification, merge into `feat/p23-panel-redesign`. Workers end with a hand-off file (scratchpad, never committed) for the next one. Findings are verified as real before they are fixed. No commit/push unless the owner asks; push only the feature branch.
4. First steps: create `feat/p23-panel-redesign` from `develop` → **P23.0** (screenshot script + "before" set) and **P23A** (docs) — the two may run in parallel — → then follow the diagram below.
5. Numbers in this doc (830, 58, 350, 208, 1080, 760…) are the proposal P23A moves into the UI bar; after P23A the **UI bar is their declaring site** and code cites it (the bar's "values change with the code" rule gets a dated owner exception for this docs-first redesign — P23A writes it).

## P23.0 — Screenshot harness + "before" set

Depends: —. Parallel: A, E.1, E.2. Size: XS. Difficulty: low.

- [ ] `scripts/panel-screenshots.mjs` (local only, never CI, never a dependency of tests): launches Chromium the way `tests/e2e/helpers/extension.ts` does (Playwright from devDependencies, persistent context, `--load-extension` of the unpacked `.output/chrome-mv3`, real scrollbars), opens a docker-site page (URL from `docker/.env` `WPR_FDT_SITE_URL`, e.g. `?fdt-delay=1` for delayed scripts; a desktop Chrome user agent, because headless UAs may be served uncached), stamps `devtools.inspectedWindow.tabId` on `window.chrome`/`window.browser` exactly like `tests/e2e/helpers/panel-data.ts` `devtoolsShim`, then saves every route (`panel.html#/<route-id>` for each id in `entrypoints/panel/routes.ts`) and the options page (`options.html`) at 420 / 760 / 1100 × 760 px in dark and light (`emulateMedia` before navigation). Output folder argument, default `.screenshots/<label>/` (add to `.gitignore`). Header TSDoc explains usage; fail fast with the cause when the build or site is missing.
- [ ] Run it on `develop`'s build → `.screenshots/before/`. Record the command in the receipt.

DoD: script runs, 66 images ((10 routes + options) × 3 widths × 2 palettes), nothing committed but the script and the `.gitignore` line; gates green (`pnpm lint` covers `scripts/`).

## Stack (installed versions; no new package)

Node 24 · pnpm (pinned) · TypeScript 5.9 · WXT · SolidJS · Tailwind CSS 4 (container queries, `@theme` sizes) · `@kobalte/core` 0.13.x via `components/ui` only (Menu for the appearance menu, Dialog for the filter sheet) · `lucide-solid` per-icon imports · `shiki` 4.5 (+ `css`/`html` grammars already in `@shikijs/langs`) · `@tanstack/solid-virtual` 3.13 · Vitest 5 + `@solidjs/testing-library` + happy-dom · Playwright e2e (local only). Verify every API against `node_modules` before use (AGENTS "Never guess").

## Verified facts this plan builds on (2026-11-18)

- Shell: `entrypoints/panel/App.tsx` composes header(rail)+`main`+`StatusBar` footer; status answers come from `status-bar/selectors.ts` (`wprDetections.wpr`, `cacheStateFromFdtData`, `pageHeaders` server/x-powered-by, `fetchedAt`, stale > 600 000 ms), `aging-clock.ts` (30 s tick), `builder-entry.tsx` (Exclusions + Off/On/Unavailable badge). Status sync guard pins 480 in `status-bar.test.tsx`.
- Nav: `routes.ts` (`NAV_GROUPS`, `liveState` text+tone), `nav/adaptive-nav.tsx` (32 px icon rows, tooltip labels), overflow `visible-rows.ts` + `rail-metrics.ts` (ResizeObserver, height only).
- Refresh: `data.reload()` (`state/use-fdt-data.ts`) = the palette's Reload row (soft refresh). No shell button today.
- Appearance: `optionsStore.appearance` (`lib/storage/options.ts`, `setAppearanceOption`/`cycleAppearanceOption`), applied live by `lib/appearance/appearance.ts`; the panel changes it only through the palette row today (AGENTS: panel + options are the only writers).
- h1 ring after route switch: `palette/focus.ts` focuses `[data-fdt-page] h1` (`tabindex=-1`, `page-header.tsx`), no outline override → browser default `:focus-visible` ring.
- Lists: `pages/resource-list/filtered-list.tsx` rows carry `border-t` hairlines inside a bordered frame; filters single-select (`components/ui/filter-bar.tsx`, `lib/panel/resources-view-model.ts` `filterAndSearch` one id, negation chips); `MAX_VISIBLE_STATE_CHIPS = 3` (`state-chips.ts`); per-row UI state lives in pages keyed by row identity; find via `pages/current-match.ts`; **no ↑/↓/Enter row keys today**. JavaScript inline rows render a `CodeBlock` each (`script-row.tsx`, 3 collapsed lines). Stylesheet data carries only a ≤ 160-char `preview` (`lib/messaging/page-styles.ts`) — full CSS needs a new bounded read (script precedent: `lib/messaging/script-source.ts` `loadScriptSource`).
- Detections: `pages/detections/*` (summary strip, All/Active/Inactive, Adaptive/List, `status-card.tsx`); `HUD_GROUPS`/`hudFeatureOf` (`lib/detection/hud.ts`) exist but the panel does not group.
- Tools: RUCSS (`rucss-tester/`, eager in panel chunk), Beacon (`beacon-tester/`, lazy), LCP & Vitals (`lcp-vitals/`, lazy); settings via `pages/settings/*`.
- Highlighting: `CODE_BLOCK_LANGS = ['javascript','json']` (`components/ui/code-block-langs.ts`), worker row 368/75 KiB (measured ≈ 356.8/72.7). `css.mjs` 56.9 KB raw/12.6 gz; `html.mjs` 61.9/11.8 and imports `javascript`+`css` → CSS+HTML ≈ +119 KB raw/+24 gz. Vite `worker.format` default is `'iife'` (no code-splitting); `wxt.config.ts` sets none.
- Open in Sources: Chrome `devtools.panels.openResource(url, lineNumber, columnNumber?)`; the Promise form exists only since Chrome 152 while `minimum_chrome_version` is 145 → use the **callback** form (typed in `@wxt-dev/browser`). **Not documented for Firefox** (MDN `devtools.panels` lists only `create`, `elements`, `themeName`, `onThemeChanged`) → feature-detect, Firefox opens a new tab. Nothing calls it today.
- Shared primitives by user. **Injected UIs** import only `choice-group` (the exclusion overlay: `modes.ts`, `exclusions/simulation-mode-control.tsx`…), `command-palette` + `command-matcher` (`command-palette.content/app.tsx`), `dialog`, `virtual-list` and `copy-flash`. These need opt-in variants whose default is today's look. Every other primitive options imports (`badge`, `button`, `card`, `error-state`, `page-header`, `skeleton`, `switch`, `toast`) is used **only by the panel and options**, so it can be restyled in place.
- Options (`entrypoints/options/`): `App.tsx` renders a `max-w-3xl` column with a `PageHeader` (manifest name as the h1, "Options" subtitle, mono version `Badge`, dirty-gated Save). Below it come the registry's section cards (`sections.tsx`: `Card` per `OPTION_SECTIONS` entry, rows inside `divide-y divide-line-1` hairlines; boolean rows = `Switch`, appearance row = default `ChoiceGroup`), the instant rows (`instant-rows.tsx`: on-page UI gate, palette chord), the `kc-freshness.tsx` card and a skeleton/error state. `index.html` holds the pre-paint theme lock; `style.css` has only the mount entrance. Appearance changes go through `scope.edit` (draft + instant `setAppearanceOption`), which **skips the instant write while a Save is in flight** (whole-shape read-modify-write race, see the comment in `App.tsx`). Budget row "options JS" = 50 KiB raw. `lib/appearance/appearance.ts` exports `pageTheme(appearance)` (`null` for System; there is no resolved-palette accessor).
- Contracts: page data (`FdtData`) records are rebuilt field by field by `lib/messaging/validate.ts`, bounded by `lib/messaging/payload-bounds.ts` (5 000 scripts, 8 MiB total inline content — content is clipped/emptied once spent), redacted for report/export by `lib/redaction/page-data.ts`, and pinned against the test-only reference engine (`lib/detection/reference-parity.test.ts`, `toEqual` + key order) — so **new per-record data goes through an on-demand ask, not a new `FdtData` field**. Tab asks are registered in `lib/messaging/protocol.ts`, `tab-asks.ts`, `tab-relay.ts` and `tab-relay-client.ts` (Firefox relay path), as `getScriptSourceChunk` is. `parseStyleInventory` (`lib/messaging/page-styles.ts`) accepts only the keys `styles`+`total` and is shared by the Stylesheets list and the RUCSS `listPageStyles`.
- Keys: `/` (alias `?`) opens the **shortcuts overlay** (`palette/shortcuts.ts` `SHORTCUTS_OVERLAY_BINDING`) — it is not a search key. Detections filter today: `all | active | inactive`, `statusBucket` = `isActiveInTab` ? active : inactive, and **non-optimization cards stay visible under every filter** (`lib/panel/detections-filter.ts`); `StatusItem.status` is the `StatusKind`. Stylesheet row ids are **list positions** (`lib/panel/style-states.ts`), not stable identities. `NoMatchesAction` = `'clear-search' | 'show-all'` (`pages/page-frame.tsx`). `HIGHLIGHT_MAX_CHARS = 20 000` (`code-block.tsx`): larger code stays plain. The RUCSS build worker (`lib/rucss-tester/build-client.ts`) is the other Vite worker.
- Data limits: `LazyloadImageRecord` = `src`, `lazyloadDetected`, `excludedReasonsFound` only; scripts carry no size and no served tag (inline size = `content.length`, possibly clipped by the payload budget); link styles have `chars` 0; `WordDefinition` = `word` + `definitions` (no occurrence count); the style inventory is a stateless `querySelectorAll` per ask (no snapshot/index) and the critical row is snapshot-only (`CRITICAL_SNAPSHOT_ROW_ID = -1`, no CSS); the Detections layout store is never persisted; `StatusKind` = `active | collecting | unknown | not-active`; the hash router takes route ids only (no sub-anchors); `aging-clock.ts` is also imported by the Detections and Headers pages.
- Budgets: panel JS 600 KiB hard (≈ 410), lazy chunks within 2–5 % of their rows, whole build 2160 (≈ 2090). Raises are owner pre-approved when justified (AGENTS "Budgets").

## Risks and mitigations

| Risk                                                                                                                                  | Mitigation                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binding docs (UX-D1/D2/D8/D15/D16, UI bar L/T/M/K, P5J, completed-shell) contradict the new design → implementers follow stale rules  | P23A amends them (dated) before any code; later phases cite the new ids only.                                                                                                                                                                     |
| Large e2e churn (≈ 45 specs assert today's DOM: `panel-status-bar`, `panel-nav`, `panel-code-rows`, chips, layout…) hides regressions | Each phase updates **only the specs its change breaks**, re-asserting the same user-visible fact on the new structure (never deleting a guarantee); every changed assertion is explained in the commit (owner rule). P23.1 re-runs the full tier. |
| Performance: detail pane + virtual list + one preview line per row; 5 000-row gate (UI bar P-3)                                       | Rows stay virtualized and render text only (no per-row `CodeBlock`, no Tooltip); code highlights only in the detail; the selection lives above virtual rows; P-3 measured in E-phases and P23.1.                                                  |
| Selection lost or wrong after soft refresh / filter / search                                                                          | Pure selection machine keyed by row id, prune rules, a "no longer on the page" detail state (P23E.2), tested event by event.                                                                                                                      |
| Budget growth (worker +≈ 119 KB, page chunks near ceilings)                                                                           | P23C.4 measures split-vs-bundled grammars; raises follow AGENTS (trim first, measured + ≈ 3 %, cause in commit).                                                                                                                                  |
| Firefox lacks `openResource`                                                                                                          | Feature detection; the tile's primary action becomes "Open in new tab"; Firefox build + manual check in P23.1.                                                                                                                                    |
| Height loss / narrow panels (UX-D15) regress with a labeled sidebar                                                                   | The overflow ("More pages") rule is reused for both forms; geometry tests at 320/420/480/760/1100/1280 × short heights.                                                                                                                           |
| Visual drift between pages                                                                                                            | One token set (P23B), shared primitives (P23C), list kit (P23E.3); P23H sweeps leftovers; P23.1 screenshots every route in both palettes.                                                                                                         |
| Find/search (UX-D4) and route-switch focus regress                                                                                    | Find keeps driving the list cursor; drill-in returns to the list on a find action; focus rules unchanged except the h1 ring (P23D.4).                                                                                                             |
| Restyling shared `components/ui` primitives changes injected UIs (owner: they stay as they are)                                       | New values live in tokens scoped to the extension pages (P23B); the primitives injected UIs use get opt-in props/variants whose default is today's look; any phase touching `components/ui` runs the injected palette/layout specs.               |
| Options regresses while it is restyled (save flow, instant rows, appearance write race, pre-paint lock)                               | P23I changes layout and look only (model, IO and copy untouched); the new app-bar appearance menu writes through the same `scope.edit` path as the row; every `options-*` spec stays green or is re-asserted with the reason.                     |

## Phase order and parallelism

```
P23.0 screenshots ∥ P23A docs ∥ D.0 move aging clock ∥ E.1 facets (pure) ∥ E.2 selection + layout rule (pure)
P23A ─ P23B tokens ─┬─ C.1 ∥ C.2 ∥ C.3 ∥ C.4 ∥ C.5 (primitives)
                    ├─ D.1 top bar (needs D.0) ─┬─ D.2 appearance
                    │                           └─ D.3 sidebar        (D.4 h1 ring: any time after A)
                    ├─ E.3 list kit, opt-in (needs C.1, C.3, C.5, D.0, E.1, E.2)
                    │    after D.1 + E.3:  E.4 JS ─ E.5 Styles ─ E.6 Lazyload+Preloaded
                    │                       ├─ E.9 Runtime ─ G.2 Beacon
                    │                       └─ (E.5) ─ G.1 RUCSS
                    │                      E.7 Headers ∥ E.8 Undefined refs (∥ E.4–E.6)
                    ├─ F.1 → F.2 Detections (needs C.1, C.2, D.1)
                    ├─ G.3 LCP & Vitals (needs C.2)
                    └─ I options (needs C.1, D.1, D.2, D.4)
P23H sweep (needs D, E, F, G, I) → P23.1 acceptance → P15
```

Max 3 concurrent workers (owner rule). **Two phases that edit the same file — code or spec — never run in parallel.** Known pairs, already serialized above: E.4/E.9 (`javascript/page.tsx`); E.9/G.2 (Beacon result lists, `beacon-tester/results.tsx` uses `FilteredList`); E.4/E.5/E.6 (`panel-link-rows-name-first.spec.ts`); D.1 before any E/F page phase (D.1 edits `panel-list-entry`, `panel-detections-filter`, `panel-detections-layout`, `site-detection-matrix` waiters). A worker that finds another shared file stops and asks the supervisor to serialize.

**Branch + workers:** one feature branch `feat/p23-panel-redesign` from `develop` (no username prefix); each phase on a worktree branched from it and merged back after its gates; push only to the feature branch, never `develop`, unless the owner says so. Worktrees share one `refs/stash` (never `git stash`); e2e runs are serial (fixture port 8891).

**Mockup use:** the canvas is the visual reference for layout, spacing, hierarchy and states, **not for data**: some of its script/style rows, sizes and attributes are invented, and its colors are a starting point (P23B's AA gate decides). It is private to the owner — a worker that cannot open it asks the supervisor for screenshots of the named board instead of guessing. It has no Options board: P23I follows the system the panel boards define (top-bar look from `Main`, settings sections from `Rucss`).

## Common rules for every P23 phase

- Read [UI bar](../ui-ux-bar.md) (as amended by P23A) and the mockup board(s) the phase names. Values come from tokens/primitives; no hex, no `transition-all`, no viewport `sm:/md:` variants (D-6 grep).
- Keep behavior: data, copy texts of states (S-3), find (UX-D4), soft refresh (UX-D5/S-2), error/empty/filtered-empty states (S-1), copy actions and toasts. Words: delegated to the implementer (owner), sentence case, W-1.
- Every new pure function: unit tests first (edge cases listed per phase). Every component: render tests for each state. Every changed e2e spec: same guarantee, new selectors; explain in the commit.
- `data-fdt` hooks: keep existing names where the element survives; new elements get new hooks; never reuse a name for a different meaning (e.g. `panel-header` stays on the nav column; the top bar is `panel-top-bar`).
- **Panel + options, never injected UIs.** Primitives only the panel and options use are restyled in place (both surfaces take the new look). A primitive an injected UI uses (`choice-group`, `command-palette`, `dialog`, `virtual-list`, `copy-flash` — see verified facts) keeps its look there: the new look comes from the extension-page tokens (P23B) or an opt-in prop/variant whose default is today's look. Any phase that touches `components/ui` adds `options-page-ui`, `options-palettes`, `options-a11y-layout`, `page-command-palette`, `theme` and the exclusion-overlay layout specs to its e2e list. An options spec that breaks because of the intended new look is re-asserted (Common rules: changed specs), never deleted.
- **Typography** stays inside the amended T-1: row names `text-xs font-semibold` (12 px), caps labels (column headers, sidebar groups) `text-2xs uppercase tracking-wide` (11 px), new sizes only `text-stat`/`text-tile` on tiles. The mockup's 12.5/10 px are rounded to these.
- Gates after each phase: `pnpm compile && pnpm lint && pnpm format:check && pnpm test`; UI/bundle phases add `pnpm build && pnpm build:firefox && pnpm check:budgets` and the phase's e2e specs (`pnpm test:e2e <spec>`; serial runs, port 8891). Receipt = UI bar §D (D-1 widths 320/420/480/760/1100/1280 docked right+bottom, D-2 themes + reduced motion, D-5 refresh, D-6 grep, D-7 perf where lists) + budget deltas.
- On completion, trim the phase's instructions to decisions + receipt (owner doc rule).
- **DoD of every phase** (unless the phase states more): its checklist done, its listed unit + e2e specs green, the gates above green, receipt written (decisions, deltas, §D checks, budget table, changed assertions + why).
- **New end-to-end flows get new specs** (owner testing rule: every flow, not only updated old ones), each landing with its phase in `tests/e2e/suites/`:
  - `panel-top-bar.spec.ts` (D.1): answers, links, overflow below 760 px, Refresh re-stamps freshness, Exclusions opens the overlay.
  - `panel-appearance-menu.spec.ts` (D.2): System/Light/Dark from the panel, live switch, persisted across panel reloads, options page reflects it.
  - `panel-sidebar.spec.ts` (D.3): labeled ≥ 1080, rail below, pin survives reload, auto-fold while a pane is open, "More pages" at short heights in both forms.
  - `panel-master-detail.spec.ts` (E.3, on the JavaScript page once E.4 lands): pane at ≥ 830 px content, drill-in below, ↑/↓/Enter/Esc, Back restores row + scroll, soft refresh keeps the selection, removed row → "no longer on the page".
  - `panel-facets.spec.ts` (E.3/E.4): combined facets, counts, compact Filters sheet, filtered-empty + Clear filters, find inside filtered rows.
  - `panel-source-link.spec.ts` (C.3/E.4): with the devtools shim's `openResource` stub (extend `tests/e2e/helpers/panel-data.ts` `devtoolsShim`, recording calls) the tile calls it once with the URL; without it the tile opens a new tab. Native "Open in Sources" stays a manual owner check (standalone pages have no real DevTools).
  - `panel-style-source.spec.ts` (E.5): full inline CSS arrives in chunks; a fixture ≤ 20 000 chars is highlighted, a larger one stays plain (`HIGHLIGHT_MAX_CHARS`); a removed `<style>` reports gone; the critical snapshot row explains itself.
  - New asks (E.4 served tag, E.5 style source) also get integration tests on the real content script (existing `processed-page-pipeline`/stylesheet fixtures), Chromium direct path and the relay path.

## P23A — Binding-doc amendments (docs only) — done

Depends: —. Parallel: E.1, E.2. Size: S. Done 2026-11-18 (`docs/p23a-binding-docs`).

- [x] [Design decisions](./design-decisions.md) (dated 2026-11-18, owner, P23): UX-D1 top bar; UX-D2 labeled sidebar + rail, fold/pin, nav never horizontal (supersedes the 2026-10-13 rail revision + P5J); UX-D8 top-bar glance (server + freshness fold into "⋯"); UX-D10 → facet bar; UX-D15 both nav forms, top bar in the reachability list; UX-D16 rail spacing kept, labeled rows 32px + 14px lead; new UX-D17 calm lists + master–detail, UX-D18 facets + **Detections filter All / Active / Collecting / Off (replaces P6G.12's wording)**, UX-D19 options; TLDR range D1–D19; audience budget "status bar" → top bar; revision-record line.
- [x] [UI bar](../ui-ux-bar.md): L-1 (`@split` 830, sidebar labeled ≥ 1080, top bar full from 760, 208/52 px sidebar, derived 532/820/882 px tiers; status-strip + ≈ 49 px figures dropped), L-2 (≈ 268 px), L-3 (list stacking, Filters sheet, drill-in / 350 px pane; card grid = Detections Cards mode), T-1 (12/11 px roles, `text-stat` 20/24, `text-tile` 15/20 — only additions), T-3 (58/36 px, 4 px gap, 14 px padding, no hairlines, ≤ 2 chips + "+N"), M-2 (+ pane enter, drill swap, filter sheet) + M-3 (sidebar fold instant), K-1 (list keys; `/` = shortcuts overlay), S-1 (`Clear filters`), D-1 (320/420/480/760/1100/1280); dated owner exception in the change-rule sentence + Change log, one line per rule.
- [x] Supersede lines: P5J (TLDR), `completed-shell.md` (Navigation + Status), `10-phase-9-options.md` (TLDR → P23I), `07-phase-6-panel-pages.md` P6G.12 (filter wording → UX-D18); AGENTS.md runbook "status strip" → "top bar". README index already carried the mockup link.
- Conflicts resolved (plan wins): status bar 480 threshold and "four segments from 480px, wrap 320–480" → top-bar 760 rule; "at ≥480px initial answers need no scroll; narrower wrap" → no scroll at any width (fold per UX-D8); rail 49 → 52 px; T-3 32 px hairline rows → 58/36 px calm rows; 3 → 2 visible chips; D-1 768 → 760 (+420/1100); K-1 Enter → Enter/Space (E.3); UX-D16 caps label cites T-1 instead of re-typing 11px.
- [x] Audit fixes (supervisor-verified): UX-D17 selection vs filter/search (→ E.2 rules); P-2 rows text-only; master P23 entry (options in, D10/D15–D19); L-3 floor figure → L-2, compact Cards rows without `divide-y`; Detections buckets declared once (UX-D18, F.2 cites); pin vs width (UX-D2 + L-1 + D.3).

DoD met: values declared once (UI bar; nav row geometry stays in UX-D16, its existing declaring site); `pnpm format:check` green.

## P23B — Design tokens refresh

Depends: A. Parallel: E.1, E.2. Size: S. Difficulty: medium (contrast gate).

- [ ] Scope: `tokens.css` is shared with every injected UI, which must stay as it is (owner). So the retuned values are declared **once**, in an extension-page block of `assets/css/tokens.css` — `:root[data-fdt-surface='extension-page']` — set as a static attribute on `<html>` by both `entrypoints/panel/index.html` and `entrypoints/options/index.html` (present before first paint). Injected UIs (`:host`, `[data-fdt-tokens]`) keep today's values untouched. Below, "panel block/map" means this extension-page block.
- [ ] Retune palette values toward the mockup (calmer lines, clearer surface steps). Starting values (light / dark): surface-0 `#f1f2f5`/`#0b0d11`, surface-1 `#f8f9fb`/`#0f1217`, surface-2 `#ffffff`/`#141820`, surface-3 `#f2f4f7`/`#1b2029`, surface-4 `#e6e9ef`/`#252c38`, line-1 `#e3e6ec`/`#1d232c`, line-2 `#d5d9e2`/`#283040`, line-3 `#c3c9d4`/`#36404f`, fg-muted `#5e6776`/`#8b96a9` (dark kept at today's value: the mockup's `#808b9d` on surface-4 `#252c38` is 4.08:1, below AA; `#8b96a9` gives 4.70), accent `#2f56e8`/`#8aa4ff`. Add **`--accent-soft`** (`#eceffe`/`#1c2145`: selected nav row, selected list row, icon tiles) — declared in the **shared** block too (same values; unused by other surfaces), so the typo guard below holds — and map it in `theme.css` (`--color-accent-soft`).
- [ ] `assets/css/theme.css` `@theme`: `--container-split: 830px`; `--text-stat` (1.25rem/1.5rem), `--text-tile` (0.9375rem/1.25rem).
- [ ] `assets/css/theme.test.ts`: its parser (`tokens` map, ≈ lines 68–77) keys tokens by name only, so a second `--surface-0` in the panel block would silently **overwrite** the shared value and stop testing it. Make the parser selector-aware: one map for the shared `:root, :host, [data-fdt-tokens]` block, one for the panel block (panel map = shared values overridden by panel values). Run the full AA table on **both** maps, plus `accent`, `fg-primary`, `fg-secondary` on `accent-soft` (panel map). Add a test that fails when the panel block declares a token the shared block lacks (typo guard). **If a pair fails, adjust the new value until it passes** (never relax the gate).
- [ ] Edge cases: the appearance attribute (`data-theme` on `<html>`) must combine with the scope attribute (both on `<html>`; test System/Dark/Light × scope, on both documents). Re-run `theme.spec.ts`, `options-palettes.spec.ts` and the strip/overlay palette specs: injected UIs stay byte-identical in computed colors (e.g. the strip pill `--surface-2` the options-palettes spec pins), options takes the new values.

DoD: AA gate green both palettes; injected-UI specs green; screenshots of 3 panel routes + options before/after attached to the receipt.

## P23C — Shared primitives (each sub-phase independent)

### P23C.1 — Segmented variant of ChoiceGroup

Depends: B. Parallel: C.2–C.5. Size: S. Difficulty: low.

- [ ] Reuse, don't duplicate: extend `components/ui/choice-group.tsx` (the shared APG single-choice control) with an opt-in `variant: 'segmented'` (default = today's look — the exclusion overlay keeps it; Detections and options opt in in their phases), an optional leading muted `label` ("Delay") and an optional per-option `count` (`tabular-nums`, muted). Segmented look: container `bg-surface-3` + `line-1`, selected option raised (`bg-surface-2 shadow-elev-1`), `FOCUS_RING`. Zero-count options stay selectable unless the caller passes `disabled`; disabled text stays readable (`fg-muted`, no opacity on text — C-1). Keyboard stays the radio-group pattern it already has (so tests assert the radio **checked** state, not `aria-pressed`).
- [ ] Boolean filter **toggles** (e.g. Minified) are not single-choice: render them as a separate `pages/resource-list/toggle-chip.tsx` (native `<button aria-pressed>`, same segmented look, panel-local) placed after the segments.
- [ ] Tests: existing ChoiceGroup tests untouched and green; new: variant classes, label, counts, disabled skip, keyboard on the variant; toggle chip pressed/unpressed. Run the options + overlay specs (Common rules: panel + options, never injected UIs).

### P23C.2 — Stat tile + score ring

Depends: B. Parallel: C.1, C.3–C.5. Size: S. Difficulty: low.

- [ ] `components/ui/score-ring-geometry.ts` (pure): `ringArcs(segments: {value, kind}[], total, circumference) → {dash, offset, kind}[]`; clamps negatives, total 0 → no arcs, sum > total → scale down, gap between arcs ≥ 0. Unit tests for each.
- [ ] `components/ui/score-ring.tsx` (SVG, `aria-hidden`, colors from status tokens, no animation) and `components/ui/stat-tile.tsx` (`label`, `icon?`, value slot, `sub?` slot, `href?` → whole tile not a link; only an inner link is interactive — K-6).
- [ ] Render tests: arcs count, zero state, tile with/without sub/link.

### P23C.3 — Source-link tile + Open in Sources

Depends: B. Parallel: C.1, C.2, C.4, C.5. Size: S. Difficulty: medium.

- [ ] `entrypoints/panel/pages/open-resource.ts`: `openResourceCapability(api: unknown): ((url: string) => Promise<void>) | null` — feature-detects on its **parameter** (`typeof api.devtools?.panels?.openResource === 'function'`, narrowing `unknown` safely) so tests pass doubles; production passes the auto-imported `browser` (never `globalThis`). Calls the **callback** form `openResource(url, 0, callback)` (the Promise form needs Chrome 152; the floor is 145), wrapped in a Promise; inside the callback read `runtime.lastError` with `utils/last-error.ts` and reject on it. Errors → `log.warn` (no URL logged: it can carry tokens) + toast "Couldn't open in Sources".
- [ ] `entrypoints/panel/pages/resource-list/source-link.tsx`: the mockup tile (icon tile · "Open in Sources · host" · 2-line clamped mono path · ↗ arrow; hover = surface-3 + line-3, arrow turns accent; never underlined/blue) + a square companion tile "Open in a new tab" (`<a target="_blank" rel="noopener noreferrer">`, icon + `aria-label`). Only `http(s)` URLs get actions (reuse `parseHttpUrl`); others render as plain mono text; a **clipped** URL (today's "Clipped" badge in `resource-link.tsx`) keeps the badge and gets no open action (the URL is incomplete). Without the capability (Firefox), the main tile itself opens a new tab and reads "Open in new tab · host"; the companion tile hides.
- [ ] Tests: capability present/absent/throwing, http vs non-http, long URLs (no horizontal overflow at 268 px), click calls the adapter once, error toast.

### P23C.4 — CSS + HTML highlighting

Depends: B. Parallel: C.1–C.3, C.5. Size: M. Difficulty: medium.

- [ ] Add `'css'`, `'html'` to `CODE_BLOCK_LANGS`; import `shiki/langs/css.mjs`, `html.mjs` in `code-block-highlighter.ts`; add to `langs`. Protocol/validation picks them up through the shared table (verify `code-block-worker-protocol.ts`, `code-block.tsx` gates).
- [ ] Decide bundling by measurement (record both numbers): (a) **bundled** — worker row grows ≈ +119 KB raw/+24 gz → raise per AGENTS; (b) **on demand** — set `vite.worker.format: 'es'` in `wxt.config.ts`, load css/html with `highlighter.loadLanguage(await import(...))` on first use (worker already `type: 'module'`; Firefox ≥ 150 supports module workers — verify on the Firefox build), each grammar chunk gets a `required` budget row wherever today's worker row applies (it has no Firefox variant today — mirror the existing coverage, don't invent rows). `worker.format` is **global**: it also rebuilds the RUCSS build worker (`lib/rucss-tester/build-client.ts`) — re-run its tests, its budget rows (both builds) and `panel-rucss-tester` under (b). Pick (b) if the base worker stays ≤ today, the RUCSS worker still works in both builds, and the first CSS block highlights < 150 ms locally; else (a).
- [ ] AA token swaps (existing) apply to the new grammars: run highlighter tests with CSS/HTML samples in both themes.
- [ ] Tests: lang table, CSS/HTML highlight, unknown lang stays plain, 20 000-char cap still plain, timeout path.

### P23C.5 — Bottom sheet

Depends: B. Parallel: C.1–C.4. Size: XS. Difficulty: low.

- [ ] `components/ui/sheet.tsx` on the existing `ModalDialog` wrapper (`components/ui/dialog.tsx`): bottom-anchored, rounded top, grab handle (decorative), scrim token, Esc/scrim close. `ModalDialog` deliberately does **not** restore focus ("focus on close is the caller's contract"), so the sheet owns it: take a `restoreFocusTo: () => HTMLElement | undefined` prop (the Filters button) and focus it after close. Motion per amended M-2.
- [ ] Tests: open/close, Esc, scrim click, focus restore.

## P23D — Shell

### P23D.0 — Move the aging clock out of the status bar

Depends: —. Parallel: everything except D.1. Size: XS. Difficulty: low.

- [ ] `git mv entrypoints/panel/status-bar/aging-clock.ts` (+ its test) → `entrypoints/panel/state/aging-clock.ts`; update the three importers (`pages/detections/page.tsx`, `pages/headers-cookies/page.tsx`, `pages/detections/page-clock.test.tsx` mock path) and the status bar. No logic change. This removes the only cross-folder import that D.1's move would break, so D.1 no longer conflicts with E/F pages.
- [ ] Create `entrypoints/panel/state/detail-presence.ts`: a shell context `{ detailOpen: Accessor<boolean>, setDetailOpen }`, default false, reset on route change, provided in `App.tsx` (nothing reads it yet). D.3 reads it; E.3 publishes into it — so neither waits for the other. Unit test: default, set, route reset.

### P23D.1 — Top bar (replaces the status strip)

Depends: B, D.0. Parallel: C.*, E.1–E.3, G.3 (E/F page phases wait for D.1: they share spec files). Size: M. Difficulty: medium.

- [ ] Move `entrypoints/panel/status-bar/` → `entrypoints/panel/top-bar/` (git mv; keep `selectors.ts`, `builder-entry.tsx`, `builder-session.ts` logic unchanged; rename `status-bar.tsx` → `top-bar.tsx`). Update AGENTS.md repository structure.
- [ ] Shared frame (options reuses it in P23I): `components/ui/app-bar.tsx` = the bar's frame (44 px, `bg-surface-1`, bottom `line-1`, `start`/`end` slots, `data-fdt` passed by the caller) + `components/ui/brand-mark.tsx` (brand tile: 24 px, accent-from→accent-to gradient, rocket icon, `aria-hidden`). No surface logic in either; render tests.
- [ ] Layout (mockup Main/MidJs/Narrow headers): `<AppBar data-fdt="panel-top-bar">` (never reuse `panel-header`, which stays on the nav column). Left: brand mark + visible name "WPR FDT" (hidden < 760 px panel); inspected host (mono, truncated, `title` = full URL — source: `report/inspected-page-url.ts`). Answers: WP Rocket pill, Cache pill, server text, freshness on the Refresh button. Right: palette trigger as a search-styled button "Jump to… ⌘K" (reuse `PaletteTrigger` behavior + tooltip), `BuilderEntry` (label hidden < 760 px, badge always), Refresh (`data.reload()`, `busy` while refreshing), appearance menu (D.2), "⋯" overflow below 760 px holding server + freshness + Exclusions label.
- [ ] **Keep every status-strip behavior** (read `status-bar.tsx` + `selectors.ts` first and list them in the receipt): all cache states (six in `selectors.ts`) with their tooltip copy and cache age; WP Rocket absent = neutral; the stale freshness marker with its remedy text and the "refreshing" state; the WP Rocket, cache and platform answers link to `#/detections` exactly as today (UX-D1 as amended; the router takes route ids only); freshness is text, never a link; the sr-only `FreshnessDetail` stays (shipped a11y code stays — UX bar §K).
- [ ] One width rule: `topBarLayout(width)` pure → `{showName, showServer, showFreshnessText, showExclusionsLabel, overflow}`; one constant `TOP_BAR_FULL_MIN_WIDTH = 760` declared once; unit-tested at 319/320/759/760/1079/1080 (≥ 760: everything visible; < 760: name, server, freshness text and Exclusions label move to "⋯", WP Rocket + cache pills always visible).
- [ ] `App.tsx`: header row above `STACK_ROW`; remove footer; keep the `z-10` reachability guarantee (UX-D15) for the bar and the nav at micro heights.
- [ ] Tests: port `status-bar.test.tsx` cases (answers, tones, stale freshness, links) to `top-bar.test.tsx`; replace the 480 sync guard with the new constants' guard; `App.test.tsx` (bar outside content region). E2E: rewrite `panel-status-bar.spec.ts` → `panel-top-bar.spec.ts` (same four answers + links + freshness not a link); update readiness waiters in `panel-boot`, `panel-soft-refresh`, `panel-detections-filter`, `panel-detections-layout`, `panel-palette` (re-stamp), `panel-list-entry` (Shift+Tab target), `site-detection-matrix` (cache chip).

### P23D.2 — Appearance menu

Depends: D.1. Parallel: D.4. Size: XS. Difficulty: low.

- [ ] Extend the `Menu` wrapper (`components/ui/menu.tsx` exports only Root/Portal/Content/Item/ItemLabel/Separator today; Kobalte may be imported nowhere else) with `RadioGroup`, `RadioItem`, `ItemIndicator` (all exported by `@kobalte/core` 0.13 `dropdown-menu`/`menu` — verify the exact export path in `node_modules/@kobalte/core/dist`). Additive: existing users unchanged.
- [ ] `components/appearance-menu.tsx` (shared: panel now, options in P23I), **controlled**: props `value: Appearance` and `onChange(next)`. Each surface wires its own writer: the panel passes `setAppearanceOption` (+ failure toast); options passes its draft path (P23I). It renders an icon button showing the **resolved** palette (sun = light, moon = dark) with the tooltip "Appearance: System (Dark)", and a menu radio group System / Light / Dark with the indicator on the current value. Resolved palette = `pageTheme(value)` (`lib/appearance/appearance.ts`), or for System a `prefers-color-scheme: dark` media-query signal (listener removed on cleanup). Live restyle is already handled by `lib/appearance`. The palette's "Toggle appearance" row stays.
- [ ] Tests: menu wrapper parts render; icon per resolved mode incl. System following a media change; `onChange` called once per pick (none on re-picking the current value); panel wiring: storage failure → toast with remedy (no dead end).

### P23D.3 — Labeled sidebar + fold rule

Depends: D.0, D.1. Parallel: D.2, every E and F phase. Size: M. Difficulty: high (geometry).

- [ ] `lib/panel/nav-mode.ts` (pure): `navMode({ shellWidth, pinned: 'auto'|'labeled'|'rail', detailOpen }) → 'labeled'|'rail'`; auto = labeled iff width ≥ 1080 and !detailOpen; pinned `'rail'` → rail always; pinned `'labeled'` → labeled iff width ≥ the top bar's full-width threshold (UI bar L-1: import that constant, never a second literal), else rail (UX-D2). Tests: full truth table + boundaries at both thresholds.
- [ ] Pin persisted: `local:panelNavPin` via WXT `storage.defineItem` in `lib/storage/` (typed, tolerant read → `'auto'`). The read is async: in `main.tsx` run it **concurrently** with `applyStoredAppearance` (`Promise.all`, before `render`, inside the same `finally` that releases the theme lock — never serially, it would add to the ≤ 500 ms cold-start row) and pass the result to `<App navPin={…} />` (new optional prop; tests inject it). The first painted frame then has the right form (no fold flash); a failed read → `'auto'` + `log.warn`. Re-measure `panel-cold-start`.
- [ ] `nav/sidebar.tsx` (labeled form, 208 px): group labels, rows icon + label + count/state right (from `routes.ts` `liveState`, plus counts: scripts, styles, headers — add `count` selectors beside `liveState`, pure, tested); active row `bg-accent-soft` + accent icon; collapse button at the bottom (`[` hint only if a shortcut is added — optional, register through `palette/shortcuts.ts` declaration if so). Rail form = today's `adaptive-nav.tsx` restyled (active tint, separators per UX-D16).
- [ ] Overflow: reuse `visible-rows.ts`/`rail-metrics.ts` for both forms (measured prefix + "More pages"); never a scrolling nav.
- [ ] `detailOpen` is read from `state/detail-presence.ts` (created in D.0; E.3 publishes into it).
- [ ] Tests: nav render both forms, counts, pin persistence, auto fold. E2E: `panel-nav.spec.ts` — replace "no top bar" with "nav is vertical; top bar holds identity only"; keep overflow suite (run both forms), tooltip placement (rail only), hairline spacing; `panel-a11y` stays green.

### P23D.4 — Route-switch h1 without ring

Depends: A. Parallel: everything. Size: XS. Difficulty: low.

- [ ] `components/ui/page-header.tsx`: the programmatic focus target gets `outline-none` (it is `tabindex=-1`, not interactive; K-2 applies to interactive elements). Focus still lands on the h1 (`palette/focus.ts` unchanged).
- [ ] Tests: unit (class present); `panel-a11y.spec.ts:249` still proves focus moves to the h1. `PageHeader`'s other user is options (in scope, so the change applies there too): run the options specs.

## P23E — Lists

### P23E.1 — Facet filter model (pure)

Depends: —. Parallel: A, B, E.2. Size: M. Difficulty: medium.

- [ ] `lib/panel/resource-facets.ts`: `Facet<Row> = { id, label, values: {id, label, predicate}[] }` (implicit "Any"); `FacetSelection = Record<facetId, valueId|'any'>`; `applyFacets(rows, facets, selection, search)` and `facetCounts(rows, facets, selection, search)` — counts per value **given the other facets' selection** (standard faceting), one pass per facet; unknown facet/value id → throw naming it (keeps today's fail-fast). Optional `toggles` (boolean filters like Minified) as facets with values `{yes}` only.
- [ ] **Additive, no migration here.** E.1 adds the facet API beside today's `filterAndSearch`/`filterCounts`/`FilterBar` (which keep working). Each page phase (E.4–E.9) switches its own page; P23H deletes the old API once nothing imports it.
- [ ] Facet definitions per page, written as data next to today's `ResourcePageDefinition`s (`lib/panel/resources-view-model.ts`). First write a **mapping table** (old chip → facet value or toggle) into this doc's receipt from the actual predicates. Rule: values inside one facet must be mutually exclusive; a value that is a subset of another (e.g. Preloaded Images/Fonts ⊂ Preload; Lazyload Excluded vs Non-lazyloaded overlap) goes into its own facet or becomes a toggle. Starting proposal: JS — Delay (Delayed/Not), Defer (Deferred/Not), Type (Inline/External), toggles Minified/Combined/Excluded; Styles — Type (Inline/External) + toggles per WP Rocket state (Critical/RUCSS/Lazy BG/Async/Minified/Font); Lazyload — Lazyload (Lazyloaded/Not) + toggle Excluded; Preloaded — Hint (Preload/Module preload/Preconnect/DNS prefetch) + Resource (Image/Font) + Source (WP Rocket/Unattributed). Every old chip must stay reachable as a facet value or a value + toggle combination (test it).
- [ ] Tests: each predicate parity with the old chip (same rows), combined facets, counts under selection, search interplay, empty rows, unknown ids, 5 000 rows < 16 ms (bench in test, not asserted on CI timing — assert O(n·facets) via call counts).

### P23E.2 — Selection machine + detail layout rule (pure)

Depends: —. Parallel: A, B, E.1. Size: M. Difficulty: high.

- [ ] `lib/panel/detail-layout.ts`: `detailLayout(contentWidth) → 'pane'|'drill'` (≥ 830 → pane; constant declared once, mirrored by `--container-split` with a sync-guard test).
- [ ] Row identity: the machine works on **stable string keys**, never list positions. Each page supplies `rowKey(row): string` in its own phase: scripts reuse their existing identity (`pages/javascript/script-identity.ts`); stylesheet ids are positions (`lib/panel/style-states.ts`) → E.5 defines a content key (type + `id` attr + `href` + class + preview, plus an occurrence counter for exact duplicates); others pick a field-based key and document it. A refresh that changes the key → `gone`, never a silent jump to another row.
- [ ] `lib/panel/list-selection.ts`: state `{ selectedId: string|null, view: 'list'|'detail' }`; events `open(id)`, `close`, `back`, `step(±1, visibleIds)`, `rowsChanged(visibleIds, allIds)`, `layoutChanged(mode)`. Rules: pane mode keeps `view:'list'` with a selection (pane shows it); drill mode `open` → `view:'detail'`; `back` → list with the same `selectedId` (scroll-restore target); `step` stops at ends (no wrap); `rowsChanged`: selected id filtered out → keep detail on the "no longer listed" state in drill, clear in pane; id gone from the page entirely (refresh) → `gone` flag; layout pane→drill with a selection → stays on list (no surprise jump); drill→pane in detail → pane shows the same id.
- [ ] Tests: every transition, ends, empty lists, gone/filtered rows, layout flips both ways, idempotent repeats.

### P23E.3 — List kit (rows, header, detail container, keyboard)

Depends: B, C.1, C.3, C.5, D.0, E.1, E.2. Parallel: D.1–D.3, F.1, G.3 (no page migrates here). Size: L. Difficulty: high.

- [ ] **Opt-in, so no page changes here.** `FilteredList` and its users (Stylesheets, Lazyload/Preloaded via `resource-list.tsx`, `runtime-section.tsx`, `beacon-tester/results.tsx`) keep today's look and filter API until their own phase switches them: add a `variant: 'calm'` prop (default = today) and accept **either** today's `filters` (single-select) **or** the new `facets` (E.1) — one component, two inputs, a type-level union so a page passes exactly one. Same for the chip cap: `splitStateChips` takes a `max` argument (default `MAX_VISIBLE_STATE_CHIPS` = 3, unchanged); calm rows pass 2. Result: E.3 breaks no existing spec; each page phase owns its own spec updates.
- [ ] `pages/resource-list/list-row.tsx`: two-line row (icon tile 32 px, name `text-xs font-semibold`, muted mono preview, optional size column `tabular-nums` — rendered only when the row has a size, chips column, chevron in drill mode); compact tier stacks (name+size / preview / chips). One-line variant for key-value lists. No borders; hover `surface-3`, selected `accent-soft`; `FOCUS_RING`. Keep what `resource-link.tsx` rows offer today: the row copy button, the external link (now via the C.3 tile in the detail), the "Clipped" badge.
- [ ] `filtered-list.tsx` calm variant: no bordered frame, no `border-t`; the existing `head` slot becomes a sticky column header (caps labels, `text-2xs`); 4 px row gap via `VirtualList`'s existing `gap` (virtual-core `gap`) — never margins on virtual rows; calm size estimates.
- [ ] `pages/resource-list/master-detail.tsx`: measures its own content box (ResizeObserver) → `detailLayout`; pane = 350 px `aside` with header (kind label, title, copy, close), drill = full view with a bar (Back, ↑/↓, "n of m", primary actions) and sticky bottom actions at compact width; publishes `detailOpen` (D.3). Selection lives here (E.2 machine), keyed by row id. Scroll restore on Back goes through `VirtualList`'s **single** `scrollTo` request prop, which find already drives (`filtered-list.tsx` ≈ line 206): merge both sources into one request signal (latest wins) — never call the virtualizer directly; no smooth scrolling (M-5).
- [ ] Keyboard (K-1 amended): ↑/↓ on a focused row move focus + selection (pane) or focus (drill); Enter/Space opens; Esc closes/back; never steals keys from inputs; works with virtual rows (focus moves after `scrollToIndex`; reuse `virtual-list-focus.ts`).
- [ ] Facets UI: `pages/resource-list/facet-bar.tsx` = C.1 segments + toggle chips inline (≥ 480 content) or "Filters" button with active count + removable chips + C.5 sheet (< 480). Filtered-empty state names facets + search and offers "Clear filters" (`NoMatchesAction` `'clear-filters'`, S-1 as amended).
- [ ] Find (UX-D4): `current-match.ts` keeps driving the list; in drill detail a find action returns to the list first.
- [ ] Tests: component tests on `page-harness.tsx` (virtualized doubles) for the calm variant: both layouts, keyboard, refresh with selection, gone state, compact stacking, sheet, both filter inputs; plus proof the default variant renders exactly as before (existing tests untouched). No existing e2e spec changes here (opt-in). The page phases then update, for their own page: `panel-list-entry`, `panel-list-reuse`, `panel-search-nav`, `panel-search-relay`, `panel-header-filter`, `panel-counts-titles` (radio checked state on segments), `scrollbars`, `panel-layout(-audit|-states)` — first page phase to touch each spec owns it (E.4 for the JavaScript cases, E.5 Stylesheets, E.6 Lazyload/Preloaded, E.7 Headers).

### P23E.4 — JavaScript: Delay & defer

Depends: E.3, C.3, C.4, D.1. Parallel: E.7, E.8 (not E.5/E.6: shared `panel-link-rows-name-first`; not E.9: same `javascript/page.tsx`). Size: L. Difficulty: medium.

- [ ] Rows (mockup JavaScript/MidJs/NarrowJs): external = file name + host/path; inline = "Inline script #n" + one-line collapsed code preview (whitespace collapsed, ≤ 200 chars, plain text); type (`module`, `importmap`, `speculationrules`, JSON) prefixed in the preview line; chips = WP Rocket/FDT states only (2 + "+N"). Size column: inline rows only, as characters (`content.length`, no new capture); when the payload budget may have clipped the content (`lib/messaging/payload-bounds.ts` caps 512 KiB per script and 8 MiB total — check the cut report the panel already receives for a per-row signal), show "≥ N" instead of a false exact size; external rows show none (no fetch).
- [ ] **New ask — served tag** (needed for the HTML highlighting the owner asked for). **Not** a new `FdtData` field: that would also need `validate.ts` (field-by-field rebuild), `payload-bounds.ts` (≈ 10 MiB worst case for 5 000 × 2 KiB), `lib/redaction/page-data.ts` (report/export) and the reference engine (`reference-parity.test.ts` key order). Instead an on-demand ask beside the script-source one: read `lib/messaging/script-source.ts` and its content-side handler first; `getServedScriptTag({ snapshotId, scriptIndex })` → `{status:'ok', tag}` | `{status:'gone'}` | typed error, from the **same snapshot** `getScriptSourceChunk` uses (cut the opening tag from the snapshot's served markup if that is what it keeps, else from the live element's `outerHTML` up to the first `>` — record which). Attribute values over 256 chars truncated with "…", whole tag ≤ 2 KiB, validated at the boundary. Register it like `getScriptSourceChunk`: `lib/messaging/protocol.ts`, `tab-asks.ts`, `tab-relay.ts`, `tab-relay-client.ts` (Firefox relay). Tests: handler (delayed, deferred, module, huge attribute, gone), validator (oversize, wrong type), relay path.
- [ ] Detail: kind + name, all state chips with sources (legend stays once per page), attributes from the record (`delayed`, `deferred`, `deferredByWPR`, `fdtExcluded`, `minifyAttribute`, `originalType` — show only what exists), source-link tile (external), code blocks: inline → full source via `loadScriptSource` (JS, or JSON by type); "Served as" → the served tag highlighted as HTML (both inline and external; asked when the detail opens; hidden on `gone`/error with a one-line note). Copy actions keep today's semantics + toasts (copy code, copy URL).
- [ ] Remove per-row `CodeBlock`, Wrap and "Show full lines" from rows (`script-row.tsx`, `script-view.ts` estimates, page `expanded`/`wrapped` sets → selection).
- [ ] Tests: `javascript/page.test.tsx`, `script-view.test.ts` rewritten for rows/detail; e2e `panel-link-rows-name-first`, `panel-code-rows`, `panel-javascript-chips`, `panel-script-copy(-audit)`, `panel-acceptance-large-list`, `panel-acceptance-source-parity`, `panel-copy-focus-independent`, `site-javascript-chips`, `site-simulation*`.

### P23E.5 — Stylesheets + full inline CSS read

Depends: E.4 (pattern + shared spec), C.4. Parallel: E.7, E.8, E.9 (not E.6: shared spec). Size: L. Difficulty: high (new contract on a stateless inventory).

- [ ] **Why a snapshot is needed:** the inventory (`entrypoints/isolated.content/style-inventory/style-inventory.ts`) is a stateless `querySelectorAll` per ask, so an index could point at a different element by the time the detail asks. Make it addressable:
  - `listPageStylesheets` reply gains `snapshotId: string` (random per list call). **Not automatically tolerated:** `parseStyleInventory` (`lib/messaging/page-styles.ts`) rejects unknown keys (`hasOnlyKeys(['styles','total'])`) and is shared with the RUCSS `listPageStyles`. Give the parser an `extraKeys` option (default none) and widen **only** the stylesheets reply (`lib/messaging/page-stylesheets.ts`); RUCSS stays byte-identical (test both).
  - The content side keeps, per snapshot, the ordered element list (strong refs, **only the latest snapshot kept**, dropped on `pagehide` and on the next list call — bounded memory, no leaks).
  - New ask in `lib/messaging/style-source.ts` mirroring `script-source.ts`: request `{snapshotId, styleIndex, offset}` → `{status:'ok', text, total}` | `{status:'gone'}` (unknown snapshot, element detached, index out of range) | typed error; chunked by a `STYLE_SOURCE_CHUNK_CHARS` constant (64 KiB like `SCRIPT_SOURCE_CHUNK_CHARS`), total capped at 1 MiB chars (over cap → truncated flag shown in the detail). Validate every field at the boundary. Register it in `protocol.ts`, `tab-asks.ts`, `tab-relay.ts`, `tab-relay-client.ts` exactly like `getScriptSourceChunk`.
  - Selection key: rows get the content key defined in E.2 (positions are not stable across refreshes).
  - Highlighting stops at `HIGHLIGHT_MAX_CHARS` (20 000): bigger CSS shows plain with the existing notice — say so in the detail, never fake it.
  - The snapshot-only critical row (`CRITICAL_SNAPSHOT_ROW_ID = -1`, `lib/panel/stylesheet-rows.ts`) has no CSS: its detail says so ("Captured from the served HTML — its CSS isn't kept") and never asks.
- [ ] Rows: `#id.class` (mono) + preview; size column = characters with a relative bar (sqrt scale; mockup) for inline styles only (link styles have `chars` 0 → no size). Detail: CSS (highlighted; pretty-print optional, skip unless trivial), source-link tile for links (no external fetch), attributes that exist in the record (media, rocket async, minify, hosted font).
- [ ] Tests: content side (snapshot replace, detach → gone, pagehide release, index bounds), contract validation (oversize, chunking, gone, malformed), page tests; e2e `panel-stylesheets`, `site-stylesheets`, `panel-link-rows-name-first`, 5 000-row perf.

### P23E.6 — Lazyload + Preloaded Resources

Depends: E.5 (shared `panel-link-rows-name-first`), C.3. Parallel: E.7–E.9. Size: M. Difficulty: low.

- [ ] Lazyload rows: image name + host/path, chips; detail shows only what `LazyloadImageRecord` has — URL (source-link tile), lazyloaded yes/no, exclusion reasons (moved from the row meta). No thumbnails (no new remote fetches, P-4), no new capture.
- [ ] Preloaded rows: `as` icon + name + rel kind; attribution chip; detail shows what `ResourceHint` (`lib/wp-rocket/types.ts`) has — `rel`, `as`, `href` (source-link tile; an empty `href` = srcset-only preload → no tile, say so), WP Rocket `mark` — plus today's attribution. Empty states stay compact (no huge empty frame — mockup note).
- [ ] Tests: page tests; e2e `panel-lazyload-chips`, `panel-lazyload-reasons`, `panel-link-rows-name-first`, `site-preloaded-hints`, `site-simulation-lazyload`.

### P23E.7 — Headers & Cookies

Depends: E.3, D.1. Parallel: E.4–E.6, E.8, E.9. Size: S. Difficulty: low.

- [ ] One-line key-value rows (36 px, no hairlines, sticky section headers with counts, values `break-all`, copy icon visible muted), caching-evidence callout as a tinted note row; no detail pane (values are short). Find table unchanged.
- [ ] Tests: page test (`border-t` assertions → row gap/hover), e2e `panel-header-filter`, `panel-header-ownership`, `site-header-capture`.

### P23E.8 — Undefined References

Depends: E.3, C.3, D.1. Parallel: E.4–E.7, E.9. Size: M. Difficulty: medium.

- [ ] Word cards → list rows (word + number of defining assets, from `WordDefinition.definitions.length`; no occurrence count exists) + detail (definitions with source-link tiles, `CopyExclusion`). Store/model unchanged.
- [ ] Tests: page tests, e2e `undefined-references.spec.ts`, `panel-copy-exclusion`.

### P23E.9 — JavaScript: Runtime states (+ Beacon result lists)

Depends: E.4 (same `javascript/page.tsx`). Parallel: E.5–E.8; not G.2 (shared Beacon result lists). Size: M. Difficulty: medium.

- [ ] Runtime rows + detail (replaces the Details disclosure; JSON/JS highlighted); source-group facet + state facet via E.1. Beacon result lists inherit the kit automatically — verify and adjust row content only.
- [ ] Tests: `runtime-section.test.tsx`, e2e `panel-runtime-states`, `site-runtime-states`, `panel-beacon-acceptance`.

## P23F — Detections

### P23F.1 — Overview tiles

Depends: B, C.2, D.1 (shared Detections spec waiters). Parallel: D.2, D.3, every E and G phase. Size: S. Difficulty: low.

- [ ] Replace `summary-strip.tsx` with tiles (mockup Main/Narrow): score ring + "N of M optimizations active" (`text-stat`), collecting/off counts; WP Rocket version + detection evidence; Page cache state + link to its evidence; Stack (WordPress, server/PHP). Grid: 4 columns `@wide`, 2×2 otherwise (score tile spans 2 at compact). Counting rules unchanged (`lib/panel/detections-summary.ts`).
- [ ] Tests: `summary-strip.test` → tiles test (counts incl. zero optimizations, absent WP Rocket = neutral, unknown cache).

### P23F.2 — Grouped feature list

Depends: F.1, C.1. Parallel: every E and G phase. Size: M. Difficulty: medium.

- [ ] `lib/panel/detections-groups.ts` (pure): group `StatusItem`s by `hudFeatureOf(id).group` in `HUD_GROUPS` order; items without a HUD group (server, known-platform, host-layers, cached, wpr, priority beacon…) → tiles or a "Page" group (decide per id, table in the receipt; nothing dropped). Per-group `active of total` with the shared counting rule.
- [ ] Rows: status icon + name + note line (e.g. "Declared on this render, but…") + optional version/meta + page link ("JavaScript ›") + state (Active pill / Collecting pill / quiet "Off" text). Evidence badge ("Meta") only when the evidence differs from the group norm. Status filter = C.1 segmented ChoiceGroup (All / Active / Collecting / Off — owner-approved mockup, recorded in P23A as replacing P6G.12's All/Active/Inactive), buckets per [UX-D18](./design-decisions.md#panel-decisions), coded once in `lib/panel/detections-filter.ts` (extend `DetectionFilterId` + `statusBucket`): Active reads `isActiveInTab` (`lib/panel/detections-summary.ts`), Collecting reads `StatusItem.status`; builder-off rows keep their "Disabled in this tab" line, unknown rows their "why" sentence. Non-optimization rows (`wpr`, Priority Elements beacon, mobile cache, context rows) stay visible under every filter (`matchesDetectionFilter` returns true for them — keep it).
- [ ] Layout modes (store is session-only, never persisted — no migration): **Grouped** (default, new), **List** (today's flat list mode, restyled to calm rows — kept, it just shipped) and **Cards** (today's Adaptive grid, restyled). Rename `ChoiceOption` ids in `state/detections-layout.ts` and update its tests.
- [ ] Keep (read `pages/detections/page.tsx` first and tick each in the receipt): `CopyReportButton`, `TestModeNotice`, the cache-bypass warning, declared-only lines, the simulation modifier and "Disabled in this tab" copy, reload-inspected recovery actions, the `NoMatches` filtered-empty state, card page links (`CARD_PAGE_LINKS`).
- [ ] Tests: grouping table (every id lands somewhere), bucket table (sum = M, unknown → Off, builder-off → Off), three layouts; e2e `panel-detections-layout`, `panel-detections-filter`, `panel-builder-modifier` ("Disabled in this tab" text still shown on rows), `site-detection-matrix` (status-card hooks → row hooks).

## P23G — Tool pages

Shared layout (mockup Rucss): settings column (340 px, scrolls on its own) + result column; collapses to one column below `@wide` with the run bar on top. Settings sections are disclosures (`MOTION_TURN` chevron) with a summary on the right ("5 always kept", "Empty"); `SaveLine` → "Saved" indicator in the settings header. Run bar card: primary action + short privacy/scope note. Result side: honest empty state describing what the run produces; running state = skeleton shaped like the result (real wait only) + Cancel where the tool supports it.

### P23G.1 — RUCSS Tester

Depends: B, C.1, E.5 (the "Page styles" tab's `rucss-tester/styles-list.tsx` adopts the list kit and the stylesheet row look). Parallel: G.2, G.3, every D and F phase. Size: M. Difficulty: medium.

- [ ] Recompose `rucss-tester/page.tsx`, `run-panel.tsx`, `form.tsx` per the shared layout; keep every field, validation, config-writer state, the run states and the "Page styles" tab.
- [ ] Tests: page tests; e2e `panel-rucss-tester`.

### P23G.2 — Beacon Tester

Depends: B, E.9 (shared result lists). Parallel: G.1, G.3. Size: M. Difficulty: medium.

- [ ] Instructions card becomes a compact info row (expandable "Details"); settings column (Features, Device and viewport, per-feature sections); results tabs on the result side.
- [ ] Tests: page tests; e2e `panel-beacon-tester`, `panel-beacon-acceptance`; budget row (lazy chunk) remeasured.

### P23G.3 — LCP & Vitals

Depends: B, C.2. Parallel: G.1, G.2. Size: S. Difficulty: low.

- [ ] Vitals as stat tiles with a threshold meter (good ≤ 2.5 s / needs improvement ≤ 4 s / poor for LCP; CLS 0.1/0.25; INP 200/500 ms — import `VITAL_THRESHOLDS` from `lib/web-vitals/current-visit.ts`, never re-type); LCP analysis as run bar + result card.
- [ ] Tests: page tests; e2e `panel-lcp-vitals`, `panel-lcp-acceptance`, `panel-live-tools-motion-perf`.

## P23I — Options page

Depends: B, C.1, D.1 (app bar), D.2 (appearance menu), D.4. Parallel: every E, F and G phase (it only touches `entrypoints/options/*` and `options-*` specs). Size: M. Difficulty: medium.

Read first: `entrypoints/options/App.tsx`, `sections.tsx`, `instant-rows.tsx`, `kc-freshness.tsx`, `index.html`, `style.css`, and the `options-*` specs. **Change layout and look only.** These stay untouched: `lib/options/*` (registry, page model, instant settings), the save/dirty/busy flow, every toast copy, the instant rows' semantics, the chord field, the on-page UI cascade notes, the KC freshness behavior, the error + retry state, the pre-paint theme lock and the mount entrance.

- [ ] **App bar** (replaces `PageHeader` on this page): `<AppBar data-fdt="options-app-bar">`, sticky at the top of the document scroller (`sticky top-0 z-10`). Mount it **outside** the animated `options-body` wrapper, so it never takes part in the mount entrance and never becomes a containing block (read the toast-region comment in `App.tsx`).
  - Start: brand mark, then the h1 = manifest name (`props.name`, never re-typed; truncates with `title` = full name) with a muted "Options" label, then the mono version `Badge`.
  - End: an "Unsaved changes" muted text, shown only while `dirty` (plain text, no live region — minimal a11y rule); then Save (same `canSave`/`loading` gating as today); then `AppearanceMenu`.
  - From a 320 px tab up, nothing hides: the name truncates first and the version chip stays. Verify there is no horizontal scroll at 320.
- [ ] **Appearance menu wiring.** `value` = the appearance row's drafted value (`scope.read`); `onChange` = `scope.edit(appearanceRow, next)` — the **same path** as the row. So the "no instant write while a Save is in flight" guard and the failure toast cover it too. Never call `setAppearanceOption` directly here: that would reintroduce the write race the comment in `App.tsx` describes. The Appearance section row stays (it is the setting with its description); the row and the menu always show the same value.
- [ ] **Sections** (`sections.tsx`): keep the `Card` per section on the new tokens. Drop `divide-y divide-line-1`: rows follow the amended T-3 rhythm (14 px inner padding, row gap instead of hairlines, no hover tint — the rows are not clickable). The appearance row's `ChoiceGroup` takes C.1 `variant='segmented'`; the radio semantics stay, so the keyboard assertions keep their meaning. Boolean rows keep `Switch`. Restyle `Switch` in place only if it clashes with the new tokens (its users are the panel tool forms + options — verified facts); run the RUCSS/Beacon/LCP form tests if you do.
- [ ] **KC freshness card + skeleton**: same card look as the sections. The skeleton is shaped like the new page (app bar + 3 cards), and the app bar renders immediately: Save stays disabled while loading, as today.
- [ ] Tests:
  - `app.test.tsx`, `sections.test.tsx`: structure (app bar, h1 text, version, Save gating, unsaved marker on/off).
  - Menu → draft: a pick dirties the page, fires one instant write, is refused while saving (draft kept), and a write failure shows the existing toast.
  - Row and menu stay in sync both ways.
  - The existing behavior tests stay green, unmodified.
- [ ] E2E: `options-page-ui`, `options-palettes`, `options-a11y-layout` (width walk 320/480/768/1280, `scrollWidth === clientWidth`), `options-persistence`, `options-kc-freshness`, `options-toolbar-badge`, `options-dbugger-admin`. New `options-app-bar.spec.ts`: at 320 × 480 the scrolled page keeps Save reachable; the unsaved marker follows dirty/save; a menu pick restyles the options page and an open panel live, and the row reflects it.
- [ ] Budget: the app bar + Kobalte menu join the options bundle. Measure the "options JS" row (50 KiB raw); if it grows past the row, trim first, then raise per AGENTS.

DoD (beyond the common one): before/after options screenshots (P23.0 script, both palettes, 420/760/1100) in the receipt; injected UIs untouched (palette specs green).

## P23H — Sweep (everything else, "current level or higher")

Depends: D, E, F, G, I. Parallel: —. Size: M. Difficulty: low.

- [ ] Restyle to the new tokens/primitives: boot skeleton (shaped like top bar + sidebar + page), `ErrorState`, `EmptyState`, `DataUnavailable`, crash view, command palette, shortcuts overlay, toasts, tooltips, tabs (underline style per mockup), cards, buttons (radius 7 px, primary uses `accent-strong`), inputs (28 px, search style; no key hint — `/` opens the shortcuts overlay), test-mode notice, outcome notices.
  - Panel + options primitives (`button`, `card`, `error-state`, toasts…) change **in place**: options takes the new look too.
  - Primitives an injected UI uses (`command-palette`, `dialog`, `choice-group`, `virtual-list`, `copy-flash`) take the new shape only through an opt-in prop/variant used by the panel/options. The on-page palette and the exclusion overlay must render exactly as before.
- [ ] Delete the old filter API once unused (`filterAndSearch`/`filterCounts`, `FilterBar` if no user remains — check options/injected first), the old summary strip, status-bar leftovers, per-row code toggles. Grep the panel for leftover hairline list frames and `border-t` row separators.
- [ ] Tests: affected unit tests; e2e `panel-palette`, `panel-shortcuts`, `panel-toast`, `panel-layout-states`, `panel-boot`, `panel-cold-start` (cold-start ≤ 500 ms row), every `options-*` spec, plus the injected specs from Common rules.

## P23.1 — Acceptance

Depends: H. Parallel: —. Size: M. Difficulty: medium.

- [ ] Full gates + `pnpm test:e2e` full tier (serial), both builds + `check:budgets` (receipt table: every changed row, before/after, cause).
- [ ] UI bar §D for options: tab widths 320/480/768/1280, system/dark/light live switch from both the menu and the row, reduced motion, sticky Save.
- [ ] UI bar §D for every panel route: widths 320/420/480/760/1100/1280 docked right and bottom, short heights (UX-D15), system/dark/light live switch, reduced motion (`getAnimations()` empty after mount), refresh keeps selection/scroll/filters, D-6 grep over changed files, 5 000-row P-3 gate on JavaScript and Stylesheets.
- [ ] Screenshot set (both palettes, 420 / 760 / 1100 px) for every route and options, compared against the mockup; differences either fixed or recorded. Use P23.0's `scripts/panel-screenshots.mjs` (`.screenshots/after/` vs `.screenshots/before/`); UI phases may also run it for their receipts.
- [ ] Firefox: build green; manual check list for the owner (sidebar, top bar, Open-in-new-tab fallback, CSS/HTML highlight, sheet, appearance menu, options page) added to this doc's receipt and the [index](./README.md) entry.
- [ ] Docs: AGENTS.md structure/stack lines, completed record (archive P23 decisions into `completed-panel-pages.md` or a new `completed-panel-redesign.md`), README/master status.

DoD: all gates green, no horizontal scroll at any width, every list ≤ 50 ms long tasks on 5 000 rows, budgets green with recorded raises, owner Firefox checklist handed over.
