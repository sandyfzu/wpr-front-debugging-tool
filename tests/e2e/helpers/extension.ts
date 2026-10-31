/**
 * The extension driver: launches Chromium (headless by default, headed via
 * `E2E_HEADED=1`) with the unpacked `.output/chrome-mv3` bundle and drives
 * everything beyond page DOM from the service worker context.
 *
 * Headless is the gate's mode so a regression run never seizes the
 * developer's foreground; the opt-in headed mode remains for debugging.
 * Extension hosting in headless uses the `chromium` channel's modern
 * headless (the legacy headless shell cannot host extensions — the reason
 * the tier was headed-only when it was built).
 *
 * Drive surface (what the README calls the "SW drive plane"):
 * - `evaluateInWorker` runs code inside the extension service worker. The MV3
 *   service worker is exposed by Playwright as a Worker target
 *   (`context.serviceWorkers()` / the `serviceworker` event), and its handle
 *   survives Chromium's own idle suspension transparently.
 * - Extension messaging is exercised over the protocol's wire shape: the
 *   installed `@webext-core/messaging` v4 envelope is
 *   `{ id, type, data, timestamp }`, so the harness sends the extension's
 *   real channels (`getFdtData`, `openSideBySide`, …) from the SW with no
 *   extension-bundle import needed.
 * - Menu state is probed with duplicate-create semantics: the extension
 *   contextMenus API has no read-back (`getAll` does not exist in Chromium —
 *   verified live), so "an entry exists exactly once" is observable as
 *   "creating a second item with that id fails with the duplicate-id
 *   lastError".
 *
 * Suites import `test`/`expect` from here — never directly from
 * `@playwright/test` — so the launch, profile, and drive behavior stay in
 * one place.
 */

import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  test as base,
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type Worker
} from '@playwright/test';

import { LATEST_LIST_ENDPOINT } from '../../../lib/wp-rocket-simulation/latest-list';

/**
 * Bounded launch wait. Playwright applies its launch `timeout` only with the
 * explicit option here: verified live on this Chromium build, a wrong
 * `--load-extension` path leaves the launch promise unsettled for minutes
 * with the default, so the harness bounds it itself and reports the bundle
 * path on failure.
 */
const LAUNCH_TIMEOUT_MS = 30_000;

/** The unpacked bundle the harness loads (the current `pnpm build` output). */
export const EXTENSION_PATH = path.resolve(
  import.meta.dirname, // tests/e2e/helpers
  '..',
  '..',
  '..', // repo root
  '.output',
  'chrome-mv3'
);

/**
 * Remote hosts the browser resolves to nothing (`~NOTFOUND`, Chromium's
 * host-resolver rule): the background fetches the latest exclusion list at
 * every start, and a test run must never reach the real endpoint. Its
 * refresh therefore misses with a network error, and the simulation runs
 * the bundled list unless a suite keeps a copy (`helpers/simulation.ts`).
 */
const BLOCKED_REMOTE_HOSTS: readonly string[] = [new URL(LATEST_LIST_ENDPOINT).hostname];

/** Chromium's resolver rule for {@link BLOCKED_REMOTE_HOSTS}. */
const HOST_RESOLVER_RULES = `--host-resolver-rules=${BLOCKED_REMOTE_HOSTS.map((host) => `MAP ${host} ~NOTFOUND`).join(', ')}`;

/** The fixture server's primary local origin (`localhost`; `127.0.0.1` is
 * the distinct-origin partner, exercised through the cross-origin fixture's
 * `location.port` derivation). The port rides `E2E_FIXTURE_PORT` (the
 * override the config's health gate and `server.mjs` read; default 8891,
 * the documented pinned port). */
const FIXTURE_PORT = Number(process.env.E2E_FIXTURE_PORT ?? 8891);
export const ORIGIN_A = `http://localhost:${String(FIXTURE_PORT)}`;

/** The eight menu ids the background's registry creates (the parity probe's list). */
export const MENU_PARITY_IDS = [
  'wprSideBySide',
  'psiSideBySide',
  'updateKnownConflictsDB',
  'exclusionBuilder',
  'toggleDetectionWidget',
  'openNowProcket',
  'openCommandPalette',
  'pageUiGate'
] as const;

/** Probe id outside the registry: proves the probe can answer "absent". */
const MENU_ABSENCE_CONTROL_ID = 'e2e-scratch-existence-probe';

/** The protocol wire shape of `@webext-core/messaging` v4 (verified dist). */
interface WireEnvelope {
  id: number;
  type: string;
  data: unknown;
  timestamp: number;
}

/** Harness-side envelope counter — concurrent sends must not share ids. */
let wireIdSequence = 0;

/**
 * Build one protocol message envelope for the SW-side sends.
 *
 * @param type The protocol channel name.
 * @param data The payload (`undefined` for no-payload protocol rows).
 */
function wireEnvelope(type: string, data: unknown): WireEnvelope {
  wireIdSequence += 1;
  return { id: wireIdSequence, type, data, timestamp: Date.now() };
}

/**
 * What the contextMenus registry answered when probing one id.
 * - `registered`: a duplicate create was refused — the id existed exactly
 *   once already (the API makes a second item with the same id impossible);
 * - `was-absent`: the probe had to create it; with {@link undoProbeItem} the
 *   transient row is removed again so the registry is left untouched.
 */
type MenuExists = 'registered' | 'was-absent';

/**
 * One extension install over one browser profile. Owns the persistent
 * headed context, the bundle path, and the service-worker drive helpers.
 * Suites use it through the {@link test} fixture: `extension`.
 */
export class ExtensionDriver {
  /** The live persistent context — replaced wholesale by a relaunch. */
  private context!: BrowserContext;

  /** Profile directory on disk; must survive a relaunch unchanged. */
  private readonly profileDir: string;

  /** Profile cleanup hook (the fixture deletes the temp dir when told). */
  private readonly cleanup: (profileDir: string, reason: string) => void;

  /**
   * Create an unlaunched driver (the fixture does the launch).
   *
   * @param profileDir An existing directory to launch the profile in.
   * @param cleanup Teardown hook (receives the profile dir it may delete).
   */
  private constructor(profileDir: string, cleanup: (profileDir: string, reason: string) => void) {
    this.profileDir = profileDir;
    this.cleanup = cleanup;
  }

  /** The live context. */
  get browserContext(): BrowserContext {
    return this.context;
  }

  /**
   * Launch the driver: Chromium (headless by default, headed via
   * `E2E_HEADED=1`) with the unpacked extension on a fresh profile.
   *
   * Extension loading uses the only supported command-line pair
   * (`--disable-extensions-except` + `--load-extension`, Playwright docs),
   * and the `chromium` channel from the same docs. The installed Chromium
   * version here (156.0.8078.4) is above the manifest's 145 floor.
   *
   * @param cleanup Profile teardown hook (receives the profile dir).
   */
  static async launch(
    cleanup: (profileDir: string, reason: string) => void
  ): Promise<ExtensionDriver> {
    const profileDir = mkdtempSync(path.join(tmpdir(), 'wpr-fdt-e2e-'));
    const driver = new ExtensionDriver(profileDir, cleanup);
    await driver.openContext();
    return driver;
  }

  /** Start (or restart) the persistent context on {@link profileDir}. */
  private async openContext(extraArgs: readonly string[] = []): Promise<void> {
    try {
      // Headless unless `E2E_HEADED=1`: the gate must not seize the
      // developer's foreground, and the `chromium` channel's modern headless
      // hosts extensions (the legacy headless shell cannot — the reason this
      // tier launched headed-only when it was built).
      this.context = await chromium.launchPersistentContext(this.profileDir, {
        channel: 'chromium',
        headless: process.env.E2E_HEADED !== '1',
        // Playwright hides painted scrollbars in headless by default. Keep real
        // scrollbar geometry/painting so layout and visibility assertions are honest.
        ignoreDefaultArgs: ['--hide-scrollbars'],
        viewport: { width: 1280, height: 800 },
        timeout: LAUNCH_TIMEOUT_MS,
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          // Every launch, relaunches included: no run ever reaches these hosts.
          HOST_RESOLVER_RULES,
          ...extraArgs
        ]
      });
    } catch (cause) {
      throw new Error(
        [
          `Launching Chromium with the unpacked extension timed out or failed after ${String(LAUNCH_TIMEOUT_MS)} ms.`,
          `extension path: ${EXTENSION_PATH}`,
          'usual causes: the bundle is missing or not a valid unpacked build (manifest.json present) — rebuild with `pnpm build`'
        ].join('\n'),
        { cause }
      );
    }
    // The install event has already fired by the time the worker target
    // exists, so the menu registry is complete the moment it appears —
    // waiting here gives every suite a settled extension.
    try {
      await this.serviceWorker();
    } catch (cause) {
      // Close the half-working context so failed launches leave no headed
      // windows behind and no 90 s teardown hang; close failures surface
      // next to the launch failure instead of dying silently.
      try {
        await this.context.close();
      } catch (closeCause: unknown) {
        console.error(
          `[e2e] closing the browser after the failed extension launch also failed: ${String(closeCause)}`
        );
      }
      throw new Error(
        [
          `The extension service worker did not appear within 20 s after the launch.`,
          `extension path: ${EXTENSION_PATH}`,
          'usual causes: the bundle has no background entrypoint registered, or the MV3 worker crashed — rebuild with `pnpm build`'
        ].join('\n'),
        { cause }
      );
    }
    await ExtensionDriver.warmUpHeaderCapture(this.context);
  }
  /**
   * Warm up the header capture after a launch so a fresh worker's FIRST
   * navigation cannot miss it.
   *
   * Environment fact (verified live, 4/4 against the current Chromium for
   * Testing): the very first main-frame response can arrive while the
   * service worker's first evaluation is still registering the
   * `onResponseStarted` listener — that page's capture is lost (its served
   * `pageHeaders` stays null), and every later navigation captures
   * deterministically. One throwaway local page absorbs the window: its
   * (possibly missed) capture belongs to its own throwaway tab, which is
   * closed immediately.
   *
   * @param context The freshly launched context.
   */
  private static async warmUpHeaderCapture(context: BrowserContext): Promise<void> {
    const page = await context.newPage();
    try {
      await page.goto(`${ORIGIN_A}/`, { waitUntil: 'load', timeout: 10_000 });
    } catch (cause) {
      // The warm-up page is a settle step, never a suite fact; a failure to
      // load it is reported and the run continues (the suites' own first
      // pages then surface any real capture problem).
      console.error(`[e2e] the capture warm-up page failed to load: ${String(cause)}`);
    }
    await page.close();
  }

  /**
   * The extension service worker handle, waiting for the target on a fresh
   * launch. Playwright keeps the same Worker object valid across Chromium's
   * MV3 idle suspension, so handles stay usable page-lifetime long.
   */
  async serviceWorker(): Promise<Worker> {
    const existing = this.context.serviceWorkers()[0];
    return existing ?? (await this.context.waitForEvent('serviceworker', { timeout: 20_000 }));
  }

  /**
   * The extension id, derived the way the Playwright extension docs do it:
   * the worker URL's `chrome-extension://<id>/` host segment.
   */
  async extensionId(): Promise<string> {
    const worker = await this.serviceWorker();
    return new URL(worker.url()).host;
  }

  /**
   * Evaluate code inside the service worker's module context — the surface
   * every extension-side assertion flows through.
   *
   * @typeParam R Serializable return; `undefined` when the body returns nothing.
   * @typeParam Arg One structured-clone-able argument.
   * @param body The function to run in the worker (may be async).
   * @param arg Its argument.
   */
  async evaluateInWorker<R, Arg>(body: (arg: Arg) => R | Promise<R>, arg: Arg): Promise<R> {
    const worker = await this.serviceWorker();
    // Worker.evaluate's own generics unwrap `Arg` (Unboxed) at its call site,
    // which cannot be instantiated through a forwarding helper — the shape
    // delegated here is exactly its (pageFunction, arg) contract.
    // Bound, so the extraction cannot lose the worker as its receiver.
    const evaluate = worker.evaluate.bind(worker) as (
      fn: (a: Arg) => R | Promise<R>,
      a: Arg
    ) => Promise<R>;
    return await evaluate(body, arg);
  }

  /**
   * The extension "reload"/relaunch leg, shaped for this environment: the
   * in-place `chrome.runtime.reload()` is NOT reproducible here — in this
   * Chromium build (Playwright's Chromium-for-Testing), any extension that
   * declares content scripts vanishes from Chrome's own extension registry
   * after the reload, never revives, and chrome://extensions-internals no
   * longer lists it (verified live; recorded in the phase doc). The harness
   * therefore closes the browser and relaunches on the SAME profile: the
   * bundle re-registers over persistent extension-owned browser state, which
   * is the behavior the phase checklist asserts (the menu ids survive
   * extension reload exactly once).
   *
   * @param extraArgs Additional Chromium command-line switches for the
   *   relaunch (e.g. a dead-proxy pair that deterministically blocks
   *   network-bound fetches for an offline-boot leg). They last for the
   *   relaunch's context, i.e. the rest of the owning suite file.
   */
  async relaunch(extraArgs: readonly string[] = []): Promise<void> {
    await this.context.close();
    await this.openContext(extraArgs);
  }

  /**
   * Close the browser and run the profile cleanup.
   *
   * @param reason Suites/teardown name why (logged on failures only).
   */
  async close(reason: string): Promise<void> {
    await this.context.close();
    this.cleanup(this.profileDir, reason);
  }

  /**
   * Duplicate-create probe for one menu id. This is the only existence
   * signal the contextMenus API offers; it says nothing about title or
   * contexts (the title/contexts/documentUrlPatterns parity is pinned by the
   * P2 unit table, not the runtime — the API cannot be read back).
   *
   * @param id The menu id to probe.
   * @param undo When the probe had to create a transient item, remove it
   *   again (the absence control needs a clean registry this way).
   * @returns `registered` (the id was occupied, once) or `was-absent`.
   */
  async probeMenuId(id: string, undo: boolean): Promise<MenuExists> {
    return await this.evaluateInWorker(
      (probe: { probe: MenuProbe; undoTransient: boolean }) =>
        new Promise<MenuExists>((resolve) => {
          chrome.contextMenus.create(
            { id: probe.probe.id, title: probe.probe.title, contexts: ['action'] },
            () => {
              if (chrome.runtime.lastError) {
                resolve('registered');
                return;
              }
              if (!probe.undoTransient) {
                resolve('was-absent');
                return;
              }
              // The probe's own transient row is undone; the lastError read
              // (before resolving) keeps it acknowledged — a failed undo
              // cannot change the answer either way: the row was this
              // probe's own item, so the id genuinely was absent before.
              chrome.contextMenus.remove(probe.probe.id, () => {
                // The undo's lastError (impossible for this probe's own
                // fresh row) is read either way so the flag gets cleared.
                if (chrome.runtime.lastError !== undefined) {
                  resolve('was-absent');
                  return;
                }
                resolve('was-absent');
              });
            }
          );
        }),
      { probe: { id, title: 'e2e existence probe' } satisfies MenuProbe, undoTransient: undo }
    );
  }

  /** Every registered menu id at once. */
  async probeRegisteredMenus(): Promise<MenuExists[]> {
    const results: MenuExists[] = [];
    for (const id of MENU_PARITY_IDS) results.push(await this.probeMenuId(id, false));
    return results;
  }

  /**
   * The absence control: a scratch id outside the registry must answer
   * `was-absent`, and re-asking after the probe's own undo affirms the
   * transient item was really removed (the probe never pollutes the
   * registry it inspects).
   */
  async probeAbsenceControl(): Promise<void> {
    const first = await this.probeMenuId(MENU_ABSENCE_CONTROL_ID, true);
    expect(first, 'the scratch probe id must not be pre-registered').toBe('was-absent');
    const again = await this.probeMenuId(MENU_ABSENCE_CONTROL_ID, true);
    expect(again, 'the removed scratch row must stay absent after its probe undo').toBe(
      'was-absent'
    );
  }

  /**
   * Send a protocol message from the service worker to one tab, and await
   * the content script's typed response. This is the panel-less pull
   * mechanism: `getFdtData` is the panel's own channel, driven here so every
   * suite can read the content script's accumulated page truth.
   *
   * @typeParam R The declared return type of the protocol row.
   * @param tabId The target tab's id.
   * @param type The channel name.
   * @param data The payload (omitted for no-payload protocol rows).
   * @returns The content script's response for that envelope.
   */
  async sendToTab<R>(tabId: number, type: string, data?: unknown): Promise<R> {
    return await this.evaluateInWorker(
      (call: { envelope: WireEnvelope; target: number }): Promise<R> =>
        new Promise<R>((resolve, reject) => {
          chrome.tabs.sendMessage(
            call.target,
            call.envelope,
            (reply: { res?: unknown; err?: string } | undefined) => {
              if (chrome.runtime.lastError !== undefined) {
                reject(
                  new Error(
                    `sw → tab ${String(call.target)} message "${call.envelope.type}" failed: ${String(chrome.runtime.lastError.message)}`
                  )
                );
                return;
              }
              if (reply !== undefined && reply.err !== undefined) {
                reject(
                  new Error(
                    `sw → tab ${String(call.target)} message "${call.envelope.type}" rejected: ${reply.err}`
                  )
                );
                return;
              }
              resolve(reply !== undefined ? (reply.res as R) : (undefined as R));
            }
          );
        }),
      { envelope: wireEnvelope(type, data), target: tabId }
    );
  }
}

/** A menu-existence probe row (id is what matters; title satisfies the API). */
interface MenuProbe {
  id: string;
  title: string;
}

/** A page open in the driver's browser, with its service-worker-view tab id. */
export interface DriverPage {
  /** The Playwright page handle. */
  page: Page;
  /** The tab id the service worker sees for this page. */
  tabId: number;
}

/**
 * Open a fixture page in the driver's browser and resolve its tab id the way
 * the service worker must (`chrome.tabs.query` against the exact URL; host
 * permissions already cover both local origins).
 *
 * Every fixture page gets a unique `e2e-tab` query parameter — `tabs.query`
 * matches URLs literally (only `*` is special), so with several same-path
 * pages open (suites share the browser), only the freshly created page
 * matches its own id and every SW-side drive targets the right tab.
 *
 * @param driver The extension driver.
 * @param urlPath The path part of the fixture (below the server root).
 * @param origin Which local origin to load from (default the first).
 * @param beforeNavigate Optional hook between page creation and navigation —
 *   where console/pageerror listeners must attach, so every fixture emits
 *   into an already-listening capture.
 * @returns The page plus its tab id.
 */
export async function openFixturePage(
  driver: ExtensionDriver,
  urlPath: string,
  origin: string = ORIGIN_A,
  beforeNavigate?: (page: Page) => void
): Promise<DriverPage> {
  const page = await driver.browserContext.newPage();
  if (beforeNavigate !== undefined) beforeNavigate(page);
  tabIdentitySequence += 1;
  const fullUrl = `${origin}${urlPath}${urlPath.includes('?') ? '&' : '?'}e2e-tab=${String(tabIdentitySequence)}`;
  await page.goto(fullUrl, { waitUntil: 'load' });
  const tabId = await driver.evaluateInWorker(
    (pattern: string) => chrome.tabs.query({ url: pattern }).then((tabs) => tabs[0]?.id ?? null),
    fullUrl
  );
  if (tabId === null) {
    throw new Error(
      `No tab matched ${fullUrl} — content script routes cannot be driven without its tab id`
    );
  }
  return { page, tabId };
}

/** Monotonic per-run tab-identity suffix (a unique query key per fixture page). */
let tabIdentitySequence = 0;

/**
 * The panel page's URL under the driven extension install — the extension
 * shell the panel suites drive as a standalone extension page (no DevTools
 * window; the store's missing-inspected-tab degradation is part of what it
 * answers honestly).
 *
 * @param extension The extension driver.
 * @returns The `chrome-extension://…/panel.html` URL.
 */
export async function panelPageUrl(extension: ExtensionDriver): Promise<string> {
  const id = await extension.extensionId();
  return `chrome-extension://${id}/panel.html`;
}

/**
 * The suite-facing Playwright test: one installed extension per WORKER (per
 * test file on parallel runs) — the second generic maps the worker-scoped
 * fixture type (Playwright's extend<T, W> contract).
 */
/**
 * Additional test-scoped fixtures: none — every pre-created surface lives in
 * the worker fixture below (a worker fixture cannot depend on test fixtures,
 * and suites create their own pages from the driver anyway).
 */
interface DriverTestFixtures {
  /** Marker type: no test-scoped fixture is declared here. */
  readonly none?: undefined;
}

export const test = base.extend<DriverTestFixtures, { extension: ExtensionDriver }>({
  extension: [
    async ({}, use) => {
      const driver = await ExtensionDriver.launch((profileDir) => {
        rmSync(profileDir, { recursive: true, force: true });
      });
      await use(driver);
      await driver.close('teardown');
    },
    {
      // One install per WORKER (per test file on parallel runs): the suites
      // explore one extension's real state, not N reinstall races.
      scope: 'worker',
      timeout: 60_000
    }
  ]
});

/** Re-exported so suites do not import from two places. */
export { expect };
