# Phase 12A — The on-page detection widget, early start (the Known Conflicts shell)

**Depends on:** P1/P1.1 (detection engine + its verified labels), P3 (data hub; the injected-UI mount/theme stack), P0 (tokens) — and the Known Conflicts redesign (commit `bf97ab7`), whose shell pattern and audited motion/focus choreography are adopted verbatim. **No** P11/P5-panel dependency. **Effort:** S–M (four sub-phases, ~3 days). **Parallelizable:** with every phase that does not touch `entrypoints/isolated.content/**`, `lib/detection/describe` strings, or the context-menu registry; P6/P8/P9/P10 surfaces are untouched by design.

## Owner mandate (2026-10-13)

The on-page inspector widget presents itself with the **Known Conflicts widget's UI**, adapted to what the strip needs — and the early start ships **detections only**. Everything else in the planned P12 scope (drag + persisted position, `Alt+H`, the tool chips and their outcome banners, the popup/Detections/options opt-in row itself, the hostile-CSS formal pass) keeps its planned slot in P12/P13/P14.

## TL;DR

A second injected widget joins the two shipped ones: a **mood-driven marker pill** (identity: `WPR <version>` or `WPR not found`; status chip: `✓ Cached` + timestamp / `Not cached` / pending pulse / pass-failure) resting at bottom-right 16/16, expanding into a **floating report card** (eyebrow per the brief's header-row semantics, one scroll region, grouped evidence rows with state chips and honest tooltips, footer micro-info), on the same class-driven visibility/opacity/transform choreography as KC — including the audit hardening: the held-visible departing leg, the machinery-free card under reduced motion, and the attempt→verify→re-arm `moveFocus`. Detections come exclusively from the data hub's already-cached single pass — no second detection pass, ever. Chips conform to the P5H brief's state vocabulary (`SB-D5`/`SB-D6`) and ride plugin-native labels straight from `describe.ts`'s verified set.

## 1. Deviations from the P5H brief (recorded per its §16 template — P12's conformance pass carries them)

| Brief decision                                                                     | Early-slice deviation                                                                                                                                     | Why                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SB-D2` idle shape — always-visible header-bar card, collapse (SB-D11) to that bar | The idle entry is a **KC-style marker pill** that opens the report card; the pill _is_ the collapsed state                                                | Owner directive (the KC language); SB-D11's collapse-to-bar is pointless over a pill that is already minimal                                                                                            |
| `SB-D1` default position top-left 12/12                                            | Resting anchor **bottom-right 16/16**; the card rises from it                                                                                             | Cannot collide with KC's own bottom-left anchor (both fixed-populated UIs coexist by construction); SB-D12's drag + persisted per-origin position supersedes any resting default in the full P12 anyway |
| `SB-D5` tool-chip kind + `SB-D14` outcome banner                                   | Absent (tools = P13/P14)                                                                                                                                  | Detections-only mandate                                                                                                                                                                                 |
| `§10` drag + persisted position; `Alt+H` session toggle                            | Absent (full P12)                                                                                                                                         | Same mandate; the enablement seam below is the only piece pulled forward, shaped as P12's final store                                                                                                   |
| Opt-in via popup switch / Detections button / options default (P8/P6/P9)           | **Context-menu row** ("Toggle the detection widget on this site") writes the same per-origin storage item those surfaces will write                       | Enablement must exist before the populated surfaces; additive, not a fork                                                                                                                               |
| `UX-D14` registry-driven chips from P11's `hud` facet                              | A provisional strip-side registry (`strip-items.ts`) — recorded **delete-on-land**: P11's facet replaces it as the declaring site and the strip re-points | P11 owns label verification + check merging; the early registry is a typed table, not a hardcoded feature list                                                                                          |

Everything else of the brief conforms as written: width 224 px / max-height `min(70vh, 520px)` with one internal scroll region (`SB-D1`), density ramp + 22 px chips with ≥ 24 px hit floors (`SB-D3`), surface/elevation (`SB-D4`), the seven chip-state pairs and the amber `attention` semantics (`SB-D5`), the honesty rule — every unsure state explains itself in its tooltip, and no chip ever claims more certainty than the scan has (`SB-D6`), group headers as scent not controls (`SB-D7`), icon family as inline path data on the shipped `StrokeIcon` factory — database / file-sliders / image / download-cloud / globe / puzzle / wrench + chevron / close, resize only (`SB-D7`), footer micro-info + `title` tooltips everywhere (`SB-D8`), interaction states incl. the `sbs` focus ring (`SB-D10`), motion on the motion tokens (`SB-D13`), palette + live appearance follow via the shared mount (`SB-D15`), host coexistence — `pointer-events` boundary, no horizontal scroll, the page never scrolls (`SB-D16`), and `z-index: 2147483647` (`SB-D1`; the shipped pair — KC `999999`, SBS `999999999` — is not re-touched).

## 2. KC → strip conversion (the shell contract)

| KC (shipped `bf97ab7`)                                                                                                       | Detection widget (adapted)                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mood rule on the chrome root (`kc-alert`/`kc-clear`/`kc-pending`) — tested pure rule                                         | `insMood`: green = WPR present + cached · amber = present + not cached · gray = WPR absent · pulse = the hub's pass still running · red = the pass failed                                                                                                               |
| Pill: alert icon + count chip, bottom-left                                                                                   | Pill: presence icon + identity (`WPR <version>` / `WPR not found`) + status chip (`✓ Cached · <formatCacheTimestamp>` / `Not cached` / pending pulse / `—`), bottom-right                                                                                               |
| Report card: eyebrow + exact title + finding rows with hover-revealed open arrow                                             | Report card: header row (identity + cache chip + close — `SB-D8`), grouped feature rows as **static evidence chips** (state chip + one-line value where the engine has one: delayed-scripts count, lazy-loaded images count, RocketCDN…), footer `WPR x · WP y · FDT z` |
| Rows act (open URL), title tooltips                                                                                          | Rows are read-only — `SB-D9` no-dead-end + `SB-D10` (static chips have no hover/press response); full feature name + the one-line why in `title` tooltips (`SB-D8`)                                                                                                     |
| Card CSS: contained scroll, `kc-*` hooks, sr-label span                                                                      | Same containment; own `ins-*` hooks + element `wpr-fdt-inspector` (D-6), sr-label span for the pill's accessible name                                                                                                                                                   |
| ESC close, shadow-root keydown, focus choreography `moveFocus` (attempt→verify→re-arm)                                       | Identical — `moveFocus` promoted to `entrypoints/isolated.content/ui/focus.ts`, KC imports it from there (one declaring site)                                                                                                                                           |
| Reduced-motion scoping in the feature CSS: card `transition: none`, zeroed open-only row stagger, held-visible departing leg | Same scoping, adapted to the `ins-*` selectors — all three audit findings carry over                                                                                                                                                                                    |

## 3. Recorded decisions

- **D-1 anchor** — pill bottom-right 16/16; card rises upward from it (KC's bottom-left is mirrored, by construction collision-free with KC and under the SBS overlay's own corner).
- **D-2 state mapping** — from `describe.ts`'s `FeatureState` + the `wpr` block: `applied → ok` · `collecting → attention` (tooltip: enabled, not yet applied on this page) · `not applied` and `not enabled → neutral` (tooltip names what was looked for — a page served before WP Rocket's work must not read as an error; red is reserved for real failures: pass failure, `WPR-V-NF`) · cache chip `cached → ok` with the `formatCacheTimestamp` value suffix, else `warn`. P11's richer signals re-tune entries without UI edits (the mapping is a tested pure table).
- **D-3 labels** — only the KB-verified strings `describe.ts` declares (2026-10-07 verification); promoted to `lib/detection/labels.ts` so the engine's report and the strip's registry share one declaring site (P11's site-verified pass upgrades it with zero surface edits).
- **D-4 provisional registry** — `strip-items.ts` is the strip's single rendering source until P11's `hud` facet lands; that landing deletes this table (the deletability test: P11 = one facet row type, the strip re-points, this file dies).
- **D-5 storage** — `sync:inspector-origins` (`storage.defineItem`, validated, bounded map origin → `{ enabled: boolean }`), shaped as the front slice of P12's planned per-origin store (which later grows the drag-position field). The context-menu row and the future popup/Detections/options rows all write this one item.
- **D-6 naming** — element `wpr-fdt-inspector`, classes under `ins-`; P12.1's suites own the assert surface and any brief-driven rename lands there.

## 4. Sub-phases

### P12A.1 — Detection presentation layer (pure)

**Depends on:** none beyond what is already on the branch (P1/P3). **Parallelizable:** — (the other sub-phases consume its types).

- `lib/detection/labels.ts` — the verified label strings as consts; `describe.ts` consumes them (its tests are unchanged — identical strings).
- `entrypoints/isolated.content/inspector/strip-items.ts` — the typed registry rows (D-4): id, label const, group (the study's Cache / File Optimization / Media / Preload / CDN / Features), state source.
- `entrypoints/isolated.content/inspector/strip-state.ts` — `insMood` + the card model builders (rows, value suffixes, tooltip copy); pure, unit-tested (the D-2 matrix, pending/failure moods, absent-WPR identity, bounded tooltip honesty).
- `entrypoints/isolated.content/data-hub.ts` — an in-page single-flight read: the cached `PageData` (or the running pass's join) handed to same-context consumers; the messaging contracts unchanged.

**DoD:** unit green (state matrix + registry + hub read), compile/lint/format green.

### P12A.2 — Presentation (the KC-language shell)

**Depends on:** P12A.1. **Parallelizable:** with P12A.3 (disjoint files).

- `entrypoints/isolated.content/inspector/index.tsx` — mount gate off the storage item, live enable/disable watch (same-beat restyle contract the theme follow already proves), invalidation-safe unmount through the WXT remove path, ESC via the shadow-root listener, hub read feeding the store.
- `entrypoints/isolated.content/inspector/ui.tsx` — pill + card per §2; `aria-controls`/`aria-expanded`; sr-label; static chips; footer; tooltips.
- `entrypoints/isolated.content/inspector/inspector.css` — token-only; the KC choreography adapted (`ins-*`, `SB-D1` geometry, `SB-D13` motion, the audited reduced-motion scoping).
- `entrypoints/isolated.content/ui/focus.ts` — `moveFocus` promoted out of the KC module; KC imports it.
- `known-conflicts/icons.tsx` + `ui/icons.tsx` — the brief's glyph set as data rows (database, file-sliders, image, download-cloud, globe, puzzle, wrench, close — chevron/icon paths already shipped).

**DoD:** compile/lint/format/test green; manual matrix in the browser: both palettes + live restyle, both motion settings (focus-in card / focus back to pill / ESC / no eviction), keyboard-only trace, tooltips, cramped-host no-scroll check, KC + strip coexistence screenshot, `pnpm check:budgets` re-measure.

### P12A.3 — Opt-in bootstrap (P12's storage shape arrives early)

**Depends on:** none. **Parallelizable:** with P12A.2.

- `lib/storage/inspector-origins.ts` — the D-5 item: validation, bounded map, corrupt-file degradation (the `options.corrupt` pattern).
- `entrypoints/background/context-menus.ts` — one registry row (page-context) + one dispatch arm writing the item on the click's own tab origin; the registry's one-row-per-entry rule holds.
- The CS watch consumes it (see P12A.2's mount gate).

**DoD:** storage + menu unit tests; browser: toggle on a live page mounts/hides with no reload, other origins unaffected, reload keeps the choice.

### P12A.4 — Verification + register

**Depends on:** P12A.1–P12A.3. **Parallelizable:** —.

- Budgets: re-derive the isolated-content-script row (P12's planned "≤ 10 KB raw on top" is the ceiling; the shared mount/icons/hub-read reuse should land well under it) — measured numbers + reasoning into `scripts/budgets.json` + this doc.
- `tests/e2e/suites/site-inspector-strip.spec.ts` — default hidden; context-menu enable mounts the pill; card rows match the docker site's **real** WP Rocket 3.23.5.1 detections; palettes; disable hides; keyboard + reduced-motion pins; the rest of the tier unaffected (53 → 53+k).
- Adversarial audit round (the KC-audit discipline: reproduce before fixing, frame-level motion/focus probes, before/after receipts) + receipts here; README/master-plan/P12-doc status rows ticked.

**DoD:** all gates green (compile, lint, format:check, `pnpm test`, `check:budgets`, full `pnpm test:e2e`, `build:firefox`); audit receipts recorded.

## 5. Stack

No new dependencies: WXT (shadow-root UI + `storage.defineItem` + context menus as shipped), SolidJS, the P0 token stylesheet, Vitest + `@playwright/test` as installed (repo pins latest-stable, reaffirmed at implementation).

## 6. Explicitly kept for the full P12 (unchanged)

Drag + persisted position + `SB-D11` collapse + `Alt+H`; the tool chips, `runRucssTest`/`runBeaconTest`/`runLcpAnalysis` call sites and the `SB-D14` banner; the popup/Detections-page/options opt-in rows (same storage item); the P11 `hud` facet re-point (D-4's delete); the hostile-CSS formal audit + P12.1's full suite set; the strip's budget re-derivation for the tools' payload.
