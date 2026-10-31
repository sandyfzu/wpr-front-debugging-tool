/**
 * The simulation modifier on the Detections cards, the summary counts and
 * the support report: a verified simulation reads "Simulated in this tab"
 * on a card whose Status stays not served, an unverified marker reads "not
 * verified" over the served verdict, and nothing is said on a page without
 * a marker.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../detection/fixtures/corpus';
import { parsePage } from '../detection/parse-page';
import { applyPresencePropagation, runChecks } from '../detection/run-detection';
import { withSimulationMarker } from '../detection/simulated-pages.fixtures';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
import type { WprDetections } from '../wp-rocket/types';
import { buildStatusItems, type StatusItem } from './detections-view-model';
import { summarizeFdtData } from './detections-summary';
import { buildSupportReport, type SupportReportContext } from './support-report';
import { makeReportData } from './support-report.fixtures';

const CONTEXT: SupportReportContext = {
  generatedAt: Date.UTC(2026, 9, 29, 12, 0, 0),
  extensionVersion: '1.4.0',
  pageUrl: 'https://example.com/'
};

const DELAY_ON_NO_META = readFileSync(join(FIXTURE_DIR, 'delay-on-no-meta.html'), 'utf8');

/** The simulated (marked) page. */
const MARKED = withSimulationMarker(DELAY_ON_NO_META);

/** A page's rows, with the features the background vouched for. */
function detect(html: string, verified: readonly 'delay_js'[]): WprDetections {
  const detections = runChecks(parsePage(html), verified);
  applyPresencePropagation(detections);
  return detections;
}

/** The Delay JS card of a page. */
function delayCard(detections: WprDetections): StatusItem {
  const found = buildStatusItems(makeReportData({ wprDetections: detections })).find(
    (item) => item.id === 'delay_js'
  );
  if (found === undefined) throw new Error('no Delay JS card');
  return found;
}

/** The report of a page. */
function report(detections: WprDetections): string {
  return buildSupportReport(makeReportData({ wprDetections: detections }), CONTEXT);
}

describe('the Delay JS card', () => {
  it('verified: not served, with the simulated badge words and sentence', () => {
    const card = delayCard(detect(MARKED, ['delay_js']));
    expect(card).toMatchObject({
      status: 'not-active',
      simulation: 'simulated',
      simulationChip: 'Simulated in this tab',
      simulationSentence:
        "Simulated in this tab by the extension — not the site's configuration; its own WP Rocket exclusions aren't included."
    });
    // The simulated runtime's version is never shown as served.
    expect(card).not.toHaveProperty('detail');
  });

  it('unverified: the served verdict, with the not-verified words', () => {
    expect(delayCard(detect(MARKED, []))).toMatchObject({
      status: 'active',
      simulation: 'unverified',
      simulationChip: 'Simulation not verified',
      simulationSentence:
        "This page claims a simulation the extension can't confirm, so it's read as served."
    });
  });

  it('no marker: no simulation field at all', () => {
    const card = delayCard(detect(DELAY_ON_NO_META, ['delay_js']));
    expect(card).not.toHaveProperty('simulation');
    expect(card).not.toHaveProperty('simulationChip');
    expect(card).not.toHaveProperty('simulationSentence');
  });
});

describe('the summary counts', () => {
  /** The optimizations summary of a page. */
  const counts = (detections: WprDetections) =>
    summarizeFdtData(makeReportData({ wprDetections: detections })).summary.optimizations;

  it('counts a verified simulation, never as active', () => {
    const served = counts(detect(DELAY_ON_NO_META, []));
    const simulated = counts(detect(MARKED, ['delay_js']));
    expect(simulated).toMatchObject({ simulated: 1, unverified: 0, offInTab: 0 });
    expect(simulated.total).toBe(served.total);
    expect(simulated.active).toBe(served.active - 1);
  });

  it('counts an unverified marker apart, the served count unchanged', () => {
    const served = counts(detect(DELAY_ON_NO_META, []));
    expect(counts(detect(MARKED, []))).toEqual({ ...served, unverified: 1 });
  });

  it('counts nothing on a page without a marker', () => {
    expect(counts(detect(DELAY_ON_NO_META, []))).toMatchObject({ simulated: 0, unverified: 0 });
  });
});

describe('the support report', () => {
  it('suffixes the Optimizations line and adds the sentence to the row’s Details', () => {
    const text = report(detect(MARKED, ['delay_js']));
    expect(text).toMatch(/^- \*\*Optimizations:\*\* \d+ of \d+ active · 1 simulated in this tab$/m);
    expect(text).toMatch(
      /^\| Delay JavaScript execution \| Not active \| .+ \| .*Simulated in this tab by the extension — not the site's configuration; its own WP Rocket exclusions aren't included\. \|$/m
    );
  });

  it('names an unverified marker on both lines', () => {
    const text = report(detect(MARKED, []));
    expect(text).toMatch(/^- \*\*Optimizations:\*\* \d+ of \d+ active · simulation not verified$/m);
    expect(text).toMatch(
      /^\| Delay JavaScript execution \| Active \| .+ \| .*This page claims a simulation the extension can't confirm, so it's read as served\. \|$/m
    );
  });

  it('chains the builder suffix before the simulation suffix', () => {
    const html = MARKED.replace(
      '<head>',
      `<head><meta name="generator" content="WP Rocket 3.24" data-wpr-features="wpr_defer_js"><meta name="${BUILDER_MARKER_META_NAME}" content="v1 defer_all_js=off">`
    );
    expect(report(detect(html, ['delay_js']))).toMatch(
      /^- \*\*Optimizations:\*\* \d+ of \d+ active · 1 off in this tab · 1 simulated in this tab$/m
    );
  });

  it('says nothing of a simulation on a page without a marker', () => {
    expect(report(detect(DELAY_ON_NO_META, ['delay_js']))).not.toMatch(/simulat/i);
  });
});
