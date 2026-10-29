/**
 * The simulation contracts' Defer JS fields: the input's `deferLists`
 * (exactly with Defer JS, for a supported version), the report's
 * own fields per feature (Defer JS's counts, never Delay JS's fields or
 * values, and the reverse), and the `rewritten`
 * outcome's `deferSimulation` beside the Delay JS `simulation`.
 */
import { describe, expect, it } from 'vitest';
import { activeRecord } from './exclusion-session.fixtures';
import { parseExclusionSessionRecord } from './exclusion-session';
import {
  parseDocumentSimulationInput,
  parseDocumentSimulationReport,
  parseSimulationDeferLists,
  type DeferSimulationReport
} from './exclusion-simulation';
import { simulatedReport, simulationInput } from './exclusion-simulation.fixtures';

const BOTH = { features: ['defer_all_js', 'delay_js'] } as const;

const DEFER_LISTS = {
  external: ['jquery.js', 'gtag'],
  inline: ['lazyLoadOptions'],
  listSource: 'latest',
  listFetchedAt: 1_790_000_000_000
} as const;

/** A Defer JS report as a step writes it. */
function deferReport(): DeferSimulationReport {
  return {
    feature: 'defer_all_js',
    state: 'simulated',
    deferred: 3,
    wrapped: 1,
    wpRocketVersion: '3.24',
    listSource: 'bundled',
    listMiss: 'never-fetched'
  };
}

/** A Delay JS report in state `not-applicable` for `reason` (no simulated-only fact). */
function delayNotApplicable(reason: string): Record<string, unknown> {
  return {
    feature: 'delay_js',
    state: 'not-applicable',
    reason,
    delayed: 0,
    runtimeInjected: false,
    wpRocketVersion: '3.24',
    listSource: 'bundled',
    listMiss: 'never-fetched'
  };
}

describe('parseSimulationDeferLists', () => {
  it('rebuilds both lists with their provenance', () => {
    expect(parseSimulationDeferLists(DEFER_LISTS)).toEqual(DEFER_LISTS);
    const bundled = { external: [], inline: [], listSource: 'bundled', listMiss: 'expired' };
    expect(parseSimulationDeferLists(bundled)).toEqual(bundled);
  });

  it.each([
    ['an unknown key', { ...DEFER_LISTS, extra: 1 }],
    ['no inline list', { ...DEFER_LISTS, inline: undefined }],
    ['an empty row', { ...DEFER_LISTS, external: [''] }],
    ['a contradictory provenance', { ...DEFER_LISTS, listMiss: 'timeout' }],
    ['no provenance', { external: [], inline: [] }],
    ['a non-record', ['jquery']]
  ])('refuses %s', (_name, value) => {
    expect(parseSimulationDeferLists(value)).toBeNull();
  });
});

describe('parseDocumentSimulationInput — Defer JS lists', () => {
  const html = 'x'.repeat(10);

  it('carries the lists exactly when the run simulates Defer JS', () => {
    const input = { ...simulationInput(), ...BOTH, deferLists: DEFER_LISTS };
    expect(parseDocumentSimulationInput(input, html.length)).toEqual(input);
    expect(parseDocumentSimulationInput(simulationInput(), html.length)).toEqual(simulationInput());
  });

  it.each([
    ['Defer JS without its lists', { ...BOTH }],
    ['lists without Defer JS', { deferLists: DEFER_LISTS }],
    ['malformed lists', { ...BOTH, deferLists: { ...DEFER_LISTS, inline: 'x' } }],
    ['an unsupported version', { ...BOTH, deferLists: DEFER_LISTS, wpRocketVersion: '3.20' }]
  ])('refuses %s', (_name, change) => {
    expect(
      parseDocumentSimulationInput({ ...simulationInput(), ...change }, html.length)
    ).toBeNull();
  });
});

describe('parseDocumentSimulationReport — Defer JS counts', () => {
  it('reads a Defer JS report, its counts required', () => {
    expect(parseDocumentSimulationReport(deferReport(), BOTH, 'reject')).toEqual(deferReport());
    const noDeferred: Record<string, unknown> = { ...deferReport() };
    delete noDeferred['deferred'];
    expect(parseDocumentSimulationReport(noDeferred, BOTH, 'reject')).toBeNull();
  });

  it('refuses counts on an identity state, or on a Delay JS report', () => {
    const served = { ...deferReport(), state: 'already-served' };
    expect(parseDocumentSimulationReport(served, BOTH, 'reject')).toBeNull();
    expect(
      parseDocumentSimulationReport({ ...served, deferred: 0, wrapped: 0 }, BOTH, 'reject')
    ).toEqual({ ...served, deferred: 0, wrapped: 0 });
    expect(
      parseDocumentSimulationReport({ ...simulatedReport(), wrapped: 0 }, BOTH, 'reject')
    ).toBeNull();
  });

  it('reads the delay-js-served reason', () => {
    const report = {
      ...deferReport(),
      state: 'not-applicable',
      reason: 'delay-js-served',
      deferred: 0,
      wrapped: 0
    };
    expect(parseDocumentSimulationReport(report, BOTH, 'reject')).toEqual(report);
  });

  it.each([
    ['delayed', { delayed: 0 }],
    ['runtimeInjected', { runtimeInjected: false }],
    ['cspLimits', { cspLimits: ['eval'] }],
    ['cspUnavailable', { cspUnavailable: 'oversized' }],
    ['undetermined', { undetermined: 1 }],
    ['regexLimitHit', { regexLimitHit: true }],
    ['caveats', { caveats: ['combined-js'] }],
    ['csp-blocked', { state: 'csp-blocked', deferred: 0, wrapped: 0 }],
    [
      'a Delay JS-only regex',
      {
        state: 'not-applicable',
        reason: 'beyond-exact-reproduction',
        unreproducedRegex: 'svg-mask',
        deferred: 0,
        wrapped: 0
      }
    ]
  ])('refuses Delay JS’s %s on a Defer JS report (either key policy)', (_name, change) => {
    const forged = { ...deferReport(), ...change };
    expect(parseDocumentSimulationReport(forged, BOTH, 'reject')).toBeNull();
    expect(parseDocumentSimulationReport(forged, BOTH, 'ignore')).toBeNull();
  });

  it.each([
    ['deferred', { deferred: 0 }],
    ['wrapped', { wrapped: 0 }],
    ['the delay-js-served reason', { reason: 'delay-js-served' }]
  ])('refuses Defer JS’s %s on a Delay JS report (either key policy)', (_name, change) => {
    const forged = { ...delayNotApplicable('amp'), ...change };
    expect(parseDocumentSimulationReport(delayNotApplicable('amp'), BOTH, 'reject')).not.toBeNull();
    expect(parseDocumentSimulationReport(forged, BOTH, 'reject')).toBeNull();
    expect(parseDocumentSimulationReport(forged, BOTH, 'ignore')).toBeNull();
  });

  it('reads Defer JS’s regexes on a Delay JS report (its buffer runs Defer JS’s passes)', () => {
    const report = {
      ...delayNotApplicable('beyond-exact-reproduction'),
      unreproducedRegex: 'defer-inline-scripts'
    };
    expect(parseDocumentSimulationReport(report, BOTH, 'reject')).toEqual(report);
  });

  it('refuses a Defer JS report from a session that does not simulate it', () => {
    expect(
      parseDocumentSimulationReport(deferReport(), { features: ['delay_js'] }, 'reject')
    ).toBeNull();
  });
});

describe('the rewritten outcome’s deferSimulation', () => {
  /** The fixture record simulating both features, its document replaced. */
  const recordWith = (fields: Record<string, unknown>): Record<string, unknown> => {
    const record = structuredClone(activeRecord()) as unknown as Record<string, unknown>;
    const document = record['document'] as Record<string, unknown>;
    const set = record['set'] as { disable: Record<string, boolean> };
    // Defer JS disabled and simulated at once is a contradictory pair: enable it.
    set.disable['deferJs'] = false;
    return { ...record, simulate: BOTH, document: { ...document, ...fields } };
  };

  it('carries each feature’s report in its own field', () => {
    const fields = { simulation: simulatedReport(), deferSimulation: deferReport() };
    const parsed = parseExclusionSessionRecord(recordWith(fields), 'reject');
    expect(parsed?.state === 'active' ? parsed.document : null).toMatchObject(fields);
  });

  it.each([
    ['a Delay JS report as deferSimulation', { deferSimulation: simulatedReport() }],
    ['a Defer JS report as simulation', { simulation: deferReport() }],
    ['a malformed Defer JS report', { deferSimulation: { ...deferReport(), wrapped: -1 } }]
  ])('refuses %s', (_name, fields) => {
    expect(parseExclusionSessionRecord(recordWith(fields), 'reject')).toBeNull();
  });
});
