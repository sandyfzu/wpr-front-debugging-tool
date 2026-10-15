# Phase 6.1 — Panel pages browser suites

**Depends on:** P4.1, P6 (P4.3 ↔ site-driven live checks fold in here where useful). **Effort:** M. **Parallelizable with:** P7 implementation.

## TLDR

Automate P6's per-page panel checklist: card sets, counts/filters, undefined-references definitions, the copyable-report contract, the response-headers section's presence/absence rule, search flows — plus the **committed long-task perf gate** (the 5,000-row fixture) as a repeatable `pnpm test:e2e` assertion, no more eyeballing.

## Suites

1. **Card parity over fixtures:** Detections (identical card set/subtitles to legacy on the same fixture pages), JS/Lazyload/Preloaded Resources (identical counts + filters), Undefined References (identical definitions on the error fixture pages — the P4.1 fixture corpus doubles as input).
2. **Detections extras:** summary strip matches the card set; `Copy report` output matches the committed golden markdown byte-for-byte; response-headers section renders every captured header — and is **omitted** when `pageHeaders` is null (the serve-path contract from P2).
3. **Search flows:** perform/next/prev/cancel across pages; Escape semantics — including, inside a real DevTools window, the JavaScript page's query half driven by the DevTools search box and Esc vs the DevTools drawer (reassigned from P6C's by-hand check: the standalone panel page cannot host the DevTools box).
4. **Perf gate (converted from the doc's "Playwright or chrome-trace" item):** the 5,000-row JSON generated from P6C's seeded generator (`PERF_FIXTURE_OUT=<path> pnpm exec vitest run perf-fixture` — the JSON is never committed) loaded via the dev-only data override; interactions triggered (tab switch + filter change + search); `PerformanceObserver('longtask')` asserts **no entry > 50 ms and total blocking time < 200 ms**. Re-run hook noted for P15.
5. **Keyboard + axe per page state** (the passes convert directly).
6. **Reassigned from P6D (needs a real DevTools window):** (a) Lazyload and Preloaded Resources side-by-side vs the reference build on the same fixture pages — identical counts and filters; (b) the query-half search on both pages with the DevTools find bar — a find-bar query mirrors into the page's field and filters `src`/`href`, `cancelSearch` clears both, a route change resets.

## Definition of done

- Suites green under `pnpm test:e2e`; P6's checklist annotated automated/manual per item; the perf-gate numbers recorded in the phase's committed table.
- Live, real-site verification of detection cards against the inspector build remains with P11.1 (this phase covers fixture/dev-override shapes).

## Stays manual

Nothing structural — the "side-by-side vs legacy on real pages" comparisons stay manual where they depend on the other extension build (recorded in the P6 doc).
