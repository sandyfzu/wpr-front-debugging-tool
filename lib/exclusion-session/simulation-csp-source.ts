/**
 * The simulation's CSP source: a document's policy inputs for the engine
 * evaluating them — its CSP header lines as the backend captured them and
 * the `<meta>` policies its served text applies (with their offsets), for
 * the browser engine rendering it (WP Rocket's runtime branches on it).
 */
import type { SimulationCspInput } from '../messaging/exclusion-simulation';
import { cspMetaPolicies } from '../wp-rocket-simulation/csp-meta';
import type { SimulationCspBrowser } from '../wp-rocket-simulation/spec';
import type { SimulationSources } from './simulation-sources';

/**
 * Create the CSP source for one browser engine.
 *
 * @param browser The engine rendering the session's documents.
 * @returns The source: the document's raw CSP inputs (fitted by the
 *   caller), flagging an unreadable applied meta — the headers and readable
 *   metas are still evaluated, since they alone may block the runtime.
 */
export function createCspSource(browser: SimulationCspBrowser): SimulationSources['csp'] {
  return (document, html): SimulationCspInput => {
    const { metas, unreadable } = cspMetaPolicies(html);
    return {
      browser,
      headers: document.cspHeaders ?? [],
      metas,
      ...(unreadable ? { metasUnreadable: true as const } : {})
    };
  };
}
