/**
 * The Chromium interception registry row and its debugger port bound to
 * the browser: `debugger` (promise style — available since Chrome 96,
 * below this build's floor) plus an id-only `tabs.get` for a tab's
 * presence. Listener bodies are guarded so one failing handler never
 * breaks a sibling listener.
 */
import type { InterceptionBackendRow } from '../../lib/exclusion-session/backend';
import { createChromiumInterceptionBackend } from '../../lib/exclusion-session/chromium/backend';
import { isDebuggerRestrictedUrl } from '../../lib/exclusion-session/chromium/detach-causes';
import type { DebuggerPort, TabPresence } from '../../lib/exclusion-session/chromium/port';
import { createLogger, type Logger } from '../../lib/logger';
import { isHttpUrl } from '../../utils/urls';

/** The protocol version requested on attach (the stable 1.x protocol). */
const PROTOCOL_VERSION = '1.3';

/** The debugger API slice this port binds (injectable for tests). */
export type DebuggerApi = Pick<
  typeof browser.debugger,
  'attach' | 'detach' | 'sendCommand' | 'onEvent' | 'onDetach'
>;

/** The tabs API slice this port binds. */
export type TabsApi = Pick<typeof browser.tabs, 'get'>;

/**
 * Whether this browser offers the debugger API (feature detection: the
 * namespace exists only where the API and its permission do).
 */
export function hasDebuggerApi(): boolean {
  return 'debugger' in browser;
}

/**
 * Bind the port.
 *
 * @param log Where listener faults are logged.
 * @param api The debugger API; defaults to `browser.debugger`.
 * @param tabs The tabs API; defaults to `browser.tabs`.
 */
export function createBrowserDebuggerPort(
  log: Logger,
  api: DebuggerApi = browser.debugger,
  tabs: TabsApi = browser.tabs
): DebuggerPort {
  return {
    attach: (tabId) => api.attach({ tabId }, PROTOCOL_VERSION),
    detach: (tabId) => api.detach({ tabId }),
    send: (target, method, params) => api.sendCommand(target, method, params),
    async tabPresence(tabId): Promise<TabPresence> {
      try {
        const tab = await tabs.get(tabId);
        // Without the `tabs` permission a URL is readable only on host-permitted
        // (http(s)) pages; the web store is http(s) but closed to the debugger.
        // A detach caused by a navigation lands before it commits: the page
        // the tab is going to is the pending URL.
        const url = tab.pendingUrl ?? tab.url;
        return url !== undefined && isHttpUrl(url) && !isDebuggerRestrictedUrl(url)
          ? 'web'
          : 'elsewhere';
      } catch (cause) {
        log.debug('Tab probe found no tab', { tabId, cause });
        return 'gone';
      }
    },
    listen(handlers) {
      api.onEvent.addListener((source, method, params) => {
        try {
          handlers.event(source, method, params);
        } catch (cause) {
          log.error('Debugger event handler failed', { method, cause });
        }
      });
      api.onDetach.addListener((source, reason) => {
        try {
          handlers.detach(source, reason);
        } catch (cause) {
          log.error('Debugger detach handler failed', { reason, cause });
        }
      });
    }
  };
}

/**
 * The Chromium row: the debugger protocol's response-stage `Fetch`
 * interception, selected where the debugger API exists.
 */
export const CHROMIUM_INTERCEPTION_ROW: InterceptionBackendRow = {
  id: 'chromium-debugger',
  isSupported: hasDebuggerApi,
  create(host) {
    const log = createLogger('interception');
    return createChromiumInterceptionBackend({ port: createBrowserDebuggerPort(log), host, log });
  }
};
