/**
 * The background's simulation input sources: the packaged data file (read
 * through the extension's own URL — never a `?url` asset import, which
 * would share the Known Conflicts seed's bundled asset name) as the
 * runtime source, the marker id drawn from `crypto.getRandomValues`
 * and remembered in the tab's marker memo before the document is released
 * (narrowed there to the features that simulated),
 * the page's CSP (captured header lines + head metas) for this build's
 * browser engine, and the exclusion list (the kept latest list, else the
 * version's bundled one).
 */
import type { Logger } from '../../lib/logger';
import {
  createPackagedLazyloadRuntimeSource,
  createPackagedRuntimeSource
} from '../../lib/exclusion-session/packaged-simulation-data';
import {
  createMarkerIdSource,
  createMarkerSettler
} from '../../lib/exclusion-session/simulation-marker-memo';
import { createCspSource } from '../../lib/exclusion-session/simulation-csp-source';
import type { SimulationCspBrowser } from '../../lib/wp-rocket-simulation/spec';
import { rememberSimulationMarker } from '../../lib/storage/simulation-markers';
import type { SimulationSources } from '../../lib/exclusion-session/simulation-sources';
import { SIMULATION_DATA_PATH } from '../../lib/wp-rocket-simulation/simulation-data';
import { webSha256Hex, webSha256HexOfBytes } from '../../utils/web-sha256';
import { latestDeferListsSource, latestListSource } from './latest-exclusion-list';

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
    runtime: createPackagedRuntimeSource({
      fetch: (url) => fetch(url),
      url: browser.runtime.getURL(`/${SIMULATION_DATA_PATH}` as const),
      sha256: webSha256Hex,
      log
    }),
    lazyloadRuntime: createPackagedLazyloadRuntimeSource({
      fetch: (url) => fetch(url),
      dataUrl: browser.runtime.getURL(`/${SIMULATION_DATA_PATH}` as const),
      sha256: webSha256HexOfBytes,
      log
    }),
    markerId: createMarkerIdSource({
      fill: (bytes) => crypto.getRandomValues(bytes),
      remember: rememberSimulationMarker
    }),
    settleMarker: createMarkerSettler({ remember: rememberSimulationMarker }),
    csp: createCspSource(cspBrowser()),
    list: latestListSource,
    deferLists: latestDeferListsSource
  };
}
