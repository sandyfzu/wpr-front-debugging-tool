# Phase 0 — Foundations: manifest, tooling, design tokens, utils

**Depends on:** nothing. **Effort:** M. **Parallelizable:** nothing before it.

## Goal

Establish the extension scaffold: justified manifest permissions, test gates, shared Tailwind v4 tokens, and tested `utils/`.

## Legacy reference

- `wxt.config.ts` (legacy): `manifestVersion: 3`, `minimum_chrome_version: '120'`, `permissions: ['contextMenus','webRequest','storage','alarms','tabs']`, name "WPR Front Debugging tool legacy". **No host_permissions** (see master §1.2).
- Legacy dev stack (to replace, not port): Tailwind 3 + postcss + `tailwind.config.js`, no test runner, no eslint.

## Tasks

### 1. Manifest & config (`wxt.config.ts`) — DONE

- [x] `manifest.name: 'WPR Front Debugging Tool'`, `description` kept from package.json ("A tool for debugging WP Rocket WordPress plugin."), `minimum_chrome_version: '145'` (per AGENTS.md).
- [x] `permissions` (each with a why-comment):
  - `storage` — options (`sync:options`) + Known Conflicts DB cache (`local:known-conflicts-db`).
  - `alarms` — hourly Known Conflicts DB refresh.
  - `webRequest` — read main-frame response headers (Server / Known Platform cards).
  - `contextMenus` — Side-by-Side, PSI Side-by-Side, Exclusion Builder, Update KC DB.
- [x] `host_permissions: ['http://*/*', 'https://*/*']` with why-comment: required for `webRequest` main-frame header capture (legacy omitted these — master risk #2) and required so the popup can read the active web tab's URL without the `tabs` permission (least privilege: **drop** legacy's `tabs` permission; P8 verifies popup URL access and P2 verifies `tabs.create` for the exclusion builder needs no permission — restore `tabs` only if verification fails, documented in AGENTS.md).
- [x] P3/P4 add content scripts; later phases add devtools/panel/popup/options. Removed the demo script (`*://*.google.com/*`); the clean-build manifest contains no content scripts.
- [x] Verified generated `.output/chrome-mv3/manifest.json` matches intent after the first build. Note: `pnpm build:firefox` emits `.output/firefox-mv2` (WXT's default Firefox choice) — revisit MV3-vs-MV2 for Firefox in P15.

### 2. Test runner (adds the `test` gate) — DONE

- [x] Added **Vitest 5.0.3** + `@solidjs/testing-library` 0.8.10 + `happy-dom` 20.14.5 (all latest stable; engines verified against Node 24).
- [x] `vitest.config.ts`: `environment: 'happy-dom'`, globals off (explicit imports), coverage provider v8. tsx component tests later feed configs through `vite-plugin-solid` (owned by P5, which adds component tests).
- [x] `package.json`: `"test": "vitest run --coverage"` (the gate runs coverage so thresholds are actually enforced), `"test:watch": "vitest"`, `"test:coverage": "vitest run --coverage"`.
- [x] **Coverage thresholds:** `coverage.thresholds` — lines/functions ≥ 90 aggregate over `lib/**` + `utils/**`, excluding `**/*.test.*`, `**/reference/**` and throwaway `spike-*.ts` files — `pnpm test` fails below the bar.
- [x] **Budget gate:** committed `scripts/budgets.json`, `scripts/check-budgets.mjs`, and `"check:budgets": "node scripts/check-budgets.mjs"`. Glob-based raw/gzip measurements print pass/fail and exit non-zero on breach. Unbuilt surfaces print “skipped” with a glob-update reminder; their owning phases take over enforcement. Invalid rows fail naming the row. Script-relative root resolution supports any cwd. Thin CLI; matcher/measurement unit-tested with an injected reader. A **whole-build row caps all JS at the summed surface ceilings** (837 KB raw), preventing chunk-splitting from evading budgets.
- [x] **Dependency bans:** `no-restricted-imports` patterns for `framer-motion(/*)`, `wouter(/*)`, `react-hot-toast`, `react-syntax-highlighter` — merged into every dependency-direction block plus the general block (flat config: last rule config wins per file, so the bans live in each block).
- [x] **CI workflow:** `.github/workflows/ci.yml` — Node 24 (`.nvmrc`) via `actions/setup-node@v6`, pnpm via `pnpm/action-setup@v6` (reads `packageManager`), `pnpm install --frozen-lockfile`, then `compile → lint → format:check → test → build → check:budgets` on PRs and pushes to main/develop. The speed bench stays local per §5.
- [x] **AGENTS.md updated:** `pnpm test` in commands and in the required workflow gates; coverage/budget/CI notes included.
- [x] Existing `lint-staged` covers TS/TSX; plans remain Prettier-checked (`pnpm format:check` clean).
- Fixture note: Tailwind v4 scans the whole working directory (not gitignored) — plan prose in `docs/` names utility-like classes; kept the scanner out of `docs/` with `@source not` in `theme.css` so documentation can never generate CSS.

### 3. Tailwind v4 + design tokens — DONE

- [x] `tailwindcss` 4.3.3 + `@tailwindcss/vite` (latest) registered through WXT's `vite: () => ({ plugins: [...] })` (plugins must be a factory per WXT's inline-config type).
- [x] `assets/css/theme.css` imported by the popup stylesheet (replaced to prove the pipeline; demo markup is replaced in P8) defining tokens:
  - Surfaces: `--color-surface-0..4` (5-level dark scale), borders per level (`--color-line-0..4` + `--color-line-strong`).
  - Accent: blue→violet ramp (`accent`, `accent-strong` for fills under light text, decorative `accent-from`, `accent-to`).
  - Status: `--color-status-ok / warn / error / info / neutral / attention` (+ `*-soft` chip backgrounds) — `attention` is the fourth amber semantic shared with the second baseline.
  - Typography: system UI stack (sans default), `--font-mono`; density overrides `--text-2xs` (11px), `--text-xs` (12px), `--text-sm` (13px).
  - Radii use Tailwind's default scale (unnamed custom radii would drift); shadows as `--shadow-elev-1..3`; motion as `--motion-fast/base/slow` + `--ease-standard/--ease-entrance` with a global `prefers-reduced-motion` neutralizer.
- [x] **Appearance:** `system` (default) / `dark` / `light`; palette values declared once as `light-dark(<light>, <dark>)` (CSS Color 5, light first; runtime probe caught an inverted draft). `:root` defaults dark; the light media query applies without `data-theme`; `[data-theme='dark'|'light']` **on any element** wins, enabling independently themed shadow UIs (probe-verified). `utils/theme.ts` provides tested `resolveTheme`/`applyTheme`; P1/P5+ add storage/surface wiring.
- [x] Token showcase: skipped as a page (the throwaway `spike-tokens` unlisted entrypoint verified generation + runtime resolution during the spike and was deleted; P5 components are the persistent verification).
- [x] **Token contrast gate:** `assets/css/theme.test.ts` parses the actual stylesheet's `light-dark()` pairs. Both palettes enforce the committed pair table: fg/accent/gradient/status text × surfaces/soft backgrounds ≥ 4.5:1; focus ring × surfaces ≥ 3:1 (WCAG 1.4.11); `on-accent` × `accent-strong` ≥ 4.5:1. Every color must have a pair, `@theme inline` mapping, and AA role; unpaired additions fail. Gradient endpoints are decorative, not text-under pairs; text over gradient fills uses `accent-strong`. Value-break/unpaired-token mutations proved test sensitivity.

### 4. `utils/` (pure, feature-agnostic, each with unit tests) — DONE

- [x] `utils/cn.ts` — `tailwind-merge` + `clsx` (latest, as decided). Empirically verified that `tailwind-merge` 3.7's default config keeps our custom tokens in the right conflict groups (`text-2xs` coexists with any `text-*` color; color tokens conflict among themselves), so no extension config is needed.
- [x] `utils/debounce.ts` — typed trailing debounce with `cancel()` handle; no `flush` (speculative — add when a phase needs it).
- [x] `utils/text.ts` — `capitalize` (rename of the ported helper's name for call-site clarity; behavior identical).
- [x] `utils/urls.ts` — `parseUrl` (null on invalid) + `isHttpUrl` (http/https only — gates KC links, resource links, page targets).
- [x] `utils/theme.ts` — `resolveTheme` + `applyTheme` + `Appearance`/`Theme` types (the three-way appearance model's pure core).

### 5. Messaging + window-bridge spike (risk retirement, not production code) — DONE, runtime-verified

- [x] Installed `@webext-core/messaging` 4.0.0 + peer devDependency `@types/chrome` 0.3.4. Package-verified: root exports `defineExtensionMessaging`; **`/page`** exports `defineWindowMessaging`/`defineCustomEventMessaging`. Window messaging uses `window.postMessage`, a required `namespace`, and `structuredClone` on both sides. `@wxt-dev/browser` types `browser.devtools`; no shim.
- [x] **Throwaway runtime spike (all legs verified in real Chromium 153 for Testing via a Playwright persistent context, `channel: 'chromium'` headless — the headless _shell_ cannot load extensions; Chromium ≥137 also requires Developer Mode, seeded via the profile preference `extensions.ui.developer_mode: true`):**
  - isolated CS ↔ service-worker round trip through `defineExtensionMessaging`; response propagation through `chrome.runtime.sendMessage` callbacks works, handler errors serialize back and throw at the sender.
  - service-worker → content-script **tab-targeted push** (`sendMessage(type, data, { tabId })` from the worker): delivered, and the CS handler's return value propagated back to the worker.
  - **No-receiver branch:** a tab-targeted push at a nonexistent tab id rejects with `Error: No response` (the library's generic messenger turns the `undefined` callback result into that error) instead of hanging. Two consequences recorded as P1 contract rules: (a) a targeted send whose receiver exists but returns `undefined` manifests the same **"No response"** error — protocol handlers must return a defined value; (b) the rejection must be caught at every send site with a typed "no content script" branch.
  - MAIN world ↔ isolated world through `defineWindowMessaging` from `/page`: messages crossed **both** directions with structured clones on the same `namespace`, and each side received the other's return value.
  - Token probe (same Chromium run): `@theme inline` utilities generated over `light-dark()` tokens and flipped correctly via `data-theme` on `<html>` **and** on a nested element (per-element resolution — the model injected UIs rely on); emulated `prefers-color-scheme` matched the system path both ways; `text-2xs` produced 11px/16px; density, shadow and gradient tokens resolved as tabled.
- Recorded limitations (each with an owning phase): the **devtools context send** could not be exercised headlessly (needs an open panel) — it rides on `chrome.tabs.sendMessage` verified above but is still spot-checked in P5 against a real panel; Firefox behavior of `chrome.tabs.sendMessage` and the `chrome`-global dependency of the library is a P3 spot-check (verified present and functional in Chromium; Firefox aliases it, but that must be verified, not assumed).

## Explicit enhancements over legacy (this phase)

- Host permissions declared + `tabs` permission dropped (least privilege, fixes silent header risk).
- Real test gate exists from the start (legacy had none).
- Token-based theming with the three-way appearance model (system default / dark / light) usable from day one; legacy hardcoded dark grays inline in every page.
- **Status-vocabulary tokens carry both baselines' state models (incl. the second baseline's amber `attention-unsure`) with AA contrast verified at the token level** — the P6 cards and P12 strip can't drift apart on state colors.
- CI runs every gate on every PR (legacy had no lint, no tests, no CI at all).

## Tests

- `utils/*.test.ts` for every util (debounce timing with fake timers, cn precedence, URL edge cases) — DONE, plus `utils/theme.test.ts`.
- `assets/css/theme.test.ts` — the WCAG AA contrast + token-structure gate on the real stylesheet — DONE.
- `scripts/check-budgets.test.mjs` — glob matching + measurement with an injected reader — DONE.

## Verification checklist

- [x] `pnpm compile && pnpm lint && pnpm format:check && pnpm test` green (33 tests; coverage 100% over `utils/**`; adversarial audit re-ran everything after mutation tests).
- [x] `pnpm build` produces a loadable extension; manifest inspected matches §Tasks-1 (permissions, host permissions, no `tabs`, no demo content script). `pnpm build:firefox` stays green (emits `firefox-mv2` — WXT default, revisit in P15).
- [x] `pnpm build && pnpm check:budgets` green (background + popup measured; other surfaces print "absent — not built yet"). Breach + malformed-table + wrong-cwd paths each proven to fail loudly with exit 1.
- [x] Messaging spike results recorded in §Tasks-5 above (runtime-verified, not just types).
- [x] AGENTS.md updated (test gate, commands, CI mention); README dev setup refreshed with the real stack.
- [x] Spike files deleted after recording (background restored to scaffold; `lib/spike-messengers.ts`, `entrypoints/spike*.ts`, `entrypoints/spike-tokens/` removed; the clean build re-verified).
- [x] Post-implementation audit (2026-10-06): fixed the budgets gate (cwd-independent root, JSON schema validation, robust exec guard, honest skip message — the foreign-cwd path was misleading before), made the AA pair table complete-by-construction, pinned `vitest` + `@vitest/coverage-v8` to the same exact version (they peer-pin each other), owned `@types/node` explicitly, least-privilege `contents: read` on CI, corrected a stale `light-dark()` ordering comment in `theme.css`, documented `debounce`'s error-propagation behavior.
- [x] Adversarial budget review (2026-10-06): fixed ceilings provide CI-enforced regression guards against measured source sizes. Mitigations: re-derive the committed table at hardening, never silently; phase ownership/hardening re-audit cover the fits-to-breach gap (defer a ratchet baseline until creep is observed); the shipped whole-build row prevents chunk-splitting evasion.

## Docs to update

AGENTS.md (commands + test gate) — DONE. README (dev setup once Tailwind lands) — DONE.
