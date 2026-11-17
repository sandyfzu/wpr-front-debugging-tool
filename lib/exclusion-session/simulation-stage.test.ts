import { describe, expect, it } from 'vitest';
import { composeSteps } from '../exclusion-builder/pipeline';
import { parseDocumentSimulationReport } from '../messaging/exclusion-simulation';
import { simulationInput as fixtureInput } from '../messaging/exclusion-simulation.fixtures';
import type { DocumentSimulationInput } from '../messaging/exclusion-simulation';
import {
  simulateDelayJs,
  type DelayJsForwardReport
} from '../wp-rocket-simulation/delay-js-forward';
import { simulationStage, simulationStepIds, wireSimulationReport } from './simulation-stage';

/** An input without CSP or marker (each case adds what it needs). */
function input(overrides: Partial<DocumentSimulationInput> = {}): DocumentSimulationInput {
  const base: Record<string, unknown> = { ...fixtureInput() };
  delete base['csp'];
  delete base['markerId'];
  return { ...base, ...overrides } as DocumentSimulationInput;
}

const PAGE =
  '<!DOCTYPE html><html><head><title>t</title></head><body><script src="/a.js"></script></body></html>';

/** Run a stage over a page (no hooks) → the html and reports. */
function run(html: string, simulation: DocumentSimulationInput, encoding?: string) {
  const stage = simulationStage(
    simulation,
    encoding === undefined ? undefined : { encoding, bom: false }
  );
  const composed = composeSteps(html, stage.steps);
  if (!composed.completed) throw new Error('unhooked composition stopped');
  return stage.finish(composed.html, composed.reports);
}

/** A forward report with defaults. */
function forward(overrides: Partial<DelayJsForwardReport> = {}): DelayJsForwardReport {
  return {
    state: 'simulated',
    delayed: 2,
    runtimeInjected: true,
    caveats: [],
    regexLimitHit: false,
    undetermined: 0,
    ...overrides
  };
}

/** Whether a report crosses the session contract (the record parser's rule). */
function crossesContract(report: unknown): boolean {
  return parseDocumentSimulationReport(report, { features: ['delay_js'] }, 'reject') !== null;
}

describe('simulationStepIds', () => {
  it('keeps the registry order and only the requested features', () => {
    expect(simulationStepIds(['delay_js'])).toEqual(['delay_js']);
    expect(simulationStepIds([])).toEqual([]);
  });
});

describe('simulationStage', () => {
  it('throws on an input naming an unsupported version (the input guard refuses it: a broken invariant)', () => {
    expect(() => run(PAGE, input({ wpRocketVersion: '3.24' }))).toThrow(
      'simulation input names WP Rocket 3.24, not a supported version'
    );
  });

  it('simulates Delay JS with the input’s runtime, fallback and list (never stored rows)', () => {
    const simulation = input();
    const out = run(PAGE, simulation);
    const expected = simulateDelayJs({
      html: PAGE,
      runtime: simulation.runtime,
      ieFallback: simulation.fallback,
      listRows: simulation.listRows,
      rows: [],
      // The fixture input simulates 3.23.5.1.
      metaCharsetMoveText: 'replacement'
    });
    expect(out.html).toBe(expected.html);
    expect(out.reports).toEqual([
      {
        feature: 'delay_js',
        state: 'simulated',
        delayed: 1,
        runtimeInjected: true,
        wpRocketVersion: '3.23.5.1',
        listSource: 'bundled',
        listMiss: 'never-fetched'
      }
    ]);
    expect(out.reports.every(crossesContract)).toBe(true);
  });

  it('moves the meta charset as the input’s version writes it', () => {
    const served =
      '<html><head><title>t</title><meta charset="utf-8" data-x="$0"></head><body></body></html>';
    const moved = (wpRocketVersion: string): string | undefined =>
      /<meta charset="utf-8" data-x="[^"]*">/.exec(
        run(served, input({ wpRocketVersion })).html
      )?.[0];
    expect(moved('3.23.5.1')).toBe('<meta charset="utf-8" data-x="<head>">');
    expect(moved('3.24.1')).toBe('<meta charset="utf-8" data-x="$0">');
  });

  it('serves an already-delayed page as is (already-served)', () => {
    const served =
      '<html><head></head><body><script type="rocketlazyloadscript"></script></body></html>';
    const out = run(served, input());
    expect(out.html).toBe(served);
    expect(out.reports[0]).toMatchObject({ state: 'already-served', delayed: 0 });
    expect(out.reports.every(crossesContract)).toBe(true);
  });

  it('serves an AMP page as is (not-applicable: amp)', () => {
    const amp = '<html amp><head></head><body><script src="/a.js"></script></body></html>';
    const out = run(amp, input());
    expect(out.html).toBe(amp);
    expect(out.reports[0]).toMatchObject({ state: 'not-applicable', reason: 'amp' });
    expect(out.reports.every(crossesContract)).toBe(true);
  });

  it('serves a page it cannot count the bytes of as is (not-applicable: unsupported-charset)', () => {
    const latin = PAGE.replace('<title>t</title>', '<title>café</title>');
    const out = run(latin, input(), 'windows-1252');
    expect(out.html).toBe(latin);
    expect(out.reports[0]).toMatchObject({
      state: 'not-applicable',
      reason: 'unsupported-charset',
      runtimeInjected: false
    });
    expect(out.reports.every(crossesContract)).toBe(true);
    // The same page, all ASCII, in that charset is simulated.
    expect(run(PAGE, input(), 'windows-1252').reports[0]?.state).toBe('simulated');
  });

  it('echoes a latest list and the served version, and reports an unevaluated CSP', () => {
    const out = run(
      PAGE,
      input({
        listSource: 'latest',
        listFetchedAt: 1_790_000_000_000,
        siteVersion: '3.12.1',
        cspUnavailable: 'oversized'
      })
    );
    expect(out.reports[0]).toMatchObject({
      listSource: 'latest',
      listFetchedAt: 1_790_000_000_000,
      siteVersion: '3.12.1',
      cspUnavailable: 'oversized'
    });
    expect(out.reports[0]).not.toHaveProperty('listMiss');
    expect(out.reports.every(crossesContract)).toBe(true);
  });

  it('writes the marker and names its id on a simulated page', () => {
    const markerId = '0123456789abcdef0123456789abcdef';
    const out = run(PAGE, input({ markerId }));
    expect(out.reports[0]).toMatchObject({ state: 'simulated', markerId });
    expect(out.html).toContain(
      `<meta name="wpr-fdt-simulation" content="v1 delay_js=simulated id=${markerId}"></head>`
    );
    expect(out.reports.every(crossesContract)).toBe(true);
  });

  it('names no marker when no id was drawn, and removes a served copy either way', () => {
    const served = PAGE.replace(
      '</head>',
      '<meta name="wpr-fdt-simulation" content="v1 delay_js=simulated id=ffffffffffffffffffffffffffffffff"></head>'
    );
    const out = run(served, input());
    expect(out.reports[0]).toMatchObject({ state: 'simulated' });
    expect(out.reports[0]).not.toHaveProperty('markerId');
    expect(out.html).not.toContain('wpr-fdt-simulation');
  });
});

describe('wireSimulationReport', () => {
  it('carries simulated-only facts only when they say something', () => {
    expect(
      wireSimulationReport(
        'delay_js',
        forward({ undetermined: 3, caveats: ['combined-js'] }),
        input(),
        ['eval']
      )
    ).toMatchObject({ undetermined: 3, caveats: ['combined-js'], cspLimits: ['eval'] });
    const quiet = wireSimulationReport('delay_js', forward(), input(), []);
    for (const key of ['undetermined', 'regexLimitHit', 'cspLimits', 'caveats', 'cspUnavailable']) {
      expect(quiet).not.toHaveProperty(key);
    }
    expect(crossesContract(quiet)).toBe(true);
  });

  it('carries a regex-limit hit (nothing delayed) as the contract wants it', () => {
    const report = wireSimulationReport(
      'delay_js',
      forward({ delayed: 0, regexLimitHit: true }),
      input(),
      []
    );
    expect(report).toMatchObject({ regexLimitHit: true, delayed: 0 });
    expect(crossesContract(report)).toBe(true);
  });

  it('keeps an identity state free of simulated-only facts (even a CSP-unavailable input)', () => {
    const report = wireSimulationReport(
      'delay_js',
      forward({
        state: 'not-applicable',
        reason: 'beyond-exact-reproduction',
        unreproducedRegex: 'svg-mask',
        delayed: 0,
        runtimeInjected: false,
        caveats: ['combined-js']
      }),
      input({ cspUnavailable: 'unreadable' }),
      ['eval']
    );
    expect(report).toMatchObject({
      state: 'not-applicable',
      reason: 'beyond-exact-reproduction',
      unreproducedRegex: 'svg-mask'
    });
    for (const key of ['cspLimits', 'caveats', 'cspUnavailable']) {
      expect(report).not.toHaveProperty(key);
    }
    expect(crossesContract(report)).toBe(true);
  });
});
