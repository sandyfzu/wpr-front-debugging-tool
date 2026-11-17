/**
 * Detection authority for Defer JS — the honest-status table: a simulated
 * Defer JS page never reads as Defer JS served nor as WP Rocket present
 * once the background vouches for its marker; an unverified marker changes
 * no verdict (annotation only); WP Rocket's generator meta declaring the
 * feature wins over any marker.
 */
import { describe, expect, it } from 'vitest';
import { packagedVersion } from '../exclusion-session/packaged-simulation-data';
import type { WprDetections } from '../wp-rocket/types';
import { simulateDeferJs } from '../wp-rocket-simulation/defer-js-forward';
import { writeSimulationMarker } from '../wp-rocket-simulation/marker-write';
import type { SimulatedFeatureId } from '../wp-rocket-simulation/spec';
import { readSimulationData, SIMULATION_DATA_PATH } from '../wp-rocket-simulation/simulation-data';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePage } from './parse-page';
import { applyPresencePropagation, runChecks, runDetection } from './run-detection';
import { SIMULATED_MARKER_ID, simulatedPage } from './simulated-pages.fixtures';

/** The packaged 3.24.1 Defer JS lists. */
const LISTS = (() => {
  const text = readFileSync(join(process.cwd(), 'public', SIMULATION_DATA_PATH), 'utf8');
  const read = readSimulationData(JSON.parse(text));
  if (!read.ok) throw new Error(read.problem);
  const version = packagedVersion(read.data, '3.24.1');
  if (!version.ok) throw new Error(version.cause);
  return version.package.bundledDeferLists;
})();

/** A page without WP Rocket: three theme scripts (two external, one inline jQuery). */
const PLAIN =
  '<!doctype html><html><head><meta charset="utf-8"><title>Plain</title>' +
  '<script src="https://site.test/wp-content/themes/t/app.js"></script></head><body>' +
  '<script src="https://site.test/wp-content/plugins/p/slider.js"></script>' +
  '<script>jQuery(function(){ start(); });</script></body></html>';

/** Defer JS simulated on a page, as the step serves it. */
function deferred(html: string): string {
  const result = simulateDeferJs({ html, rows: [], lists: LISTS, inlineQuoteDelimiter: '/' });
  if (result.report.state !== 'simulated') throw new Error(result.report.state);
  return result.html;
}

/** A page with the marker naming `features`. */
function marked(html: string, features: readonly SimulatedFeatureId[]): string {
  return writeSimulationMarker(html, SIMULATED_MARKER_ID, features).html;
}

/** The detection rows of a page, with the given verification. */
function detect(html: string, verified: readonly SimulatedFeatureId[] = []): WprDetections {
  const detections = runChecks(parsePage(html), verified);
  applyPresencePropagation(detections);
  return detections;
}

/** The rows that read as present. */
function presentRows(detections: WprDetections): string[] {
  return Object.entries(detections as unknown as Record<string, { present: boolean }>)
    .filter(([, row]) => row.present)
    .map(([key]) => key);
}

const DEFERRED = marked(deferred(PLAIN), ['defer_all_js']);

describe('Defer JS detection authority — the honest-status table', () => {
  it('control: the simulated page reads as deferred by WP Rocket without a verification', () => {
    const detections = detect(DEFERRED);
    expect(detections.defer_all_js).toMatchObject({
      present: true,
      deferredScripts: 2,
      simulation: 'unverified'
    });
    // Deferral alone never makes WP Rocket present.
    expect(detections.wpr.present).toBe(false);
  });

  it('verified · no WP Rocket: not served, inventory kept, nothing reads as WP Rocket', () => {
    const detections = detect(DEFERRED, ['defer_all_js']);
    expect(detections.defer_all_js).toMatchObject({
      present: false,
      deferredScripts: 2,
      simulation: 'simulated'
    });
    expect(detections.defer_all_js.scripts).toHaveLength(2);
    expect(presentRows(detections)).toEqual([]);
  });

  it('verified · both features simulated: neither row nor WP Rocket reads as served', () => {
    const both = marked(simulatedPage(deferred(PLAIN), null), ['defer_all_js', 'delay_js']);
    const detections = detect(both, ['defer_all_js', 'delay_js']);
    expect(detections.defer_all_js).toMatchObject({ present: false, simulation: 'simulated' });
    expect(detections.delay_js).toMatchObject({ present: false, simulation: 'simulated' });
    expect(presentRows(detections)).toEqual([]);
  });

  it('a verification naming only Delay JS never vouches for Defer JS', () => {
    const both = marked(simulatedPage(deferred(PLAIN), null), ['defer_all_js', 'delay_js']);
    const detections = detect(both, ['delay_js']);
    expect(detections.defer_all_js).toMatchObject({ present: true, simulation: 'unverified' });
    expect(detections.delay_js).toMatchObject({ present: false, simulation: 'simulated' });
  });

  it('unverified (forged, other tab, saved copy) · every verdict as served, annotated', () => {
    const served = runDetection(deferred(PLAIN)).detections;
    expect(detect(DEFERRED)).toEqual({
      ...served,
      defer_all_js: { ...served.defer_all_js, simulation: 'unverified' }
    });
    expect(runDetection(DEFERRED).detections.defer_all_js).toMatchObject({
      present: true,
      simulation: 'unverified'
    });
  });

  it('verified · WP Rocket with a meta that does not declare Defer JS', () => {
    const meta =
      '<meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_minify_js">';
    const detections = detect(DEFERRED.replace('<head>', `<head>${meta}`), ['defer_all_js']);
    expect(detections.defer_all_js).toMatchObject({
      present: false,
      deferredScripts: 2,
      simulation: 'simulated'
    });
    expect(detections.wpr.present).toBe(true);
  });

  it('verified · WP Rocket, no meta, Minify JS served (read through the served URL)', () => {
    const minified =
      '<script src="https://site.test/wp-content/cache/min/1/wp-content/themes/t/min.js?ver=1"></script>';
    const html = marked(deferred(PLAIN.replace('</head>', `${minified}</head>`)), ['defer_all_js']);
    // Control: unverified, the page reads as WP Rocket deferring it.
    expect(detect(html).defer_all_js).toMatchObject({ present: true, simulation: 'unverified' });
    const detections = detect(html, ['defer_all_js']);
    expect(detections.defer_all_js).toMatchObject({
      present: false,
      deferredScripts: 3,
      simulation: 'simulated'
    });
    expect(detections.minify_js.present).toBe(true);
    expect(detections.wpr.present).toBe(true);
  });

  it('a forged marker cannot hide Defer JS from runDetection (it verifies nothing)', () => {
    expect(runDetection(DEFERRED).detections.defer_all_js).toMatchObject({
      present: true,
      deferredScripts: 2,
      simulation: 'unverified'
    });
  });

  it('a declaring meta wins over any marker: no simulation field', () => {
    const meta =
      '<meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_defer_js">';
    const html = DEFERRED.replace('<head>', `<head>${meta}`);
    const detections = detect(html, ['defer_all_js']);
    expect(detections.defer_all_js.present).toBe(true);
    expect(detections.defer_all_js).not.toHaveProperty('simulation');
  });
});
