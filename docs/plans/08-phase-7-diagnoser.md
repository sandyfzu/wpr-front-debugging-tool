# Phase 7 — Diagnoser pages (General Info + Optimizations Info)

**Depends on:** P5, P6 shell, P1 diagnostics parser. **Effort:** M. **Parallelizable with:** P8, P9, P10.

## Goal

Port the two Diagnoser tabs with the same data semantics as legacy but typed, validated, and rendered with the design system (dense key-value cards, real JSON tree, accessible tabs).

## Legacy reference

- `pages/DiagnoserPage.tsx` — if no `noRocketData`: NothingToShow "WP Rocket - Support Diagnoser plugin was not detected…" (parity text); otherwise two tabs (General / Optimizations) with tab-state cached in a module variable (works-around remounts — irrelevant in Solid). Tab selection is triple-sourced (module cache + local state + uncontrolled `defaultValue`; `TabsContent` unused) and wiped by panel reload anyway (master #38).
- `pages/DiagnoserGeneralInfoPage.tsx` + `components/diagnoser/utils.ts` — `getGeneralInfo(diagnoser)` builds: `postMetaDisabledOptions` (from `rocketData.post_meta_excluded_options` keys — rendered when non-empty), `pluginInfo` (`wpr_plugin` status, WPR version from `get_rocket_option.version`, `imagify`, `querystrings`, `user_agent`, `wpr_diagnoser_version`), `serverInfo` (`server_info.server_load/web_server/php_memory_limit/wp_memory_limit/wp_max_memory_limit`), `constants` (name → `{defined, value}`), `preload_rucss_tasks`, `preload_rucss_parameters`, `someOptions` (`get_rocket_option` minus `version`), `someFilters` (`filters` minus null values).
- Cards (visual + logic to port): PluginInfoCard (status/versions badges, querystrings JSON block, user-agent code, imagify), ServerInfoCard (5 rows; **bug:** Server Load badge colored via `serverInfo !== null` — always true — master #5), ConstantsCard (defined/undefined badges; WP_CACHE green-when-true; DONOT* green-when-false), PreloadRUCSSTasksStatusCard, PreloadRUCSSParametersCard, SomeFiltersAndOptionsCard (options/filters; scalar → truthy-colored badge, empty string/array → "empty", object → JSON block).
- `pages/DiagnoserOptimizationsInfoPage.tsx` + `OptimizationInfoItem.tsx` — if no `rocketData.options`: NothingToShow "WP Rocket seems to be inactive…"; else per-option collapsible card: status icon from `get_rocket_option[key]` (1/true → ok, 0/false → off, else warn), title via `getRealOptionName`, Options section (per-key rows: status when key === option name, truncated labels > 37 chars, boolean/0/1 → Active/Inactive, arrays/long strings → count badge + expandable JSON), Filters section (same renderer minus Active/Inactive mapping). The options-section array branch ignores the expand toggle while the filters section honors it, and long strings show their character length as an item count (master #30).

## Tasks

### View-models (pure, in `entrypoints/panel/pages/diagnoser/`)

- [ ] `general-info.ts` — port `getGeneralInfo` + sub-builders with P1 types; defensive access (every diagnoser field is optional until proven) with explicit fallbacks; `formatServerLoad(n): 'X%' | "couldn't get"`; constants color semantics extracted as `constantState(name, {defined, value}): 'ok' | 'error' | 'neutral'` (WP_CACHE true=ok; DONOT* false=ok; else neutral) — parity with legacy's `getColors`.
- [ ] `optimizations-view-model.ts` — normalize each option entry `{ status, options: [k,v][], filters: [k,v][] }` (filters null-stripped, `version` option hidden — parity); `formatOptionValue(v, isOption)` parity (non-empty arrays → list, **empty array → the literal `'Empty Array'` badge string**, `'' | null | undefined` → 'Empty', boolean/0/1 → Active/Inactive, else `String(v)`); label truncation helper (37 chars parity) + `title` tooltip. Count badges show true item counts for arrays and clearly labeled character counts for long strings (fixes master #30).
- [ ] Option-name lookups via `lib/options-map` (`getRealOptionName`) — parity.

### Pages

- [ ] **Tab shell** — `tabs.tsx` (Kobalte) with General/Optimizations (icons + ARIA); selection persisted across route switches in the page store (parity of `currentPageCache`), default General, and across panel reloads via `sessionStorage` (extension — legacy's cache died on every `reloadDevTools`).
- [ ] **Not-detected / inactive states** — `empty-state.tsx` with legacy copy (exact strings preserved).
- [ ] **General Info** — card grid: Disabled-on-page banner (red soft card, badge list) only when non-empty (parity); General Info card (status badge active/inactive, versions, user-agent mono block with copy button, querystrings via `json-value.tsx`, imagify when present); Server Info card (fix #5 — badge color keyed on the actual value); Constants card (state-colored badges + value); Preload tasks + parameters cards (dense `key-value.tsx` rows); "Get Rocket Option" + "Filters" cards (scalars → colored badges, empties → neutral "empty", objects/arrays → `json-value.tsx` collapsible).
- [ ] **Optimizations Info** — responsive grid of collapsible option cards (Kobalte-free disclosure with CSS animation, expanded-by-default parity): header = status icon + `getRealOptionName` + chevron; body = Options rows (status row labelled "Status" when key === option name — parity; count badge + expandable `json-value` for arrays/long values — replaces the JSON-in-highlighter dumps) + Filters rows; row labels truncated at 37 with full-name tooltip (parity); count/expand state local to card. **Intentional delta (master bug #23):** legacy renders arrays unconditionally expanded and the chevron is a no-op for them; here arrays start collapsed behind their count badge like every other expandable — consistent, and one click closer to the summary view. Both sections use identical expand/collapse semantics (fixes master #30's two-inches-apart inconsistency).

## Explicit enhancements over legacy

- Fully typed diagnoser data (no `any` chains) with runtime validation; `json-value` tree instead of syntax-highlighted JSON strings; copy buttons on user-agent/JSON; consistent status color system; fixed Server Load badge bug; no hook-order landmine (legacy #4); fine-grained updates (expanding one card doesn't re-render siblings). Tab selection survives panel reloads (extension); consistent expand/collapse and truthful count badges (master #30); tab state single-sourced (master #38).

## Tests

- `general-info.test.ts` — full matrix over a captured diagnoser JSON fixture (missing `rocketData`, missing `server_info` pieces, null filters, `version` hidden, post-meta disabled options on/off).
- `optimizations-view-model.test.ts` — status mapping (1/true/0/false/other), value formatting matrix, truncation, filter null-stripping, count-badge truthfulness (array length vs labeled char count).

## Verification checklist

- [ ] Gates green.
- [ ] Side-by-side vs legacy on a site with the Support Diagnoser plugin active: identical fields/badges across both tabs; with plugin absent → not-detected state; WP Rocket inactive → inactive state.
- [ ] Fixture-driven UI check (dev-only data override) for the degenerate shapes above.
- [ ] Keyboard/axe pass on both tabs (tablist semantics, disclosures operable).

## Docs to update

None expected; if diagnoser JSON reveals undocumented fields, document them in `lib/diagnostics` TSDoc.
