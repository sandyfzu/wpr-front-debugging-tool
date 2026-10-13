# Browser-test tier (Playwright, local-only)

The real-browser test tier for this extension. **Local-only by rule: never wired
into CI** (headless runners cannot host extensions — the env contract is in the
master plan's browser-test track).

```bash
pnpm test:e2e            # all suites, headless Chromium, ~10–20 s
E2E_HEADED=1 pnpm test:e2e   # headed windows (the debugging opt-in)
E2E_BUILD_STRICT=1 pnpm test:e2e   # refuse to auto-rebuild: fail fast with the diff instead
E2E_WORKERS=5 pnpm test:e2e        # run suites in parallel (five browsers)
pnpm exec playwright show-report tests/e2e/playwright-report   # inspect the last run's HTML report
```

## What runs

- **Playwright (latest stable) launches Chromium from the `chromium` channel with the unpacked extension preloaded** from `.output/chrome-mv3/` (`--disable-extensions-except` + `--load-extension`, the documented extension-loading path). Runs are **headless by default** — a gate run never opens windows or steals the foreground; `E2E_HEADED=1` is the debugging opt-in (real windows open and close). The channel's modern headless hosts extensions (verified against the installed build); the legacy headless shell cannot, which is why the tier launched headed-only when it was built.
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
- **A second webServer boots the P4.2 dockerized WordPress site**
  (`docker/scripts/up.sh`, ready on its `/fdt/` page; URL read from
  `docker/.env` — docker stays the site's single declaring site). The six
  `site-*` suites run against it. A converged stack adds ~25 s; `up.sh`
  rebuilds nothing when the volumes are warm and the reuse check skips the
  boot entirely when the stack is already up.

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

| Suite (`suites/*.spec.ts`) | Phase contract it pins                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boot-and-registry`        | P2 background: SW alive; menu ids exactly once after install **and** after extension reload                                                                                                                                                                                                                                                                     |
| `undefined-references`     | P4 MAIN-world capture (+ P3 receiving guard): validated batch on the panel seam; host safety (hostile `stack` getter, malformed bridge batches); page console unchanged                                                                                                                                                                                         |
| `cross-origin-sentinel`    | P4 sentinel path (the cross-origin resurrection): the fixed sentinel word reaches the isolated receiver immediately, not debounced                                                                                                                                                                                                                              |
| `side-by-side`             | P3 Side-by-Side mechanics: message-driven open, URL rules, per-side refresh, exact overflow/scroll restore, re-open keeps frames; the open-path scroll sync (engine armed at open, one half driven to its bottom, the other follows mapped — no switch interaction)                                                                                             |
| `processed-page-pipeline`  | P3 data hub: mandated timing log format + page-analysis print; P2/P3 badge seam: summary push rendered per state                                                                                                                                                                                                                                                |
| `site-header-capture`      | P4.3 over the real site: the P2-audit BLOCKER re-run (real responses → served row pairs), tab scoping + navigation supersede, the tabless sender, the over-cap reject                                                                                                                                                                                           |
| `site-badge-pipeline`      | P4.3 over the real site: the blue present-but-uncached state, supersede, the post-`chrome://` clear, the live `toolbarBadge` flip                                                                                                                                                                                                                               |
| `site-known-conflicts`     | P4.3 over the real plugin tables: containment-counted scan, the corrected empty state, the no-reload storage-watch rescan, the serve path, the offline boot seed (unstamped)                                                                                                                                                                                    |
| `site-data-hub`            | P4.3 over the real site: the mandated log lines, the console whitelist (no page content), the `rocket-allScriptsLoaded` flip, the real error page's served words                                                                                                                                                                                                |
| `site-improvements-admin`  | P4.3 over real wp-admin: the option-on D-bugger entry (built once), the option-off removal, the restore                                                                                                                                                                                                                                                         |
| `site-side-by-side`        | P4.3 on genuinely cached pages: the two frames' real cache-state bodies (footprint + delay markers in the cached frame, none in the bypassed), real refresh, scroll restore                                                                                                                                                                                     |
| `panel-nav`                | P5 adaptive nav: the icon rail is the only form at every width (no morphology switch, no top-bar edge — resize-pinned), real hash links + `aria-current`, the honest error-state boot, tooltip focus/hover wiring incl. the disabled reserved row + the right-placement pin (an open tooltip never covers the sibling rows), keyboard reach with a visible ring |
| `panel-cold-start`         | P5I cold-start timing row: the shell's three `performance.marks` land once and in order on a real timeline, both windows exist, and the script-start → first-settle span stays within the `panel cold-start ≤ 500 ms` row read straight from `scripts/budgets.json` (the settle leg pinned: the standalone boot's honest recorded error)                        |
| `theme`                    | The injected-UI palette (every shadow-rooted UI through `mount.ts`): `system` declared on the container resolves dark under a dark OS and follows it in real time; explicit dark wins — see 05e's 2026-10-11 palette fix                                                                                                                                        |

## Manual remainder (recorded, never silently dropped)

These need a human, a real site, or a user-visible surface that is not
automatable — each is named in the owning phase's checklist:

- **Context-menu clicks**: native menus are not Playwright-reachable. The click
  DISPATCH tree is unit-pinned (P2) and the open flow is driven here via the
  same message; only the actual right-click UX remains manual.
- **PSI production pages**: the cross-origin SBS refresh leg (`refreshFrame`'s
  `src`-reassignment variant) and the auto-open flow — P14.6 reach.
- **Legacy-vs-new timing benchmark** (the ≥30 %-faster claim, P3's manual row):
  needs a real legacy build run on the same page — numbers recorded there.
- **attached-devtools visuals** (P5+): the panel's own rendering pipeline.
- **Firefox runtime**: the harness cannot load extensions in Playwright's
  Firefox build — Firefox stays a manual `pnpm dev:firefox` smoke tier per
  phase (recorded in each suite's parent phase doc, never skipped silently).

## Real-site facts the site suites rely on (verified against the live stack)

- **One worker serves the whole `pnpm test:e2e` run** (per-file when
  `E2E_WORKERS` > 1): the browser profile and its state (cookies, storage,
  the extension's own caches) are shared across the consecutive files, so
  every suite declares its needed preconditions explicitly (the SBS suites
  clear the site's login cookies and run as a normal visitor; the admin
  suites log in themselves).
- **Fresh-profile first `/fdt/` visit is cache-served** (green badge, the
  WP Rocket footprint comment + the `cached@` debug marker); WordPress-served
  pages (every uncached query) carry three `Link` header rows and lack the
  marker. Revisits revalidate and keep serving the same document, so each
  state is stable per tab.
- **Logged-in visitors get no cache and no optimization** (plain WordPress
  HTML) — the site suites that need cached truth stay anonymous.
- **The first navigation after a launch can miss the header capture**: the
  main-frame event races the service worker's first listener registration.
  The driver warms the capture with one throwaway local page after the worker
  event, so every suite's real pages capture deterministically.

## Known flake class + the retry policy (recorded 2026-10-13, the P5I audit round)

The site suites assert against the **live** dockerized site's real cache, and a
shared run can race it: one observed shape is a frame's
`performance.timeOrigin` advancing under `site-side-by-side`'s per-side refresh
(the shared site re-issued the document mid-assertion). **Policy:** on a
failure of that shape, wait ~90 s and re-run the failing suite **once** — a
deliberate manual retry. Playwright's own `retries` stay `0`, so nothing ever
auto-passes; a clean full `pnpm test:e2e` run is the gate's evidence.

## Environment facts (verified against the installed tooling)

- Chromium for Testing 156.0.8078.4 via Playwright (above the manifest floor of
  145); extensions load per the Playwright extension docs.
- After `chrome.runtime.reload()`, any extension that declares content scripts
  vanishes from Chrome's extension registry and never revives in this build
  (verified; even with a trivial background). The harness's reload leg closes
  the browser and relaunches on the SAME profile — the bundle re-registers over
  persistent extension-owned browser state, asserting the checklist's actual
  question (ids survive extension reload exactly once).
