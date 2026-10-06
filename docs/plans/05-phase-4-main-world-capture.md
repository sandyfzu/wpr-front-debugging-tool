# Phase 4 — MAIN-world content script (undefined-references capture)

**Depends on:** P1. **Effort:** S. **Parallelizable with:** P2, P3.

## Goal

Port the MAIN-world error capture that powers the Undefined References page, replacing the document-CustomEvent hop with the typed window bridge, adding the dead error cap for real, and keeping the host page 100 % unaffected.

## Legacy reference

- `entrypoints/mainWord.content.ts` — `matches: http/https all`, `runAt: 'document_start'`, `world: 'MAIN'`, runs `undefinedReferencesCapture()`.
- `content-scripts/undefinedReferencesCapture.ts` — window `error` + `unhandledrejection` listeners; extraction regexes: `ReferenceError: (.*) is not defined`, `TypeError: Cannot read properties of undefined \(reading '(.*)'\)`, `TypeError: (.*) is not a function` (→ last `.`-segment); "Script error." → `__EXTERNAL_ORIGIN_ERROR__` sentinel; dedupe via `words` Set; 500 ms debounced batches sent as document `CustomEvent` with `detail.words`; buffer cleared after send. **Dead:** `errors`/`LIMIT = 50` never enforced (master #11). Deeper risk (master #41): the hop itself — `document` CustomEvents with a `detail` payload created in the page world are generally **unreadable from the isolated world** in Chromium, so the entire pipeline (not just the #21 sentinel) may never have delivered a word in legacy Chrome. The P0 spike verifies the `postMessage`-based bridge before this phase relies on it — the replacement is a resurrection, not just hygiene.

## Tasks

### 1. `entrypoints/main-world.content.ts`

- [ ] `defineContentScript({ matches, runAt: 'document_start', world: 'MAIN', main() { ... } })` — keep this file tiny; logic in a colocated `capture-undefined-references.ts`.
- [ ] **Minimize main-world footprint:** the only thing running in the page's world is the capture + `window.postMessage` envelope (via `defineWindowMessaging` sender from P1). No Solid, no UI, no P1 imports beyond the bridge + constants (bundle budget ≤ 2 KB).
- [ ] Extraction: port the three regexes verbatim into a **pure exported function** `extractUndefinedReference(message: string): string | null` (unit-testable, parity guaranteed).
- [ ] Cross-world hop: `defineWindowMessaging` (imported from **`@webext-core/messaging/page`** — not the main entry) channel `undefinedReferenceBatch` (namespace constant) — replaces `document.dispatchEvent(new CustomEvent(...))`; the isolated-world receiver (P3 data hub) validates with `parseErrorWords` (defense in depth: the MAIN world is page-compromisable; treat its output as untrusted on both sides).
- [ ] Batching: dedupe Set + 500 ms debounce (P0 util with cancel — also used as cleanup), buffer flush sends the batch.
- [ ] **Implement the cap for real:** max 50 unique identifiers per page lifetime (parity with intent), plus per-word length cap (200 chars) and total-batch cap — prevents pathological pages from flooding the bridge (master #11 + security).
- [ ] `Script error.` handling: **fix the dead sentinel path** (master bug #21 — legacy dispatches `detail.word` singular which the isolated receiver ignores, so cross-origin errors never reach devtools). In the port, the sentinel flows through the same window-bridge batch (deduped like any word, sent immediately rather than waiting 500 ms — immediate visibility matters more than batching for a single sentinel; document the delta from legacy's immediate-but-broken dispatch).
- [ ] Cleanup: remove both `window` listeners when the CS context is invalidated. Verify at implementation time whether a MAIN-world CS receives a usable `ContentScriptContext`/invalidation handshake in WXT 0.21 (the isolated-world handshake exists in `content-script-context.mjs`; a MAIN-world equivalent must be confirmed, not assumed) — if none exists, keep page-lifetime listeners with a documented note (the page lifetime is the correct lifetime for an error capture anyway) and record the decision here.
- [ ] Listeners are `capture: false` (parity) and never re-thrown — a capture failure must not alter page error handling (no `event.preventDefault`, no rethrow).

## Explicit enhancements over legacy

- Real cap + length limits (flood safety); typed window bridge with validation on both ends; pure extractable matcher; cleanup discipline; ≤ 2 KB world footprint. The bridge replaces a hop that was likely entirely dead in Chromium (#41) — the undefined-references feature is expected to _start working_ in the port.

## Tests

- `capture-undefined-references.test.ts` — `extractUndefinedReference` matrix: ReferenceError / reading-of-undefined / not-a-function (nested path → last segment) / no-match / multi-line stacks / the exact legacy message forms; batching logic with fake timers (dedupe, 50 cap, length cap, flush timing); sentinel handling.

## Verification checklist

- [ ] Gates green; main-world bundle ≤ 2 KB (measure `content-scripts/main-world.js`).
- [ ] The P0 spike record for the MAIN↔ISOLATED `postMessage` round-trip is confirmed here (master #41 — if the bridge also fails cross-world, escalate to P1 for a data-attribute fallback before building on it).
- [ ] Manual: open a page with a known undefined reference (fixture page from P1 corpus or a local test page throwing `ReferenceError: foo is not defined` after 2 s) → P3 data hub log shows the validated batch; the page's own console output is unchanged.
- [ ] Manual: page with cross-origin script error → `__EXTERNAL_ORIGIN_ERROR__` reaches the panel data (**this must work; in legacy it silently never did** — bug #21).
- [ ] Manual Firefox: MAIN-world CS runs (WXT `world: 'MAIN'` Firefox support verified — if Firefox lacks `world: 'MAIN'` in its manifest schema, use WXT's `injectScript`-style fallback **only if needed**; record outcome and reflect it in CLAUDE.md if the entrypoint shape changes).

## Docs to update

CLAUDE.md only if the MAIN-world strategy changes from a plain content script.
