/**
 * The simulation marker's read rule (present / absent / hostile / duplicate /
 * misplaced) and its authority: only a background-verified marker turns a
 * simulated row into "not served"; an unverified one only annotates; a
 * declaring generator meta always wins.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIMULATION_MARKER_META_NAME } from '../wp-rocket/constants';
import type { WprDetections } from '../wp-rocket/types';
import { FIXTURE_DIR } from './fixtures/corpus';
import { parsePage } from './parse-page';
import { applyPresencePropagation, runChecks, runDetection } from './run-detection';
import { applySimulationFacts, delayRuntimeOnPage } from './simulation-fact';
import {
  SIMULATED_MARKER_ID,
  simulatedPage,
  withSimulationMarker
} from './simulated-pages.fixtures';

const ID = SIMULATED_MARKER_ID;
const CONTENT = `v1 delay_js=simulated id=${ID}`;

/** A marker meta with the given content and extra attribute markup. */
function marker(content = CONTENT, extra = ''): string {
  return `<meta name="${SIMULATION_MARKER_META_NAME}" content="${content}"${extra}>`;
}

/** A page with `head` and `body` markup. */
function page(head: string, body = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
}

/** The marker as the detection pass reads it off a page's HTML. */
function read(html: string) {
  return parsePage(html).simulationMarker;
}

/** The detection rows of a page, with the given verification. */
function detect(html: string, verified: readonly 'delay_js'[] = []): WprDetections {
  const detections = runChecks(parsePage(html), verified);
  applyPresencePropagation(detections);
  return detections;
}

/** The real WP Rocket 3.24 Delay JS output, no generator meta, Minify JS served. */
const DELAY_ON_NO_META = readFileSync(join(FIXTURE_DIR, 'delay-on-no-meta.html'), 'utf8');

/** A generator meta declaring `features`. */
function generator(features: string): string {
  return `<meta name="generator" content="WP Rocket 3.24" data-wpr-features="${features}">`;
}

/** A page with no WP Rocket at all: two theme scripts. */
const PLAIN = page(
  '<title>Plain</title><script src="https://site.test/wp-includes/js/jquery/jquery.min.js"></script>',
  '<script src="https://site.test/wp-content/themes/t/app.js"></script><script>console.log(1)</script>'
);

describe('readSimulationMarker', () => {
  it('reads exactly one well-formed marker, wherever it sits, in either attribute order', () => {
    expect(read(page(marker()))).toEqual({ features: ['delay_js'], markerId: ID });
    expect(read(page('', marker()))).toEqual({ features: ['delay_js'], markerId: ID });
    expect(read(page(`<meta content="${CONTENT}" name="${SIMULATION_MARKER_META_NAME}">`))).toEqual(
      { features: ['delay_js'], markerId: ID }
    );
  });

  it('states nothing without a marker', () => {
    expect(read(page('<title>t</title>'))).toBeNull();
    expect(read('')).toBeNull();
  });

  it('reads byte-identical copies as one marker, wherever they sit', () => {
    const one = { features: ['delay_js'], markerId: ID };
    expect(read(page(marker() + marker()))).toEqual(one);
    expect(read(page(marker(), marker() + marker()))).toEqual(one);
  });

  it('identical copies still obey the single-marker rule', () => {
    expect(read(page(marker(CONTENT, ' id="x"').repeat(2)))).toBeNull();
    expect(read(page(marker('v1').repeat(2)))).toBeNull();
  });

  it('copies that differ carry no id: their named features read as unverified, never silent', () => {
    const OTHER = `v1 delay_js=simulated id=${'f'.repeat(32)}`;
    const unverifiable = { features: ['delay_js'], markerId: null };
    expect(read(page(marker() + marker(OTHER)))).toEqual(unverifiable);
    // Same content, extra attribute on one copy: not byte-identical.
    expect(read(page(marker(), marker(CONTENT, ' data-x')))).toEqual(unverifiable);
    // One well-formed copy beside a malformed one still names the feature.
    expect(read(page(marker() + marker('v1 nope')))).toEqual(unverifiable);
    // Attribute order differs: the bytes differ.
    const swapped = `<meta content="${CONTENT}" name="${SIMULATION_MARKER_META_NAME}">`;
    expect(read(page(marker() + swapped))).toEqual(unverifiable);
  });

  it('copies that differ and name no feature state nothing', () => {
    expect(read(page(marker('v1') + marker('v2')))).toBeNull();
  });

  it('states nothing for a marker with extra or missing attributes', () => {
    expect(read(page(marker(CONTENT, ' id="x"')))).toBeNull();
    expect(read(page(marker(CONTENT, ' data-x')))).toBeNull();
    expect(read(page(`<meta name="${SIMULATION_MARKER_META_NAME}">`))).toBeNull();
  });

  it('states nothing for malformed or hostile content', () => {
    for (const content of [
      '',
      'v1',
      `v1 delay_js=off id=${ID}`,
      `v1 delay_js=simulated id=${ID.toUpperCase()}`,
      `v1 delay_js=simulated delay_js=simulated id=${ID}`,
      `v1 lazyload=simulated id=${ID}`,
      `${CONTENT} `,
      `${CONTENT}${'x'.repeat(5000)}`
    ]) {
      expect(read(page(marker(content))), content).toBeNull();
    }
  });

  it('ignores a meta whose name differs in case or spacing, and the builder marker', () => {
    expect(read(page(`<meta name="WPR-FDT-SIMULATION" content="${CONTENT}">`))).toBeNull();
    expect(read(page(`<meta name=" wpr-fdt-simulation" content="${CONTENT}">`))).toBeNull();
    expect(read(page(`<meta name="wpr-fdt-exclusion-builder" content="${CONTENT}">`))).toBeNull();
  });

  it('reads the marker after the live-document serialization the data hub performs', () => {
    const live = new DOMParser().parseFromString(page(marker()), 'text/html');
    const serialized = new XMLSerializer().serializeToString(live);
    expect(read(serialized)).toEqual({ features: ['delay_js'], markerId: ID });
  });
});

describe('applySimulationFacts', () => {
  const NO_META = parsePage(page('')).featureMeta;

  /** Fresh rows of a page with delayed scripts. */
  const rows = () => runChecks(parsePage(DELAY_ON_NO_META));

  it('is a no-op without a marker, verified or not', () => {
    const detections = rows();
    const before = structuredClone(detections);
    applySimulationFacts(detections, null, ['delay_js'], NO_META);
    expect(detections).toEqual(before);
  });

  it('verified: not served, version unknown, inventory kept, annotated', () => {
    const detections = rows();
    const before = structuredClone(detections.delay_js);
    applySimulationFacts(
      detections,
      { features: ['delay_js'], markerId: ID },
      ['delay_js'],
      NO_META
    );
    expect(detections.delay_js).toEqual({
      ...before,
      present: false,
      version: null,
      simulation: 'simulated'
    });
    expect(before.scripts.length).toBeGreaterThan(0);
    expect(before.delayedScripts).toBeGreaterThan(0);
  });

  it('an unverifiable marker (copies differ) is never vouched for, whatever the caller passes', () => {
    const detections = rows();
    const before = structuredClone(detections.delay_js);
    applySimulationFacts(
      detections,
      { features: ['delay_js'], markerId: null },
      ['delay_js'],
      NO_META
    );
    expect(detections.delay_js).toEqual({ ...before, simulation: 'unverified' });
  });

  it('unverified: verdict untouched, only annotated', () => {
    const detections = rows();
    const before = structuredClone(detections.delay_js);
    applySimulationFacts(detections, { features: ['delay_js'], markerId: ID }, [], NO_META);
    expect(detections.delay_js).toEqual({ ...before, simulation: 'unverified' });
  });
});

describe('detection authority — the honest-status table', () => {
  it('a page without a marker reads exactly as before, whatever the verification says', () => {
    expect(detect(DELAY_ON_NO_META, ['delay_js'])).toEqual(
      runDetection(DELAY_ON_NO_META).detections
    );
    expect(detect(DELAY_ON_NO_META).delay_js).toMatchObject({ present: true, source: 'footprint' });
  });

  it('verified · WP Rocket with a meta that does not declare Delay JS', () => {
    const html = withSimulationMarker(
      DELAY_ON_NO_META.replace('<head>', `<head>${generator('wpr_minify_js')}`)
    );
    const detections = detect(html, ['delay_js']);
    expect(detections.delay_js).toMatchObject({
      present: false,
      version: null,
      source: 'meta',
      simulation: 'simulated'
    });
    expect(detections.wpr.present).toBe(true);
  });

  it('verified · WP Rocket, no meta, Minify JS served (read through the served URL)', () => {
    const detections = detect(withSimulationMarker(DELAY_ON_NO_META), ['delay_js']);
    expect(detections.delay_js).toMatchObject({
      present: false,
      version: null,
      simulation: 'simulated'
    });
    expect(detections.delay_js).not.toHaveProperty('source');
    expect(detections.delay_js.delayedScripts).toBe(2);
    expect(detections.minify_js.present).toBe(true);
    expect(detections.wpr.present).toBe(true);
  });

  it('verified · no WP Rocket: nothing reads as WP Rocket', () => {
    const html = simulatedPage(PLAIN);
    // Control: the same page read unverified looks like a Delay JS page.
    expect(detect(html).delay_js).toMatchObject({ present: true, simulation: 'unverified' });
    expect(detect(html).wpr.present).toBe(true);
    const detections = detect(html, ['delay_js']);
    expect(detections.delay_js).toMatchObject({
      present: false,
      version: null,
      simulation: 'simulated'
    });
    // Inventory kept: the two external scripts and the inline one, delayed.
    expect(detections.delay_js.delayedScripts).toBe(3);
    expect(detections.wpr.present).toBe(false);
    const present = Object.entries(
      detections as unknown as Record<string, { present: boolean }>
    ).filter(([, row]) => row.present);
    expect(present).toEqual([]);
  });

  it('unverified (forged, other tab, saved copy) · every verdict as served, annotated', () => {
    const html = withSimulationMarker(DELAY_ON_NO_META);
    const served = runDetection(DELAY_ON_NO_META).detections;
    const detections = detect(html);
    expect(detections).toEqual({
      ...served,
      delay_js: { ...served.delay_js, simulation: 'unverified' }
    });
  });

  it('a forged marker cannot hide Delay JS from runDetection (it verifies nothing)', () => {
    const detections = runDetection(withSimulationMarker(DELAY_ON_NO_META)).detections;
    expect(detections.delay_js).toMatchObject({
      present: true,
      version: '2.0.5',
      source: 'footprint',
      simulation: 'unverified'
    });
  });

  it('a declaring meta wins over any marker, verified or forged: no simulation field', () => {
    const html = withSimulationMarker(
      DELAY_ON_NO_META.replace('<head>', `<head>${generator('wpr_delay_js wpr_minify_js')}`)
    );
    for (const verified of [['delay_js'] as const, [] as const]) {
      const detections = detect(html, verified);
      expect(detections.delay_js).toMatchObject({ present: true, source: 'meta' });
      expect(detections.delay_js).not.toHaveProperty('simulation');
      expect(detections.delay_js.version).toBe('2.0.5');
    }
  });

  it('a verification the marker does not name changes nothing', () => {
    expect(detect(simulatedPage(PLAIN, null), ['delay_js']).delay_js).toMatchObject({
      present: true
    });
  });

  it('builder facts and simulation facts sit together on one row', () => {
    const html = simulatedPage(
      PLAIN.replace(
        '</head>',
        '<meta name="wpr-fdt-exclusion-builder" content="v1 delay_js=excluded:1"></head>'
      )
    );
    const detections = detect(html, ['delay_js']);
    expect(detections.delay_js).toMatchObject({
      present: false,
      builder: { excluded: 1 },
      simulation: 'simulated'
    });
  });
});

describe('delayRuntimeOnPage', () => {
  it('served or verified-simulated holds scripts; unverified or absent does not', () => {
    expect(delayRuntimeOnPage({ present: true })).toBe(true);
    expect(delayRuntimeOnPage({ present: false, simulation: 'simulated' })).toBe(true);
    expect(delayRuntimeOnPage({ present: false, simulation: 'unverified' })).toBe(false);
    expect(delayRuntimeOnPage({ present: true, simulation: 'unverified' })).toBe(true);
    expect(delayRuntimeOnPage({ present: false })).toBe(false);
  });

  it('reads a verified simulated page as runtime-on-page though not served', () => {
    const row = detect(simulatedPage(PLAIN), ['delay_js']).delay_js;
    expect(row.present).toBe(false);
    expect(delayRuntimeOnPage(row)).toBe(true);
  });
});
