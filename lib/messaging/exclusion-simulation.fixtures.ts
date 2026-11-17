/**
 * Shared fixtures for the simulation contract suites: the canonical valid
 * values each suite mutates per case — declared once so the shapes cannot
 * drift between suites.
 */
import type { SimulateSpec } from '../wp-rocket-simulation/spec';
import type {
  DeferSimulationReport,
  DocumentSimulationInput,
  DelaySimulationReport,
  LazyloadSimulationReport
} from './exclusion-simulation';

/** A marker id (32 lowercase hex). */
export const MARKER_ID = '0123456789abcdef0123456789abcdef';

/** The Delay JS simulate spec. */
export function delaySimulate(): SimulateSpec {
  return { features: ['delay_js'] };
}

/** A simulated document's report: every optional `simulated` fact present, a latest list. */
export function simulatedReport(): DelaySimulationReport {
  return {
    feature: 'delay_js',
    state: 'simulated',
    delayed: 4,
    undetermined: 1,
    runtimeInjected: true,
    wpRocketVersion: '3.24.1',
    siteVersion: '3.12.1',
    listSource: 'latest',
    listFetchedAt: 1_790_000_000_000,
    markerId: MARKER_ID,
    cspLimits: ['eval', 'inline'],
    caveats: ['combined-js']
  };
}

/** A simulated document's Defer JS report: scripts deferred and wrapped, the bundled lists. */
export function deferSimulatedReport(): DeferSimulationReport {
  return {
    feature: 'defer_all_js',
    state: 'simulated',
    deferred: 4,
    wrapped: 1,
    wpRocketVersion: '3.24.1',
    listSource: 'bundled',
    listMiss: 'never-fetched',
    markerId: MARKER_ID
  };
}

/**
 * A simulated document's LazyLoad report: images, a picture and a
 * background made lazy, the runtime URL from the default folders, WordPress
 * core's lazy loading found, every every-page caveat.
 */
export function lazyloadSimulatedReport(): LazyloadSimulationReport {
  return {
    feature: 'lazyload',
    state: 'simulated',
    images: 5,
    pictures: 1,
    backgrounds: 2,
    wpRocketVersion: '3.24.1',
    markerId: MARKER_ID,
    runtimeUrl:
      'https://example.com/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js',
    assetsUrlSource: 'default',
    delivery: 'external',
    placement: { head: 'before-end-tag', footer: 'before-end-tag', fallbacks: [] },
    caveats: [
      'core-lazy-loading',
      'hook-text-placement',
      'runtime-url',
      'above-the-fold-exclusions',
      'site-filters'
    ]
  };
}

/** An engine request's simulation input: a bundled list, CSP inputs. */
export function simulationInput(): DocumentSimulationInput {
  return {
    features: ['delay_js'],
    wpRocketVersion: '3.23.5.1',
    runtime: 'RocketLazyLoadScripts.run();',
    fallback: 'if(navigator.userAgent.match(/MSIE|Trident/i)){}',
    listRows: ['lazyLoadOptions', 'wpr-beacon'],
    listSource: 'bundled',
    listMiss: 'never-fetched',
    markerId: MARKER_ID,
    csp: {
      browser: 'chromium',
      headers: [{ name: 'Content-Security-Policy', value: "script-src 'self'" }],
      metas: [{ content: "script-src 'self'", offset: 3 }]
    }
  };
}
