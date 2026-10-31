/**
 * The session contract's simulation fields: `simulate` on the apply/save
 * payload, the saved-set answer and the active record (with its
 * contradictory pair), the `rewritten` outcome's simulation report, the
 * simulate-stage overrun, the `runtime-unavailable` outcome, the marker
 * ask's deadline and protocol row — and that every value without them
 * parses exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { SIMULATION_RUNTIME_UNAVAILABLE_CAUSES } from '../wp-rocket-simulation/spec';
import {
  EXCLUSION_SESSION_DEADLINES_MS,
  parseExclusionSessionRecord,
  parseExclusionSessionStatus,
  parseExclusionSetPayload,
  parseSavedExclusionSetReply
} from './exclusion-session';
import { activeRecord, validSet } from './exclusion-session.fixtures';
import { parseSimulationMarkerQuery, parseSimulationMarkerVerdict } from './exclusion-simulation';
import { delaySimulate, MARKER_ID, simulatedReport } from './exclusion-simulation.fixtures';
import { onMessage, sendMessage } from './index';

/** A deep-cloned plain-object copy the cases mutate freely. */
function clone(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

/** The fixture set with Delay JS disabled. */
function delayDisabledSet(): Record<string, unknown> {
  const set = clone(validSet());
  (set['disable'] as Record<string, unknown>)['delayJs'] = true;
  return set;
}

/** The fixture record simulating Delay JS, its document replaced. */
function simulatingRecord(document: unknown): Record<string, unknown> {
  return { ...clone(activeRecord()), simulate: delaySimulate(), document };
}

/** The fixture's rewritten document with a simulation report. */
function rewrittenWith(simulation: unknown): Record<string, unknown> {
  return { ...clone(activeRecord().document), simulation };
}

describe('values without the simulation fields parse exactly as before', () => {
  it('keeps an old record, payload and saved answer unchanged (no field appears)', () => {
    for (const policy of ['reject', 'ignore'] as const) {
      const record = parseExclusionSessionRecord(activeRecord(), policy);
      expect(record).toEqual(activeRecord());
      expect(record !== null && 'simulate' in record).toBe(false);
    }
    expect(parseExclusionSetPayload({ set: validSet() })).toEqual({ set: validSet() });
    expect(parseSavedExclusionSetReply({ set: validSet() })).toEqual({ set: validSet() });
    expect(parseSavedExclusionSetReply({ set: null })).toEqual({ set: null });
  });
});

describe('simulate on the apply / save payload', () => {
  it('accepts a set with a simulate spec', () => {
    const payload = { set: validSet(), simulate: delaySimulate() };
    expect(parseExclusionSetPayload(payload)).toEqual(payload);
  });

  it('rejects the contradictory pair and malformed specs', () => {
    expect(
      parseExclusionSetPayload({ set: delayDisabledSet(), simulate: delaySimulate() })
    ).toBeNull();
    expect(parseExclusionSetPayload({ set: delayDisabledSet() })).not.toBeNull();
    for (const simulate of [
      null,
      {},
      { features: [] },
      { features: ['x'] },
      { features: ['delay_js'], extra: 1 }
    ]) {
      expect(parseExclusionSetPayload({ set: validSet(), simulate })).toBeNull();
    }
    expect(
      parseExclusionSetPayload({ set: validSet(), simulate: delaySimulate(), x: 1 })
    ).toBeNull();
  });
});

describe('simulate on the saved-set answer', () => {
  it('carries it beside a set, never beside no set, never contradictory', () => {
    const reply = { set: validSet(), simulate: delaySimulate() };
    expect(parseSavedExclusionSetReply(reply)).toEqual(reply);
    expect(parseSavedExclusionSetReply({ set: null, simulate: delaySimulate() })).toBeNull();
    expect(
      parseSavedExclusionSetReply({ set: delayDisabledSet(), simulate: delaySimulate() })
    ).toBeNull();
    expect(parseSavedExclusionSetReply({ set: validSet(), simulate: { features: [] } })).toBeNull();
    expect(parseSavedExclusionSetReply({ set: null, extra: 1 })).toBeNull();
  });
});

describe('simulate on the active record', () => {
  it('round-trips under both policies and through the status guard', () => {
    const record = simulatingRecord(null);
    expect(parseExclusionSessionRecord(record, 'reject')).toEqual(record);
    expect(parseExclusionSessionRecord(record, 'ignore')).toEqual(record);
    expect(parseExclusionSessionStatus(record)).toEqual(record);
  });

  it('drops the whole record for a malformed or contradictory spec, under both policies', () => {
    for (const policy of ['reject', 'ignore'] as const) {
      expect(
        parseExclusionSessionRecord({ ...simulatingRecord(null), simulate: {} }, policy)
      ).toBeNull();
      const contradictory = { ...simulatingRecord(null), set: delayDisabledSet() };
      expect(parseExclusionSessionRecord(contradictory, policy)).toBeNull();
    }
  });

  it('drops unknown keys inside the spec under ignore only', () => {
    const record = { ...simulatingRecord(null), simulate: { features: ['delay_js'], next: 1 } };
    expect(parseExclusionSessionRecord(record, 'reject')).toBeNull();
    expect(parseExclusionSessionRecord(record, 'ignore')).toEqual(simulatingRecord(null));
  });
});

describe('the rewritten outcome’s simulation report', () => {
  it('is kept on a simulating session’s record, beside the served identity', () => {
    const served = {
      urlPath: 'https://example.com/a',
      urlDigest: 'a'.repeat(64),
      token: 't',
      order: 1,
      receivedAt: 2,
      speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: true },
      copy: true,
      serviceWorkersBypassed: true
    };
    const record = simulatingRecord({ ...rewrittenWith(simulatedReport()), served });
    expect(parseExclusionSessionRecord(record, 'reject')).toEqual(record);
  });

  it('fails the record when malformed, or when the session simulates nothing', () => {
    const bad = simulatingRecord(rewrittenWith({ ...simulatedReport(), delayed: -1 }));
    expect(parseExclusionSessionRecord(bad, 'reject')).toBeNull();
    const notSimulating = { ...clone(activeRecord()), document: rewrittenWith(simulatedReport()) };
    expect(parseExclusionSessionRecord(notSimulating, 'reject')).toBeNull();
    expect(parseExclusionSessionRecord(notSimulating, 'ignore')).toBeNull();
  });

  it('keeps the outcome when a page-derived echo is unfit (the served version omitted)', () => {
    const unfit = { ...simulatedReport(), siteVersion: '9'.repeat(65) };
    // `toEqual` reads an `undefined` property as absent.
    const expected = { ...simulatedReport(), siteVersion: undefined };
    for (const policy of ['reject', 'ignore'] as const) {
      expect(parseExclusionSessionRecord(simulatingRecord(rewrittenWith(unfit)), policy)).toEqual(
        simulatingRecord(rewrittenWith(expected))
      );
    }
    const unevaluated = { ...simulatedReport(), cspLimits: undefined, cspUnavailable: 'oversized' };
    const record = simulatingRecord(rewrittenWith(unevaluated));
    expect(parseExclusionSessionRecord(record, 'reject')).toEqual(record);
  });

  it('drops a report’s unknown keys under ignore', () => {
    const record = simulatingRecord(rewrittenWith({ ...simulatedReport(), next: 1 }));
    expect(parseExclusionSessionRecord(record, 'reject')).toBeNull();
    expect(parseExclusionSessionRecord(record, 'ignore')).toEqual(
      simulatingRecord(rewrittenWith(simulatedReport()))
    );
  });
});

describe('the simulate-stage overrun', () => {
  const overrun = (changes: Record<string, unknown>) => ({
    outcome: 'over-budget',
    feature: 'delay_js',
    row: null,
    budgetMs: 2_000,
    stage: 'simulate',
    ...changes
  });

  it('names a simulated feature with no row, on a simulating session', () => {
    const record = simulatingRecord(overrun({}));
    expect(parseExclusionSessionRecord(record, 'reject')).toEqual(record);
  });

  it('rejects another stage, a row, a feature not simulated, a session not simulating', () => {
    for (const changes of [
      { stage: 'exclude' },
      { stage: null },
      { row: 'gtag' },
      { feature: 'defer_all_js' }
    ]) {
      expect(parseExclusionSessionRecord(simulatingRecord(overrun(changes)), 'reject')).toBeNull();
    }
    const notSimulating = { ...clone(activeRecord()), document: overrun({}) };
    expect(parseExclusionSessionRecord(notSimulating, 'reject')).toBeNull();
  });

  it('leaves the stage-less overrun as before', () => {
    const plain = { outcome: 'over-budget', feature: 'delay_js', row: 'gtag', budgetMs: 2_000 };
    const record = simulatingRecord(plain);
    expect(parseExclusionSessionRecord(record, 'reject')).toEqual(record);
  });
});

describe('the runtime-unavailable outcome', () => {
  it('accepts each cause on a simulating session, with or without a served identity', () => {
    for (const cause of SIMULATION_RUNTIME_UNAVAILABLE_CAUSES) {
      const record = simulatingRecord({ outcome: 'runtime-unavailable', cause });
      expect(parseExclusionSessionRecord(record, 'reject')).toEqual(record);
    }
  });

  it('rejects unknown causes, extra keys, and a session that simulates nothing', () => {
    const outcome = { outcome: 'runtime-unavailable', cause: 'hash-mismatch' };
    for (const document of [
      { ...outcome, cause: 'engine-failed' },
      { ...outcome, cause: 'toString' },
      { outcome: 'runtime-unavailable' },
      { ...outcome, extra: 1 }
    ]) {
      expect(parseExclusionSessionRecord(simulatingRecord(document), 'reject')).toBeNull();
    }
    expect(
      parseExclusionSessionRecord(
        { ...simulatingRecord(null), document: { ...outcome, extra: 1 } },
        'ignore'
      )
    ).toEqual(simulatingRecord(outcome));
    expect(
      parseExclusionSessionRecord({ ...clone(activeRecord()), document: outcome }, 'reject')
    ).toBeNull();
  });
});

describe('marker verification ask', () => {
  it('has a deadline like the other one-read asks', () => {
    expect(EXCLUSION_SESSION_DEADLINES_MS.verifyMarker).toBe(EXCLUSION_SESSION_DEADLINES_MS.status);
  });

  it('round-trips over the fake runtime: guarded ask, guarded verdict', async () => {
    const remove = onMessage('verifySimulationMarker', ({ data }) =>
      parseSimulationMarkerQuery(data) === null ? { features: [] } : { features: ['delay_js'] }
    );
    try {
      const verdict = await sendMessage('verifySimulationMarker', { markerId: MARKER_ID });
      expect(parseSimulationMarkerVerdict(verdict)).toEqual({ features: ['delay_js'] });
    } finally {
      remove();
    }
  });
});
