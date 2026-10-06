# CLAUDE.md

Operating guide for AI agents (and humans) working in this repository. Keep it accurate and in sync with the code — see [When to update this file](#when-to-update-this-file).

## Project Overview

Browser extension for debugging the [WP Rocket](https://wp-rocket.me) WordPress plugin on the front end. This repo is a **modernized port** of the legacy project [wpr-front-debugging-tool-legacy](https://github.com/wp-media/wpr-front-debugging-tool-legacy) (you might find it at `../wpr-front-debugging-tool-legacy`, check) (WXT + React 18): same feature set + new features, rebuilt on a faster stack (WXT + SolidJS). Legacy entrypoints being ported: `background`, `devtools`, `exclusion-builder`, `fdt` (main UI, shown as the devtools panel — ported as `panel/`), `options`, `popup`, and two content scripts (isolated world + main world — ported as `isolated.content.ts` / `main-world.content.ts`).

> **Porting rule:** treat the legacy repo as the **behavioral** reference, not the code reference. Port features by their observed behavior — verify parity against the real legacy extension (`pnpm dev` + load both builds and compare), never from memory of its code. It must also aim to be faster and more efficient than the legacy extension, so don't blindly port inefficient patterns, always improve and enhance.

## Key technologies

| Area      | Tech                                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime   | **Node** 24 (`.nvmrc`, major only; floor in `engines`), **pnpm** (pinned in `packageManager`) — lockfile is the source of truth, never `npm`/`yarn`                    |
| Framework | **WXT** (extension framework, generates the manifest) + **SolidJS** (fine-grained reactivity)                                                                          |
| Language  | **TypeScript**, strict — stay on **5.9.x**: `typescript-eslint` peer-caps TS `<6.1.0` while npm `latest` is already TS 7; revisit when `typescript-eslint` supports it |
| Targets   | Chrome & Firefox, Manifest V3 (Chrome: `minimum_chrome_version: 120` in legacy — this one `145`)                                                                       |
| Build     | Vite (via WXT)                                                                                                                                                         |

## Repository structure

WXT conventions govern the layout — follow them, don't invent a new one. The manifest is generated from `entrypoints/` into `.output/**` — never hand-edit it there.

```
├── docs/                      # architecture deep-dives, linked from this file
├── public/                    # copied to the build output as-is (icons, …)
├── assets/                    # bundled assets: images, fonts, shared styles
├── entrypoints/               # one folder/file per extension surface
│   ├── background/            # service worker — listener wiring only; logic lives in lib/
│   ├── popup/                 # browser-action popup
│   ├── devtools/              # registers the devtools panel (points at panel.html)
│   ├── panel/                 # main debugging UI, shown as the devtools panel (panel.html)
│   ├── exclusion-builder/     # unlisted page (exclusion-builder.html)
│   ├── options/               # options page
│   ├── isolated.content.ts    # content script — isolated world
│   └── main-world.content.ts  # content script — MAIN world
├── components/                # Solid components shared by ≥2 entrypoints
│   └── ui/                    # design-system primitives
├── lib/                       # domain modules — logic + types + data, pure and testable
│   ├── messaging/             # typed message contracts + boundary validation
│   ├── storage/               # typed storage items (storage.defineItem)
│   ├── detection/             # WP Rocket footprint detection
│   └── <domain>/              # one folder per feature; its data files colocated
├── utils/                     # generic, feature-agnostic pure helpers
└── wxt.config.ts              # manifest fields, permissions (each with a why), modules
```

- **Dependency direction:** `entrypoints/` → `components/` → `lib/` → `utils/`, never upward. Enforced by `no-restricted-imports` rules in `eslint.config.js`.
- **Entrypoints are thin wiring:** bootstrap, `defineXxx`, mount UI, register listeners. Code used by a single surface is colocated in its entrypoint folder; promote it to `components/` or `lib/` the moment a second surface needs it.
- **`lib/` modules are self-contained:** each owns its logic, types, and data. No shared grab-bag files (`Globals.ts`/`Types.ts` are legacy patterns — don't port them). Cross-surface types are contracts in `lib/messaging/` and `lib/storage/`. Constants live with the module that owns the concept.
- **Tests:** unit tests colocated as `*.test.ts` next to the code they test; a root `tests/` only for integration/E2E if ever added.
- `public/` is copied as-is; `assets/` is imported and bundled.

## Commands

```bash
pnpm dev             # dev build + watch → load .output/chrome-mv3 unpacked
pnpm dev:firefox
pnpm build           # production build   (pnpm build:firefox)
pnpm zip             # production build + store zip
pnpm compile         # tsc --noEmit — type check
pnpm lint            # eslint — strict typescript-eslint + Solid rules + dependency direction
pnpm lint:fix        # eslint --fix
pnpm format          # prettier --write .
pnpm format:check    # prettier --check .
```

## Non-negotiable rules

### Never guess — verify

Do not guess, suppose, or assume. Always verify, validate, confirm, and fact-check, e.g.:

- **APIs & libraries:** confirm signatures and options against the installed package (read it in `node_modules/`) or the current official docs (WXT, SolidJS, MDN webextension APIs). Training memory is not evidence.
- **Behavior:** confirm against the legacy extension or a real run before declaring parity or a fix done.
- **Facts you state:** paths, line numbers, command names, config values — read them, don't recall them. If you cannot verify something, say so explicitly instead of asserting it.

### Quality bar

The project must be stable, reliable, secure, safe, production-ready, well documented, and well tested:

- **No half-finished paths.** Handle edge cases and errors explicitly; fail fast with actionable messages that name the offending input.
- **Least privilege.** Request only the manifest permissions and host permissions actually used; each one gets a comment in `wxt.config.ts` explaining why. Never add permissions "just in case".
- **Dependencies: latest stable.** Any dependency added to the project MUST be the latest stable version (`latest` dist-tag) unless it is incompatible with the installed stack — verify `engines` and peer ranges before adding. Never add outdated versions "just in case".
- **Security.** Never log or persist sensitive data. Validate untrusted input — page DOM, `storage`, message payloads — at the boundary before use.
- **Content scripts must never break the host page.** They run on sites being debugged: wrap risky work, clean up listeners/observers, and keep main-world vs isolated-world responsibilities explicit.
- **Tests & testability.** Design for unit testing by default: keep logic (parsing, messaging/storage contracts, exclusion rules, decisions) in pure functions/modules, decoupled from I/O, DOM, `browser.*` APIs, and UI — inject or pass dependencies instead of hardcoding them. Unit-test all such logic; test first, not as an afterthought. The only acceptable exceptions are thin UI glue and entrypoint wiring — a limitation, never a design goal. When code is hard to unit test, restructure it until it isn't (or justify why it can't be).

### Required workflow after every edit

```bash
pnpm compile         # must pass
pnpm lint            # must pass
pnpm format:check    # must pass (run pnpm format if it fails)
```

The `test` gate is added together with the test runner — wire it here when it exists. Don't rely on git hooks (pre-commit runs lint-staged on staged files only), run the gates yourself. Verify runtime behavior in the browser for anything the compiler cannot catch (messaging, content scripts, storage).

## Coding conventions

Requirements, not suggestions:

- **Strict, explicit types.** No implicit `any`; type parameters and return types. Narrow `unknown` at boundaries (messages, storage, DOM). `tsconfig` extends WXT's — keep it strict.
- **Explicit error handling.** Distinguish "operation failed" (branch on the result) from "couldn't run at all" (throw). Extension APIs reject or set `lastError` — always check. Best-effort side work must never mask a real failure.
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
- Never commit secrets or build output (`.output/`, `.wxt/`).

## When to update this file

Whoever makes the code change owns the doc update. Update CLAUDE.md when you: add/rename an NPM script; add/remove a dependency or a manifest permission; add an entrypoint or restructure directories; add a quality gate (lint/format/test); change a convention stated here. Put detail too long for this file in `README.md` (setup/run) or `docs/` (architecture), and link it from here.

In any file, a `NOTE FROM DEV:` comment is an instruction for the next AI/human reading that file — read it carefully and act on it.
