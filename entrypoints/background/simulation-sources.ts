/**
 * The background's simulation input sources: the packaged data file (read
 * through the extension's own URL — never a `?url` asset import, which
 * would share the Known Conflicts seed's bundled asset name) as the
 * runtime source, the marker id drawn from `crypto.getRandomValues`
 * and remembered in the tab's marker memo before the document is released,
 * and the page's CSP (captured header lines + head metas) for this build's
 * browser engine; every other source keeps its inert default until it lands.
 */
import type { Logger } from '../../lib/logger';
import { createPackagedRuntimeSource } from '../../lib/exclusion-session/packaged-simulation-data';
import { createMarkerIdSource } from '../../lib/exclusion-session/simulation-marker-memo';
import { createCspSource } from '../../lib/exclusion-session/simulation-csp-source';
import type { SimulationCspBrowser } from '../../lib/wp-rocket-simulation/spec';
import { rememberSimulationMarker } from '../../lib/storage/simulation-markers';
import {
  INERT_SIMULATION_SOURCES,
  type SimulationSources
} from '../../lib/exclusion-session/simulation-sources';
import { SIMULATION_DATA_PATH } from '../../lib/wp-rocket-simulation/simulation-data';
import { webSha256Hex } from '../../utils/web-sha256';

/**
 * The browser engine this build renders pages with (one interception
 * backend per build: the streaming filter in Firefox, the debugger
 * protocol elsewhere).
 */
export function cspBrowser(): SimulationCspBrowser {
  return import.meta.env.BROWSER === 'firefox' ? 'firefox' : 'chromium';
}

/**
 * The sources a session controller prepares simulations from (one set per
 * background lifetime: the data file is read at most once while it reads).
 *
 * @param log Where an unusable package is reported.
 */
export function createSimulationSources(log: Pick<Logger, 'error'>): SimulationSources {
  return {
    ...INERT_SIMULATION_SOURCES,
    runtime: createPackagedRuntimeSource({
      fetch: (url) => fetch(url),
      url: browser.runtime.getURL(`/${SIMULATION_DATA_PATH}` as const),
      sha256: webSha256Hex,
      log
    }),
    markerId: createMarkerIdSource({
      fill: (bytes) => crypto.getRandomValues(bytes),
      remember: rememberSimulationMarker
    }),
    csp: createCspSource(cspBrowser())
  };
}
