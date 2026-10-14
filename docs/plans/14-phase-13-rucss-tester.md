# Phase 13 — RUCSS live tester

**Depends on:** P11, P12 (tool chips + feedback banner), P3 (content-script infra), P5 (design system), P6 (Detections TEST MODE badge). **Effort:** M–L. **Parallelizable:** with P14.

> **UI/UX bar:** this phase's UI meets [`docs/ui-ux-bar.md`](../ui-ux-bar.md) (rules cited by id; its §D checks are receipted with every UI change) — this doc keeps only surface-specific decisions.

## Goal

Port the inspector source's RUCSS tester: strips every stylesheet from the live page, asks WP Media's RUCSS endpoint for the page's "shaken" used-CSS (URL + safelist), then injects the result so a support engineer can see what the page would look like if Remove Unused CSS produced exactly that CSS. In this extension the test is configured and triggered from a new panel page (and the on-page strip's chip), executes in the content script, and reports into the panel — with the tool's known fragilities fixed and its client-side transforms made correct.

The UX shell: one **panel page** with the full form (expert inputs preserved verbatim), persisted in extension storage, a status area with explicit running/error/success states, and a "Styles in page" inventory list replacing the source's console-table dump. The strip chip (P12) triggers the same run using the persisted config.

## Reference (wpr-inspector, verified on 2026-10-06 by full-source read)

- `wpr-inspector/RUCSSTester.js` (the whole behavior) + `utils.js` helpers (cookie/localStorage persistence, `getTextareaValueToArray`, wildcard helpers).
- Endpoint (verbatim): `https://mega.wp-rocket.me/support/wpr-rucss-v2.php`, built as
  `${endPointURL}?url=${document.location.href}?${unixTimestamp()}${isMobile}${isHome}` — a **literal second `?`** separator followed by unix seconds, optional `&mobile` (checkbox `#wpr_ins_rucss_mobile`) and `&home` (`#wpr_ins_rucss_home`). The page URL is NOT URL-encoded. This is the server's observed contract — ported as-is, with a live verification task (below) before "fixing" anything about it.
- Request: `fetch(url, { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(safelist items ? { safelist } : {}), redirect: 'follow' })` — **only the safelist rides in the body**; preserve/exclude/replace are purely client-side transforms.
- Response honored shape: `{ code: 200, contents: { shakedCSS: string } }` — non-200 → red banner + `console.error('RUCSS Result :', data)`; injected via `<style id="rucss_test_result_style">` appended to `head`, content = `pre_append + doContentReplace(shakedCSS) + append`; success also flips the strip's RUCSS chip to enabled + appends a literal "(TEST MODE)" extra line (idempotent by `includes` check).
- Style removal (verbatim semantics): selector `style, link[rel="stylesheet"]`; per-item skip when — (a) excluded files: a `link[rel="stylesheet"]` whose `href` matches any user line compiled via `new RegExp(item)` (lines containing `(.*)` passed through a `preserveWildCard` that **discards its own result** — so every user line is a raw regex, wildcards included); (b) preserved inline CSS: a `style` whose `outerHTML` contains any preserve token — the default list `['#wpcb-quick-actions-menu', 'wpr_rucss_style', 'admin-bar.min.css', 'dashicons.min.css', 'inspector_style', 'rocket-lazyrender-inline-css']` **concatenated with user lines only when the user typed anything** (empty textarea ⇒ zero preserved styles, defaults included); plus the carve-out `style.id !== 'wpr-usedcss'` (the stale used-CSS style is always removable).
- Replace pairs: `.wpr_ins_replace_inputs` rows (search/replace textareas, ➕/❌), persisted to `localStorage['wpr_ins_rucss_content_replace_values']`; applied as `content.replace(new RegExp(search, 'g'), replace)` in row order.
- Auxiliary "check styles" button: `console.table` of all live `style/link[rel=stylesheet]` (tag/id/class/href).
- Form persistence via page `localStorage` keyed by input `name` + CSV→newline restore trick.

## Source quirks fixed in this phase (verified in the source)

| #   | Quirk in the inspector source                                                                                                                                                                     | Fix here                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The default preserve list silently disappears when "Inline CSS to preserve" is empty (`updateInlineToPreserve` only concats when truthy) — new users unknowingly strip admin-bar/dashboard styles | Defaults always applied; user lines appended on top                                                                                                                                 |
| 2   | `resetRUCSSTesterBtn`/`toggleButtonState` latch the submit button disabled forever on a fetch exception (re-enable only happens on the success path)                                              | Explicit state machine: idle → running → success/error; button state derived, never toggled blindly                                                                                 |
| 3   | `this.testMessage.classList.remove = 'error'` (assignment, not call) in both testers — once an error styles the banner, every later message stays red                                             | Central message component with proper class handling; golden tests for state colors                                                                                                 |
| 4   | Row-persistence uses CSV round-trip (commas inside values survive as line breaks); caret restore etc. unhandled                                                                                   | Typed storage item (JSON), list-rendered rows, no serialization tricks                                                                                                              |
| 5   | Invalid replace-search regex throws inside the injection during `doRUCSSTest` — the caught error shows "test failed" with zero audience for the real cause                                        | Live regex validation at edit time (the Exclusion Builder's inline-validation pattern); invalid pairs flagged before the run; all-at-once validation report before stripping styles |
| 6   | A failed response shape (different `contents`) is trusted (`data.contents.shakedCSS` assumed)                                                                                                     | Boundary-validated response (§2); unknown shapes → explicit error result                                                                                                            |
| 7   | `console.log('endpoint URL: …')` leaks the page URL to the host page console per run                                                                                                              | Endpoint URL lives in the status area (copyable), never dumped                                                                                                                      |

## Tasks

### 1. `lib/rucss-tester/` — pure core (all unit-tested)

- [ ] `constants.ts` — `RUCSS_ENDPOINT = 'https://mega.wp-rocket.me/support/wpr-rucss-v2.php'`, `DEFAULT_PRESERVE_TOKENS` (the six default tokens above, why-comment each), `RESULT_STYLE_ID = 'rucss_test_result_style'` (id parity — external docs/greps against the shipped tool matter).
- [ ] `endpoint.ts` — `buildRucssTestUrl({ pageUrl, mobile, home, requestedAtUnixSec })`: byte-identical string assembly with the literal second `?` + unencoded page URL (parity — the server's parsing depends on it; do NOT "fix" the encoding gap without the live verification task below, and if it is verified unnecessary, the fix lands HERE as an upgrade with the endpoint's documented behavior).
- [ ] `transforms.ts` —
  - **One shared line-list parser** (pure, colocated here as the tester-safe variant): split on `\n`, collapse blank-line runs, drop empty lines, trim each line — replacing the source's lossy `getTextareaValueToArray` (CSV-unsafe, kept literal `\n\n` gap artifacts and empty lines). Both the RUCSS config lists AND P14's element-selectors list consume this one parser (tests pin: empty lines, whitespace-only lines, trailing newline, duplicate lines — deduped with order kept).
  - `compilePreserveList(userLines)`: always `DEFAULT_PRESERVE_TOKENS.concat(userLines)`; token match = substring of the style's serialized HTML, with the `id === 'wpr-usedcss'` carve-out addon `isStylePreserved(style, tokens)` (returns plain data via a light style descriptor — the removal executor stays DOM-thin).
  - `compileExcludePatterns(userLines)`: every line is a **raw regex** (source-parity semantics, now honestly documented); compile upfront, invalid patterns rejected at input time (see §3), pattern match applies to `link[rel="stylesheet"]` hrefs only.
  - `applyReplacements(css, pairs)`: ordered `g`-flag replaces returning `{ css, applied: number }`.
- [ ] `response.ts` — `parseShakenCssResponse(json: unknown)`: discriminates `code === 200 && typeof contents.shakedCSS === 'string'`; anything else → typed `{ ok: false, reason, detail }` results; caps the accepted CSS payload size (≤ 2 MB — reasonable used-CSS bound; rejection message names what arrived).
- [ ] `config.ts` — `RucssTestConfig` rich type (`safelist`, `inlinePreserve`, `excludeFiles`, `preAppend`, `append`, `replacements: { search; replace }[]`, `mobile`, `home`) + `parseRucssTestConfig` validator (string maxima, bounded replacement count) consumed by the storage item.

### 2. State: `lib/storage/rucss-tester.ts`

- [ ] `rucssTesterStore = storage.defineItem<RucssTestConfig>('local:rucss-tester-config', fallback: defaults)` — validator reuses `parseRucssTestConfig`; panel page + strip chip read it; panel writes on change (debounced); one store yields cross-site persistence the source's page-localStorage only had per-site.

### 3. Panel page `rucss-tester` (new route in `panel/routes.ts`)

- [ ] Form: Patterns to safelist · Inline CSS to preserve · Exclude CSS files · pre-append/append wrappers · search/replace rows editor (add row, remove row, per-row live regex validation with the inline-validation pattern already built for the Exclusion Builder) · `mobile` + `home` switches · "Run test" primary + "Inspect page styles" secondary. All config textareas auto-grow via the P5 form primitives (the source's hand-rolled `calcTextAreaHeight` was right in spirit — the design system owns that nicety now, no per-surface copy).
- [ ] Status area (third state machine enhancement): idle → running (disable Run, show "Endpoint: <built URL>" in a copy-only row — no page console) → success ("Injected" + styles-affected count) / error (typed reason: endpoint responded with code X · network failure · invalid response shape · replacements failed to compile) with per-reason recovery actions ("review exclude patterns", "reload page to restore styles" — the reload hint uses `browser.tabs.reload` from the devtools context; verified working without extra permission, else the page reload instruction text).
- [ ] "Inspect page styles": lists the live `style, link[rel="stylesheet"]` inventory (`tag/id/class/href` + inline preview) as resource rows — the honest upgrade of the console.table dump; uses the same data the strip's used-CSS test consumed.
- [ ] TEST MODE badge: after a successful run the CS's detections envelope gains `rucssTestMode: true`; the Detections page (P6 view-model) renders the RUCSS card's subtitle with "(TEST MODE)" and a tooltip naming the injected `style` id; cleared by page reload (fresh hub).
- [ ] The page warns before running twice in one load (second run strips the already-broken state — surface "the page is already in test mode; reload to start clean" requiring no extra clicks to proceed atomically).

### 4. Executor: `entrypoints/isolated.content.ts/rucss-test/` + background fetch

- [ ] Protocol rows (additive to the P1 map, each with validators + tests): `runRucssTest` (panel/strip → tab CS; no payload — config from storage; returns `RucssTestOutcome`), `fetchRucssShakenCss` (CS → background: `{ pageUrl, safelist, mobile, home, requestedAtUnixSec }` → `{ ok: true; shakenCss } | { ok: false; reason; detail }`).
- [ ] **The background fetches, not the page.** The content script hands the typed request to the background service worker, which builds the endpoint URL itself via `buildRucssTestUrl` **and validates `pageUrl` is http(s)** — the CS never dictates an arbitrary URL (no open-proxy hop through our extension), and page-level CSP/CORS quirks can never block the test (the source's content-script `fetch` rides the host page's CORS allowance).
- [ ] Executor steps on `runRucssTest`: load config → validate (compile preserve/exclude/replacements; failures return a typed outcome without touching the page) → background fetch → strip styles (live DOM; per-item preserve/exclude decisions from the compiled transforms) → inject `<style id="rucss_test_result_style">` with `preAppend + replacements.css + append` → set `rucssTestMode` on the hub envelope → respond.
- [ ] Failure atomicity: if the fetch fails or the response is invalid, **no styles are removed** (the source strips first, then fetches — a network error left users with a styleless page and a dead button, quirks #1/#2); the run order is fetch-then-strip-then-inject, documented as a deliberate sequencing delta.
- [ ] `wpr-usedcss` target: correctness of the source's carve-out is preserved (`#wpr-usedcss` is removed even if a preserve token matches it).
- [ ] Strip chip (P12) calls this identical executor with the persisted config; outcome → the strip's transient banner; a successful first run when no prior config existed still applies defaults (never the silent zero-preserve quirk #1).

### 5. Manifest, security, privacy

- [ ] `wxt.config.ts`: **no new permission needed** — the already-declared `https://*/*` host permissions cover `mega.wp-rocket.me` from the background; the phase verifies the fetch works in both browsers and updates the host-permission why-comment to name this use.
- [ ] Privacy note (README + this doc): running the test transmits the page URL (plus `mobile`/`home` flags) to WP Media's first-party support endpoint — user-triggered only, never automatic; the worldview of inspectors making similar calls matches. The payload never contains page DOM (only the URL + safelist strings).
- [ ] Endpoint contract verification task (do on a real page before shipping): confirm URL-with-querystrings handling through the literal second `?` separator, `&mobile`/`&home` flag parsing, and required valid non-200 behavior (empty safelist body `{}` accepted). Record outcomes here; any mismatch folds into `endpoint.ts` as an evidenced fix (or a blocker for the phase, recorded).

## Explicit enhancements over the inspector source

- Fetch-then-strip sequencing (no styleless page on network failure); explicit state machine (no latched button); boundary-validated response; preserve defaults always applied; replacement-pair validation before the run; background-side URL building/validation (the extension never proxies arbitrary URLs); endpoint URL surfaced in the panel, not the host console; "Inspect page styles" as a real browsable list; TEST MODE surfaces on the Detections page too; typed storage replaces page-localStorage CSV tricks; panel form + strip chip share executors and config (one behavior, two entries, no divergence).

## Tests

- `endpoint.test.ts` — identical-assembly assertions fixture (`mobile/home` toggles, unix ts), unencoded-URL parity documented; validation of http(s) pageUrl.
- `transforms.test.ts` — preserve semantics incl. the `wpr-usedcss` carve-out and the always-defaults fix (quirk #1); **line-list parser matrix** (empty lines, whitespace-only, trailing newline, dedupe-with-order); exclude lines compile to raw regexes (wildcard lines included — with the literal-regex assertion pinned, no re-introduction of the source's discarded-helper accident); replacement composition ordering + `g` flag; invalid search regex rejected pre-run.
- `response.test.ts` — success shape, non-200, malformed `contents`, oversized payload, stringy `code`.
- `config` + storage validator tests (hostile inputs: giant strings, prototype keys, wrong shapes).
- Executor integration (fake DOM + fake background): fetch-fail leaves page untouched; fetch-success strips correctly when multiple matches (preserve/exclude interplay incl. both default tokens + user line).

## Verification checklist

- [ ] Gates green; `pnpm check:budgets` unchanged for content scripts (executor ≤ 6 KB raw on top) and panel (page within panel budget; recorded in the table).
- [ ] Manual on a real WP Rocket site: default run produces RUCSS'd page matching the inspector's same-page results (run both in dev, compare visually + via `document.querySelector('#rucss_test_result_style')` existence and sheet size); safelist/mobile/home variants exercised (endpoint contract findings folded into `endpoint.ts`).
- [ ] Manual failure paths: airplane-mode run (styles intact, typed error), bad shape (mocked non-200 code via devtools override — record the how), invalid replacement regex (blocked pre-run with a report).
- [ ] TEST MODE badge appears on the Detections card; strip chip lands "(TEST MODE)" state once and never twice on repeat runs; reload clears both.
- [ ] Firefox smoke run: both fetch paths work (background fetch + no page CORS assumptions); the `mobile`/`home` flags compile identically.
- [ ] Copy review: no `TEST MODE` typos; error reasons self-explanatory; `browser.tabs.reload` answer recorded.

## Docs to update

AGENTS.md (host-permission why-comment mention from P13's endpoint use; the panel route registry note); README privacy note (endpoint data flow); master plan §9 row states.
