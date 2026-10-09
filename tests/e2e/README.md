# Browser-test tier (Playwright, local-only)

The real-browser test tier for this extension. **Local-only by rule: never wired
into CI** (headless runners cannot host extensions — the env contract is in the
master plan's browser-test track).

```bash
pnpm test:e2e            # all suites, headed Chromium, ~10–20 s
E2E_BUILD_STRICT=1 pnpm test:e2e   # refuse to auto-rebuild: fail fast with the diff instead
E2E_WORKERS=5 pnpm test:e2e        # run suites in parallel (five headed windows)
pnpm exec playwright show-report tests/e2e/playwright-report   # inspect the last run's HTML report
```

## What runs

- **Playwright (latest stable) launches headed Chromium** from the `chromium`
  channel with the unpacked extension preloaded from `.output/chrome-mv3/`
  (`--disable-extensions-except` + `--load-extension`, the documented
  extension-loading path). Real windows open on your screen for the run and
  close again — that is the tier's environment contract.
- **`global-setup.ts` refuses a stale build**: it fingerprints every file the
  build reads (`entrypoints/`, `components/`, `lib/`, `utils/`, `assets/`,
  `public/`, `wxt.config.ts`, `package.json`) and compares against
  `tests/e2e/.build-stamp.json` (gitignored, derived data). On a mismatch the
  harness runs `pnpm build` first (or, with `E2E_BUILD_STRICT=1`, fails fast
  printing the changed-file list).
- **`server.mjs` is the fixture webServer**: one local port (8891) is bound to
  both `http://localhost:8891/` and `http://127.0.0.1:8891/` — distinct origins,
  so cross-origin script errors and origin-tagged comparisons are real — over
  **loopback-only** sockets (`127.0.0.1` + `::1`; nothing answers on the
  machine's network interfaces). Fixtures
  are committed under `fixtures/`; every response is `no-store` so each reload
  is a genuine network round-trip, and the `__E2E_FRAME_TOKEN__` placeholder in
  any served `.html` is replaced with a fresh per-request random token (a
  fixture page can prove its body is from the latest request).

## The SW drive plane (beyond page DOM)

Extension state that has no page-DOM presence is asserted from the **service
worker context**:

- Playwright exposes the MV3 background as a `Worker` target
  (`context.serviceWorkers()`); the driver evaluates real `chrome.*` code there
  (`tests/e2e/helpers/extension.ts`, `evaluateInWorker`). The
  `Worker.evaluate` handle stays valid across Chromium's own service-worker
  idle suspension.
- Extension messaging is driven over the protocol's wire shape: the installed
  `@webext-core/messaging` v4 sends `{ id, type, data, timestamp }` envelopes,
  so the harness sends the extension's real protocol rows (`getFdtData`
  pull-through, `openSideBySide`) from the SW to a tab without importing any
  extension bundle.
- **Menu state is probed by duplicate-create semantics.** The extension
  `contextMenus` API has no read-back (`getAll` does not exist in the
  installed Chromium; verified live) — so "entry exists exactly once" is
  observable as "creating a second item with that id is refused with the
  duplicate-id `lastError`". A scratch id outside the registry serves as the
  probe's absence control. The title/contexts/documentUrlPatterns parity
  shapes are therefore pinned by the background's own unit table
  (`entrypoints/background/context-menus.test.ts`), not re-read at runtime.

## Suites → parent phase docs

| Suite (`suites/*.spec.ts`) | Phase contract it pins                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boot-and-registry`        | P2 background: SW alive; menu ids exactly once after install **and** after extension reload                                                                             |
| `undefined-references`     | P4 MAIN-world capture (+ P3 receiving guard): validated batch on the panel seam; host safety (hostile `stack` getter, malformed bridge batches); page console unchanged |
| `cross-origin-sentinel`    | P4 sentinel path (the cross-origin resurrection): the fixed sentinel word reaches the isolated receiver immediately, not debounced                                      |
| `side-by-side`             | P3 Side-by-Side mechanics: message-driven open, URL rules, per-side refresh, exact overflow/scroll restore, re-open keeps frames                                        |
| `processed-page-pipeline`  | P3 data hub: mandated timing log format + page-analysis print; P2/P3 badge seam: summary push rendered per state                                                        |

## Manual remainder (recorded, never silently dropped)

These need a human, a real site, or a user-visible surface that is not
automatable — each is named in the owning phase's checklist:

- **Context-menu clicks**: native menus are not Playwright-reachable. The click
  DISPATCH tree is unit-pinned (P2) and the open flow is driven here via the
  same message; only the actual right-click UX remains manual.
- **Real WordPress-site flows** (P4.3 on the P4.2 site): judged/major-feature
  rounds, KC-DB refresh against the live endpoint, header capture on real
  responses, diagnoser JSON payloads from the real plugin.
- **attached-devtools visuals** (P5+): the panel's own rendering pipeline.
- **Firefox runtime**: the harness cannot load extensions in Playwright's
  Firefox build — Firefox stays a manual `pnpm dev:firefox` smoke tier per
  phase (recorded in each suite's parent phase doc, never skipped silently).

## Environment facts (verified against the installed tooling)

- Chromium for Testing 156.0.8078.4 via Playwright (above the manifest floor of
  145); extensions load per the Playwright extension docs.
- After `chrome.runtime.reload()`, any extension that declares content scripts
  vanishes from Chrome's extension registry and never revives in this build
  (verified; even with a trivial background). The harness's reload leg closes
  the browser and relaunches on the SAME profile — the bundle re-registers over
  persistent extension-owned browser state, asserting the checklist's actual
  question (ids survive extension reload exactly once).
