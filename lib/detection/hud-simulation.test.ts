/**
 * The simulation modifier in the shared reading: the fact read through,
 * the owner-approved copy pinned (chip, sentence, tab hint, summary suffix),
 * the served state line for both facts, and the verdict a verified
 * simulation reads as —
 * not applied, never "unknown", never a WP Rocket claim.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WprDetections } from '../wp-rocket/types';
import { describeDetections } from './describe';
import { FIXTURE_DIR } from './fixtures/corpus';
import {
  BUILDER_TAB_LINE_TITLE,
  builderPageKind,
  builderTabLine,
  hudFeatureOf,
  hudStateLine,
  readHudFeature,
  simulationModifierCopy,
  simulationSummary,
  simulationSummaryParts,
  simulationTabHint,
  type HudFeature
} from './hud';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
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

describe('simulation modifier copy (owner words)', () => {
  it('pins both facts', () => {
    expect(simulationModifierCopy('simulated')).toEqual({
      chip: 'Simulated in this tab',
      sentence: "Simulated in this tab by the extension — not the site's configuration."
    });
    expect(simulationModifierCopy('unverified')).toEqual({
      chip: 'Simulation not verified',
      sentence: "This page claims a simulation the extension can't confirm, so it's read as served."
    });
    // Only a verified simulation joins the tab line, so only it has a hint.
    expect(simulationTabHint(DELAY)).toBe('Delay JS simulated');
  });

  it('pins the summary suffix phrases (the panel strip renders each as its own unit)', () => {
    expect(simulationSummaryParts(0, 0)).toEqual([]);
    expect(simulationSummaryParts(1, 0)).toEqual(['1 simulated in this tab']);
    expect(simulationSummaryParts(3, 2)).toEqual([
      '3 simulated in this tab',
      'simulation not verified'
    ]);
  });

  it('pins the summary suffix', () => {
    expect(simulationSummary(0, 0)).toBeNull();
    expect(simulationSummary(1, 0)).toBe('1 simulated in this tab');
    expect(simulationSummary(0, 1)).toBe('simulation not verified');
    expect(simulationSummary(2, 1)).toBe('2 simulated in this tab · simulation not verified');
  });
});

describe('readHudFeature + hudStateLine with a simulation fact', () => {
  // The state line feeds only the widget row tooltip, which a row with a
  // simulation modifier drops: the line stays the served one, never naming it.
  it('verified on a WP Rocket page without meta: not applied (never unknown), served line', () => {
    const detections = detect(withSimulationMarker(DELAY_ON_NO_META), ['delay_js']);
    expect(detections.wpr.present).toBe(true);
    const reading = delayReading(detections);
    expect(reading).toMatchObject({ verdict: 'not applied', source: null, why: null });
    expect(reading.simulation).toBe('simulated');
    expect(hudStateLine(DELAY, reading)).toBe(
      "nothing matched on this page (the page may predate the plugin's work)."
    );
  });

  it('verified under a refuting meta: the meta line alone', () => {
    const html = withSimulationMarker(
      DELAY_ON_NO_META.replace(
        '<head>',
        '<head><meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_minify_js">'
      )
    );
    const reading = delayReading(detect(html, ['delay_js']));
    expect(reading).toMatchObject({ verdict: 'not applied', source: 'meta' });
    expect(hudStateLine(DELAY, reading)).toBe(
      "WP Rocket's generator meta does not declare it on this page."
    );
  });

  it('unverified: the served verdict alone', () => {
    const reading = delayReading(detect(withSimulationMarker(DELAY_ON_NO_META), []));
    expect(reading).toMatchObject({ verdict: 'applied', simulation: 'unverified' });
    expect(hudStateLine(DELAY, reading)).toMatch(/^applied on this page: [^.]+\.$/);
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

/** The page with an Exclusion Builder marker stating `content` in its head. */
function withBuilderMarker(html: string, content: string): string {
  return html.replace(
    '<head>',
    `<head><meta name="${BUILDER_MARKER_META_NAME}" content="${content}">`
  );
}

describe('builderTabLine + builderPageKind with a simulation fact', () => {
  it('verified: the tab line names the simulation and the pill leads with its glyph', () => {
    const detections = detect(withSimulationMarker(DELAY_ON_NO_META), ['delay_js']);
    expect(builderTabLine(detections)).toEqual({
      title: BUILDER_TAB_LINE_TITLE,
      hints: ['Delay JS simulated'],
      spoken: `${BUILDER_TAB_LINE_TITLE} — Delay JS simulated`
    });
    expect(builderPageKind(detections)).toBe('simulated');
  });

  it('verified + builder facts: the simulation hint before the builder hints; the glyph stays simulated', () => {
    const html = withBuilderMarker(
      withSimulationMarker(DELAY_ON_NO_META),
      'v1 delay_js=excluded:2 defer_all_js=off'
    );
    const detections = detect(html, ['delay_js']);
    expect(builderTabLine(detections)?.hints).toEqual([
      'Delay JS simulated',
      'Delay JS: 2 excluded',
      'Defer JS off'
    ]);
    // A simulation outranks a feature turned off (the page runs code the site never sent).
    expect(builderPageKind(detections)).toBe('simulated');
  });

  it('unverified: no tab-level change (nothing the extension can vouch for), builder facts still lead', () => {
    const unverified = detect(withSimulationMarker(DELAY_ON_NO_META), []);
    expect(builderTabLine(unverified)).toBeNull();
    expect(builderPageKind(unverified)).toBeNull();
    const withBuilder = detect(
      withBuilderMarker(withSimulationMarker(DELAY_ON_NO_META), 'v1 defer_all_js=off'),
      []
    );
    expect(builderTabLine(withBuilder)?.hints).toEqual(['Defer JS off']);
    expect(builderPageKind(withBuilder)).toBe('off');
  });
});
