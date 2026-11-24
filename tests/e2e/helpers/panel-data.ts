/**
 * The panel-data-path seam: a panel page whose devtools accessor reports a
 * REAL inspected tab.
 *
 * Why this exists: the panel asks the page for its data through the typed
 * `getFdtData` runtime contract, targeted at `devtools.inspectedWindow.tabId`
 * — the value only Chrome itself provides inside a real DevTools window. A
 * standalone panel page (the harness's only drivable form) carries no
 * inspected tab, so its boot flight broadcasts to the runtime and content
 * scripts never answer broadcasts; the suite would stay pinned to the
 * recorded-error boot forever. This seam writes exactly that one value —
 * the harness's stand-in for Chrome — and lets every other step run through
 * the shipped app code: the real boot fetch, the real content script's
 * processed page data, the real boundary validation, the real push channels
 * and their sender-tab scoping. Detections are never injected into the
 * panel's store: a fixture page's real detection output is the fixture.
 *
 * Verified installer facts (recorded once, probed 2026-10-14 on the harness
 * Chromium build):
 * - `page.addInitScript` runs on `chrome-extension://` documents, before the
 *   panel's module graph evaluates — the accessor reads the shim at boot.
 * - Extension pages in this build carry TWO distinct namespace objects
 *   (`window.chrome` and a separate `window.browser`, both with
 *   `runtime.id`), and the shipped accessor resolves through the `browser`
 *   global first; a `chrome`-only shim was empirically IGNORED by the
 *   panel's boot flight. The shim therefore stamps both objects — arbitrary
 *   extension-page mechanics it must not assume away.
 *
 * Everything below is harness-only: no shipped module imports this file.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import { openFixturePage, panelPageUrl, type DriverPage, type ExtensionDriver } from './extension';

/** Re-exported for the suites that open fixture pages or resolve the panel
 * document's URL themselves (the panel-data file is the harness's one
 * entrypoint for both). */
export { openFixturePage, panelPageUrl };

/** A panel page and the fixture tab it inspects through the devtools contract. */
export interface InspectedPanel {
  /** The panel page (boot included; asserts read the resolved shell). */
  readonly panel: Page;
  /** The fixture page its data comes from (the tab the panel's sends target). */
  readonly fixture: DriverPage;
}

/**
 * The init script the seam installs: stamp `devtools.inspectedWindow.tabId`
 * onto every namespace object the extension page exposes (`chrome` and
 * `browser` — see the file header's verified facts), and — only when the
 * suite passes {@link OpenPanelOptions.inspect} — the resource table and
 * page origin the undefined-references reader enumerates through. That stub
 * answers with suite-provided values only; the shipped adapter's shape
 * checks, the definition search and the store flow around it are app code.
 * With {@link OpenPanelOptions.openResource} it also stamps a recording
 * `devtools.panels.openResource` (see {@link OPEN_RESOURCE_CALLS}).
 *
 * Exported for the suites that need the shim and the panel document's own
 * boot hash in different orders (the report's inspected-URL stub rides one
 * opening); its shape is the harness's only devtools stand-in.
 *
 * @param tabId The tab id a real DevTools window would report.
 * @param inspect The suite-provided resource stub, when one is needed.
 * @param openResource How the `panels.openResource` stub answers; omitted =
 *   no `panels` at all (the capability a standalone page lacks).
 * @returns The init script text for {@link Page.addInitScript}.
 */
export function devtoolsShim(
  tabId: number,
  inspect?: OpenPanelOptions['inspect'],
  openResource?: OpenPanelOptions['openResource']
): string {
  // The whole stub rides as a JSON literal: the init script self-contains it,
  // sharing no state with the suite beyond this call's arguments.
  const stub =
    inspect === undefined ? null : { origin: inspect.origin, resources: inspect.resources };
  return `(() => {
    const stub = ${JSON.stringify(stub)};
    const openMode = ${JSON.stringify(openResource ?? null)};
    // DevTools' own answer shapes: success is a status record with code OK;
    // a failure arrives as the callback argument (never runtime.lastError
    // alone), its details carrying the URL.
    const calls = [];
    window[${JSON.stringify(OPEN_RESOURCE_CALLS)}] = calls;
    const panels = openMode === null ? null : {
      openResource(url, lineNumber, callback) {
        calls.push([url, lineNumber]);
        callback(openMode === 'fail'
          ? { isError: true, code: 'E_NOTFOUND', description: 'Object not found: %s', details: [url] }
          : { code: 'OK', description: 'OK', details: [] });
      }
    };
    const inspectedWindow = stub === null
      ? { tabId: ${JSON.stringify(tabId)} }
      : {
          tabId: ${JSON.stringify(tabId)},
          eval: (expression, onComplete) => { onComplete(stub.origin, null); },
          getResources: (onComplete) => {
            onComplete(stub.resources.map((resource) => ({
              url: resource.url,
              type: 'script',
              getContent(onContent) { onContent(resource.content, ''); }
            })));
          }
        };
    const stamp = (namespace) => {
      if (namespace === undefined || namespace === null) return false;
      namespace['devtools'] = panels === null ? { inspectedWindow } : { inspectedWindow, panels };
      return true;
    };
    const win = window;
    stamp(win['chrome']);
    stamp(win['browser']);
  })()`;
}

/**
 * The panel window's property holding the `openResource` stub's calls, in
 * order: `[url, lineNumber]` each (read with {@link openResourceCalls}).
 */
export const OPEN_RESOURCE_CALLS = '__fdtOpenResourceCalls';

/**
 * The calls the `panels.openResource` stub recorded so far.
 *
 * @param panel The panel page opened with {@link OpenPanelOptions.openResource}.
 * @returns Each call's `[url, lineNumber]`, in order (empty without the stub).
 */
export async function openResourceCalls(panel: Page): Promise<[string, number][]> {
  return await panel.evaluate(
    (key) => (window as unknown as Record<string, [string, number][] | undefined>)[key] ?? [],
    OPEN_RESOURCE_CALLS
  );
}

/** One script resource the {@link OpenPanelOptions.inspect} stub answers with. */
export interface InspectedResourceStub {
  /**
   * The absolute http(s) URL DevTools would report — the fixture page's own
   * origin plus its path (the shipped reader only enumerates http(s)).
   */
  readonly url: string;
  /** The script source `getContent` answers with. */
  readonly content: string;
}

/** The seam's opening options (defaults keep the plain two-arg form). */
export interface OpenPanelOptions {
  /** Which local origin to load the fixture from (default ORIGIN_A). */
  readonly origin?: string;
  /**
   * The panel document's boot hash (`#/<route>`, e.g. `#/lazyload`) for
   * deep-link boots; the open resolves once that route's body is mounted.
   */
  readonly bootHash?: string;
  /**
   * Media emulation applied to the panel page BEFORE it navigates. The
   * palette must exist before the boot: Chromium applies a palette change
   * against an already-rendered document to its descendants with a ~2-frame
   * lag, inside which computed colors mix both arms (see the audit runner's
   * palette rule). Booting into the final palette leaves no flip to lag.
   */
  readonly emulation?: {
    /** The emulated `prefers-color-scheme` arm. */
    readonly colorScheme: 'dark' | 'light';
    /** The emulated reduced-motion state. */
    readonly reducedMotion?: 'reduce' | 'no-preference';
  };
  /**
   * The panel page's viewport, set BEFORE it navigates: the shell boots at
   * this width (its first layout and every width rule start there), never
   * resized into it. Omitted, the context default applies.
   */
  readonly viewport?: { readonly width: number; readonly height: number };
  /**
   * An init script evaluated on the panel page after the devtools stamp
   * but before its module graph — the smoothest window into a phase the
   * page's own boot belongs to (the perf suite installs its PerformanceObserver
   * here, so the cold mount is inside the observation). Nothing injected is
   * app state: it only listens on the timeline.
   */
  readonly panelInit?: string;
  /**
   * The undefined-references reader's `devtools.inspectedWindow` stub: one
   * fixture origin (what `eval('location.origin')` answers) and the script
   * resources `getResources` enumerates. Without it the seam stamps only the
   * tab id, and standalone panel pages have no resource table — exactly the
   * fact the suites that exercise the reader need stubbed.
   */
  readonly inspect?: {
    /** The page origin the reader reads (the fixture page's own origin). */
    readonly origin: string;
    /** The page's script resources (the fixture page's external scripts). */
    readonly resources: readonly InspectedResourceStub[];
  };
  /**
   * A recording `devtools.panels.openResource` (the Open in Sources seam):
   * `ok` answers DevTools' success record, `fail` its `E_NOTFOUND` status
   * record. Omitted, the page has no `panels` (its source links open tabs).
   */
  readonly openResource?: 'ok' | 'fail';
}

/**
 * Resolve a fixture tab and open the panel page inspecting it through the
 * typed data contract. The panel's own boot flight then runs exactly as it
 * does under a real DevTools window: a tab-targeted `getFdtData` request, the
 * content script's processed page data, the boundary validator, and the
 * push channels armed for the sender-tab-checked scope.
 *
 * The caller owns both pages' lifetimes (close them in the test's cleanup);
 * a backgrounded fixture page keeps processing without stealing focus.
 *
 * @param extension The extension driver.
 * @param urlPath The fixture path below the server root (e.g. `/pipeline/markers.html`).
 * @param options The opening options: fixture origin, panel boot hash.
 * @returns The open panel page plus the fixture page bindings.
 * @throws {Error} When `bootHash` is not `#/<route>`.
 */
export async function openPanelForFixture(
  extension: ExtensionDriver,
  urlPath: string,
  options: OpenPanelOptions = {}
): Promise<InspectedPanel> {
  const fixture = await openFixturePage(extension, urlPath, options.origin);
  const panel = await extension.browserContext.newPage();
  // The emulated media exists before the first document renders, so the
  // panel boots into its final palette (no post-render flip, no lag window).
  if (options.emulation !== undefined)
    await panel.emulateMedia({
      colorScheme: options.emulation.colorScheme,
      reducedMotion: options.emulation.reducedMotion ?? 'no-preference'
    });
  if (options.viewport !== undefined) await panel.setViewportSize(options.viewport);
  // Before any module script, so the accessor's feature-detection reads the
  // stamped id at its first read (the boot flight's timing).
  await panel.addInitScript(devtoolsShim(fixture.tabId, options.inspect, options.openResource));
  if (options.panelInit !== undefined) await panel.addInitScript(options.panelInit);
  await panel.goto(`${await panelPageUrl(extension)}${options.bootHash ?? ''}`, {
    waitUntil: 'load'
  });
  // A deep-link boot returns only once its page body is mounted: a lazy
  // route shows its loading frame first, and a caller's one-shot DOM read
  // would otherwise land on that frame.
  const route = options.bootHash === undefined ? null : bootRoute(options.bootHash);
  if (route !== null) await expect(loadedPageRoot(panel, route)).toBeVisible();
  return { panel, fixture };
}

/**
 * Relay one DevTools search action into the runtime exactly the way the
 * devtools page does: the @webext-core/messaging envelope over a plain
 * `runtime.sendMessage`, carrying the relaying devtools page's inspected
 * tab as the payload's scoping field. Extension senders have no runtime
 * sender tab, so that payload field is the panel's only scope (the protocol
 * row's one documented tabId-payload exception).
 *
 * Every open panel page receives the send at the runtime layer; each scopes
 * the delivery against its own inspected tab and drops foreign ones at warn
 * — the observable the search-relay suite asserts across two panels.
 *
 * @param extension The extension driver.
 * @param payload The relay action: one of the four DevTools search actions
 *   plus the relay tab (`performSearch` carries `query`).
 * @throws {Error} When no receiver answers at all (no panel mounted) — that
 *   is a broken suite, not a scoping fact.
 */
export async function relaySearchAction(
  extension: ExtensionDriver,
  payload: Record<string, unknown>
): Promise<void> {
  await extension.evaluateInWorker(
    (envelope: unknown) =>
      new Promise<boolean>((resolve, reject) => {
        chrome.runtime.sendMessage(envelope, (reply: unknown) => {
          // The typed acknowledgement: handlers return `true`; the reply
          // carries that value. A no-receiver transport makes the send a
          // suite bug — it rejects instead of swallowing the fact.
          const sendError = chrome.runtime.lastError;
          if (sendError !== undefined) {
            reject(new Error(`panelSearch relay failed: ${String(sendError.message)}`));
            return;
          }
          if ((reply as { res?: unknown } | undefined)?.res !== true) {
            reject(new Error(`panelSearch relay answered ${JSON.stringify(reply)}`));
            return;
          }
          resolve(true);
        });
      }),
    // The envelope shapes the real wire: { id, type, data, timestamp }.
    {
      id: Date.now() % 1_000_000,
      type: 'panelSearch',
      data: payload,
      timestamp: Date.now()
    }
  );
}

/**
 * A route's page root once its body is the page itself. A lazy route first
 * renders its titled loading frame under the same `data-fdt-page`, then swaps
 * it for the loaded body: a root read off that frame detaches mid-read (a
 * late chunk — a busy run — leaves it on screen long enough to be matched).
 *
 * @param panel The panel page.
 * @param route The route id (`data-fdt-page`).
 * @returns The loaded page's root locator.
 */
export function loadedPageRoot(panel: Page, route: string): Locator {
  return panel.locator(`[data-fdt-page="${route}"]:not(:has([data-fdt-page-chunk-loading]))`);
}

/**
 * The route a panel boot hash names (`#/<route>`).
 *
 * @param hash The boot hash.
 * @returns The route id.
 * @throws {Error} When the hash is not `#/<route>`: a boot hash the router
 *   cannot read is a broken suite, not a page to wait for.
 */
function bootRoute(hash: string): string {
  const route = /^#\/([a-z-]+)$/.exec(hash)?.[1];
  if (route === undefined) throw new Error(`Boot hash ${JSON.stringify(hash)} is not #/<route>`);
  return route;
}

/**
 * Show a panel route the way a deep link does (a hash change) and wait for
 * its page body, so one-shot DOM reads that follow never meet a lazy
 * route's loading frame. The one way suites switch routes by hash.
 *
 * @param panel The panel page.
 * @param route The route id (`data-fdt-page`).
 * @returns The loaded page's root locator.
 */
export async function showPanelRoute(panel: Page, route: string): Promise<Locator> {
  await panel.evaluate((hash) => {
    location.hash = hash;
  }, `#/${route}`);
  const root = loadedPageRoot(panel, route);
  await expect(root).toBeVisible();
  return root;
}
