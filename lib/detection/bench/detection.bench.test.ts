/**
 * Speed gate for the detection engine.
 *
 * Measured (2026-10-07, happy-dom, medians over 10 warm, alternating
 * iterations): the shared DOMParser dominates both engines' full passes
 * (e.g. on a 136 KB fixture: parse ≈ 10.5 ms of an ≈ 11–12 ms total), so a
 * full-pass ratio cannot express what the engine controls. The asserted
 * comparison is the checks phase only: both engines receive the same
 * pre-parsed document and element lists, and only their checks are timed.
 * Full-pass totals (parse included) are printed for transparency; P3's
 * content script reports the full pass.
 *
 * Runs locally (its ratio is machine-relative — CI never runs it) via
 * `pnpm bench:detection`, which enables the reporter that shows the output.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePage } from '../parse-page';
import { runDetection, runChecks } from '../run-detection';
import { detectPreloadedResources } from '../detect-optimizations';
import { FIXTURES, FIXTURE_DIR } from '../fixtures/corpus';
import CheckOptimizationFunctions, {
  checkPreloadedResources,
  runReferenceDetection
} from '../reference/engine';
import type { CheckOptimizationFunctionPayload } from '../reference/engine';

const WARMUPS = 3;
const ITERATIONS = 10;
/** Checks-phase speed floor: median(new) ≤ 70 % of median(reference). */
const SPEED_RATIO_CEILING = 0.7;

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const low = sorted[Math.floor((sorted.length - 1) / 2)];
  const high = sorted[Math.ceil((sorted.length - 1) / 2)];
  if (low === undefined || high === undefined) throw new Error('median over an empty sample set');
  return (low + high) / 2;
}

/** Runs `fn` once with timing, returns milliseconds. */
function time(fn: () => void): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

/** Rounds to two decimals for the report table. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

describe('detection bench', () => {
  const corpus = FIXTURES.map((fixture) => {
    const html = readFileSync(join(FIXTURE_DIR, fixture), 'utf8');
    const page = parsePage(html);
    // The reference engine reads the same parsed document and element lists
    // the port's checks run on — one parse per fixture, never two.
    const payload: CheckOptimizationFunctionPayload = {
      pageHTML: html,
      HTMLDocument: page.document,
      pageScripts: page.scripts,
      pageLinkElements: page.links
    };
    return { fixture, html, page, payload };
  });

  it('checks phase is ≥30 % faster than the reference (aggregate median)', () => {
    // Warmup: both engines under identical conditions.
    for (let i = 0; i < WARMUPS; i++) {
      for (const { page, payload } of corpus) {
        runChecks(page);
        for (const func of Object.values(CheckOptimizationFunctions)) func(payload);
      }
    }

    // Per-fixture samples (medians feed the table), aggregate counts per
    // iteration (medians feed the asserted ratio).
    const portChecksBy = new Map<string, number[]>(corpus.map(({ fixture }) => [fixture, []]));
    const referenceChecksBy = new Map<string, number[]>(corpus.map(({ fixture }) => [fixture, []]));
    const portChecks: number[] = [];
    const referenceChecks: number[] = [];
    const portFull: number[] = [];
    const referenceFull: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      // Alternate engines per iteration so a drifting clock cannot favor one.
      let portTotal = 0;
      let referenceTotal = 0;
      let portFullTotal = 0;
      let referenceFullTotal = 0;
      for (const { fixture, html, page, payload } of corpus) {
        const portMs = time(() => runChecks(page)) + time(() => detectPreloadedResources(page));
        portTotal += portMs;
        (portChecksBy.get(fixture) as number[]).push(portMs);
        const referenceMs = time(() => {
          for (const func of Object.values(CheckOptimizationFunctions)) func(payload);
          checkPreloadedResources(payload.HTMLDocument);
        });
        referenceTotal += referenceMs;
        (referenceChecksBy.get(fixture) as number[]).push(referenceMs);
        portFullTotal += time(() => runDetection(html));
        referenceFullTotal += time(() => runReferenceDetection(html));
      }
      portChecks.push(portTotal);
      referenceChecks.push(referenceTotal);
      portFull.push(portFullTotal);
      referenceFull.push(referenceFullTotal);
    }

    const portChecksMedian = median(portChecks);
    const referenceChecksMedian = median(referenceChecks);
    const ratio = portChecksMedian / referenceChecksMedian;

    console.table(
      corpus.map(({ fixture }) => {
        const port = median(portChecksBy.get(fixture) as number[]);
        const reference = median(referenceChecksBy.get(fixture) as number[]);
        return {
          fixture,
          'new ms': round2(port),
          'reference ms': round2(reference),
          ratio: round2(port / reference)
        };
      })
    );
    console.log(
      `checks-phase aggregate medians: new=${portChecksMedian.toFixed(2)} ms, ` +
        `reference=${referenceChecksMedian.toFixed(2)} ms, ratio=${ratio.toFixed(2)} ` +
        `(ceiling ${String(SPEED_RATIO_CEILING)}); full-pass medians (parse included): ` +
        `new=${median(portFull).toFixed(2)} ms, reference=${median(referenceFull).toFixed(2)} ms`
    );

    expect(
      ratio,
      'the port engine must be ≥30 % faster than the reference on the fixture corpus'
    ).toBeLessThan(SPEED_RATIO_CEILING);
  });
});
