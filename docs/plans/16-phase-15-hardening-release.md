# Phase 15 — Hardening, audits & release

**Depends on:** P0–P14 complete. **Effort:** M. **Parallelizable:** none (final gate; requires everything else done first).

## Goal

Cross-surface verification of every master-plan promise (speed, size, security, reliability, UI), documentation debt, and store/release readiness for Chrome + Firefox.

## Tasks

### 1. Budget & performance audit (master §1.3, §5.6)

- [ ] `pnpm build` (both browsers) → `pnpm check:budgets` (P0 script) → pass/fail table committed into this file with raw + gzip per surface; **the panel's ≤ 350 KB stretch target reported met/not-met with reason**.
- [ ] **Re-audit from P6's record** ([07 §Phase-close notes](./07-phase-6-panel-pages.md#phase-close-notes), 2026-10-15: panel past the stretch, the shiki worker near its row): re-measure against it and decide the levers 07 left open — precompiled grammars + raw JS engine (07 §Shared design-system fixes, "Trimming") and the shared chunks no surface row counts (`chunks/web-*.js`, `chunks/types-*.js`).
- [ ] **Speed gate (automated):** `pnpm bench:detection` → commit its table (fixture | new median ms | reference median ms | ratio | PASS on `median(new) ≤ 0.70 × median(reference)`). Supplement with the scripted real-page protocol: same machine, same WP Rocket fixture page, ≥ 5 page loads per build (legacy + new), medians of the timing logs recorded in the same table — cross-environment confirmation of the in-process result.
- [ ] Panel interaction: re-run the P6 long-task gate (5,000-row fixture; none > 50 ms, TBT < 200 ms); shiki loads only on demand (network log).
- [ ] Startup audit (grep gate): no top-level `await` in `entrypoints/background/**` outside handler functions — SW cold-start only registers listeners; CS `document_start` footprint measured.
- [ ] CI gate: the P0 workflow (compile/lint/format/test/check:budgets + both-browser build) green on the release commit; evidence links to the run.

### 2. Security audit

- [ ] Enumerate every boundary (message types × senders, storage keys, fetched KC JSON, page-derived DOM strings, file input) and verify a validator + test exists (walk `lib/*/validate` + P1 protocol).
- [ ] **Injected-UI isolation audit (release gate, AGENTS.md rule):** every UI injected into host pages (Known Conflicts, Side-by-Side, on-page strip, tool banners) verified shadow-rooted via `createShadowRootUi` with adopted styles only — grep gate for un-scoped injection patterns (`document.head.append`, `document.adoptedStyleSheets`, root-level `<style>` creation outside a shadow root) = 0 hits; hostile-CSS host page re-run for every injected surface (P12's audit repeated for the older P3 overlays).
- [ ] Confirm no `innerHTML`/`insertAdjacentHTML` with any non-static string anywhere (`grep` gate), all external links `rel="noopener noreferrer"`, all `window.open` targets explicit.
- [ ] Manifest review: least privilege final state documented in `wxt.config.ts` why-comments; CSP untouched (default MV3); no remote code (KC fetch is data-only, validated).
- [ ] Error-word cap & KC item caps confirmed effective (hostile fixture page).
- [ ] **Dependency-ban gate:** commit `pnpm ls --depth 0` diff against master §1.4's stack decisions: no framer-motion/wouter/react-hot-toast/react-syntax-highlighter or React package. ESLint is the ongoing guard; this is release verification. The second baseline's only accepted runtime addition, `wp-rocket-scripts` (P14), must appear at its exact pin.

### 3. Reliability & cross-browser pass

- [ ] Reload-storm test: reload extension 10×, navigate 20× — no duplicate context menus (legacy's fix preserved), no duplicate admin-bar entries, no leaked observers (heap snapshot delta on HS page).
- [ ] **Unit-tier flake risk (tracked 2026-10-15):** `components/ui/tooltip.test.tsx`'s first case pays the cold `import('./tooltip')` after `vi.resetModules()` — 0.88 s alone, 1.2–1.5 s in full runs (07's P6C/P6F gate receipts), up to 3.8 s reported locally — against Vitest's 5 s default. Warm the import once (e.g. `beforeAll`), never raise the timeout. Owned here: P6.1 is the Playwright tier only, and this is the release pass over test reliability; pull it forward if CI times out first.
- [ ] Long-session test: panel open across 50 navigations — memory stable (no accumulating caches; header LRU bounded).
- [ ] Firefox E2E: every surface smoke-tested via `pnpm dev:firefox`; known FF deltas documented (MAIN-world CS support, FSA fallback, host-permission grant flow) in README.
- [ ] `web-ext lint` (devDependency already present) clean or documented exceptions.
- [ ] Built-HTML audit (master #25): every entrypoint HTML in both `.output` trees references the emitted CSS assets — grep gate; no silently dropped stylesheets (legacy dropped `common.css` on itself).

### 4. UI/UX polish & a11y final pass

- [ ] Full keyboard-only walkthrough of all surfaces; axe run on every page/state with **0 violations** as the pass bar; focus management on route change.
- [ ] **"Better UI" acceptance gate — all five green or the claim fails:** (a) axe 0 violations everywhere; (b) keyboard-only checklist 100 % ticked; (c) P6 long-task gate green on the 5,000-row fixture; (d) motion-token gate — grep for bare `transition:`/`animation:` outside the P0 motion tokens/`theme.css` = 0 hits (`prefers-reduced-motion` coverage); (e) palette-token gate — grep for hardcoded palette classes (`bg-gray-*`, inline hex colors) outside `assets/css` = 0 hits, plus a committed light- **and** dark-mode screenshot set of every page (the appearance gate: System/Dark/Light each render correctly per AGENTS.md's UI-themes rule — System screenshotted under both OS settings); (f) **design-craft pass:** per surface, spacing/alignment on the grid, one semantic accent, type ramp consistent, icon set unified, empty/error/skeleton states present everywhere (the P5 UX-study decisions respected — deviations re-audit against the study, not against taste).
- [ ] Copy sweep (grep gate): no "FDT legacy", no legacy typos ("Trucated", "ocurred", "Know conflict", "Resouces"), no double periods (".."), "Non-delayed"/"Non-Deferred" consistent, "if there are any" (not "in there are any"), "No known conflicts found" (not "No Know conflict found"), garbled options label rewritten, consistent product name "WPR Front Debugging Tool".

### 5. Documentation

- [ ] README rewrite: what the tool does (with screenshots), dev setup, build/zip, browser notes, link to `docs/`.
- [ ] `docs/`: architecture deep-dive (data flow diagram from master §2), detection-engine reference (each check's footprint + fixtures), messaging protocol table.
- [ ] AGENTS.md final sync (scripts incl. `test`/`check:budgets`/`bench:detection`, permissions, structure, conventions that changed during the port).

### 6. Enhancement re-audit (closes README rule 3)

- [ ] Audit every **Explicit enhancements** bullet (P0–P14) and every master §8/§9 extension/integration item: **DELIVERED / DEFERRED / DROPPED** + test/measurement/manual evidence; justify every deferral/drop. This enforces README rule 3's owning-phase commitment; no phase is done with unaccounted enhancements. Include badge, report, headers, exclusion bridge, KC freshness, sidebar, CI, and all P11–P14 additions.
- [ ] Re-check cross-phase promises that phases defer to each other (e.g. P0 → P9 appearance selector; P1 logger → P2/P3; P6 gate → here) — each resolved in its owning phase.

### 7. Release

- [ ] Version bump to `1.0.0` (SemVer; store-ready milestone), changelog section in README or `docs/` summarizing the port + enhancements.
- [ ] `pnpm zip` + `pnpm zip:firefox` produce store artifacts; verify zips contain no dev artifacts (`.output` hygiene, `.gitignore` respected).
- [ ] Store listing assets: 128-px icon check, description text, screenshots from the new UI (panel Detections, Diagnoser, Exclusion Builder).
- [ ] Re-verify both behavioral sources haven't moved before release: the legacy tool past v2.2.5 (it moved once during planning — the WP 7.x KC-selector fix) **and** `wp-media/wpr-inspector` HEAD (P11–P14 build from its v4.1.1 audit — fold any newer commits into the affected phase docs first).
- [ ] Re-sync the committed Known Conflicts DB snapshot with the live endpoint (AGENTS.md rule): refresh `lib/known-conflicts/known-conflicts-db.json`, re-pin the row count, and re-derive the seed-asset budget row.
- [ ] Tag `v1.0.0`, Conventional-Commits history clean.

## Verification checklist (phase exit = project exit)

- [ ] All budgets pass (table filled here; stretch target accounted for).
- [ ] `pnpm bench:detection` table committed with PASS; real-page protocol numbers recorded.
- [ ] Security + reliability checklists above fully ticked (all grep gates 0 hits).
- [ ] Enhancement re-audit table complete (every bullet DELIVERED/DEFERRED/DROPPED + evidence).
- [ ] Both browsers verified; artifacts built.
- [ ] Docs complete and accurate (spot-check every command and path cited).
- [ ] Master-plan TL;DR promises each mapped to evidence (list them here with links to commits/checks).

## Docs to update

README (full), docs/ (architecture), AGENTS.md (final sync), this file (audit tables).
