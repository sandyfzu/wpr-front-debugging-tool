# Phase 9.1 — Options browser suites

**Depends on:** P4.1, P9 (site rounds for the badge/admin-bar interplay reuse P4.3's site). **Effort:** S. **Parallelizable with:** P10 implementation.

## TLDR

Automate the options page: toggles persist through the validated storage contract, the appearance selector switches all three palette states live, the KC row refreshes its meta, and the two cross-surface effects (toolbar badge gate, D-bugger admin-bar entry) react without a service-worker restart.

## Suites

1. **Toggle persistence:** improvements toggle → `sync:options` matches (storage read asserted from the page contract, corrupt-value tolerance covered by the P1/P0 validator suite).
2. **Appearance (three-way):** System follows `prefers-color-scheme` (Playwright `setEmulatedMedia` flips the emulation and the page follows); explicit Dark/Light override it on every palette-sensitive element — palette flips asserted on-page without reload.
3. **Cross-surface effects:** toolbar-badge toggle off/on changes the badge via `chrome.action.*` (SW-side assert) with no extension restart; improvements toggle reflects on the site's wp-admin page (site round reusing the P4.3 improvement suite).
4. **KC row:** last-update display + `Refresh now` moves the `updatedAt` meta on success; the failure path surfaces a readable error (offline round; storage-corruption round via a pre-seeded invalid value).
5. **Keyboard + axe pass.**

## Definition of done

- Suites green under `pnpm test:e2e`; P9's checklist annotated; the error-path item now has an automated round (its "temporary mock" hack replaced by the same fixture machinery).

## Stays manual

Nothing structural; visual polish of the three palettes is judged in P15's craft pass.
