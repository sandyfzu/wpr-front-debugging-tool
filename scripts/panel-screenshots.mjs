#!/usr/bin/env node
/**
 * Panel + options screenshot harness (local only: never CI, never a test dependency).
 *
 * Captures every devtools-panel route (`panel.html#/<id>`, ids read at run time from the
 * `ROUTE_IDS` table in `entrypoints/panel/routes.ts`) and the options page at
 * 420 / 760 / 1100 × 760 px, in the dark and light palettes, as
 * `<out>/<surface>-<width>-<palette>.png` — a before/after set for visual review.
 *
 * Usage (Node 24, after `pnpm build`; the docker site up: `docker/scripts/up.sh`):
 *
 *   node scripts/panel-screenshots.mjs <label> [--out <dir>] [--page <path>] [--only <ids>] [--headed]
 *   pnpm screenshots <label> [...]   (the same, as the package script)
 *
 * - `<label>`: names the default output folder `.screenshots/<label>/` (git-ignored).
 * - `--out <dir>`: write there instead. A relative path resolves against the current
 *   directory — the package root under `pnpm screenshots` (pnpm runs scripts there).
 * - `--page <path>`: the site page the panel inspects (default `/fdt/?fdt-delay=1`, the
 *   delay-queue fixture: delayed scripts, lazyload, preload hints…).
 * - `--only <ids>`: comma-separated route ids and/or `options` (default: all).
 * - Output folder: a full run first deletes the folder's previous shots (files named like
 *   `<surface>-<width>-<palette>.png`, nothing else), so a renamed route leaves no stale
 *   image; an `--only` run replaces just its own shots and keeps the others.
 * - `--headed`: show the browser windows (default headless).
 * - Site URL: `WPR_FDT_SITE_URL` from the environment, else from this checkout's
 *   `docker/.env` (git-ignored: a worktree without it passes the env var).
 *
 * How it drives the extension (same seams as the e2e tier, `tests/e2e/helpers/`):
 * Playwright's `chromium` channel with the unpacked `.output/chrome-mv3`, real scrollbars,
 * the e2e tier's blocked remote hosts (`tests/e2e/helpers/blocked-hosts.ts`, loaded through
 * Vite since it is TypeScript), one site tab (desktop Chrome user agent: a headless one may be served uncached), and
 * per shot a fresh panel page whose `devtools.inspectedWindow.tabId` is stamped on both
 * `window.chrome` and `window.browser` before its modules run, so the panel boots on the
 * site tab's real data. The palette is emulated before navigation (a later flip repaints
 * with a lag), motion reduced, and each shot waits for the route's ready body, then for
 * skeletons and animations to settle. Fails fast, naming the cause, when the build, the
 * site or the route table is missing; a boot that never becomes ready fails the run. An
 * error view in a shot (a page chunk that failed to load, a failed read) fails the run too,
 * after every shot is taken (the failing images stay, for diagnosis). Ctrl-C / SIGTERM close
 * the browser and remove the temp profile; a second signal exits at once.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { constants as osConstants, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Panel widths (px) the set covers: narrow (icon rail), mid and wide panels. */
export const WIDTHS = [420, 760, 1100];

/** Viewport height (px) of every shot. */
export const HEIGHT = 760;

/** Palettes, each emulated through `prefers-color-scheme` before navigation. */
export const PALETTES = ['dark', 'light'];

/** The options page's surface id (it shares the file-name scheme with routes). */
export const OPTIONS_SURFACE = 'options';

/** The site page inspected by default: the delay-queue fixture of the docker site. */
export const DEFAULT_SITE_PAGE = '/fdt/?fdt-delay=1';

/** The env var (and `docker/.env` key) naming the docker site's base URL. */
export const SITE_URL_KEY = 'WPR_FDT_SITE_URL';

/**
 * Every in-page error view: the error-state primitive (a failed page chunk, a failed read,
 * a boot error) and the panel's "no data for this tab" view.
 */
export const ERROR_VIEW_SELECTOR = '[data-fdt="error-state"], [data-fdt="data-unavailable"]';

/** The file names {@link shotPlan} writes: the only files a full run deletes. */
const SHOT_FILE_PATTERN = /^[a-z0-9-]+-\d+-(?:dark|light)\.png$/;

/** The switch prefix a valid host-resolver rule (from the e2e helper) starts with. */
const HOST_RESOLVER_RULES_PREFIX = '--host-resolver-rules=MAP ';

/** Bounds of the waits; a ready body comes in well under a second on a warm site. */
const READY_TIMEOUT_MS = 20_000;
const SKELETON_TIMEOUT_MS = 8_000;
const SITE_PROBE_TIMEOUT_MS = 10_000;

/** The usage line every argument error prints. */
const USAGE =
  'usage: node scripts/panel-screenshots.mjs <label> [--out <dir>] [--page <path>] [--only <ids>] [--headed]';

/**
 * Parse the command line.
 *
 * @param {readonly string[]} argv The arguments after the script path.
 * @param {string} root The package root (anchors the default output folder).
 * @returns {{outDir: string, page: string, only: string[] | null, headed: boolean}} The run options.
 * @throws {Error} Naming the offending argument, with the usage line.
 */
export function parseArgs(argv, root) {
  /** @type {string | null} */
  let label = null;
  /** @type {string | null} */
  let out = null;
  let page = DEFAULT_SITE_PAGE;
  /** @type {string[] | null} */
  let only = null;
  let headed = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    /**
     * Consume the current flag's value (the next argument).
     *
     * @returns {string} The value.
     * @throws {Error} When it is missing or flag-shaped.
     */
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--'))
        throw new Error(`${arg} needs a value\n${USAGE}`);
      i += 1;
      return next;
    };
    if (arg === '--out') out = value();
    else if (arg === '--page') page = value();
    else if (arg === '--only')
      only = value()
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    else if (arg === '--headed') headed = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}\n${USAGE}`);
    else if (label === null) label = arg;
    else throw new Error(`unexpected argument "${arg}" (one label only)\n${USAGE}`);
  }
  if (label === null && out === null) throw new Error(`a label (or --out) is required\n${USAGE}`);
  if (label !== null && !/^[\w.-]+$/.test(label)) {
    throw new Error(
      `label "${label}" must be a plain folder name (letters, digits, . _ -)\n${USAGE}`
    );
  }
  if (!page.startsWith('/'))
    throw new Error(`--page must be a site path starting with "/" (got "${page}")`);
  if (only !== null && only.length === 0) throw new Error(`--only needs at least one id\n${USAGE}`);
  return {
    outDir: out !== null ? resolve(out) : join(root, '.screenshots', /** @type {string} */ (label)),
    page,
    only,
    headed
  };
}

/**
 * Parse dotenv-shaped text: `KEY=value` lines only (the docker env file's vocabulary has no
 * quotes, exports or inline comments).
 *
 * @param {string} text The file's contents.
 * @returns {Record<string, string>} Key → value.
 */
export function parseEnvText(text) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match !== null) values[match[1]] = match[2];
  }
  return values;
}

/**
 * Resolve the docker site's base URL: the env var wins over the checkout's `docker/.env`.
 *
 * @param {string | undefined} fromEnv The `WPR_FDT_SITE_URL` env value.
 * @param {string | null} envFileText `docker/.env`'s text, or null when the file is missing.
 * @param {string} envFilePath Its path (named in the error).
 * @returns {string} The base URL without a trailing slash.
 * @throws {Error} When neither names a URL, or the value is not an http(s) URL.
 */
export function resolveSiteUrl(fromEnv, envFileText, envFilePath) {
  const raw =
    fromEnv !== undefined && fromEnv !== ''
      ? fromEnv
      : envFileText === null
        ? undefined
        : parseEnvText(envFileText)[SITE_URL_KEY];
  if (raw === undefined || raw === '') {
    throw new Error(
      `No site URL: set ${SITE_URL_KEY} in the environment or in ${envFilePath}` +
        (envFileText === null
          ? ' (missing — run docker/scripts/up.sh, or pass the env var from a worktree)'
          : '')
    );
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${SITE_URL_KEY} is not a URL: "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${SITE_URL_KEY} must be http(s): "${raw}"`);
  }
  return raw.replace(/\/+$/, '');
}

/**
 * Read the route ids from the panel's route table source. The table is TypeScript importing
 * Solid icons, so it is parsed as text: the `ROUTE_IDS = [ … ] as const` literal, one quoted
 * id per entry. Each shot then requires its route's page to render, so a drifted parse fails
 * the run instead of passing silently.
 *
 * @param {string} source The text of `entrypoints/panel/routes.ts`.
 * @returns {string[]} The route ids, in table order.
 * @throws {Error} When the table is missing, empty, holds a non-literal entry or a duplicate.
 */
export function parseRouteIds(source) {
  const block = /export const ROUTE_IDS = \[([\s\S]*?)\] as const;/.exec(source);
  if (block === null)
    throw new Error('routes.ts no longer declares `export const ROUTE_IDS = [ … ] as const;`');
  const entries = block[1]
    .split(',')
    .map((entry) => entry.replace(/\/\/.*$/gm, '').trim())
    .filter(Boolean);
  const ids = entries.map((entry) => {
    const id = /^'([a-z0-9-]+)'$/.exec(entry)?.[1];
    if (id === undefined)
      throw new Error(`ROUTE_IDS holds an entry this script cannot read: ${entry}`);
    return id;
  });
  if (ids.length === 0) throw new Error('ROUTE_IDS is empty');
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) throw new Error(`ROUTE_IDS lists "${duplicate}" twice`);
  return ids;
}

/**
 * The surfaces a run captures: the routes plus the options page, narrowed by `--only`.
 *
 * @param {readonly string[]} routeIds The panel's route ids.
 * @param {readonly string[] | null} only The `--only` ids, or null for everything.
 * @returns {string[]} Surface ids in capture order (routes first, options last).
 * @throws {Error} Naming an `--only` id that is neither a route nor `options`.
 */
export function selectSurfaces(routeIds, only) {
  const all = [...routeIds, OPTIONS_SURFACE];
  if (only === null) return all;
  const unknown = only.filter((id) => !all.includes(id));
  if (unknown.length > 0)
    throw new Error(`--only names unknown ids: ${unknown.join(', ')} (known: ${all.join(', ')})`);
  return all.filter((id) => only.includes(id));
}

/**
 * Every shot of a run: surfaces × palettes × widths.
 *
 * @param {readonly string[]} surfaces The surface ids.
 * @returns {{surface: string, palette: string, width: number, file: string}[]} The shots.
 */
export function shotPlan(surfaces) {
  return surfaces.flatMap((surface) =>
    PALETTES.flatMap((palette) =>
      WIDTHS.map((width) => ({
        surface,
        palette,
        width,
        file: `${surface}-${String(width)}-${palette}.png`
      }))
    )
  );
}

/**
 * The desktop Chrome form of a browser's user agent (headless builds say `HeadlessChrome`,
 * which a page cache may refuse to serve from cache).
 *
 * @param {string} userAgent The browser's own user agent.
 * @returns {string} The same string with the headless marker replaced.
 */
export function desktopUserAgent(userAgent) {
  return userAgent.replace('HeadlessChrome/', 'Chrome/');
}

/**
 * The init script standing in for DevTools: stamps `devtools.inspectedWindow` on both
 * namespace objects an extension page exposes (`chrome` and the separate `browser`: the panel
 * resolves through `browser` first, so a `chrome`-only stamp is ignored). Mirrors the e2e
 * tier's shim (`tests/e2e/helpers/panel-data.ts`): the tab id, plus a callback-form `eval`
 * that answers only `location.href` (the top bar's inspected address) with the inspected
 * page's URL; any other expression gets an exception answer.
 *
 * @param {number} tabId The inspected tab's id.
 * @param {string} pageUrl The inspected page's URL (`location.href` answer).
 * @returns {string} Script text for `page.addInitScript`.
 * @throws {Error} When the id is not a non-negative integer (it is interpolated into code)
 *   or the URL is not absolute http(s).
 */
export function devtoolsShim(tabId, pageUrl) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error(`invalid tab id: ${String(tabId)}`);
  if (typeof pageUrl !== 'string' || !/^https?:\/\//.test(pageUrl)) {
    throw new Error(`invalid page URL: ${String(pageUrl)}`);
  }
  return `(() => {
    const href = ${JSON.stringify(pageUrl)};
    const inspectedWindow = {
      tabId: ${String(tabId)},
      eval: (expression, callback) => {
        if (typeof callback !== 'function') return;
        if (expression === 'location.href') callback(href, undefined);
        else callback(undefined, { isException: true, value: 'unsupported in screenshots' });
      }
    };
    for (const namespace of [window.chrome, window.browser]) {
      if (namespace !== undefined && namespace !== null) namespace.devtools = { inspectedWindow };
    }
  })()`;
}

/**
 * Check the host-resolver switch read from the e2e helper module.
 *
 * @param {unknown} value The module's `HOST_RESOLVER_RULES` export.
 * @param {string} source The module path (named in the error).
 * @returns {string} The switch, unchanged.
 * @throws {Error} When the export is missing or not a `--host-resolver-rules=MAP …` switch.
 */
export function checkHostResolverRules(value, source) {
  if (typeof value !== 'string' || !value.startsWith(HOST_RESOLVER_RULES_PREFIX)) {
    throw new Error(
      `${source} no longer exports HOST_RESOLVER_RULES as a "${HOST_RESOLVER_RULES_PREFIX}…" switch (got ${JSON.stringify(value) ?? String(value)})`
    );
  }
  return value;
}

/**
 * The text of every error view in the current document, whitespace collapsed and capped.
 * Runs in the page (`page.evaluate`): it must not reference anything outside its body.
 *
 * @param {string} selector The error views' selector ({@link ERROR_VIEW_SELECTOR}).
 * @returns {string[]} One entry per view, in document order.
 */
export function errorViewTexts(selector) {
  return [...document.querySelectorAll(selector)].map((element) =>
    (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  );
}

/**
 * The failure line of a shot that captured error views, or null for a clean shot.
 *
 * @param {{surface: string, palette: string, width: number}} shot The shot.
 * @param {readonly string[]} errorTexts Its error views' texts ({@link errorViewTexts}).
 * @returns {string | null} Names the surface, width, palette and each view's text.
 */
export function shotFailure(shot, errorTexts) {
  if (errorTexts.length === 0) return null;
  const views = errorTexts.map((text) => `"${text === '' ? '(no text)' : text}"`).join('; ');
  return `${shot.surface} at ${String(shot.width)} px, ${shot.palette}: error view ${views}`;
}

/**
 * The previous shots a run deletes before capturing: every shot-named PNG on a full run (a
 * renamed or removed surface leaves no stale image), none on an `--only` run (it keeps the
 * other surfaces' shots). Other files are never touched, whatever folder `--out` names.
 *
 * @param {readonly string[]} fileNames The output folder's entries.
 * @param {readonly string[] | null} only The `--only` ids, or null for a full run.
 * @returns {string[]} The file names to delete.
 */
export function staleShotFiles(fileNames, only) {
  return only === null ? fileNames.filter((name) => SHOT_FILE_PATTERN.test(name)) : [];
}

/**
 * The run's one-shot teardown: close the browser, then remove the temp profile even when
 * closing failed. Never throws (a failure is logged), so it cannot mask the run's own error;
 * every call after the first returns the first call's promise.
 *
 * @param {() => Promise<void> | void} closeBrowser Closes the context (no-op before launch).
 * @param {() => void} removeProfile Deletes the temp profile folder.
 * @param {(message: string) => void} log Reports a teardown failure.
 * @returns {() => Promise<void>} The teardown.
 */
export function createTeardown(closeBrowser, removeProfile, log) {
  /** @type {Promise<void> | undefined} */
  let pending;
  /**
   * Run both steps, each failure logged.
   *
   * @returns {Promise<void>} Settles once both steps ran.
   */
  const run = async () => {
    try {
      await closeBrowser();
    } catch (cause) {
      log(`could not close the browser: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    try {
      removeProfile();
    } catch (cause) {
      log(
        `could not remove the temp profile: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    }
  };
  return () => (pending ??= run());
}

/**
 * The conventional exit code of a process stopped by a signal: 128 + the signal number.
 *
 * @param {NodeJS.Signals} signal The signal.
 * @returns {number} E.g. 130 for SIGINT, 143 for SIGTERM.
 */
export function signalExitCode(signal) {
  return 128 + osConstants.signals[signal];
}

/**
 * The package root: this script lives at `<root>/scripts/`.
 *
 * @returns {string} Absolute root path.
 */
function packageRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Read a file, or null when it does not exist.
 *
 * @param {string} path Absolute path.
 * @returns {string | null} Its text.
 */
function readOptional(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * Refuse a site that does not answer the inspected page with a 2xx.
 *
 * @param {string} url The page URL.
 * @throws {Error} Naming the URL, the cause and the fix.
 */
async function probeSite(url) {
  let status;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(SITE_PROBE_TIMEOUT_MS) });
    status = response.status;
  } catch (cause) {
    throw new Error(
      // fetch wraps the network error (e.g. ECONNREFUSED) one level down: name that one.
      `The docker site does not answer ${url} (${String(cause instanceof Error && cause.cause !== undefined ? cause.cause : cause)}) — start it with docker/scripts/up.sh`
    );
  }
  if (status < 200 || status > 299)
    throw new Error(`The docker site answered ${url} with HTTP ${String(status)}`);
}

/**
 * Wait for one panel route's ready body: the route's own page rendered (never the boot
 * skeleton nor a chunk-loading frame), then — best effort — no skeleton left.
 *
 * @param {import('@playwright/test').Page} page The panel page.
 * @param {string} route The route id.
 * @returns {Promise<string[]>} Warnings (a lingering skeleton).
 * @throws {Error} When the panel never boots into the route (boot error, unavailable data, timeout).
 */
async function panelReady(page, route) {
  try {
    await page.waitForFunction(
      (id) => {
        if (document.querySelector('[data-fdt="data-unavailable"]') !== null) return true;
        const body = document.querySelector(`[data-fdt-page="${id}"]`);
        // A boot error renders outside any route page; a route's own error view stays inside.
        const bootError = [...document.querySelectorAll('[data-fdt="error-state"]')].some(
          (element) => element.closest('[data-fdt-page]') === null
        );
        return (
          bootError ||
          (body !== null && body.querySelector('[data-fdt-page-chunk-loading]') === null)
        );
      },
      route,
      { timeout: READY_TIMEOUT_MS }
    );
  } catch (cause) {
    throw new Error(
      `The panel never rendered route "${route}" within ${String(READY_TIMEOUT_MS)} ms`,
      { cause }
    );
  }
  const failure = await page.evaluate((id) => {
    const unavailable = document.querySelector('[data-fdt="data-unavailable"]');
    if (unavailable !== null) return unavailable.textContent;
    return document.querySelector(`[data-fdt-page="${id}"]`) === null
      ? (document.querySelector('[data-fdt="error-state"]')?.textContent ?? 'unknown boot failure')
      : null;
  }, route);
  if (failure !== null)
    throw new Error(`The panel did not boot on route "${route}": ${failure.trim()}`);
  return await settle(page);
}

/**
 * Wait for the options page's ready body: its first option row rendered, then — best
 * effort — no skeleton left (the freshness card reads storage after the rows).
 *
 * @param {import('@playwright/test').Page} page The options page.
 * @returns {Promise<string[]>} Warnings.
 * @throws {Error} When no option row renders in time.
 */
async function optionsReady(page) {
  try {
    await page.locator('[data-fdt="option-row"]').first().waitFor({ timeout: READY_TIMEOUT_MS });
  } catch (cause) {
    throw new Error(
      `The options page rendered no option row within ${String(READY_TIMEOUT_MS)} ms`,
      { cause }
    );
  }
  return await settle(page);
}

/**
 * Let a ready page settle: skeletons gone (bounded; a lingering one is reported, since some
 * live reads legitimately stay pending), fonts loaded, animations finished, two frames painted.
 *
 * @param {import('@playwright/test').Page} page The page.
 * @returns {Promise<string[]>} Warnings for the run summary.
 */
async function settle(page) {
  /** @type {string[]} */
  const warnings = [];
  try {
    await page.waitForFunction(
      () => document.querySelector('[data-fdt="skeleton"]') === null,
      undefined,
      { timeout: SKELETON_TIMEOUT_MS }
    );
  } catch {
    warnings.push(`skeleton still shown after ${String(SKELETON_TIMEOUT_MS)} ms`);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    const deadline = performance.now() + 2_000;
    while (
      document.getAnimations().some((animation) => animation.playState === 'running') &&
      performance.now() < deadline
    ) {
      await new Promise((done) => setTimeout(done, 50));
    }
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  return warnings;
}

/**
 * Open the inspected site page with a desktop user agent and resolve its tab id the way the
 * service worker sees it (exact URL; exactly one tab must match).
 *
 * @param {import('@playwright/test').BrowserContext} context The browser context.
 * @param {import('@playwright/test').Worker} worker The extension service worker.
 * @param {string} url The site page URL.
 * @returns {Promise<number>} The tab id.
 * @throws {Error} When the page fails to load or no single tab matches.
 */
async function openSiteTab(context, worker, url) {
  const page = await context.newPage();
  const userAgent = desktopUserAgent(await page.evaluate(() => navigator.userAgent));
  // The same override Playwright's `userAgent` context option applies, scoped to this tab.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setUserAgentOverride', { userAgent });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: 'load' });
  const ids = await worker.evaluate(
    async (pattern) => (await chrome.tabs.query({ url: pattern })).map((tab) => tab.id),
    url
  );
  if (ids.length !== 1 || typeof ids[0] !== 'number') {
    throw new Error(`Expected exactly one tab at ${url}, found ${String(ids.length)}`);
  }
  return ids[0];
}

/**
 * Settle the header capture before the inspected page loads: a fresh worker can miss the very
 * first main-frame response while it registers its listeners, so one worker evaluation runs
 * first and one throwaway page absorbs any miss (its own tab, closed at once).
 *
 * @param {import('@playwright/test').BrowserContext} context The browser context.
 * @param {import('@playwright/test').Worker} worker The extension service worker.
 * @param {string} siteUrl The site's base URL.
 */
async function warmUp(context, worker, siteUrl) {
  await worker.evaluate(() => true);
  const page = await context.newPage();
  try {
    await page.goto(`${siteUrl}/`, { waitUntil: 'load' });
  } finally {
    await page.close();
  }
}

/**
 * Capture one shot on a fresh page (palette and size set before its first navigation). The
 * image is written even when the page shows an error view, so a failing run can be diagnosed.
 *
 * @param {import('@playwright/test').BrowserContext} context The browser context.
 * @param {{surface: string, palette: string, width: number, file: string}} shot The shot.
 * @param {{extensionId: string, tabId: number, pageUrl: string, outDir: string}} run The run's fixed inputs.
 * @returns {Promise<{warnings: string[], errorTexts: string[]}>} Its warnings and error views.
 */
async function captureShot(context, shot, run) {
  const page = await context.newPage();
  try {
    await page.emulateMedia({
      colorScheme: /** @type {'dark' | 'light'} */ (shot.palette),
      reducedMotion: 'reduce'
    });
    await page.setViewportSize({ width: shot.width, height: HEIGHT });
    const base = `chrome-extension://${run.extensionId}`;
    let warnings;
    if (shot.surface === OPTIONS_SURFACE) {
      await page.goto(`${base}/options.html`, { waitUntil: 'load' });
      warnings = await optionsReady(page);
    } else {
      await page.addInitScript(devtoolsShim(run.tabId, run.pageUrl));
      await page.goto(`${base}/panel.html#/${shot.surface}`, { waitUntil: 'load' });
      warnings = await panelReady(page, shot.surface);
    }
    const errorTexts = await page.evaluate(errorViewTexts, ERROR_VIEW_SELECTOR);
    // Full page: the options page scrolls its document; the panel's own scrollers keep it to the viewport.
    await page.screenshot({ path: join(run.outDir, shot.file), fullPage: true });
    return { warnings, errorTexts };
  } finally {
    await page.close();
  }
}

/**
 * Load the e2e tier's host-resolver switch from its TypeScript module (Vite transpiles it and
 * its `lib/` imports), so the blocked hosts are declared in one place.
 *
 * @param {string} root The package root.
 * @returns {Promise<string>} The `--host-resolver-rules=…` switch.
 * @throws {Error} When the module cannot be loaded or no longer exports a valid switch.
 */
async function loadHostResolverRules(root) {
  const source = join(root, 'tests', 'e2e', 'helpers', 'blocked-hosts.ts');
  const { runnerImport } = await import('vite');
  /** @type {{ HOST_RESOLVER_RULES?: unknown }} */
  let module;
  try {
    ({ module } = await runnerImport(source, { root, logLevel: 'silent' }));
  } catch (cause) {
    throw new Error(`Could not load the blocked remote hosts from ${source}`, { cause });
  }
  return checkHostResolverRules(module.HOST_RESOLVER_RULES, source);
}

/**
 * Delete the output folder's previous shots per {@link staleShotFiles}.
 *
 * @param {string} outDir The output folder (exists).
 * @param {readonly string[] | null} only The `--only` ids, or null for a full run.
 * @returns {number} How many files were deleted.
 */
function clearStaleShots(outDir, only) {
  const stale = staleShotFiles(readdirSync(outDir), only);
  for (const name of stale) rmSync(join(outDir, name));
  return stale.length;
}

/**
 * Stop on SIGINT / SIGTERM: the first signal closes the browser and removes the profile
 * (Playwright's own handlers are off, so nothing else races it) before exiting; a second one
 * removes the profile and exits at once (Playwright's exit hook kills the browser).
 *
 * @param {() => Promise<void>} teardown The run's teardown.
 * @param {() => void} removeProfile Deletes the temp profile folder.
 * @returns {() => void} Removes the handlers.
 */
function stopOnSignals(teardown, removeProfile) {
  let stopping = false;
  /**
   * Handle one signal.
   *
   * @param {NodeJS.Signals} signal The signal received.
   */
  const onSignal = (signal) => {
    const code = signalExitCode(signal);
    if (stopping) {
      removeProfile();
      process.exit(code);
    }
    stopping = true;
    console.error(`[screenshots] ${signal}: closing the browser (repeat to exit at once)`);
    void teardown().then(() => process.exit(code));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
}

/**
 * Run the harness: validate inputs, launch the browser, capture every shot, clean up.
 *
 * @param {readonly string[]} argv The arguments after the script path.
 * @throws {Error} On any fail-fast input, a boot that never becomes ready, or shots with error views.
 */
async function main(argv) {
  const root = packageRoot();
  const options = parseArgs(argv, root);
  const extensionPath = join(root, '.output', 'chrome-mv3');
  if (!existsSync(join(extensionPath, 'manifest.json'))) {
    throw new Error(`No Chromium build at ${extensionPath} — run \`pnpm build\` first`);
  }
  const envFile = join(root, 'docker', '.env');
  const siteUrl = resolveSiteUrl(process.env[SITE_URL_KEY], readOptional(envFile), envFile);
  const pageUrl = `${siteUrl}${options.page}`;
  await probeSite(pageUrl);
  const routesFile = join(root, 'entrypoints', 'panel', 'routes.ts');
  const surfaces = selectSurfaces(parseRouteIds(readFileSync(routesFile, 'utf8')), options.only);
  const shots = shotPlan(surfaces);
  const hostResolverRules = await loadHostResolverRules(root);

  // Loaded here, not at module scope: the pure helpers above stay importable without a browser.
  const { chromium } = await import('@playwright/test');
  const profileDir = mkdtempSync(join(tmpdir(), 'wpr-fdt-screens-'));
  /** @type {import('@playwright/test').BrowserContext | undefined} */
  let context;
  /** Delete the temp profile folder (sync: it also runs right before a forced exit). */
  const removeProfile = () => {
    rmSync(profileDir, { recursive: true, force: true });
  };
  const teardown = createTeardown(
    () => context?.close(),
    removeProfile,
    (message) => {
      console.error(`[screenshots] ${message} (profile: ${profileDir})`);
    }
  );
  const releaseSignals = stopOnSignals(teardown, removeProfile);
  /** @type {string[]} */
  const failures = [];
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: !options.headed,
      // Signals are ours (stopOnSignals): the profile is removed before the process exits.
      handleSIGINT: false,
      handleSIGTERM: false,
      // Real scrollbars: their painting and layout belong in the picture.
      ignoreDefaultArgs: ['--hide-scrollbars'],
      timeout: 30_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        // The e2e tier's blocked remote hosts: no run reaches a real service.
        hostResolverRules
      ]
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 20_000 }));
    const extensionId = new URL(worker.url()).host;
    await warmUp(context, worker, siteUrl);
    const tabId = await openSiteTab(context, worker, pageUrl);
    mkdirSync(options.outDir, { recursive: true });
    const cleared = clearStaleShots(options.outDir, options.only);
    if (cleared > 0) console.log(`[screenshots] deleted ${String(cleared)} previous shots`);
    for (const shot of shots) {
      const { warnings, errorTexts } = await captureShot(context, shot, {
        extensionId,
        tabId,
        pageUrl,
        outDir: options.outDir
      });
      for (const warning of warnings) console.warn(`[screenshots] ${shot.file}: ${warning}`);
      const failure = shotFailure(shot, errorTexts);
      if (failure !== null) failures.push(failure);
    }
    console.log(
      `[screenshots] ${String(shots.length)} images → ${options.outDir} (inspected ${pageUrl})`
    );
  } finally {
    releaseSignals();
    await teardown();
  }
  if (failures.length > 0) {
    throw new Error(
      `${String(failures.length)} shot(s) captured an error view:\n  ${failures.join('\n  ')}`
    );
  }
}

// Run only as a CLI: tests import the pure helpers above.
if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? `\n  cause: ${error.cause.message}`
        : '';
    console.error(
      `[screenshots] ${error instanceof Error ? error.message : String(error)}${cause}`
    );
    process.exitCode = 1;
  });
}
