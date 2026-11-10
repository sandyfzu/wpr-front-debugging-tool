# AGENTS.md

Operating guide for AI agents (and humans) working in this repository. Keep it accurate and in sync with the code — see [When to update this file](#when-to-update-this-file).

## Project Overview

Browser extension for debugging the [WP Rocket](https://wp-rocket.me) WordPress plugin on the front end. This repo is a **modernized port** of the legacy project [wpr-front-debugging-tool-legacy](https://github.com/wp-media/wpr-front-debugging-tool-legacy) (you might find it at `../wpr-front-debugging-tool-legacy`, check) (WXT + React 18): same feature set + new features, rebuilt on a faster stack (WXT + SolidJS). Legacy entrypoints being ported: `background`, `devtools`, `exclusion-builder` (re-planned as the in-page overlay `exclusion-overlay.content/`), `fdt` (main UI, shown as the devtools panel — ported as `panel/`), `options`, `popup`, and two content scripts (isolated world + main world — ported as `isolated.content.ts` / `main-world.content.ts`).

A **second behavioral baseline** is also being integrated: the features of [wpr-inspector](https://github.com/wp-media/wpr-inspector) (you might find it at `../wpr-inspector`, check) — WP Rocket feature detection via the `data-wpr-features` generator meta, an on-page detection strip, the RUCSS live tester, and the runtime analysis tools (beacon/LCP/script views). Same rules apply: port behavior, improve and enhance, never copy; that baseline is planned as phases P11–P14 in `docs/plans/`.

> **Porting rule:** treat both source repos as the **behavioral** reference, not the code reference. Port features by their observed behavior — verify parity against a real build of the source you are porting (`pnpm dev` + load both builds and compare), never from memory of its code. It must also aim to be faster and more efficient than any source surface, so don't blindly port inefficient patterns, always improve and enhance.
>
> **Never port structures as-is.** A source repo's type shapes, file layout, registries, and the names of types, properties, variables, constants, and functions are a starting point to reshape, never a spec to copy: rework them into the port's clearer shape and intent-revealing names (only behavior and user-facing strings stay identical). When a ported surface looks "the same, just renamed", the port didn't happen.
>
> **No legacy in code — ever.** Code and comments in this project must never mention either source project or their code: no `legacy`/`inspector`-origin identifiers, strings, comments, TSDoc, or error messages referencing legacy files, functions, or behavior. Name things by what they do; provenance, mappings, parity proofs, and bug references live in `docs/plans/` — and only there.

## Key technologies

| Area      | Tech                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime   | **Node** 24 (`.nvmrc`, major only; floor in `engines`), **pnpm** (pinned in `packageManager`) — lockfile is the source of truth, never `npm`/`yarn`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Framework | **WXT** (extension framework, generates the manifest) + **SolidJS** (fine-grained reactivity)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Language  | **TypeScript**, strict — stay on **5.9.x**: `typescript-eslint` peer-caps TS `<6.1.0` while npm `latest` is already TS 7; revisit when `typescript-eslint` supports it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| UI        | **`@kobalte/core`** (pinned minor `0.13.x`, installed 0.13.14 — the 2.0 line is unported alpha) wrapped by `components/ui/*` and **never imported elsewhere** (lint-guarded); **`lucide-solid`** (1.55.x) for icons — imported **per icon** from `lucide-solid/icons/<kebab-name>` (default export), never the barrel: the barrel's `solid` condition serves ~1700 raw JSX source files, which an unbundled dev session fetched per request (measured: 2145 of the panel's ~2300 dev-server requests; per-icon imports cut the dev panel load to 174 requests; production bundles/tree-shakes either way). `import type { LucideIcon }` from the barrel stays fine — type-only imports are erased                                                                                                                                                                                                                                                                                                                                                          |
| Code/JSON | **`shiki`** (4.5.x, fine-grained `shiki/core` + JS regex engine + the `javascript`/`json` grammars and the `github-light`/`github-dark` pair — statically imported only by `components/ui/code-block-highlighter`, which runs **only in the highlight Web Worker** (`components/ui/code-block-highlight.worker.ts`, spawned via `new Worker(new URL(…, import.meta.url), { type: 'module' })`; `components/ui/code-block` talks to it through the shiki-free `code-block-worker-client`, which time-boxes each block and terminates a runaway worker; pages import the language table from the shiki-free `components/ui/code-block-langs`) and **`@tanstack/solid-virtual`** (3.13.x) for the `components/ui/virtual-list` wrapper — so all of shiki ships as the worker bundle (`assets/code-block-highlight.worker-*.js`, its own `scripts/budgets.json` row), never in a consumer's chunk nor on the main thread; `@solid-primitives/intersection-observer` deliberately not taken (a ~10-line gate util is the dependency-lighter fix for master #24) |
| Styling   | **Tailwind CSS v4** — design tokens in `assets/css/tokens.css` (`@theme inline` over `light-dark()` values in `theme.css`; appearance = `system`/`dark`/`light` via `[data-theme]`; `tokens.css` is the module injected UIs import so shadow roots get the same values)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tests     | **Vitest 5** + `@solidjs/testing-library` + `happy-dom` (+ `vite-plugin-solid` compiles Solid JSX in the test runner — declared in `vitest.config.ts`, since WXT's vitest plugin does not merge the solid module's vite config); coverage thresholds gate `lib/**` + `utils/**` (see [Commands](#commands)). Browser tier: **@playwright/test** in `tests/e2e/` — headless Chromium with the unpacked extension (`E2E_HEADED=1` for headed), `*.spec.ts`, **local-only, never in CI** (see `tests/e2e/README.md`), with **axe-core** as the dev-time a11y engine the existing `panel-a11y` spec injects into the page under test (never a bundle input; no new axe assertions — see Accessibility)                                                                                                                                                                                                                                                                                                                                                         |
| Targets   | Chromium-based browsers (primary; Manifest V3, `minimum_chrome_version: 145`); Firefox secondary, `strict_min_version: 150.0` (owner-chosen explicit floor) + add-on id `{f6991cc9-09e3-43d0-a6dd-4aae5f676452}` (owner-chosen GUID, permanent once on AMO; both Firefox build only, `wxt.config.ts`) — see Cross-browser compatibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Messaging | **`@webext-core/messaging` v4** (extension-wide) + its `page` subpath for the MAIN↔isolated-world window bridge — contracts live in `lib/messaging/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Beacon    | **`wp-rocket-scripts`** (exact-pinned 1.2.2, ISC, no dependencies) — WP Rocket's own beacon, run by the beacon test; imported **only** by `entrypoints/beacon-runner/beacon-adapter.ts` (lint-guarded: a per-instance subclass, never a prototype patch, overrides its site requests/save/finalize/console), so its bytes ship only in the unlisted `beacon-runner.js` the background injects on the first test (budget row ≤ 30 KiB raw); upgrade = re-read the package source and re-verify the adapter's overrides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Build     | Vite (via WXT)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Repository structure

WXT conventions govern the layout — follow them, don't invent a new one. The manifest is generated from `entrypoints/` into `.output/**` — never hand-edit it there.

```
├── docs/                      # the port plan (master + phase docs) + `ui-ux-bar.md` (linked from this file)
├── public/                    # copied to the build output as-is (icons, …)
├── assets/                    # bundled assets: images, fonts, `assets/css/theme.css` design tokens
├── entrypoints/               # one folder/file per extension surface
│   ├── background/            # service worker — listener wiring only; logic lives in lib/
│   ├── popup/                 # browser-action popup
│   ├── devtools/              # registers the devtools panel (points at panel.html)
│   ├── panel/                 # main debugging UI, shown as the devtools panel (panel.html)
│   ├── options/               # options page
│   ├── isolated.content.ts    # content script — isolated world
│   │   │                      #   (WXT folder form: `isolated.content/index.ts` entry +
│   │   │                      #    colocated feature modules; see docs/plans for the list)
│   ├── exclusion-overlay.content/ # runtime content script (`registration: 'runtime'`, never in the
│   │                          #   manifest): the in-page exclusion builder overlay, injected into a
│   │                          #   tab's top frame on open (`scripting.executeScript`) so its code
│   │                          #   costs pages nothing until then; the background re-opens it on a
│   │                          #   session tab's loaded pages (`lib/exclusion-session/overlay-reopen`)
│   ├── command-palette.content/ # runtime content script (`registration: 'runtime'`): the on-page
│   │                          #   command palette's view (combobox + dialog), injected into the top
│   │                          #   frame on the first open (asked by `isolated.content/palette/`, which
│   │                          #   keeps the gate, the receiver and the executors) — pages pay nothing until then
│   ├── beacon-runner/         # unlisted script, injected into the top frame on the first beacon test:
│   │                          #   publishes the runner bridge (`lib/beacon-test/runner-bridge`) + the package adapter
│   ├── exclusion-transform-worker.ts # Firefox-only unlisted script: the exclusion engine's Web Worker
│   │                          #   (the background preempts a runaway row by terminating it)
│   ├── main-world.content.ts  # content script — MAIN world (undefined-references capture)
│   ├── ua-relay.content.ts    # content script — isolated world, all frames;
│   │   │                      #   device-sim relay: cached boot ask + live pushes (`ua-relay/`)
│   └── ua-identity.content.ts # content script — MAIN world, all frames;
│                              #   `navigator.userAgent` shadowed per the sim state (`ua-identity/`)
├── components/                # Solid components shared by ≥2 entrypoints
│   ├── ui/                    # design-system primitives
│   └── injected-ui/           # shadow-root mount + cycled surface (one host per surface across hide → show), live appearance, input-event isolation, key guard, top-layer z-order + runtime-overlay mount for UIs injected into host pages
├── lib/                       # domain modules — logic + types + data, pure and testable
│   ├── messaging/             # typed message contracts + boundary validation
│   ├── storage/               # typed storage items (storage.defineItem)
│   ├── detection/             # WP Rocket footprint detection
│   ├── exclusion-builder/     # pure exclusion engine: WP Rocket's row save + match semantics, the
│   │                          #   four transforms, one pipeline (+ PHP parity table and fixtures)
│   ├── exclusion-session/     # backend-agnostic interception session: controller, state machines,
│   │                          #   charset round trip, budgeted document step, CDP + stream backends
│   ├── wp-rocket-simulation/  # WP Rocket simulation (P21): the simulation data file's format + reader, the plugin-oracle
│   │                          #   table (`simulation-parity.fixtures.json`, dev/test only)
│   ├── page-commands/         # the on-page command vocabulary (labels the menu + palette share), the
│   │                          #   palette's executor contract and the view↔module bridge
│   ├── beacon-test/           # beacon test config/result validation + runner bridge; live-analysis
│   │                          #   siblings: `lcp-analysis/`, `script-runtime/`, `web-vitals/` (current visit)
│   └── <domain>/              # one folder per feature; its data files colocated
├── utils/                     # generic, feature-agnostic pure helpers
├── scripts/                   # repo tooling (budget gate etc.); `scripts/budgets.json` is the committed budget table
├── docker/                    # local WP site: compose stack (WP+MariaDB+wp-cli bootstrap, `apache/` conf), lifecycle + smoke
│   │                          #   + conflict-derivation scripts, mu-plugin + edge-layer fixtures, KC conflict list —
│   │                          #   machine state (`.env`, the `apvm`-built zip, `docker/certs/`, `docker/state/`) is git-ignored
├── tests/e2e/                 # the browser-test tier (Playwright, headless Chromium + unpacked extension; `*.spec.ts` suites, fixtures, harness README — local-only, never in CI)
└── wxt.config.ts              # manifest fields, permissions (each with a why), modules
```

- **Dependency direction:** `entrypoints/` → `components/` → `lib/` → `utils/`, never upward. Enforced by `no-restricted-imports` rules in `eslint.config.js`.
- **Entrypoints are thin wiring:** bootstrap, `defineXxx`, mount UI, register listeners. Code used by a single surface is colocated in its entrypoint folder; promote it to `components/` or `lib/` the moment a second surface needs it.
- **Panel tool pages stay off the panel's start:** a tool route's body is `lazyPage(...)` (`entrypoints/panel/pages/lazy-page.tsx`, fetched at the first idle moment or first visit) importing a one-line `pages/<route>/<route>.ts` entry, so the chunk is named `chunks/<route>-*.js` with its own `required` `scripts/budgets.json` rows (both builds). Tool forms share `pages/settings/` (stored settings + debounced writer + save line, store via `lib/storage/validated-config-store`), outcomes `pages/outcome-notice.tsx`, lists `pages/resource-list/filtered-list.tsx`.
- **`lib/` modules are self-contained:** each owns its logic, types, and data. No shared grab-bag files (`Globals.ts`/`Types.ts` are legacy patterns — don't port them). Cross-surface types are contracts in `lib/messaging/` and `lib/storage/`. Constants live with the module that owns the concept.
- **Tests:** unit tests colocated as `*.test.ts` next to the code they test; the browser tier (`*.spec.ts`) lives in `tests/e2e/` (see its README).
- `public/` is copied as-is; `assets/` is imported and bundled.

### Exclusion Builder sessions (runbook)

- **Apply modes:** Apply arms an interception session for the tab and reloads it; the served HTML is rewritten before parse — Chromium: `debugger` + CDP `Fetch` (in-process engine, 2 s budget between steps), Firefox: `webRequest.filterResponseData` (engine in `exclusion-transform-worker`, preempted at the budget). Unavailable interception (attach denied, debugging policy, cancelled infobar, detached, unsupported page or browser, session limit) is a warning state naming cause + remedy (Retry when transient) — there is **no fallback**. A session lasts across the tab's navigations until Stop, tab close or extension reload.
- **DevTools interplay:** the mode is decided by attempting the attach, never assumed; on Chromium the attach worked with DevTools open (CDP is multi-client; stable-Chrome manual check open in P15B). The panel shows the session in its status strip and detection cards ("Disabled in this tab by the Exclusion Builder").
- **Reset / Stop:** Reset is held while the draft equals the applied set; with edits it discards them and re-applies the session's stored set. Stop ends the session without navigating (the rewritten page and the draft stay); the next load is served as WP Rocket serves it.
- **Page records:** every page of the session's origin loaded in the tab gets exactly one record — rewritten, or served unmodified with its reason (past its time bound, a response the engine never rewrites such as a `206` or XHTML, a network error, …); a response the browser does not render inline (a download: `attachment`, or a type outside `rendersInline` — e.g. a zip, an octet stream, a missing type) is never recorded, so it cannot overwrite the visible page's record. Every pass of a session page on the session's origin is logged at info (`Session page served as received`, origin + path only). A page loaded after Apply whose record never lands (e.g. a failed session read) shows "No result for this page" once the record wait passes (`documentRecordWaitMs`, `lib/exclusion-session/document-hold.ts`): Reload, Stop or Re-apply — never an endless "waiting".
- Decisions, limits + open items: [`docs/plans/completed-exclusion-builder.md`](docs/plans/completed-exclusion-builder.md).

## Commands

```bash
pnpm dev             # dev build + watch → load .output/chrome-mv3 unpacked
pnpm dev:firefox
pnpm build           # production build   (pnpm build:firefox)
pnpm zip             # production build + store zip (pnpm zip:firefox for Firefox)
pnpm compile         # tsc --noEmit — type check
pnpm lint            # eslint — strict typescript-eslint + Solid rules + dependency direction
pnpm lint:fix        # eslint --fix
pnpm format          # prettier --write .
pnpm format:check    # prettier --check .
pnpm test            # vitest run with coverage — the test gate; thresholds over lib/** + utils/** fail below 90 % (lines/functions/branches)
pnpm test:watch      # vitest in watch mode (no coverage in the loop)
pnpm test:coverage   # same as pnpm test, for when `test` is re-pointed later
pnpm test:shard --shard=<i>/<n> # one CI test shard: coverage collected, thresholds off (a shard can't meet
                     #   the aggregate floor), Vitest blob written to `.vitest/blob/` (git-ignored)
pnpm test:merge      # merges the `.vitest/blob/` blobs: full report + the 90 % thresholds on the merged coverage
pnpm test:e2e        # browser-test tier (tests/e2e/): Playwright, headless Chromium + the unpacked extension; E2E_HEADED=1 for headed, local-only — rebuilds a stale `pnpm build` or fails fast with the diff (`E2E_BUILD_STRICT=1` opts into fail-fast)
pnpm bench:detection # checks-phase speed gate: port vs reference engine over the fixture corpus (local only, never CI)
pnpm check:budgets   # measures built surfaces against scripts/budgets.json — run after pnpm build, on the
                     #   .nvmrc Node (gzip sizes depend on its zlib: another major is refused); a row with
                     #   `required: true` fails unless each of its globs matches exactly one built file
pnpm parity:wp-rocket # WP Rocket parity tables (lib/exclusion-builder/wp-rocket-parity.fixtures.json + lib/wp-rocket-
                     #   simulation/simulation-parity.fixtures.json) + the generated simulation data file (public/wp-rocket-
                     #   simulation/simulation-data.json) and packaged LazyLoad runtime (public/wp-rocket-simulation/<jsPath>,
                     #   WP Rocket's bytes, pinned in the data file; lint/format-ignored): re-derives their
                     #   expected outputs with the real plugin under `php -n -d pcre.jit=1` (needs PHP >= 8.1 + ext-dom/mbstring,
                     #   compiled in or shared, `unzip`, one pinned zip per supported version (lib/wp-rocket/versions.ts)
                     #   at docker/wpr/wpr-rocket-<version>.zip; network on the first run only — the pinned WordPress
                     #   zip is then cached in .cache/) — fails when stale; --write regenerates; --ci / --compare
                     #   --zip <zip> / --release-check are the parity workflow's modes (see its header)
docker/scripts/up.sh # local WordPress debugging site lifecycle — up / down.sh / reset.sh; URLs, credentials
                     #   location, reset semantics, scenario flags, apvm build path: docs/local-site-runbook.md
```

CI (`.github/workflows/ci.yml`) runs, in parallel, `checks` (`compile` + `lint` + `format:check` + `build` + `build:firefox` + `check:budgets`) and `tests` (3 × `test:shard`), then `coverage` (`test:merge`: fails on any failed test, missing blob/shard or merged coverage below the floor) — `gates` is the one required check, red when any of them is not green — on every PR and push to `main`/`develop`, and on demand via `workflow_dispatch` (Actions tab, or `gh workflow run ci.yml --ref <branch>`; `-f ref=<branch|tag|sha>` tests a different ref); a newer push to a PR cancels that PR's older run; `main`/`develop` and manual runs are never cancelled. `test:e2e` is deliberately **never wired into CI** (it needs this machine's real Chrome build and the docker site — the owner's environment contract; see `tests/e2e/README.md`); `bench:detection` stays local too. A separate, informational workflow (`.github/workflows/wp-rocket-parity.yml`, not a required check) builds every supported WP Rocket version (`lib/wp-rocket/versions.ts`, owner-pinned) with a pinned APVM and runs `parity:wp-rocket --ci` under each (fails on a stale table or data file, or reference drift), warns (never fails) when a release tag newer than every supported version, or a newer patch of a supported minor, exists — release flags ignored — and `--compare`s the newest such tag (warnings only) — on PRs and pushes to `main`/`develop`/`feat/**` touching the parity files, weekly, and on dispatch (`gh workflow run wp-rocket-parity.yml --ref <branch>`; cron and dispatch work only once the file is on `develop`, GitHub's default branch).

## Non-negotiable rules

### Never guess — verify

Do not guess, suppose, or assume. Always verify, validate, confirm, and fact-check, e.g.:

- **APIs & libraries:** confirm signatures and options against the installed package (read it in `node_modules/`) or the current official docs (WXT, SolidJS, MDN webextension APIs). Training memory is not evidence.
- **Behavior:** confirm against the legacy extension or a real run before declaring parity or a fix done.
- **Facts you state:** paths, line numbers, command names, config values — read them, don't recall them. If you cannot verify something, say so explicitly instead of asserting it.

### Quality bar

The project must be stable, reliable, secure, safe, production-ready, well documented, and well tested:

- **No half-finished paths.** Handle edge cases and errors explicitly; fail fast with actionable messages that name the offending input.
- **Least privilege.** Request only the manifest permissions and host permissions actually used; each one gets a comment in `wxt.config.ts` explaining why. Never add permissions "just in case". (`declarativeNetRequestWithHostAccess` is the deliberate variant choice for the simulated-device sessions: same capabilities as the base permission, no install-time warning, and its rules act only within the already-declared host permissions. `debugger` — Chromium build only — is the one way to rewrite a top-level document before parse (CDP `Fetch`) for the Exclusion Builder; install warnings "Access the page debugger backend" + "Read and change all your data on all websites", plus Chrome's debugging infobar while attached; owner-accepted while store review allows it.)
- **Dependencies: latest stable.** Any dependency added to the project MUST be the latest stable version (`latest` dist-tag) unless it is incompatible with the installed stack — verify `engines` and peer ranges before adding. Never add outdated versions "just in case".
- **Budgets.** `scripts/budgets.json` ceilings are guards, not caps on features: when justified growth of well-written, production-ready code reaches a row, trim obvious waste first, then raise it (measured + ~3 % headroom, cause in the commit). Owner pre-approved; never ask.
- **Security.** Never log or persist sensitive data. Validate untrusted input — page DOM, `storage`, message payloads — at the boundary before use.
- **Content scripts must never break the host page.** They run on sites being debugged: wrap risky work, clean up listeners/observers, and keep main-world vs isolated-world responsibilities explicit.
- **Injected UI is fully shadow-isolated.** Every UI injected into a host page (strips, badges, overlays) lives inside its own shadow root (WXT `createShadowRootUi`), with its own adopted styles — never un-scoped CSS, never host stylesheets, never page globals invading in or out.
- **Tests & testability.** Design for unit testing by default: keep logic (parsing, detection, messaging/storage contracts, exclusion rules, decisions) in pure functions/modules, decoupled from I/O, DOM, `browser.*` APIs, and UI — inject or pass dependencies instead of hardcoding them. Unit-test all such logic; test first, not as an afterthought. The only acceptable exceptions are thin UI glue and entrypoint wiring — a limitation, never a design goal. When code is hard to unit test, restructure it until it isn't (or justify why it can't be).

### Extensibility & maintainability

The extension must stay **easily extensible and cheap to maintain**: adding a feature is a local, predictable change; removing or reworking one never breaks its siblings.

- **Locality.** A new feature lands as a self-contained `lib/<domain>/` module (logic, types, data, tests) plus its thin wiring in the owning surface — never by reaching into or editing other features' internals. Single-surface code stays in its entrypoint; promote when a second surface needs it.
- **Registries over branching.** Anything that comes in "many of a kind" (detection checks, message channels, storage items, exclusion rules, panel pages/tabs, options rows, context menus…) is defined in one typed table/list owned by the module that owns the concept, and consumers map over it. Adding one = adding one row + its tests, not new `if`/`switch` arms sprinkled across surfaces.
- **One declaring site.** A constant, data table, regex/selector, type, or helper is declared exactly once — in the module that owns the concept — and imported wherever it is needed. The same value re-typed in a second file under any name (e.g. `DELAYJS_SRC` next to `DELAY_JS_SRC`) is a defect: move it to its owner and import. Sanctioned exceptions: test assertions may repeat literals to pin behavior; the test-only reference engine (`lib/detection/reference/`) shares its vocabulary and contract types from `lib/wp-rocket/` and deliberately duplicates only control flow (its whole job is to be an independent implementation the port is compared against); standard web-platform literals (tag names, universal attributes like `src`/`defer`/`rel`) stay inline.
- **Stable, additive contracts.** `lib/messaging/` and `lib/storage/` are the seams every feature plugs into: evolve them additively, validate with discriminated types, and read back tolerant of unknown fields so new data never breaks existing consumers.
- **Deletability is the test.** A feature is properly isolated when removing it = deleting its folder + its registry entries. If removal cascades into unrelated files, fix the structure before building on top of it.
- **Extensible ≠ speculative.** Prefer the smallest structure that makes the _next_ feature a local change; introduce a registry or abstraction when the second instance of a concept appears, never "just in case".

### Error management

Extension surfaces fail differently from web apps (asynchronous API errors, listeners, cross-world hops, extension reloads mid-flight) — handle them deliberately, never incidentally:

- **Every extension API call is failure-aware.** Promise-style (the default via WXT's `browser`) — always `await` and branch on rejection; never fire-and-forget a promise (unhandled rejection). Callback-style APIs — check **`runtime.lastError` inside the callback**; it is set on error and cleared when read, and leaving it unread raises "Unchecked runtime.lastError" console errors. Where both styles exist, prefer promises.
- **Branch ≠ throw, expected ≠ unexpected.** Expected failures (tab closed mid-query, content script not injected yet, extension context invalidated after reload, missing/corrupt storage, invalid untrusted payload) are results — branch, recover, or degrade explicitly. "Couldn't run at all" (bad arguments, broken invariant) throws — fail fast with a message naming the offending input. Best-effort side work must never mask a real failure.
- **No silent failures.** No empty catch blocks: every catch branches, logs with context, rethrows, or degrades explicitly. Log under one stable prefix (`[WPR FDT]`) with actionable context (operation, offending input, cause); never sensitive data.
- **Listeners are isolated.** Each `browser.*`/DOM event listener body is guarded so one failing listener cannot break sibling listeners; the background service worker and content scripts register global `error` + `unhandledrejection` handlers that log and continue — a service worker or content script must not die on one error.
- **Messaging errors reach the sender.** Handlers validate payloads and report typed error results; senders always await responses and handle no-receiver/timeout (e.g., content script not injected). Receiver-side failures must never vanish.
- **Content scripts: page safety first.** An error in our code must never break the host page or spam its console; risky work (DOM probing, cross-world messaging, eval) is wrapped. On extension reload ("Extension context invalidated") stop cleanly — disconnect observers, timers, listeners — and never retry-loop against a dead context.
- **UI never dead-ends.** Every async surface renders its error state with an actionable message and retry where sensible; `console.error` alone is not UI error handling.

### Cross-browser compatibility

- **Chromium-based browsers are the primary target** (Chrome/Chromium, Edge, Brave, Arc, …): every feature must work there; size/perf budgets are measured on Chromium.
- **Firefox is a first-class secondary:** keep it compatible whenever that costs Chromium nothing. Where an API or capability differs, the Chromium path wins and Firefox degrades explicitly — feature-detect, then hide or disable with a message — never a half-working feature.
- **One codebase.** Write against WXT's auto-imported `browser.*` (never `chrome.*`); branch on feature detection (`'x' in api`), never user-agent sniffing; per-browser manifest differences live in `wxt.config.ts` (WXT generates per-browser output), not source forks. `pnpm build:firefox` stays green for whatever it currently builds.
- **The Firefox build is Manifest V2** (`.output/firefox-mv2`): manifest-versioned APIs (menu context `'action'` MV3 / `'browser_action'` MV2 — Firefox throws on the other; namespace `action` MV3 / `browserAction` MV2) branch on WXT's build-time `import.meta.env.MANIFEST_VERSION` (Vite `define` = the shipped manifest's version), so MV3 (Chromium) bundles never contain the MV2 path — see `entrypoints/background/menu-contexts.ts`, `toolbar-action.ts`; registries stay browser-agnostic. Vitest serves the define as the string `'3'`.

### UI themes: light & dark

- **Every user-facing surface supports both palettes** — panel, popup, options, and every injected UI (strips, badges, overlays — the exclusion builder included): token-based theming only; tokens are palette-agnostic; no hardcoded palette colors anywhere else.
- **The appearance setting has exactly three options — System (default), Dark, Light.** System follows `prefers-color-scheme`; an explicit Dark/Light always wins over it. The choice persists across surfaces (one synced option) and is resolved before the UI renders — no wrong-palette flash.
- **Real time** — changing the appearance setting updates all surfaces immediately, including injected UIs, without a reload. The panel and options pages are the only surfaces that can change the setting; injected UIs and the popup only read it.

### Accessibility: minimal, effort-free

Internal support-team tool (owner 2026-10-27): **zero screen-reader support**. Only what costs nothing — semantic HTML and what `components/ui/` primitives give for free (native/Kobalte keyboard behavior, focus ring). No new a11y work: no live regions/announcements, SR or real-AT checks, ARIA research, keyboard walks, new axe assertions. Existing a11y code and axe assertions stay (never removed or weakened). Host-page safety and shadow isolation are not a11y — unchanged. Details: [`docs/ui-ux-bar.md` §K](docs/ui-ux-bar.md#k--keyboard-focus-aria-ux-d3).

### UI/UX bar

Every user-facing surface — panel, popup, options, exclusion builder, every injected UI, and any future one — meets **[`docs/ui-ux-bar.md`](docs/ui-ux-bar.md)**, the single declaring site of the bar: refined, fast, responsive, with restrained motion. In short: container-query layouts with no horizontal scroll down to 320 px; tokens and `components/ui/` primitives only (token contrast pinned by `theme.test.ts`); motion only through the motion tokens and the bar's closed list of moments (`opacity`/`transform`, reduced motion honored, no per-row or infinite animation outside real waits); every async state designed (no dead ends, no fake waits); visible focus; virtualized lists with no long task > 50 ms. Phase docs cite its rule ids instead of re-declaring values; every UI change receipts its §D checks.

### Required workflow after every edit

```bash
pnpm compile         # must pass
pnpm lint            # must pass
pnpm format:check    # must pass (run pnpm format if it fails)
```

The `test` gate exists and runs with coverage. Run the gates yourself: `pnpm compile && pnpm lint && pnpm format:check && pnpm test`, plus `pnpm build && pnpm check:budgets` after any change that could shift bundle sizes. Verify runtime behavior in the browser for anything the compiler cannot catch (messaging, content scripts, storage).

## Coding conventions

Requirements, not suggestions:

- **Strict, explicit types.** No implicit `any`; type parameters and return types. Narrow `unknown` at boundaries (messages, storage, DOM). `tsconfig` extends WXT's — keep it strict.
- **Document with TSDoc — always, and only TSDoc.** Every function and non-obvious constant gets a doc comment. Say **why**, not just what; use `@param`, `@returns`, `@throws {@link ErrorType}`. Never JSDoc type annotations (`@param {type}`) in `.ts` files.
- **Dense over long.** Documentation, comments, this file — keep everything as short as clarity allows while staying understandable and detailed enough. No overexplaining.
- **Code is self-contained.** No references to plans/design docs in code, comments, TSDoc, or error messages — explain reasoning inline. (Markdown docs may cite plans.)
- **Separate concerns.** UI in components, extension logic in `lib/`, shared logic extracted into small reusable utilities instead of hardcoding it in one module. Short functions. Assess over- vs under-engineering case by case.
- **SolidJS, not React.** Do not port React idioms:
  - Don't destructure `props` (kills reactivity) — use `props.x`.
  - Components run **once**; there is no re-render.
- **WXT conventions.** Prefer WXT's built-ins (auto-imported `browser`, its storage and messaging utilities) over ad-hoc `chrome.*` calls or hand-rolled wrappers. Keep message and storage contracts typed and defined in one place. Verify exact APIs against the installed WXT version — don't trust remembered import paths.
- **`browser` and `chrome` are clobber-proof by build.** A page's DOM can answer either name in an isolated world: one created after parse (a tab loaded before install/update/reload), or a `document_start` one whose root element carries `id="chrome"`/`id="browser"`. `wxt.config.ts` aliases `@wxt-dev/browser` (behind the auto-imported `browser`, WXT and its storage) to `utils/extension-api/`, which on Chromium also pins the genuine namespace as the world's own `chrome` (bare `chrome` readers: `@webext-core/messaging`, evaluated after it by a `wxt.config.ts` transform). Use the auto-imported `browser`; never read `browser`/`chrome` off `globalThis`/`window`/`self` (casts included) nor import the resolver or the package (lint-guarded).
- **Match the surrounding style** and follow best practices of each library in use.

## Git & releases

- **Conventional Commits** — enforced by the `commit-msg` hook (`commitlint`); non-conforming messages are rejected. The `pre-commit` hook runs `lint-staged` (eslint --fix + prettier) on staged files with `--no-stash`: worktrees share one `refs/stash` and lint-staged drops its backup by stash index, so a concurrent commit elsewhere could drop the wrong entry; partially staged files stay protected by its patch in the per-worktree git dir (trade-off: a failing task no longer auto-reverts the tree). Hooks are husky v9 — activated by `pnpm install` (`prepare` script).
- **Semantic Versioning** — bump `package.json` version for every store upload.
- **Known Conflicts DB snapshot MUST be re-synced with the server before every release.** `lib/known-conflicts/known-conflicts-db.json` is the offline/first-run fallback seed, and a stale seed ships a blind spot on offline installs; it must mirror the live endpoint (`DB_ENDPOINT` in `entrypoints/background/known-conflicts.ts`) at release time. Refresh it verbatim from that URL, format it with Prettier, then re-pin the row count (the comment in `lib/storage/known-conflicts-seed.ts` + the exact-count assertion in `lib/storage/storage.test.ts`) and re-derive the ceiling of both `known-conflicts DB seed asset (background-owned)` rows (Chromium, and the `required` `firefox-mv2` twin) in `scripts/budgets.json` from the new byte size — the payload is server-owned data that grows over time, so raising those rows is expected, never a code regression to hide.
- Never commit secrets or build output (`.output/`, `.wxt/`).

## When to update this file

Whoever makes the code change owns the doc update. Update AGENTS.md when you: add/rename an NPM script; add/remove a dependency or a manifest permission; add an entrypoint or restructure directories; add a quality gate (lint/format/test); change a convention stated here. Put detail too long for this file in `README.md` (setup/run) or `docs/` (architecture), and link it from here.

In any file, a `NOTE FROM DEV:` comment is an instruction for the next AI/human reading that file — read it carefully and act on it.
