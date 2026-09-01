# Phase 0 — Foundations: manifest, tooling, design tokens, utils

**Depends on:** nothing. **Effort:** M. **Parallelizable:** nothing before it.

## Goal

Make this scaffold a real extension project: correct manifest with justified permissions, a test runner wired into the quality gates, Tailwind v4 with the design tokens that every later phase consumes, and the generic `utils/` layer (tested).

## Legacy reference

- `wxt.config.ts` (legacy): `manifestVersion: 3`, `minimum_chrome_version: '120'`, `permissions: ['contextMenus','webRequest','storage','alarms','tabs']`, name "WPR Front Debugging tool legacy". **No host_permissions** (see master §1.2).
- Legacy dev stack (to replace, not port): Tailwind 3 + postcss + `tailwind.config.js`, no test runner, no eslint.

## Tasks

### 1. Manifest & config (`wxt.config.ts`)

- [ ] `manifest.name: 'WPR Front Debugging Tool'`, `description` kept from package.json ("A tool for debugging WP Rocket WordPress plugin."), `minimum_chrome_version: '145'` (per CLAUDE.md).
- [ ] `permissions` (each with a why-comment):
  - `storage` — options (`sync:options`) + Known Conflicts DB cache (`local:known-conflicts-db`).
  - `alarms` — hourly Known Conflicts DB refresh.
  - `webRequest` — read main-frame response headers (Server / Known Platform cards).
  - `contextMenus` — Side-by-Side, PSI Side-by-Side, Exclusion Builder, Update KC DB.
- [ ] `host_permissions: ['http://*/*', 'https://*/*']` with why-comment: required for `webRequest` main-frame header capture (legacy omitted these — master risk #2) and required so the popup can read the active web tab's URL without the `tabs` permission (least privilege: **drop** legacy's `tabs` permission; P8 verifies popup URL access and P2 verifies `tabs.create` for the exclusion builder needs no permission — restore `tabs` only if verification fails, documented in CLAUDE.md).
- [ ] Content scripts configured in P3/P4 (not now); devtools/panel/popup/options entrypoints added by their phases.
- [ ] Verify generated `.output/chrome-mv3/manifest.json` matches intent after first build.

### 2. Test runner (adds the `test` gate)

- [ ] Add **Vitest** (latest stable) + `@solidjs/testing-library` + `happy-dom` (all latest stable; check `engines` compatibility).
- [ ] `vitest.config.ts`: happy-dom (or jsdom if Solid testing-library prefers — verify), globals off (explicit imports), coverage provider v8, `environmentMatchGlobs` not needed — colocated tests import what they need.
- [ ] `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:coverage": "vitest run --coverage"`.
- [ ] **Coverage thresholds (enforces the "logic is tested" promise):** configure `coverage.thresholds` in `vitest.config.ts` — `lines`/`functions` ≥ 90 restricted to `lib/**` + `utils/**`, excluding `**/reference/**` and entrypoint glue — so `pnpm test` fails below the bar.
- [ ] **Budget script (enforces master §1.3):** `scripts/check-budgets.mjs` + `"check:budgets": "node scripts/check-budgets.mjs"` — reads a committed budget table (surface | output glob | max raw KB | max gzip KB, straight from master §1.3), measures the `pnpm build` output (raw + gzip), prints a pass/fail table, exits non-zero on breach. Every later phase's checklist runs it for the surfaces it owns. Add `pnpm check:budgets` to CLAUDE.md gates.
- [ ] **Dependency bans (enforces master §1.4):** add `no-restricted-imports` patterns for `framer-motion`, `wouter`, `react-hot-toast`, `react-syntax-highlighter` (message: banned by master §1.4 — use CSS motion / the hash router / the custom toast / shiki).
- [ ] **Update CLAUDE.md:** add `pnpm test` to commands and to the required workflow gates (it currently says "The `test` gate is added together with the test runner — wire it here when it exists").
- [ ] Update `lint-staged` no (it lints TS/TSX already); ensure prettier handles `.md` under docs/plans (check `.prettierignore`).

### 3. Tailwind v4 + design tokens

- [ ] Add `tailwindcss` v4 (latest) with the Vite plugin (`@tailwindcss/vite`); remove nothing (no legacy postcss here).
- [ ] `assets/css/theme.css` (imported by every entrypoint stylesheet) defining tokens via `@theme`:
  - Surfaces: `--color-surface-0..4` (devtools-dark scale), borders per level.
  - Accent: blue→violet gradient ramp (successor of legacy's `from-blue-400 to-purple-600` headings).
  - Status: `--color-status-ok / warn / error / info / neutral` (+ soft backgrounds) — replaces legacy's scattered emerald/rose/amber inline choices.
  - Typography: system UI stack; `--font-mono` for URLs/code; panel density sizes (11/12/13 px classes).
  - Radii, spacing, focus ring, shadows; motion tokens (duration/ease) + global `prefers-reduced-motion` handling.
- [ ] Dark is the default; light palette via `@media (prefers-color-scheme: light)` + a `[data-theme]` override hook for an options toggle (P9 wires the toggle; token names must be palette-agnostic from day one).
- [ ] Deliver a tiny "tokens showcase" unlisted route or story-style page **only if** cheap; otherwise verify via P5 components (do not build a docs site).

### 4. `utils/` (pure, feature-agnostic, each with unit tests)

- [ ] `utils/cn.ts` — class merging without `clsx`/`tailwind-merge` if a 10-line join suffices? **Decision:** add `tailwind-merge` + `clsx` (latest) — legacy used `cn()` everywhere and our design system needs override semantics; both are tiny and dependency-free.
- [ ] `utils/debounce.ts` — typed debounce (returns cancel handle) — replaces three hand-rolled copies in legacy (known-conflicts, panel search, error batching).
- [ ] `utils/text.ts` — `capitalizeString` (parity with `lib/utils.ts`).
- [ ] `utils/urls.ts` — `isHttpUrl`, safe URL parsing (null on invalid) — used by popup, KC links, resource links.
- [ ] `utils/rng.ts` no — skip anything speculative.

### 5. Messaging + window-bridge spike (risk retirement, not production code)

- [ ] Install `@webext-core/messaging` v4 (note: `defineWindowMessaging` lives in the `@webext-core/messaging/page` subpath).
- [ ] Throwaway verification (deleted after P1 lands its real contracts): background ↔ isolated-CS round-trip via `defineExtensionMessaging` with tab targeting; MAIN → isolated round-trip via `defineWindowMessaging`; devtools context `sendMessage(type, data, tabId)` to CS. Record findings in this file's checklist notes (interop with WXT `browser`, Firefox behavior).
- [ ] `browser.devtools` typing via `@wxt-dev/browser` — **pre-verified as typed** (devtools.panels/inspectedWindow/onSearch); confirm at build time only.

## Explicit enhancements over legacy (this phase)

- Host permissions declared + `tabs` permission dropped (least privilege, fixes silent header risk).
- Real test gate exists from the start (legacy had none).
- Token-based theming (light mode possible; legacy hardcoded dark grays inline in every page).

## Tests

- `utils/*.test.ts` for every util (debounce timing with fake timers, cn precedence, URL edge cases).

## Verification checklist

- [ ] `pnpm compile && pnpm lint && pnpm format:check && pnpm test` green.
- [ ] `pnpm build` produces a loadable extension; manifest inspected matches §Tasks-1.
- [ ] Messaging spike results recorded here (or issues escalated into P1 spec).
- [ ] CLAUDE.md updated (test gate).

## Docs to update

CLAUDE.md (commands + test gate), README (dev setup once Tailwind lands).
