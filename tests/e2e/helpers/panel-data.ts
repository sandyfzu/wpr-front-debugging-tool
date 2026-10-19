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
import type { Page } from '@playwright/test';

import { openFixturePage, panelPageUrl, type DriverPage, type ExtensionDriver } from './extension';

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
 *
 * @param tabId The tab id a real DevTools window would report.
 * @param inspect The suite-provided resource stub, when one is needed.
 */
function devtoolsShim(tabId: number, inspect: OpenPanelOptions['inspect']): string {
  // The whole stub rides as a JSON literal: the init script self-contains it,
  // sharing no state with the suite beyond this call's arguments.
  const stub =
    inspect === undefined ? null : { origin: inspect.origin, resources: inspect.resources };
  return `(() => {
    const stub = ${JSON.stringify(stub)};
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
      namespace['devtools'] = { inspectedWindow };
      return true;
    };
    const win = window;
    stamp(win['chrome']);
    stamp(win['browser']);
  })()`;
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
  /** The panel document's boot hash (e.g. `#/lazyload`) for deep-link boots. */
  readonly bootHash?: string;
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
 */
export async function openPanelForFixture(
  extension: ExtensionDriver,
  urlPath: string,
  options: OpenPanelOptions = {}
): Promise<InspectedPanel> {
  const fixture = await openFixturePage(extension, urlPath, options.origin);
  const panel = await extension.browserContext.newPage();
  // Before any module script, so the accessor's feature-detection reads the
  // stamped id at its first read (the boot flight's timing).
  await panel.addInitScript(devtoolsShim(fixture.tabId, options.inspect));
  await panel.goto(`${await panelPageUrl(extension)}${options.bootHash ?? ''}`, {
    waitUntil: 'load'
  });
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
