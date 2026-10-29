/**
 * The stage's slots with a stand-in plugged in (the CSP evaluator is inert
 * in the product today; the marker writer is replaced to isolate the
 * stage): what the stage does with a blocking or limiting verdict and with
 * a written marker.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { composeSteps } from '../exclusion-builder/pipeline';
import { parseDocumentSimulationReport } from '../messaging/exclusion-simulation';
import { MARKER_ID, simulationInput } from '../messaging/exclusion-simulation.fixtures';
import type { SimulationCspVerdict } from '../wp-rocket-simulation/csp-evaluation';
import { simulationStage } from './simulation-stage';

const slots: { verdict: SimulationCspVerdict; written: boolean } = vi.hoisted(() => ({
  verdict: { blocked: false, limits: [] },
  written: false
}));

vi.mock('../wp-rocket-simulation/csp-evaluation', () => ({
  evaluateSimulationCsp: () => slots.verdict
}));

vi.mock('../wp-rocket-simulation/marker-write', () => ({
  writeSimulationMarker: (
    html: string,
    markerId: string | undefined,
    simulated: readonly string[]
  ) =>
    slots.written && markerId !== undefined && simulated.length > 0
      ? { html: `${html}<!--marker ${markerId}-->`, written: true }
      : { html, written: false }
}));

const PAGE = '<html><head></head><body><script src="/a.js"></script></body></html>';

/** Run the stage over a page. */
function run(html: string) {
  const stage = simulationStage(simulationInput());
  const composed = composeSteps(html, stage.steps);
  if (!composed.completed) throw new Error('unhooked composition stopped');
  return stage.finish(composed.html, composed.reports);
}

/** Whether a report crosses the session contract. */
function crossesContract(report: unknown): boolean {
  return parseDocumentSimulationReport(report, { features: ['delay_js'] }, 'reject') !== null;
}

beforeEach(() => {
  slots.verdict = { blocked: false, limits: [] };
  slots.written = false;
});

describe('simulationStage — CSP slot', () => {
  it('serves the page as is when the policy blocks the runtime (csp-blocked)', () => {
    slots.verdict = { blocked: true };
    const out = run(PAGE);
    expect(out.html).toBe(PAGE);
    expect(out.reports[0]).toMatchObject({
      state: 'csp-blocked',
      delayed: 0,
      runtimeInjected: false
    });
    expect(out.reports.every(crossesContract)).toBe(true);
  });

  it('names the limited work on a simulated page', () => {
    slots.verdict = { blocked: false, limits: ['eval', 'data'] };
    const out = run(PAGE);
    expect(out.reports[0]).toMatchObject({ state: 'simulated', cspLimits: ['eval', 'data'] });
    expect(out.reports.every(crossesContract)).toBe(true);
  });
});

describe('simulationStage — marker slot', () => {
  it('names the marker id on a simulated report once the writer wrote it', () => {
    slots.written = true;
    const out = run(PAGE);
    expect(out.html.endsWith(`<!--marker ${MARKER_ID}-->`)).toBe(true);
    expect(out.reports[0]).toMatchObject({ state: 'simulated', markerId: MARKER_ID });
    expect(out.reports.every(crossesContract)).toBe(true);
  });

  it('writes nothing on a page nothing was simulated on', () => {
    slots.written = true;
    const served =
      '<html><head></head><body><script type="rocketlazyloadscript"></script></body></html>';
    const out = run(served);
    expect(out.html).toBe(served);
    expect(out.reports[0]).not.toHaveProperty('markerId');
  });
});
