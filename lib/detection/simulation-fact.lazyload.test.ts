/**
 * Detection authority for LazyLoad (images) — the honest-status table: a
 * simulated LazyLoad page never reads as LazyLoad served nor as WP Rocket
 * present once the background vouches for its marker; an unverified marker
 * changes no verdict (annotation only); WP Rocket's generator meta
 * declaring the feature wins over any marker.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagedVersion } from '../exclusion-session/packaged-simulation-data';
import type { WprDetections } from '../wp-rocket/types';
import { simulateLazyload } from '../wp-rocket-simulation/lazyload-simulation';
import { writeSimulationMarker } from '../wp-rocket-simulation/marker-write';
import { readSimulationData, SIMULATION_DATA_PATH } from '../wp-rocket-simulation/simulation-data';
import type { SimulatedFeatureId } from '../wp-rocket-simulation/spec';
import { describeDetections } from './describe';
import {
  BUILDER_TAB_LINE_TITLE,
  builderPageKind,
  builderTabLine,
  hudFeatureOf,
  readHudFeature,
  simulationTabHint,
  type HudFeature
} from './hud';
import { parsePage } from './parse-page';
import { applyPresencePropagation, runChecks } from './run-detection';
import { SIMULATED_MARKER_ID } from './simulated-pages.fixtures';

/** The packaged 3.24.1 LazyLoad inputs. */
const LAZYLOAD = (() => {
  const text = readFileSync(join(process.cwd(), 'public', SIMULATION_DATA_PATH), 'utf8');
  const read = readSimulationData(JSON.parse(text));
  if (!read.ok) throw new Error(read.problem);
  const version = packagedVersion(read.data, '3.24.1');
  if (!version.ok) throw new Error(version.cause);
  return version.package.lazyload;
})();

/** A page without WP Rocket: two images. */
const PLAIN =
  '<!doctype html><html><head><meta charset="utf-8"><title>Plain</title></head><body>' +
  '<img src="https://site.test/a.png" width="10" height="10" alt="a">' +
  '<img src="https://site.test/b.png" alt="b"></body></html>';

/** LazyLoad simulated on a page, as the step serves it, with the marker naming `features`. */
function simulated(html: string, features: readonly SimulatedFeatureId[] = ['lazyload']): string {
  const result = simulateLazyload({
    html,
    pageUrl: 'https://site.test/',
    texts: LAZYLOAD,
    literals: LAZYLOAD,
    rows: []
  });
  if (result.report.state !== 'simulated') throw new Error(result.report.state);
  return writeSimulationMarker(result.html, SIMULATED_MARKER_ID, features).html;
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

const LAZY = simulated(PLAIN);

describe('LazyLoad detection authority — the honest-status table', () => {
  it('control: the simulated page reads as LazyLoad by WP Rocket without a verification', () => {
    const detections = detect(LAZY);
    expect(detections.lazyload).toMatchObject({ present: true, simulation: 'unverified' });
  });

  it('verified · no WP Rocket: not served, inventory kept, nothing reads as WP Rocket', () => {
    const detections = detect(LAZY, ['lazyload']);
    expect(detections.lazyload).toMatchObject({ present: false, simulation: 'simulated' });
    expect(detections.lazyload.images.length).toBeGreaterThan(0);
    expect(presentRows(detections)).toEqual([]);
  });

  it('a verification for another feature only: the row stays as served, annotated', () => {
    const detections = detect(LAZY, ['delay_js']);
    expect(detections.lazyload).toMatchObject({ present: true, simulation: 'unverified' });
  });

  it('WP Rocket’s generator meta declaring LazyLoad wins over the marker', () => {
    const meta =
      '<meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_lazyload_images" />';
    const detections = detect(LAZY.replace('</head>', `${meta}</head>`), ['lazyload']);
    expect(detections.lazyload.present).toBe(true);
    expect(detections.lazyload).not.toHaveProperty('simulation');
  });

  it('no marker: no simulation field', () => {
    const detections = detect(PLAIN);
    expect(detections.lazyload).not.toHaveProperty('simulation');
  });
});

describe('LazyLoad simulated — HUD and panel words (the approved patterns, no new copy)', () => {
  const ROW = hudFeatureOf('lazyload') as HudFeature;

  it('verified: not applied (never unknown), the simulation fact, the shared tab-line pattern', () => {
    const detections = detect(LAZY, ['lazyload']);
    expect(readHudFeature(ROW, describeDetections(detections), detections)).toMatchObject({
      verdict: 'not applied',
      simulation: 'simulated'
    });
    expect(simulationTabHint(ROW)).toBe('Lazyload Images simulated');
    expect(builderTabLine(detections)).toEqual({
      title: BUILDER_TAB_LINE_TITLE,
      hints: ['Lazyload Images simulated'],
      spoken: `${BUILDER_TAB_LINE_TITLE} — Lazyload Images simulated`
    });
    expect(builderPageKind(detections)).toBe('simulated');
  });

  it('unverified: the served verdict, annotated', () => {
    const detections = detect(LAZY);
    expect(readHudFeature(ROW, describeDetections(detections), detections)).toMatchObject({
      verdict: 'applied',
      simulation: 'unverified'
    });
  });
});
