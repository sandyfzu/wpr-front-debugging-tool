/**
 * The simulation modifier in the shared reading: the fact read through,
 * the draft copy pinned (chip, sentence, hint, summary suffix), the state
 * lines for both facts, and the verdict a verified simulation reads as —
 * not applied, never "unknown", never a WP Rocket claim.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WprDetections } from '../wp-rocket/types';
import { describeDetections } from './describe';
import { FIXTURE_DIR } from './fixtures/corpus';
import {
  hudFeatureOf,
  hudStateLine,
  readHudFeature,
  SIMULATED_SERVED_LINE,
  simulationModifierCopy,
  simulationSummary,
  type HudFeature
} from './hud';
import { parsePage } from './parse-page';
import { applyPresencePropagation, runChecks } from './run-detection';
import { withSimulationMarker } from './simulated-pages.fixtures';

const DELAY = hudFeatureOf('delay_js') as HudFeature;
const DEFER = hudFeatureOf('defer_all_js') as HudFeature;

const DELAY_ON_NO_META = readFileSync(join(FIXTURE_DIR, 'delay-on-no-meta.html'), 'utf8');

/** A page's rows with the given verification. */
function detect(html: string, verified: readonly 'delay_js'[]): WprDetections {
  const detections = runChecks(parsePage(html), verified);
  applyPresencePropagation(detections);
  return detections;
}

/** The Delay JS reading of a page. */
function delayReading(detections: WprDetections) {
  return readHudFeature(DELAY, describeDetections(detections), detections);
}

describe('simulation modifier copy (draft words)', () => {
  it('pins both facts', () => {
    expect(simulationModifierCopy(DELAY, 'simulated')).toEqual({
      chip: 'Simulated in this tab',
      sentence: 'Simulated in this tab by the extension, not by WP Rocket.',
      hint: 'Delay JS simulated'
    });
    expect(simulationModifierCopy(DELAY, 'unverified')).toEqual({
      chip: 'Marker not verified',
      sentence: 'Simulation marker not verified: read as served.',
      hint: 'Delay JS: simulation marker not verified'
    });
  });

  it('pins the summary suffix', () => {
    expect(simulationSummary(0, 0)).toBeNull();
    expect(simulationSummary(1, 0)).toBe('1 simulated in this tab');
    expect(simulationSummary(0, 1)).toBe('simulation marker not verified');
    expect(simulationSummary(2, 1)).toBe(
      '2 simulated in this tab · simulation marker not verified'
    );
  });
});

describe('readHudFeature + hudStateLine with a simulation fact', () => {
  it('verified on a WP Rocket page without meta: not applied (never unknown), simulated words', () => {
    const detections = detect(withSimulationMarker(DELAY_ON_NO_META), ['delay_js']);
    expect(detections.wpr.present).toBe(true);
    const reading = delayReading(detections);
    expect(reading).toMatchObject({ verdict: 'not applied', source: null, why: null });
    expect(reading.simulation).toBe('simulated');
    expect(hudStateLine(DELAY, reading)).toBe(
      `${SIMULATED_SERVED_LINE} Simulated in this tab by the extension, not by WP Rocket.`
    );
  });

  it('verified under a refuting meta: the meta line, then the simulated words', () => {
    const html = withSimulationMarker(
      DELAY_ON_NO_META.replace(
        '<head>',
        '<head><meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_minify_js">'
      )
    );
    const reading = delayReading(detect(html, ['delay_js']));
    expect(reading).toMatchObject({ verdict: 'not applied', source: 'meta' });
    expect(hudStateLine(DELAY, reading)).toBe(
      "WP Rocket's generator meta does not declare it on this page. Simulated in this tab by the extension, not by WP Rocket."
    );
  });

  it('unverified: the served verdict, then the not-verified words', () => {
    const reading = delayReading(detect(withSimulationMarker(DELAY_ON_NO_META), []));
    expect(reading).toMatchObject({ verdict: 'applied', simulation: 'unverified' });
    expect(hudStateLine(DELAY, reading)).toMatch(
      /^applied on this page: .+\. Simulation marker not verified: read as served\.$/
    );
  });

  it('no fact on a page without a marker, nor on rows a simulation never names', () => {
    const plain = detect(DELAY_ON_NO_META, ['delay_js']);
    expect(delayReading(plain)).not.toHaveProperty('simulation');
    const marked = detect(withSimulationMarker(DELAY_ON_NO_META), ['delay_js']);
    expect(readHudFeature(DEFER, describeDetections(marked), marked)).not.toHaveProperty(
      'simulation'
    );
  });
});
