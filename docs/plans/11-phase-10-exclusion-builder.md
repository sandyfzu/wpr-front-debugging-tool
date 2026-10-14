# Phase 10 — Exclusion Builder

**Depends on:** P1 (constants/types), P5 (design system). **Effort:** L. **Parallelizable with:** P6–P9 (UI part needs P5 only).

> **UI/UX bar:** this phase's UI meets [`docs/ui-ux-bar.md`](../ui-ux-bar.md) (rules cited by id; its §D checks are receipted with every UI change) — this doc keeps only surface-specific decisions.

> **OWNER DECISION (2026-10-08) — PARKED FOR A RE-PLAN.** The owner **ditched the current way**
> of building and planning the Exclusion Builder (this document's legacy-parity shape, including
> its incognito parity skip) and asked to **re-think and re-plan it** before anything here is
> built. Until that re-plan lands, this document is historical context for the port's parity
> answers, not the build spec. Immediate behavioral consequence already applied: the context-menu
> entry opens the standalone builder page from private windows too (no incognito skip — the
> parity skip is gone; supersedition recorded in P2's deltas). The re-plan's new shape is the
> owner's next call.

## Goal

Port the Exclusion Builder: the exclusion engine as a pure, exhaustively-tested library plus a rebuilt unlisted page with inline validation, counts, and a Firefox fallback for file writes.

## Legacy reference

- `entrypoints/exclusion-builder/utils.ts` (engine — port into `lib/exclusions/`):
  - `createDocument(html)` → DOMParser (throws `DocumentCreationError`).
  - `getInvalidRegExps(list)`, `linesToArray(text)` (split/trim/filter-empty).
  - `applyDelayJSExclusions(doc, exclusions)` — validates all regexes first (throws `InvalidExclusionError` with the invalid list), finds `script[type=rocketlazyloadscript|text/rocketlazyloadscript]`, per script matches `script.outerHTML` against each exclusion, on match `excludeScriptDelayJS`: restore `data-rocket-type` → `type`, `data-rocket-src` → `src`, set `data-wpr-fdt-excluded` (`delay_js`).
  - `applyDeferJSExclusions` — `script[data-rocket-defer]`, real src = `data-rocket-src` (delayed) or `src`; match on src; `excludeScriptDeferJS`: drop `data-rocket-defer` + `defer`, tag FDT-excluded (`defer_all_js`).
  - `applyLazyloadExclusions` — `img[data-lazy-src]`; clone with `src` = lazy value (simulates original), match `outerHTML.includes(exclusion)` (plain string, not regex — parity); `excludeImageLazyload`: restore `src/srcset/sizes` from data attrs, tag FDT-excluded (`lazyload`).
  - `applyALRExclusions` — `*[data-wpr-lazyrender]`; match on element-with-empty-children outerHTML; `excludeElementALR`: drop attr, tag FDT-excluded (`rocket_lrc_optimization`).
  - `disableDelayJS/DeferJS/ALR` — full-feature disable: remove the three runner inline scripts (userAgent match script, `RocketLazyLoadScripts.run`, `RocketElementorAnimation.run`), then exclude everything; `disableALR` also removes `#rocket-lazyrender-inline-css`.
  - `outerHTMLWithDocType(doc)` — `<!DOCTYPE html> \n` + `documentElement.outerHTML`.
  - `setFDTExcludeAttribute` — appends to existing attr CSV.
- `pages/ExclusionBuilderPage.tsx` (UI): file pick via `showOpenFilePicker({ types: [text/html] })` + `requestPermission({ mode: 'readwrite' })`; empty-file guard (`HTMLFileEmpty`); reset file to original content; 4 textareas (Delay JS / Defer JS / ALR / Lazyload) + 3 enable-disable toggles (when disabled → apply full `disableX` instead of exclusions); Apply: parse → per-feature apply → append `ChromeOverridesNotice` (script+style that flashes "Please remember that you are viewing an overwritten page!") → save back to the file handle; toasts for success/error; disabled buttons while working/unselected. Invalid regexes are reported toast-only — which lines are invalid is console-only (the per-line validation below replaces this). `saveFile` wraps even `HTMLFileEmpty` as `SavingFileError` (type laundering) and never closes/aborts the writable stream on failure; `resetHTMLFile` can leave `working=true` permanently; the selected file's content is never re-read, so external edits are silently overwritten (all master #35).
- `override-notice.html` — the injected notice (script + styles) — port as a data file.

## Tasks

### 1. `lib/exclusions/` (pure engine, no DOM globals beyond `DOMParser` input)

- [ ] `errors.ts` — `InvalidExclusionError` (carries invalid list), `DocumentCreationError`, `EmptyHtmlError` (renamed from legacy `HTMLFileEmpty`, clearer), `FileWriteError` (successor of legacy `SavingFileError`; the legacy → new mapping lives in this file — never in code TSDoc, per the no-legacy rule in AGENTS.md). No type laundering — `EmptyHtmlError` is never re-wrapped (master #35); set `Error.prototype.name` — legacy's `static name` on Error subclasses is a TS anti-pattern.
- [ ] `parse.ts` — `createDocument`, `linesToArray`, `validateExclusions` (returns `{ valid, invalid }`; keep legacy's validate-all-first throw behavior in the orchestrator).
- [ ] `apply.ts` — the four `applyXExclusions` + four `disableX` ports **verbatim in semantics**, operating on `Document` + `ParsedPage`-style pre-classification where cheap (e.g. reuse `delayJSScriptSelector`); per-element tagging via `setFdtExcludedAttribute(element, feature)` (CSV parity); regex compile cached per call batch (perf: legacy `new RegExp` per script × exclusion).
- [ ] `notice.ts` — `buildChromeOverridesNotice()` importing `override-notice.html` (kept byte-identical — it runs on the _target site_, not the extension; only change: nothing). Known cosmetic quirks kept and documented (byte-parity wins over cosmetics): the invalid `transition-timing-function: line` value falls back to the browser default, and removal is `transitionend`-gated with an 810 ms timeout — the notice can linger until click if the transition never runs (backgrounded tab).
- [ ] `serialize.ts` — `outerHTMLWithDocType` (parity, trailing-space quirk kept — files are re-read by the tool only).

### 2. Unlisted page `entrypoints/exclusion-builder/`

- [ ] Registered as unlisted page (`exclusion-builder.html`); context menu opens it (P2); **no auto-close behaviors** (full page); applies the stored appearance before mount (system default / dark / light — P0 resolver + `[data-theme]`).
- [ ] **File handling (`file-io.ts`):** feature-detect `window.showOpenFilePicker` — Chrome path parity (text/html accept, readwrite permission request, **MIME re-check `file.type !== 'text/html'` → "File must be HTML"**, empty-file error, AbortError silence); **Firefox fallback (enhancement):** `<input type="file" accept=".html,.htm">` read + modified output via `URL.createObjectURL` download (`<a download>`) with a notice that in-place write isn't available (master risk covered); drag-and-drop file support (enhancement); file identity card (name, size, last-modified) + "unsaved changes" marker. Stream hygiene (master #35): the writable is closed/aborted on every failure path and `working` resets in a `finally` (legacy could wedge it permanently). On every Apply/Reset, re-stat the handle (`getFile()`) and warn when size/lastModified changed since selection — external edits are no longer silently overwritten (legacy re-derived from the original snapshot with only a static sentence as warning).
- [ ] **State store (`builder-store.ts`):** file (handle + original content + name), per-feature `{ enabled, text }` for delay/defer/alr/lazyload (lazyload has no disable toggle — parity), `working` flag, per-feature result counts.
- [ ] **UI:** two-column layout (file card; actions card with the 3 disable toggles + Apply — parity behaviors, redesigned presentation); four exclusion editors rebuilt as `exclusion-editor.tsx`: line-numbered textarea (overlay gutter), **live per-line regex validation** with invalid lines highlighted + error summary (uses `validateExclusions` — replaces legacy's toast-only feedback), "plain-string" mode badge on the Lazyload editor (parity: lazyload matches `includes`, not regex — legacy never told the user; document in the editor's hint), clear button, counts (N lines). Apply pipeline with per-feature result counts rendered as toasts + a summary strip ("Excluded 4 scripts from Delay JS, 12 images from Lazyload, …" — enhancement; legacy said only "applied successfully").
- [ ] Reset file button (parity) + confirmation when edits exist (enhancement); Unselect file (parity).
- [ ] All buttons disabled during `working` (parity) with spinner.

## Explicit enhancements over legacy

- Engine 100 % pure + unit-tested (legacy: zero tests, all inline); cached regex compilation; inline validation UX; result counts; Firefox file fallback + drag-drop; unsaved-changes guard; plain-string vs regex mode made explicit; clearer error taxonomy. Stream hygiene + external-edit detection (master #35); `working` can never wedge; no type laundering.

## Tests

- `lib/exclusions/*.test.ts` — the big one: fixture HTML pages (from P1 corpus, plus ALR/DelayJS-heavy fixtures) × operations matrix: apply per feature (matched/unmatched/non-trimmed exclusions), disable per feature (three runner scripts removed, CSS removed for ALR), FDT attr CSV accumulation, invalid-regex throw carrying the right list, empty-lines handling, lazyload clone-simulation matching (verify a `srcset`-only image is excluded via restored markup), doctype serialization round-trip. Snapshot assertions on output HTML for each fixture × operation.
- Failure-path hygiene (master #35): the writable stream is closed/aborted on failure, `working` always resets, and external file changes (size/lastModified drift since selection) produce the warning state (mocked handle).

## Verification checklist

- [ ] Gates green; `pnpm check:budgets` — exclusion-builder ≤ 50 KB raw.
- [ ] Manual vs legacy on identical HTML files: byte-diff of outputs must be empty for the same inputs (parity proof), except documented deltas (none expected in the engine; the notice is byte-identical).
- [ ] Manual Chrome: full flow (pick → exclusions → apply → reopen file in browser → behaviors gone, notice flashes; Reset → original behavior back).
- [ ] Manual Firefox: fallback flow produces a correct downloadable file.
- [ ] Invalid regex per-line UX: type `(` → line flagged, Apply blocked with actionable message naming the line.
- [ ] External-edit guard: modify the file on disk after selecting it → Apply warns instead of silently overwriting.

## Docs to update

AGENTS.md: nothing structural (unlisted page already anticipated); README: Firefox limitation note.
