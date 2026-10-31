/**
 * The simulation step's CSP outcomes, with the real evaluator: a blocked
 * runtime serves the page as is (`csp-blocked`), limits ride on a
 * `simulated` report, an unevaluated policy is carried as such — each
 * report crossing the session contract.
 */
import { describe, expect, it } from 'vitest';
import { composeSteps } from '../exclusion-builder/pipeline';
import {
  parseDocumentSimulationReport,
  type DocumentSimulationInput,
  type SimulationCspInput
} from '../messaging/exclusion-simulation';
import { simulationInput as fixtureInput } from '../messaging/exclusion-simulation.fixtures';
import { simulationStage } from './simulation-stage';

/** A page with one external and one inline script (both delayed). */
const PAGE =
  '<!DOCTYPE html><html><head><title>t</title></head><body><script src="/a.js"></script><script>inline()</script></body></html>';

/** The fixture input with the given CSP pair (no marker). */
function input(
  csp: Pick<DocumentSimulationInput, 'csp' | 'cspUnavailable'>
): DocumentSimulationInput {
  const base: Record<string, unknown> = { ...fixtureInput() };
  delete base['csp'];
  delete base['markerId'];
  return { ...base, ...csp } as DocumentSimulationInput;
}

/** A CSP input of header policies. */
function headers(browser: SimulationCspInput['browser'], ...values: string[]): SimulationCspInput {
  return {
    browser,
    headers: values.map((value) => ({ name: 'Content-Security-Policy', value })),
    metas: []
  };
}

/** Run the stage → the html and its one report. */
function run(simulation: DocumentSimulationInput, page = PAGE) {
  const stage = simulationStage(simulation);
  const composed = composeSteps(page, stage.steps);
  if (!composed.completed) throw new Error('unhooked composition stopped');
  const out = stage.finish(composed.html, composed.reports);
  const [report] = out.reports;
  expect(parseDocumentSimulationReport(report, { features: ['delay_js'] }, 'reject')).toEqual(
    report
  );
  return { html: out.html, report };
}

describe('simulation step — CSP outcomes', () => {
  it('a policy blocking the inline runtime serves the page as is: csp-blocked', () => {
    for (const browser of ['chromium', 'firefox'] as const) {
      const { html, report } = run(input({ csp: headers(browser, "script-src 'self'") }));
      expect(html).toBe(PAGE);
      expect(report).toMatchObject({ state: 'csp-blocked', delayed: 0, runtimeInjected: false });
      expect(report).not.toHaveProperty('cspLimits');
    }
  });

  it('a policy limiting the runtime’s work simulates and names each limit, per engine', () => {
    const csp = "script-src 'self' 'unsafe-inline'";
    const chromium = run(input({ csp: headers('chromium', csp) }));
    expect(chromium.html).toContain('rocketlazyloadscript');
    expect(chromium.report).toMatchObject({ state: 'simulated', cspLimits: ['eval', 'data'] });
    expect(run(input({ csp: headers('firefox', csp) })).report).toMatchObject({
      state: 'simulated',
      cspLimits: ['eval']
    });
  });

  it('a policy limiting nothing simulates without limits', () => {
    const { report } = run(
      input({ csp: headers('chromium', "script-src 'unsafe-inline' 'unsafe-eval' data:") })
    );
    expect(report).toMatchObject({ state: 'simulated' });
    expect(report).not.toHaveProperty('cspLimits');
  });

  it('an unevaluated policy simulates and says so (never "no CSP")', () => {
    const { report } = run(input({ cspUnavailable: 'oversized' }));
    expect(report).toMatchObject({ state: 'simulated', cspUnavailable: 'oversized' });
    expect(report).not.toHaveProperty('cspLimits');
  });

  it('a delayed nonce it cannot read, under a nonce source, simulates with the CSP unavailable', () => {
    const page = PAGE.replace('<script>inline()', '<script nonce="n&nbsp;">inline()');
    const csp = headers('chromium', "script-src 'unsafe-inline' 'unsafe-eval' data:");
    const reportOnly = {
      name: 'Content-Security-Policy-Report-Only',
      value: "script-src 'nonce-n'"
    };
    const { html, report } = run(
      input({ csp: { ...csp, headers: [...csp.headers, reportOnly] } }),
      page
    );
    expect(html).toContain('rocketlazyloadscript');
    expect(report).toMatchObject({ state: 'simulated', cspUnavailable: 'unreadable' });
    expect(report).not.toHaveProperty('cspLimits');
  });
});
