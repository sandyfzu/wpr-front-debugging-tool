# Phase 10.1 — Exclusion-Builder browser suites

**Depends on:** P4.1, P10 (site flows reuse the P4.2 fixture pages the builder targets). **Effort:** S–M. **Parallelizable with:** P11 implementation.

> **Parked with P10's re-plan (owner, 2026-10-08):** P10 is ditched and awaiting its re-think;
> these suites are re-derived when that re-plan lands, since every suite below traces to the
> old plan's flows.

## TLDR

Automate the exclusion-builder checklist: the engine's byte-parity proof becomes an automated diff on identical HTML files, the invalid-regex-per-line UX, the external-edit guard, and the full apply→reopen→behaviors-gone→reset flow on the local site's fixture pages.

## Suites

1. **Engine parity, automated:** open the builder with identical HTML fixture files in both builds (the legacy build unpacked alongside when the owner's legacy checkout is available) → byte-diff of outputs empty except documented deltas (the notice) — the P10 doc's planned manual comparison, converted.
2. **Regex UX:** `(` typed on a line → line flagged; Apply blocked with the actionable message naming the line.
3. **External-edit guard:** the harness mutates the selected file on disk between select and Apply → the guard warns instead of silently overwriting.
4. **Apply flow on site fixtures:** pick → exclusions → apply → reopen the page in-browser → targeted behaviors gone and the notice flashes; Reset restores original behavior. Fixture pages from P4.2 carry exactly the behaviors the builder config addresses.
5. **Fallback flow (Firefox):** stays manual with the harness exception noted — Playwright cannot load extensions into its Firefox build; the produced downloadable file's correctness gets a byte-diff round on Chromium only (Firefox-checked manually per the P10 doc).

## Definition of done

- Suites green under `pnpm test:e2e`; P10's checklist annotated; budget row unaffected.

## Stays manual

Firefox install-time flow checks; UX feel of the drag/selection interactions beyond their testable state contracts.
