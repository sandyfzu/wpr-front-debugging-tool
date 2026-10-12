# AGENTS.md

Operating guide for AI agents (and humans) working in this repository. Keep it accurate and in sync with the code — see [When to update this file](#when-to-update-this-file).

## Project Overview

Browser extension for debugging the [WP Rocket](https://wp-rocket.me) WordPress plugin on the front end. This repo is a **modernized port** of the legacy project [wpr-front-debugging-tool-legacy](https://github.com/wp-media/wpr-front-debugging-tool-legacy) (you might find it at `../wpr-front-debugging-tool-legacy`, check) (WXT + React 18): same feature set + new features, rebuilt on a faster stack (WXT + SolidJS). Legacy entrypoints being ported: `background`, `devtools`, `exclusion-builder`, `fdt` (main UI, shown as the devtools panel — ported as `panel/`), `options`, `popup`, and two content scripts (isolated world + main world — ported as `isolated.content.ts` / `main-world.content.ts`).

A **second behavioral baseline** is also being integrated: the features of [wpr-inspector](https://github.com/wp-media/wpr-inspector) (you might find it at `../wpr-inspector`, check) — WP Rocket feature detection via the `data-wpr-features` generator meta, an on-page detection strip, the RUCSS live tester, and the runtime analysis tools (beacon/LCP/script views). Same rules apply: port behavior, improve and enhance, never copy; that baseline is planned as phases P11–P14 in `docs/plans/`.

> **Porting rule:** treat both source repos as the **behavioral** reference, not the code reference. Port features by their observed behavior — verify parity against a real build of the source you are porting (`pnpm dev` + load both builds and compare), never from memory of its code. It must also aim to be faster and more efficient than any source surface, so don't blindly port inefficient patterns, always improve and enhance.
>
> **Never port structures as-is.** A source repo's type shapes, file layout, registries, and the names of types, properties, variables, constants, and functions are a starting point to reshape, never a spec to copy: rework them into the port's clearer shape and intent-revealing names (only behavior and user-facing strings stay identical). When a ported surface looks "the same, just renamed", the port didn't happen.
>
> **No legacy in code — ever.** Code and comments in this project must never mention either source project or their code: no `legacy`/`inspector`-origin identifiers, strings, comments, TSDoc, or error messages referencing legacy files, functions, or behavior. Name things by what they do; provenance, mappings, parity proofs, and bug references live in `docs/plans/` — and only there.

## Key technologies

| Area      | Tech                                                                                                                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime   | **Node** 24 (`.nvmrc`, major only; floor in `engines`), **pnpm** (pinned in `packageManager`) — lockfile is the source of truth, never `npm`/`yarn`                                                                                                                                                                                       |
| Framework | **WXT** (extension framework, generates the manifest) + **SolidJS** (fine-grained reactivity)                                                                                                                                                                                                                                             |
| Language  | **TypeScript**, strict — stay on **5.9.x**: `typescript-eslint` peer-caps TS `<6.1.0` while npm `latest` is already TS 7; revisit when `typescript-eslint` supports it                                                                                                                                                                    |
| Styling   | **Tailwind CSS v4** — design tokens in `assets/css/tokens.css` (`@theme inline` over `light-dark()` values in `theme.css`; appearance = `system`/`dark`/`light` via `[data-theme]`; `tokens.css` is the module injected UIs import so shadow roots get the same values)                                                                   |
| Tests     | **Vitest 5** + `@solidjs/testing-library` + `happy-dom`; coverage thresholds gate `lib/**` + `utils/**` (see [Commands](#commands)). Browser tier: **@playwright/test** in `tests/e2e/` — headless Chromium with the unpacked extension (`E2E_HEADED=1` for headed), `*.spec.ts`, **local-only, never in CI** (see `tests/e2e/README.md`) |
| Targets   | Chromium-based browsers (primary; Manifest V3, `minimum_chrome_version: 145`); Firefox secondary — see Cross-browser compatibility                                                                                                                                                                                                        |
| Messaging | **`@webext-core/messaging` v4** (extension-wide) + its `page` subpath for the MAIN↔isolated-world window bridge — contracts live in `lib/messaging/`                                                                                                                                                                                      |
| Build     | Vite (via WXT)                                                                                                                                                                                                                                                                                                                            |

## Repository structure

WXT conventions govern the layout — follow them, don't invent a new one. The manifest is generated from `entrypoints/` into `.output/**` — never hand-edit it there.

```
├── docs/                      # the port plan: master plan + phase docs (linked from this file)
├── public/                    # copied to the build output as-is (icons, …)
├── assets/                    # bundled assets: images, fonts, `assets/css/theme.css` design tokens
├── entrypoints/               # one folder/file per extension surface
│   ├── background/            # service worker — listener wiring only; logic lives in lib/
│   ├── popup/                 # browser-action popup
│   ├── devtools/              # registers the devtools panel (points at panel.html)
│   ├── panel/                 # main debugging UI, shown as the devtools panel (panel.html)
│   ├── exclusion-builder/     # unlisted page (exclusion-builder.html)
│   ├── options/               # options page
│   ├── isolated.content.ts    # content script — isolated world
│   │   │                      #   (WXT folder form: `isolated.content/index.ts` entry +
│   │   │                      #    colocated feature modules; see docs/plans for the list)
│   └── main-world.content.ts  # content script — MAIN world
├── components/                # Solid components shared by ≥2 entrypoints
│   └── ui/                    # design-system primitives
├── lib/                       # domain modules — logic + types + data, pure and testable
│   ├── messaging/             # typed message contracts + boundary validation
│   ├── storage/               # typed storage items (storage.defineItem)
│   ├── detection/             # WP Rocket footprint detection
│   └── <domain>/              # one folder per feature; its data files colocated
├── utils/                     # generic, feature-agnostic pure helpers
├── scripts/                   # repo tooling (budget gate etc.); `scripts/budgets.json` is the committed budget table
├── docker/                    # local WP site: compose stack (WP+MariaDB+wp-cli bootstrap), lifecycle + smoke
│   │                          #   + conflict-derivation scripts, mu-plugin fixtures, KC conflict list —
│   │                          #   machine state (`.env`, the `apvm`-built zip, `docker/certs/`) is git-ignored
├── tests/e2e/                 # the browser-test tier (Playwright, headless Chromium + unpacked extension; `*.spec.ts` suites, fixtures, harness README — local-only, never in CI)
└── wxt.config.ts              # manifest fields, permissions (each with a why), modules
```

- **Dependency direction:** `entrypoints/` → `components/` → `lib/` → `utils/`, never upward. Enforced by `no-restricted-imports` rules in `eslint.config.js`.
- **Entrypoints are thin wiring:** bootstrap, `defineXxx`, mount UI, register listeners. Code used by a single surface is colocated in its entrypoint folder; promote it to `components/` or `lib/` the moment a second surface needs it.
- **`lib/` modules are self-contained:** each owns its logic, types, and data. No shared grab-bag files (`Globals.ts`/`Types.ts` are legacy patterns — don't port them). Cross-surface types are contracts in `lib/messaging/` and `lib/storage/`. Constants live with the module that owns the concept.
- **Tests:** unit tests colocated as `*.test.ts` next to the code they test; the browser tier (`*.spec.ts`) lives in `tests/e2e/` (see its README).
- `public/` is copied as-is; `assets/` is imported and bundled.

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
pnpm test            # vitest run with coverage — the test gate; thresholds over lib/** + utils/** fail below 90 % (lines/functions)
pnpm test:watch      # vitest in watch mode (no coverage in the loop)
pnpm test:coverage   # same as pnpm test, for when `test` is re-pointed later
pnpm test:e2e        # browser-test tier (tests/e2e/): Playwright, headless Chromium + the unpacked extension; E2E_HEADED=1 for headed, local-only — rebuilds a stale `pnpm build` or fails fast with the diff (`E2E_BUILD_STRICT=1` opts into fail-fast)
pnpm bench:detection # checks-phase speed gate: port vs reference engine over the fixture corpus (local only, never CI)
pnpm check:budgets   # measures built surfaces against scripts/budgets.json — run after pnpm build
docker/scripts/up.sh # local WordPress debugging site lifecycle — up / down.sh / reset.sh; URLs, credentials
                     #   location, reset semantics, scenario flags, apvm build path: docs/local-site-runbook.md
```

CI (`.github/workflows/ci.yml`) runs `compile` + `lint` + `format:check` + `test` + `build` + `check:budgets` on every PR and push to `main`/`develop`. `test:e2e` is deliberately **never wired into CI** (it needs this machine's real Chrome build and the docker site — the owner's environment contract; see `tests/e2e/README.md`).

## Non-negotiable rules

### Never guess — verify

Do not guess, suppose, or assume. Always verify, validate, confirm, and fact-check, e.g.:

- **APIs & libraries:** confirm signatures and options against the installed package (read it in `node_modules/`) or the current official docs (WXT, SolidJS, MDN webextension APIs). Training memory is not evidence.
- **Behavior:** confirm against the legacy extension or a real run before declaring parity or a fix done.
- **Facts you state:** paths, line numbers, command names, config values — read them, don't recall them. If you cannot verify something, say so explicitly instead of asserting it.

### Quality bar

The project must be stable, reliable, secure, safe, production-ready, well documented, and well tested:

- **No half-finished paths.** Handle edge cases and errors explicitly; fail fast with actionable messages that name the offending input.
- **Least privilege.** Request only the manifest permissions and host permissions actually used; each one gets a comment in `wxt.config.ts` explaining why. Never add permissions "just in case". (`declarativeNetRequestWithHostAccess` is the deliberate variant choice for the simulated-device sessions: same capabilities as the base permission, no install-time warning, and its rules act only within the already-declared host permissions.)
- **Dependencies: latest stable.** Any dependency added to the project MUST be the latest stable version (`latest` dist-tag) unless it is incompatible with the installed stack — verify `engines` and peer ranges before adding. Never add outdated versions "just in case".
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

### UI themes: light & dark

- **Every user-facing surface supports both palettes** — panel, popup, options, exclusion-builder, and every injected UI (strips, badges, overlays): token-based theming only; tokens are palette-agnostic; no hardcoded palette colors anywhere else.
- **The appearance setting has exactly three options — System (default), Dark, Light.** System follows `prefers-color-scheme`; an explicit Dark/Light always wins over it. The choice persists across surfaces (one synced option) and is resolved before the UI renders — no wrong-palette flash.
- **Real time** — changing the appearance setting updates all surfaces immediately, including injected UIs, without a reload. The panel and options pages are the only surfaces that can change the setting; injected UIs and the popup only read it.

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
- **Match the surrounding style** and follow best practices of each library in use.

## Git & releases

- **Conventional Commits** — enforced by the `commit-msg` hook (`commitlint`); non-conforming messages are rejected. The `pre-commit` hook runs `lint-staged` (eslint --fix + prettier) on staged files. Hooks are husky v9 — activated by `pnpm install` (`prepare` script).
- **Semantic Versioning** — bump `package.json` version for every store upload.
- **Known Conflicts DB snapshot MUST be re-synced with the server before every release.** `lib/known-conflicts/known-conflicts-db.json` is the offline/first-run fallback seed, and a stale seed ships a blind spot on offline installs; it must mirror the live endpoint (`DB_ENDPOINT` in `entrypoints/background/known-conflicts.ts`) at release time. Refresh it verbatim from that URL, format it with Prettier, then re-pin the row count (the comment in `lib/storage/known-conflicts-seed.ts` + the exact-count assertion in `lib/storage/storage.test.ts`) and re-derive the `known-conflicts DB seed asset` ceiling in `scripts/budgets.json` from the new byte size — the payload is server-owned data that grows over time, so raising that one row is expected, never a code regression to hide.
- Never commit secrets or build output (`.output/`, `.wxt/`).

## When to update this file

Whoever makes the code change owns the doc update. Update AGENTS.md when you: add/rename an NPM script; add/remove a dependency or a manifest permission; add an entrypoint or restructure directories; add a quality gate (lint/format/test); change a convention stated here. Put detail too long for this file in `README.md` (setup/run) or `docs/` (architecture), and link it from here.

In any file, a `NOTE FROM DEV:` comment is an instruction for the next AI/human reading that file — read it carefully and act on it.
