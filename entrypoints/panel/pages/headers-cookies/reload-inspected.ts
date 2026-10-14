/**
 * Reloading the inspected page from the panel — the remedy for a missing
 * header capture. Headers are read from the page's main-frame response, so
 * only a new navigation can produce them; refetching the panel's data
 * cannot. The reload makes the page's content script notify the panel,
 * which then soft-refreshes on its own.
 */
import { createLogger } from '../../../../lib/logger';

const log = createLogger('panel');

/** The slice of the DevTools API the reload needs (absent outside a DevTools window). */
export interface InspectedWindowReloadApi {
  readonly devtools?: {
    readonly inspectedWindow?: { readonly reload?: (options?: object) => void };
  };
}

/** What a reload attempt came to. */
export type ReloadOutcome = 'reloaded' | 'unavailable' | 'failed';

/**
 * Whether this context can reload the inspected page (a DevTools panel can;
 * a standalone extension page cannot).
 *
 * @param api The extension namespace (the real `browser`, or a test double).
 * @returns True when `devtools.inspectedWindow.reload` exists.
 */
export function canReloadInspected(api: InspectedWindowReloadApi): boolean {
  return typeof api.devtools?.inspectedWindow?.reload === 'function';
}

/**
 * Ask DevTools to reload the inspected page.
 *
 * @param api The extension namespace (the real `browser`, or a test double).
 * @returns `'reloaded'` once the request was handed over, `'unavailable'`
 *   outside a DevTools window, `'failed'` when the API threw (e.g. the
 *   extension context was invalidated) — the caller tells the user.
 */
export function reloadInspected(api: InspectedWindowReloadApi): ReloadOutcome {
  const reload = api.devtools?.inspectedWindow?.reload;
  if (typeof reload !== 'function') return 'unavailable';
  try {
    reload.call(api.devtools?.inspectedWindow, {});
    return 'reloaded';
  } catch (cause) {
    // The caller renders the remedy; the cause is the operational record.
    log.warn('Inspected-page reload failed', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    return 'failed';
  }
}
