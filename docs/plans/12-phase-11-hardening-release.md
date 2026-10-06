# Phase 11 — Hardening, audits & release

**Depends on:** P0–P10 complete. **Effort:** M. **Parallelizable:** none (final gate).

## Goal

Cross-surface verification of every master-plan promise (speed, size, security, reliability, UI), documentation debt, and store/release readiness for Chrome + Firefox.

## Tasks

### 1. Budget & performance audit (master §1.3, §5.6)

- [ ] `pnpm build` (both browsers) → `pnpm check:budgets` (P0 script) → pass/fail table committed into this file with raw + gzip per surface; **the panel's ≤ 350 KB stretch target reported met/not-met with reason**.
- [ ] **Speed gate (automated):** `pnpm bench:detection` → commit its table (fixture | new median ms | reference median ms | ratio | PASS on `median(new) ≤ 0.70 × median(reference)`). Supplement with the scripted real-page protocol: same machine, same WP Rocket fixture page, ≥ 5 page loads per build (legacy + new), medians of the timing logs recorded in the same table — cross-environment confirmation of the in-process result.
- [ ] Panel interaction: re-run the P6 long-task gate (5,000-row fixture; none > 50 ms, TBT < 200 ms); shiki loads only on demand (network log).
- [ ] Startup audit (grep gate): no top-level `await` in `entrypoints/background/**` outside handler functions — SW cold-start only registers listeners; CS `document_start` footprint measured.
- [ ] CI gate: the P0 workflow (compile/lint/format/test/check:budgets + both-browser build) green on the release commit; evidence links to the run.

### 2. Security audit

- [ ] Enumerate every boundary (message types × senders, storage keys, fetched KC JSON, page-derived DOM strings, file input) and verify a validator + test exists (walk `lib/*/validate` + P1 protocol).
- [ ] Confirm no `innerHTML`/`insertAdjacentHTML` with any non-static string anywhere (`grep` gate), all external links `rel="noopener noreferrer"`, all `window.open` targets explicit.
- [ ] Manifest review: least privilege final state documented in `wxt.config.ts` why-comments; CSP untouched (default MV3); no remote code (KC fetch is data-only, validated).
- [ ] Error-word cap & KC item caps confirmed effective (hostile fixture page).
- [ ] **Dependency-ban gate:** `pnpm ls --depth 0` output diffed against the master §1.4 stack table and committed — none of `framer-motion`/`wouter`/`react-hot-toast`/`react-syntax-highlighter` (nor any React package) present (the eslint rules from P0 are the per-commit guard; this is the release gate).

### 3. Reliability & cross-browser pass

- [ ] Reload-storm test: reload extension 10×, navigate 20× — no duplicate context menus (legacy's fix preserved), no duplicate admin-bar entries, no leaked observers (heap snapshot delta on HS page).
- [ ] Long-session test: panel open across 50 navigations — memory stable (no accumulating caches; header LRU bounded).
- [ ] Firefox E2E: every surface smoke-tested via `pnpm dev:firefox`; known FF deltas documented (MAIN-world CS support, FSA fallback, host-permission grant flow) in README.
- [ ] `web-ext lint` (devDependency already present) clean or documented exceptions.
- [ ] Built-HTML audit (master #25): every entrypoint HTML in both `.output` trees references the emitted CSS assets — grep gate; no silently dropped stylesheets (legacy dropped `common.css` on itself).

### 4. UI/UX polish & a11y final pass

- [ ] Full keyboard-only walkthrough of all surfaces; axe run on every page/state with **0 violations** as the pass bar; focus management on route change.
- [ ] **"Better UI" acceptance gate — all five green or the claim fails:** (a) axe 0 violations everywhere; (b) keyboard-only checklist 100 % ticked; (c) P6 long-task gate green on the 5,000-row fixture; (d) motion-token gate — grep for bare `transition:`/`animation:` outside the P0 motion tokens/`theme.css` = 0 hits (`prefers-reduced-motion` coverage); (e) palette-token gate — grep for hardcoded palette classes (`bg-gray-*`, inline hex colors) outside `assets/css` = 0 hits, plus a committed light-mode screenshot set of every page.
- [ ] Copy sweep (grep gate): no "FDT legacy", no legacy typos ("Trucated", "ocurred", "Know conflict", "Resouces"), no double periods (".."), "Non-delayed"/"Non-Deferred" consistent, "if there are any" (not "in there are any"), "No known conflicts found" (not "No Know conflict found"), garbled options label rewritten, consistent product name "WPR Front Debugging Tool".

### 5. Documentation

- [ ] README rewrite: what the tool does (with screenshots), dev setup, build/zip, browser notes, link to `docs/`.
- [ ] `docs/`: architecture deep-dive (data flow diagram from master §2), detection-engine reference (each check's footprint + fixtures), messaging protocol table.
- [ ] CLAUDE.md final sync (scripts incl. `test`/`check:budgets`/`bench:detection`, permissions, structure, conventions that changed during the port).

### 6. Enhancement re-audit (closes README rule 3)

- [ ] Walk every phase file's **Explicit enhancements over legacy** section (P0–P10) bullet by bullet: mark each **DELIVERED / DEFERRED / DROPPED** with evidence (test name, measurement, or manual-check note). Deferred/Dropped entries need a written justification. This is the enforcement point promised by README rule 3 ("must ship in that phase, not 'later'") — a phase cannot be considered done with unaccounted enhancements. Walk master §8's committed-extensions table (toolbar badge, support report, headers viewer, exclusion bridge, KC freshness, sidebar inventory, CI) row by row with the same discipline.
- [ ] Re-check cross-phase promises that phases defer to each other (e.g. P0 → P9 theme toggle; P1 logger → P2/P3; P6 gate → here) — each resolved in its owning phase.

### 7. Release

- [ ] Version bump to `1.0.0` (SemVer; store-ready milestone), changelog section in README or `docs/` summarizing the port + enhancements.
- [ ] `pnpm zip` + `pnpm zip:firefox` produce store artifacts; verify zips contain no dev artifacts (`.output` hygiene, `.gitignore` respected).
- [ ] Store listing assets: 128-px icon check, description text, screenshots from the new UI (panel Detections, Diagnoser, Exclusion Builder).
- [ ] Re-verify legacy HEAD hasn't moved past v2.2.5 before release (it moved once during planning — the WP 7.x KC-selector fix); fold any newer legacy commits into the affected phase docs first.
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

README (full), docs/ (architecture), CLAUDE.md (final sync), this file (audit tables).
