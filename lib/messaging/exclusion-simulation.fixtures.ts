/**
 * Shared fixtures for the simulation contract suites: the canonical valid
 * values each suite mutates per case — declared once so the shapes cannot
 * drift between suites.
 */
import type { SimulateSpec } from '../wp-rocket-simulation/spec';
import type { DocumentSimulationInput, DocumentSimulationReport } from './exclusion-simulation';

/** A marker id (32 lowercase hex). */
export const MARKER_ID = '0123456789abcdef0123456789abcdef';

/** The Delay JS simulate spec. */
export function delaySimulate(): SimulateSpec {
  return { features: ['delay_js'] };
}

/** A simulated document's report: every optional `simulated` fact present, a latest list. */
export function simulatedReport(): DocumentSimulationReport {
  return {
    feature: 'delay_js',
    state: 'simulated',
    delayed: 4,
    undetermined: 1,
    runtimeInjected: true,
    wpRocketVersion: '3.24',
    siteVersion: '3.12.1',
    listSource: 'latest',
    listFetchedAt: 1_790_000_000_000,
    markerId: MARKER_ID,
    cspLimits: ['eval', 'inline'],
    caveats: ['combined-js']
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
