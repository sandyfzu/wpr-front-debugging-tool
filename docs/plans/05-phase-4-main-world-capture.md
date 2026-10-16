# Phase 4 — MAIN-world content script (undefined-references capture)

**Depends on:** P1. **Effort:** S. **Parallelizable with:** P2, P3.

## Goal

Port Undefined References capture to the typed window bridge, enforce the error cap, and leave host-page behavior unchanged.

## Legacy reference

- `entrypoints/mainWord.content.ts` — `matches: http/https all`, `runAt: 'document_start'`, `world: 'MAIN'`, runs `undefinedReferencesCapture()`.
- `content-scripts/undefinedReferencesCapture.ts` — window `error` + `unhandledrejection` listeners; extraction regexes: `ReferenceError: (.*) is not defined`, `TypeError: Cannot read properties of undefined \(reading '(.*)'\)`, `TypeError: (.*) is not a function` (→ last `.`-segment); "Script error." → `__EXTERNAL_ORIGIN_ERROR__` sentinel; dedupe via `words` Set; 500 ms debounced batches sent as document `CustomEvent` with `detail.words`; buffer cleared after send. **Dead:** `errors`/`LIMIT = 50` never enforced (master #11). Deeper risk (master #41): the hop itself — `document` CustomEvents with a `detail` payload created in the page world are generally **unreadable from the isolated world** in Chromium, so the entire pipeline (not just the #21 sentinel) may never have delivered a word in legacy Chrome. The P0 spike verifies the `postMessage`-based bridge before this phase relies on it — the replacement is a resurrection, not just hygiene.

## Tasks

### 1. `entrypoints/main-world.content.ts`

- [x] `defineContentScript({ matches, runAt: 'document_start', world: 'MAIN', main() { ... } })` — keep this file tiny; logic in a colocated `capture-undefined-references.ts`. (Built manifest: `world: "MAIN"`, `run_at: "document_start"`, matches `http://*/* + https://*/*`.)
- [x] **Minimize main-world footprint:** the only thing running in the page's world is the capture + `window.postMessage` envelope (via `defineWindowMessaging` sender from P1). No Solid, no UI, no P1 imports beyond the bridge + constants (bundle budget ≤ 2 KB). (Measured outcome recorded below — the bridge transport alone costs ~3.7 KB minified, so the ≤ 2 KB reading of the budget cannot hold; see the record.)
- [x] Extraction: port the three regexes verbatim into a **pure exported function** `extractUndefinedReference(message: string): string | null` (unit-testable, parity guaranteed).
- [x] Cross-world hop: `defineWindowMessaging` (imported from **`@webext-core/messaging/page`** — not the main entry) channel `undefinedReferenceBatch` (namespace constant) — replaces `document.dispatchEvent(new CustomEvent(...))`; the isolated-world receiver (P3 data hub) validates with `parseErrorWords` (defense in depth: the MAIN world is page-compromisable; treat its output as untrusted on both sides).
- [x] Batching: dedupe Set + 500 ms debounce (P0 util with cancel — also used as cleanup), buffer flush sends the batch.
- [x] **Implement the cap for real:** max 50 unique identifiers per page lifetime (parity with intent), plus per-word length cap (200 chars) and total-batch cap — prevents pathological pages from flooding the bridge (the batch truncation keeps every flush within the receiver's word cap; the overflow drops the newest identifiers, never the sentinel).
- [x] `Script error.` handling: **fix the dead sentinel path** (the singular-field dispatch the port replaces — see the bridge constants sharing `CROSS_ORIGIN_ERROR_MESSAGE`/`CROSS_ORIGIN_ERROR_WORD`). In the port, the sentinel flows through the same window-bridge batch (deduped like any word, sent immediately rather than waiting 500 ms — immediate visibility matters more than batching for a single sentinel; it also cancels the pending debounce so nothing lands twice). The sentinel is deliberately exempt from the 50-identifier ledger: it is a fixed constant, not page-derived, and losing it would mute every cross-origin error of the page.
- [x] Cleanup: page-lifetime listeners plus an explicit stop handle; MAIN-world scripts receive no invalidation context. Package evidence and teardown details are in the Implementation record.
- [x] Listeners are `capture: false` (parity) and never re-thrown — a capture failure must not alter page error handling (no `event.preventDefault`, no rethrow). (Every listener body is wrapped; a synthetic throw-hostile `stack` getter is pinned by a test.)

**Historical P16 forward note:** the proposed colocated `ua-identity.ts` instead shipped as a separate all-frame entrypoint pair. [05g](./05g-phase-16-2-sbs-mobile-comparison.md) owns UA shadow/restore, bridge, tests, and budgets; P4's capture remains separate.

## Explicit enhancements over legacy

- Real cap + length limits (flood safety); typed window bridge with validation on both ends; pure extractable matcher; cleanup discipline; ≤ 2 KB world footprint. The bridge replaces a hop that was likely entirely dead in Chromium (#41) — the undefined-references feature is expected to _start working_ in the port.

## Tests

- `capture-undefined-references.test.ts` — `extractUndefinedReference` matrix: ReferenceError / reading-of-undefined / not-a-function (nested path → last segment) / no-match / multi-line stacks / the exact legacy message forms; batching logic with fake timers (dedupe, 50 cap, length cap, flush timing); sentinel handling. **DONE — 33 tests, all passing** (extraction matrix incl. pattern priority and line-local matching; debounce restart, the identifiers-only dedupe ledger — the sentinel never shares a slot, rides its own once-per-page flags — unique/word/batch caps incl. the sentinel-never-dropped truncation with exactly the receiver cap held and the newest identifier spilling announced-once, the page-lifetime identifier ceiling never shaved by the sentinel; immediate + cancel-then-flush sentinel semantics incl. closed-ledger ride-along and cross-flush dedupe; rejection events sharing the ledger incl. the deliberate callable skip; page-safety pins — no `preventDefault`, hostile stack getter swallowed, control-character admission refusal, teardown; one composed bridge round-trip over real timers).

## Verification checklist

- [x] Gates green; `content-scripts/main-world.js` **6.58 KB raw / 2.6 KB gzip**. Transport requires the documented **2 → 8 KB raw** budget raise; breakdown/rationale below.
- [x] P0 §5 verified bidirectional MAIN↔ISOLATED `defineWindowMessaging` clones/return values. This phase adds a CI composition pin: capture → real window → fresh same-namespace receiver → acknowledged batch. No bridge failure/fallback needed.
- [ ] Manual: open a page with a known undefined reference (fixture page from P1 corpus or a local test page throwing `ReferenceError: foo is not defined` after 2 s) → P3 data hub log shows the validated batch; the page's own console output is unchanged. _(pending — needs P3's receiver landed plus a live browser; steps unchanged.)_
- [ ] Manual: page with cross-origin script error → `__EXTERNAL_ORIGIN_ERROR__` reaches the panel data (this must work; the pre-port behavior silently dropped it). _(pending — same conditions.)_
- [ ] Manual Firefox: live MAIN-world injection remains pending; build/schema evidence below.
- [x] `sandbox`/`credentialless` evaluation, booked for completeness against P3's iframe decision: **N/A for this entrypoint** — the capture only attaches two `window` listeners and sends over `window.postMessage`; it creates no iframes and injects no UI, so there is nothing to sandbox or make credentialless.

## Implementation record (2026-10-07)

**Delivered:** `entrypoints/main-world.content.ts` (wiring only); `entrypoints/main-world/capture-undefined-references.ts` (+ its 33-test suite); contract additions shared with the other worlds: `lib/messaging/error-words.ts` (the word-batch caps + printability rule, single-sourced for both bridge sides), `ERROR_WORD_LIMITS`/`isPrintable` re-exported unchanged from `lib/messaging/validate.ts`, and `CROSS_ORIGIN_ERROR_MESSAGE`/`CROSS_ORIGIN_ERROR_WORD` in `lib/messaging/window-bridge.ts`.

**WXT MAIN-world invalidation (empirical, read from the installed package):** `wxt 0.21.4`'s MAIN-world entrypoint wrapper (`dist/virtual/content-script-main-world-entrypoint.mjs`) calls `definition.main()` with no arguments and no context object — the isolated-world wrapper is the only one that constructs and passes a `ContentScriptContext`. Consequence: no invalidation handshake exists for this surface; the implementation keeps page-lifetime listeners (this capture's natural lifetime; scripts injected at `document_start` die with the page on navigation anyway) and returns a `stop()` teardown (two non-capture `removeEventListener` calls + debounce `cancel`) for tests and any future caller holding a context.

**Budget raise:** `content-scripts/main-world.js` = **6,580 B raw / 2,635 B gzip**: ~370 B entry/wrapper, ~3.7 KB mandated `@webext-core/messaging` v4 transport (error-clone helpers + `/page`), ~1.9 KB capture (extraction/caps/truncation/immediate sentinel/listener guards/constants). The original 2 KB priced the replaced CustomEvent hop, not the spike-verified typed `postMessage` transport. Following `scripts/check-budgets.mjs`'s legitimate-breach rule, only `raw: 2 → 8` changed; no behavior was cut. This record/phase report provides the committed rationale; doubled capture+bridge still breaches, and P15 re-derives the table.

**Dependency-graph discipline (why the bundle shrank 7.83 → 6.58 KB mid-phase):** importing the caps from `lib/messaging/validate.ts` pulled `lib/wp-rocket/constants` (lazyload exclusion list, beacon field names, minify regexes) and the full guard-cap table into the page-world bundle — tree-shaking cannot drop their side-effectful module statements. That knowledge now lives where its concepts live: the error-words contract leaf, imported by the capture sender _and_ the receiving guard.

**Semantics deltas over the reference behavior (all explicitly enumerated, none silent):** (1) the cross-origin sentinel is exempt from the 50-identifier ledger and ships immediately (cancels the pending debounce; pending identifiers ride along) — the reference dispatch was immediate but the singular-field it carried was ignored by every receiver, so cross-origin errors were meta-dead; (2) admission filtering (length + printability) mirrors the receiving guard before any batch exists, because the receiver rejects a whole batch on one malformed word; (3) flushed batches never exceed the receiver's word cap — overflow truncates newest-first and keeps the sentinel, announced once per occurrence; (4) the ledger cap announces itself once per page, not per refused word; (5) the thrown-value surface is narrower by one shape: the reference read `.stack` off any truthy thrown value, the port scans only object-shaped ones, so a callable carrying a string `stack` is skipped. Deliberate, with no behavioral loss observed: callables have no native `stack` at all in this engine (verified on the installed V8/Node 26.10 — `typeof fn.stack === 'undefined'`; a string stack on one exists only when the page attached it, e.g. via `Error.captureStackTrace(fn)` or a direct property), real `ReferenceError`/`TypeError` reports arrive as `Error` objects the port scans identically, and every non-callable thrown value scans with unchanged behavior; pinned by the capture suite ('a callable is skipped even when a page stapled a string stack onto it'). The test coverage pins each of these.

**Main-world safety notes:** both listener bodies fully wrapped (a thrown value with a hostile `stack` getter is logged and dropped — pinned by a test); nothing repaints or intercepts (`defaultPrevented` stays `false`, `capture: false`, removal by the same flags); the entrypoint's `main()` is guarded so no throw of ours reaches the host page; the bridge send is fire-and-handled (`void … .catch`) — with no receiver it stays pending by documented transport semantics and sends are ledger-bounded, so response listeners cannot grow unbounded.

**Firefox (build-side verified, runtime pending):** `pnpm build:firefox` emits the MV2 manifest carrying `world: "MAIN"` for this entry (verified in `.output/firefox-mv2/manifest.json`); MDN's `content_scripts` schema documents the `world` key with `MAIN` semantics for Firefox. Live injection remains the manual item below.

**Browser-suite pointer (P4.1):** this capture's runtime behavior is pinned by `tests/e2e/suites/undefined-references.spec.ts` (2 s `ReferenceError` → validated batch observable at the `getFdtData` seam; hostile `stack` getter and malformed bridge batches cannot break it; the page's own console output unchanged) and `cross-origin-sentinel.spec.ts` (the sentinel word reaches the isolated receiver immediately, not debounced — page-clock round-trip measurement).

## Docs to update

AGENTS.md only if the MAIN-world strategy changes from a plain content script. **No change — the strategy is the planned one** (a plain `world: 'MAIN'` manifest content script over the shared window bridge; no fallback mechanism was needed). The budgets row's value lives only in `scripts/budgets.json` + this record.
