# Firefox runtime parity — diagnosis & fix plan

## TLDR

Firefox (temporary install) breaks for two proven root causes and one open diagnostic:

1. **No addon identity in the manifest.** `wxt.config.ts` declares no `browser_specific_settings.gecko.id`, so a temporary install has no stable addon ID and every `storage.sync` call **rejects** ("The storage API will not work with a temporary addon ID…"). Two surfaces die on it: the toolbar badge's option gate (`watchBadgeGate` → `getOptions()`), and the palette read inside `mountShadowUi` (`followStoredAppearance` → `optionsStore.getValue()`), which fails the whole mount of every injected UI — Side-by-Side, the PSI overlay, and the Known Conflicts UI. Proven empirically on Firefox 154: adding the ID makes `storage.sync` work in a temporary install.
2. **The badge writes use `browser.action`, which does not exist in Firefox MV2.** The namespace is `browserAction` there (proven: `browser.action` → `undefined`, `browser.browserAction` → object with `setBadgeText`/`setBadgeBackgroundColor`/`setBadgeTextColor`). Every badge write throws inside its own guard and is logged as "Badge update ignored" — the dot never renders even after cause 1 is fixed.
3. **The panel's "Couldn't load page data / The page could not be reached for its data."** — the transport primitives the panel uses are proven healthy on Firefox 154 (async responses, error envelopes, ≥2 MB payloads, both no-receiver shapes classify correctly), and the `getFdtData` handler cannot throw by construction. The one unverified context is the DevTools page/panel itself (cannot be automated headlessly). The panel logs the exact cause in the Browser Console (`[WPR FDT] [panel] Page-data request failed {cause}`) — one observation decides the fix (see P0/P4).

Fix plan: manifest identity (P1), cross-browser badge applier (P2), storage-failure degrade in the shared mount (P3), the panel cause fix once captured (P4), and a Firefox verification matrix + docs (P5).

**Strict gate:** none of this may negatively affect the Chromium build — the verifiable conditions live in "Strict gate" below; P5 fails without the Chromium regression proof.

---

## Strict gate — Chromium must not be negatively affected

The owner's gate for this workstream: **nothing here may negatively affect the Chromium build.** Every Firefox fix is paid for by Firefox-shaped code, never by Chromium behavior. The gate is not aspirational — it is a set of checks P5 must pass and record in receipts; a phase that cannot satisfy them is rejected, not traded:

1. **Manifest:** `.output/chrome-mv3/manifest.json` stays byte-identical to the pre-change output — the identity fields are scoped to Firefox (P1's task).
2. **Badge:** the applier resolves `browser.action` first, and on Chromium that resolution never changes — the `browserAction` fallback is unreachable on Chromium (P2's task).
3. **Mounted UIs:** the palette read's success path — the only path Chromium runs with healthy storage — keeps its exact current semantics (arm-first race logic, the read's role, the disposer contracts); only the rejection arm degrades (P3's task).
4. **Messaging:** any P4 fix stays additive — Chromium's send and classification behavior remains pinned green, unchanged, by the existing `lib/messaging` unit rows.
5. **Bundles & tests:** `pnpm build` + `pnpm check:budgets` hold their ceilings; the full Chromium e2e tier (`pnpm test:e2e`) passes with no row changed or relaxed (the never-modify-a-test rule applies).

A change that improves Firefox by regressing any of the above is rejected outright.

---

## Evidence (all verified, none assumed)

**Empirical probe — Firefox 154.0, temporary add-on (about:debugging-equivalent via `web-ext run`), MV2 manifest, 2026-10-13.** A scratch extension in the session temp dir (`opencode/ff-probe/`) replicated the exact primitives; results observed over a local HTTP sink:

| Probe                                                                              | Result                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage.sync.get` (no ID in manifest)                                             | **rejects**: "The storage API will not work with a temporary addon ID. Please add an explicit addon ID to your manifest." (the user's exact console error)                                                                                                 |
| `storage.sync.get/set` (with `gecko.id`)                                           | **works** (resolves; write ok)                                                                                                                                                                                                                             |
| `storage.local`                                                                    | works either way                                                                                                                                                                                                                                           |
| `typeof browser.action` (MV2)                                                      | `"undefined"`                                                                                                                                                                                                                                              |
| `typeof browser.browserAction` (MV2, `browser_action` declared)                    | `"object"`; `setBadgeText`, `setBadgeTextColor` are functions                                                                                                                                                                                              |
| `typeof browser.declarativeNetRequest` (MV2)                                       | `"undefined"` **without** the DNR permission declared; `"object"` (with `updateSessionRules`) **with** `declarativeNetRequestWithHostAccess` in permissions — the real manifest declares it, so the mobile-sim capability stands on Firefox as 05g planned |
| Tab send, callback style, `options` slot = `undefined` (the library's exact shape) | works; async `{res}` envelope arrives                                                                                                                                                                                                                      |
| Far-side handler rejection                                                         | arrives as `{err:{name,message,stack}}`; sender throws with the original message → classifies as a **real failure** (matches the panel's `REQUEST_FAILURE_CAUSE` mechanism)                                                                                |
| No-listener tab send                                                               | callback invoked with `response = undefined`, `lastError = null` → library folds to `Error("No response")` → classified no-receiver ✓                                                                                                                      |
| Runtime-wide send with no listener                                                 | "Could not establish connection. Receiving end does not exist." → classified no-receiver ✓                                                                                                                                                                 |
| 2 MB response through the tab port                                                 | delivered intact                                                                                                                                                                                                                                           |
| `world: "MAIN"` content scripts                                                    | supported since Firefox 128 (MDN / Firefox 128 release notes, bug 1736575) — not a Firefox delta on any supported floor                                                                                                                                    |

**BCD (mdn/browser-compat-data, `webextensions/api/browserAction.json`):** `setBadgeText` Firefox 45+, `setBadgeBackgroundColor` 45+ (tab-specific clearing fixed 58), `setBadgeTextColor` Firefox 63+. A `strict_min_version` of 128 puts all three inside the floor.

**Code paths (file:line, read from this repo):**

- `wxt.config.ts:13-44` — no `browser_specific_settings`. WXT itself warns about exactly this at build time ("Firefox requires extension ID for MV3 and recommends it for MV2").
- `entrypoints/background/badge.ts:176-200` — `applyBadgeEffect` writes via `browser.action.*`; every call throws on Firefox MV2 and is caught → "Badge update ignored". The badge never renders.
- `entrypoints/background/badge.ts:290-307` (`watchBadgeGate`) + `entrypoints/background/index.ts:157-164` — `getOptions()` rejection resolves the gate to "unresolved" → the model records summaries but renders nothing (`badge.ts:123`: `if (this.#gate !== true) return null`). The gate's `optionsStore.watch` never arms either.
- `entrypoints/isolated.content/ui/mount.ts:42` → `entrypoints/isolated.content/ui/live-theme.ts:77-100` — the mount awaits the stored appearance **before** rendering; a rejected `optionsStore.getValue()` unwinds and **rethrows**, failing `mountShadowUi`. That is the "Mounting the side-by-side overlay view into the shadow root failed" + "The overlay view failed to mount — the open degraded, nothing shown" pair (side-by-side `index.tsx:392-404, 493-499`) and the Known Conflicts mount failure (`known-conflicts/index.tsx:156-168`).
- `entrypoints/isolated.content/side-by-side/index.tsx:365-380` — the settings read degrades correctly (defaults, logged) — the overlay's own failure is purely the palette read in the mount.
- `entrypoints/panel/state/edges.ts:89` + `lib/messaging/index.ts` — the panel's request is `sendMessage('getFdtData', undefined, tabId)`; the transport wraps callback-style `chrome.tabs.sendMessage` (proven healthy above).
- `entrypoints/panel/state/use-fdt-data.ts:79,135-145` — `REQUEST_FAILURE_CAUSE` is rendered only for a rejection that does **not** classify as no-receiver; the same failure logs `Page-data request failed {cause}` in the Browser Console (the panel is an extension page; its console is not the tab's).
- `entrypoints/panel/state/fdt-state-machine.ts:69-104` — no timeout exists, so an error card means the flight really settled with a rejection.

**Context from the port plans:** the Firefox runtime pass was scheduled as P15's manual matrix (`16-phase-15-hardening-release.md`: "Firefox E2E: every surface smoke-tested…; known FF deltas documented") and never executed; P0's foundations note explicitly deferred the MV2-vs-MV3 and identity questions to P15. This plan executes that deferred work as a dedicated workstream, ahead of or as part of P15.

---

## Stack

No new dependencies. WXT manifest config (identity), TypeScript 5.9, Vitest 5 (+ `@webext-core/fake-browser` doubles), `web-ext` for the manual Firefox matrix. Firefox floor: **128** (`world: "MAIN"` requirement, bug 1736575); the gecko `strict_min_version` encodes it.

## Phases

### P0 — Capture the panel's failure cause on Firefox (diagnostic, no code)

**Depends on:** nothing. **Parallel with:** P1, P2, P3.

1. `pnpm build:firefox` → load `.output/firefox-mv2` via about:debugging.
2. Open the **Browser Console** (Ctrl+Shift+J), reproduce the panel error, and copy every `[WPR FDT]` line — especially `[panel] Page-data request failed` with its `cause` (and `[devtools]`/`[background]`/`[badge]` lines around it).
3. Note the Firefox version and whether the inspected tab had the content script alive (the tab console's `[WPR FDT] Page data processed` line).

**DoD:** the panel failure's exact cause string is recorded here (append to this doc's receipts). The fix branch of P4 is selected from it:

- cause message **matches a no-receiver text** → P4-A (classification gap: add the missing pattern to `lib/messaging/no-receiver.ts` + tests);
- **any other message** → P4-B (the named fault fixes where it names);
- **no warn line at all** → the flight never settled in the devtools context → P4-C (devtools-context transport probe from a real devtools window; the scratch probe's `devtools.js` is the template).

### P1 — Manifest: Firefox addon identity

**Depends on:** nothing. **Parallel with:** P0, P2, P3.

- `wxt.config.ts`: add `browser_specific_settings` with `gecko.id` + `gecko.strict_min_version: '128.0'`. Proposed ID (owner-decidable — it becomes the sync-storage identity and the AMO identity): `wpr-front-debugging-tool@wp-media.com`. Keep it valid (GUID or `id@domain`).
- Chrome ignores `browser_specific_settings`; verify the chrome-mv3 manifest is byte-identical to today's apart from nothing (WXT passes the field through; Chrome build should not carry it if WXT scopes per browser — check the emitted chrome-mv3 manifest; if it carries the key, scope it via WXT's per-browser manifest hook).
- Release note (non-blocking here, blocks AMO submission later): Firefox requires `gecko.data_collection_permissions` for new submissions since 2025-11 — covered by P15's release rows, linked doc in WXT's own build warning.
- Manifest tests: a unit row asserting the emitted firefox-mv2 manifest carries the ID and floor (match how existing suites inspect built manifests, if a pattern exists; otherwise a build-output check inside P5's verification).

**DoD:** `pnpm build:firefox` manifest contains `browser_specific_settings.gecko.id` + `strict_min_version: '128.0'`; `.output/chrome-mv3/manifest.json` stays byte-identical to the pre-change output (strict gate #1); `compile`/`lint`/`format:check`/`test` green.

### P2 — Toolbar badge: cross-browser action applier

**Depends on:** nothing. **Parallel with:** P0, P1, P3.

- `entrypoints/background/badge.ts`: resolve the action namespace once — `browser.action` when present (Chromium), else `browser.browserAction` (Firefox MV2) — behind a small typed structural interface (the four calls this module makes); throw a named, actionable error at init when neither exists (fail fast per the error-management rule; `bootBadge`'s existing degrade path turns it into a never-rendering session).
- Namespace order is `action` first: Chromium's path is the pinned, tested one and the fallback is unreachable there (strict gate #2).
- `setBadgeTextColor` is inside the FF 128 floor and used only as chrome-chrome presentation; keep the call (no extra detection needed at the declared floor).
- Keep the pure state machine untouched (it never touches the namespace — by design).
- Unit rows: the applier against a fake exposing only `browserAction` (the Firefox shape) and only `action` (the Chromium shape); the neither-case error.

**DoD:** unit tests cover both namespace shapes + the missing-both degrade, and the Chromium shape's outcomes are pinned unchanged (strict gate #2); all gates green.

### P3 — Injected-UI mount: degrade on a failed palette read

**Depends on:** nothing. **Parallel with:** P0, P1, P2.

- `entrypoints/isolated.content/ui/live-theme.ts` / `mount.ts`: a rejected appearance read stops being a mount-fatal error. Degrade: apply the token default (`system` — `FALLBACK.appearance`), keep the write-follow armed (a later successful write re-applies the stored choice live — the race counter semantics already handle a write landing during the read window), render the view, log once at warn.
- The mount's disposer/teardown contracts stay exactly as they are (the follow stop handle folds in unchanged).
- Strict gate #3: the success path — the only path Chromium runs with healthy storage — keeps its exact current semantics (arm-first race logic, the read's role, the disposer contracts); only the rejection arm degrades.
- The side-by-side degrade branch (`index.tsx:392-404`) then only fires for real render crashes, as its comment already intends.
- Unit rows: read-rejection → view still mounts, container carries the default declaration, the follow still applies a later write; no exception escapes.

**DoD:** with a sabotaged (rejecting) options source, every injected UI still mounts with the default palette; the success path's semantics unchanged (strict gate #3); gates green.

### P4 — Panel page-data fix (branch chosen by P0)

**Depends on:** P0 (the cause string), and P1 only insofar as storage corruption was a candidate. **Parallel with:** nothing (last code change).

- **P4-A** — a no-receiver text Firefox produces that the patterns miss: add the captured string to `lib/messaging/no-receiver.ts`'s patterns (the array is the one declaring site) + unit rows for the captured message shape.
- **P4-B** — a named real fault: fix where the message names it; add the regression row at that boundary.
- **P4-C** — the flight never settles in the devtools context: exercise the scratch probe's `devtools.js` from a real devtools window to pin the context's transport behavior, then fix the sender side (e.g., context-specific divergence handling in `lib/messaging/`), never the validator (it is transport-agnostic by contract).
- Chromium's sender/validator behavior stays pinned by the existing `lib/messaging` unit rows — a Firefox-only divergence fix touches Firefox-shaped paths or adds additive patterns, never Chromium semantics (strict gate #4).

**DoD:** the panel loads page data from the inspected page on Firefox (docker site + one public site); the error state remains reachable only in its expected standalone/no-content-script form; the messaging unit rows stay green unchanged (strict gate #4); gates green.

### P5 — Firefox verification matrix + docs

**Depends on:** P1-P4. **Parallel with:** nothing (final).

0. **Chromium regression proof (the strict gate — runs first; P5 fails without it):** `.output/chrome-mv3/manifest.json` byte-diffed clean against the pre-work build; the full e2e tier (`pnpm test:e2e`) green with no row changed or relaxed; `pnpm build` + `pnpm check:budgets` within ceilings; the toolbar-badge dot spot-checked on Chromium.
1. Manual matrix on Firefox (temporary install, then optionally a real profile):
   - toolbar badge: green dot on the WP site, gray on a non-WP page (requires P1+P2 together);
   - context-menu Side-by-Side opens the overlay (and its scroll-sync leg works);
   - PSI Side-by-Side: the PSI tab opens and its overlay mounts;
   - Known Conflicts UI mounts and scans;
   - the panel loads page data; palette cycle in the panel restyles a mounted overlay live;
   - device simulation (DNR present on Firefox per the probe): the mobile switch renders and the session rule applies — the recorded manual smoke 05f owed;
   - the MAIN-world capture smoke (undefined references on a page that throws) — the P4-main-world doc's pending live-injection item.
2. Document the known Firefox deltas in the README (the P15 row's substance): identity requirement, MV2 namespaces (`browserAction`, permission-gated DNR), `world: "MAIN"` floor 128, and anything P0 surfaced.
3. Full gates: `compile`, `lint`, `format:check`, `test`, `build`, `check:budgets`, `build:firefox` green; no budget changes expected (manifest-only + a few bytes in the background/chunks).

**DoD:** every matrix row recorded here (receipts section) as pass/fail with notes — the Chromium regression proof (strict gate) recorded first; docs updated; all gates green.

---

## Risks & notes

- **The addon ID changes sync-storage identity.** A user who synced options under a previous (real) install keeps them only if the ID matches; this is a pre-release project (version 0.0.0), so the choice is free now and expensive later — decide once, in P1.
- **`strict_min_version: '128.0'`** is justified by `world: "MAIN"` (bug 1736575); it also puts every used badge method inside the floor. If the floor ever drops below 128, the MAIN-world entries need a real fallback path (out of scope here).
- **The panel's no-timeout hang** (a flight that never settles spins "Loading page data" forever) is out of scope unless P0 shows it is the actual failure mode (P4-C) — then the transport fix comes first and a settle timeout is a follow-up proposal, not a silent patch.
- **`chrome.*` dependency of `@webext-core/messaging`** (the library binds the callback-style namespace directly): proven present and functional in Firefox MV2 for every primitive used, including from content scripts. No transport change is planned. If P4-C shows the devtools context diverges, the fix stays in this repo's sender edges, not a library fork.

## Receipts

_(append execution outcomes per phase here)_
