import { describe, expect, it } from 'vitest';
import { activeRecord } from './exclusion-session.fixtures';
import {
  EXCLUSION_OVERLAY_OPEN_OUTCOMES,
  parseExclusionOverlayOpenOutcome,
  parseExclusionSessionSummary,
  parseExclusionSessionTabSummary
} from './exclusion-panel';

describe('parseExclusionOverlayOpenOutcome', () => {
  it('parses every open outcome and nothing else', () => {
    for (const outcome of EXCLUSION_OVERLAY_OPEN_OUTCOMES) {
      expect(parseExclusionOverlayOpenOutcome(outcome)).toBe(outcome);
    }
    for (const input of ['opened', 'INJECTED', '', null, undefined, 1, { outcome: 'injected' }]) {
      expect(parseExclusionOverlayOpenOutcome(input)).toBeNull();
    }
  });
});

describe('parseExclusionSessionSummary', () => {
  it('reads the state, and an active session’s origin, ignoring every other field', () => {
    expect(parseExclusionSessionSummary({ state: 'inactive' })).toEqual({ state: 'inactive' });
    expect(
      parseExclusionSessionSummary({ state: 'unavailable', cause: 'attach-denied', at: 1 })
    ).toEqual({ state: 'unavailable' });
    expect(parseExclusionSessionSummary(activeRecord())).toEqual({
      state: 'active',
      origin: activeRecord().origin
    });
    expect(parseExclusionSessionSummary({ state: 'inactive', future: true })).toEqual({
      state: 'inactive'
    });
  });

  it('refuses unknown states, non-objects and active sessions without an http(s) origin', () => {
    for (const input of [
      null,
      'inactive',
      [],
      { state: 'gone' },
      {},
      Object.create({ state: 'inactive' }),
      { state: 'active' },
      { state: 'active', origin: 'chrome://settings' },
      { state: 'active', origin: 'https://example.com/path' },
      { state: 'active', origin: 7 }
    ]) {
      expect(parseExclusionSessionSummary(input)).toBeNull();
    }
  });
});

describe('parseExclusionSessionSummary — the simulated features', () => {
  /** An active record whose last document carries `simulation` (rewritten). */
  const withDocumentSimulation = (simulation: unknown) => ({
    ...activeRecord(),
    simulate: { features: ['delay_js'] },
    document: { outcome: 'rewritten', reports: [], simulation }
  });

  it('reads the feature the last document was simulated with', () => {
    expect(
      parseExclusionSessionSummary(
        withDocumentSimulation({ feature: 'delay_js', state: 'simulated', delayed: 3 })
      )
    ).toEqual({ state: 'active', origin: activeRecord().origin, simulated: ['delay_js'] });
  });

  it('reads the Defer JS report beside the Delay JS one (registry order)', () => {
    const both = {
      ...activeRecord(),
      simulate: { features: ['defer_all_js', 'delay_js'] },
      document: {
        outcome: 'rewritten',
        reports: [],
        simulation: { feature: 'delay_js', state: 'simulated', delayed: 3 },
        deferSimulation: { feature: 'defer_all_js', state: 'simulated', deferred: 2, wrapped: 0 }
      }
    };
    expect(parseExclusionSessionSummary(both)).toMatchObject({
      simulated: ['defer_all_js', 'delay_js']
    });
    const deferOnly = {
      ...both,
      document: {
        ...both.document,
        simulation: { feature: 'delay_js', state: 'csp-blocked', delayed: 0 }
      }
    };
    expect(parseExclusionSessionSummary(deferOnly)).toMatchObject({ simulated: ['defer_all_js'] });
  });

  it('reads every step state but simulated as no simulation, never refusing the session', () => {
    for (const state of ['already-served', 'csp-blocked', 'not-applicable', 'future-state']) {
      expect(
        parseExclusionSessionSummary(withDocumentSimulation({ feature: 'delay_js', state })),
        state
      ).toEqual({ state: 'active', origin: activeRecord().origin });
    }
  });

  it('reads a simulating session with no document or an unmodified one as no simulation', () => {
    const base = { ...activeRecord(), simulate: { features: ['delay_js'] } };
    for (const document of [
      null,
      { outcome: 'over-budget', feature: 'delay_js', row: null, budgetMs: 2000, stage: 'simulate' },
      { outcome: 'failed', reason: 'engine-failed' },
      { outcome: 'runtime-unavailable', cause: 'damaged' }
    ]) {
      expect(parseExclusionSessionSummary({ ...base, document })).toEqual({
        state: 'active',
        origin: activeRecord().origin
      });
    }
  });

  it('reads a malformed report or an unknown feature as no simulation', () => {
    for (const simulation of [
      null,
      'simulated',
      [],
      {},
      { state: 'simulated' },
      { feature: 'future_feature', state: 'simulated' }
    ]) {
      expect(parseExclusionSessionSummary(withDocumentSimulation(simulation))).toEqual({
        state: 'active',
        origin: activeRecord().origin
      });
    }
  });
});

describe('parseExclusionSessionTabSummary', () => {
  it('reads a push: a tab id plus a summarized status', () => {
    expect(parseExclusionSessionTabSummary({ tabId: 3, status: activeRecord() })).toEqual({
      tabId: 3,
      summary: { state: 'active', origin: activeRecord().origin }
    });
  });

  it('refuses a push without a numeric tab id or a known status', () => {
    for (const input of [
      { tabId: '3', status: { state: 'inactive' } },
      { tabId: -1, status: { state: 'inactive' } },
      { tabId: 3, status: { state: 'gone' } },
      { status: { state: 'inactive' } },
      null
    ]) {
      expect(parseExclusionSessionTabSummary(input)).toBeNull();
    }
  });
});
