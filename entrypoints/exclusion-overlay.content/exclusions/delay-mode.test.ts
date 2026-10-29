import { describe, expect, it } from 'vitest';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import type { DocumentSimulationReport } from '../../../lib/messaging/exclusion-simulation';
import { simulatedReport } from '../../../lib/messaging/exclusion-simulation.fixtures';
import {
  DELAY_MODES,
  NO_DELAY_EVIDENCE,
  delayModeBlocks,
  delayModeFields,
  delayModeOf,
  disabledChangesNothing,
  shownDelayMode,
  realDelayState,
  runsSimulation,
  sameSimulate,
  type DelayPageEvidence,
  type DelaySessionFacts,
  type RealDelayState
} from './delay-mode';

const SIMULATE = { features: ['delay_js' as const] };

/** A Delay JS report with `candidates` delayed scripts. */
function delayReport(candidates: number): TransformReport {
  return {
    feature: 'delay_js',
    featureWide: false,
    candidates,
    rewritten: 0,
    regionRemovals: 0,
    matchedRows: [],
    unmatchedRows: []
  };
}

/** A simulation report in a given state. */
function simulation(
  state: DocumentSimulationReport['state'],
  reason?: DocumentSimulationReport['reason']
): DocumentSimulationReport {
  if (state === 'simulated') return simulatedReport();
  return {
    feature: 'delay_js',
    state,
    ...(reason === undefined ? {} : { reason }),
    ...(reason === 'beyond-exact-reproduction' ? { unreproducedRegex: 'xmp-mask' as const } : {}),
    delayed: 0,
    runtimeInjected: false,
    wpRocketVersion: '3.24',
    listSource: 'bundled',
    listMiss: 'never-fetched'
  };
}

/** Session facts (defaults: nothing simulated, nothing disabled, no delayed scripts). */
function facts(over: Partial<DelaySessionFacts> = {}): DelaySessionFacts {
  return { simulation: undefined, disableDelayJs: false, delayReport: delayReport(0), ...over };
}

/** Page evidence over the empty page. */
function page(over: Partial<DelayPageEvidence> = {}): DelayPageEvidence {
  return { ...NO_DELAY_EVIDENCE, ...over };
}

describe('mode ↔ wire fields', () => {
  it('maps each mode both ways', () => {
    for (const mode of DELAY_MODES) {
      const fields = delayModeFields(mode, undefined);
      expect(delayModeOf(fields.disableDelayJs, fields.simulate)).toBe(mode);
    }
    expect(delayModeFields('served', undefined)).toEqual({
      disableDelayJs: false,
      simulate: undefined
    });
    expect(delayModeFields('simulated', undefined)).toEqual({
      disableDelayJs: false,
      simulate: SIMULATE
    });
    expect(delayModeFields('disabled', SIMULATE)).toEqual({
      disableDelayJs: true,
      simulate: undefined
    });
  });

  it('never produces the contradictory pair (disabled and simulated)', () => {
    for (const mode of DELAY_MODES) {
      for (const current of [undefined, SIMULATE]) {
        const fields = delayModeFields(mode, current);
        expect(fields.disableDelayJs && fields.simulate !== undefined).toBe(false);
      }
    }
  });

  it('reads the contradictory pair as Disabled (the stored-set rule)', () => {
    expect(delayModeOf(true, SIMULATE)).toBe('disabled');
    expect(delayModeOf(false, { features: [] })).toBe('served');
  });

  it('compares simulate specs order-free, absent = empty', () => {
    expect(sameSimulate(undefined, undefined)).toBe(true);
    expect(sameSimulate(undefined, { features: [] })).toBe(true);
    expect(sameSimulate(SIMULATE, { features: ['delay_js'] })).toBe(true);
    expect(sameSimulate(SIMULATE, undefined)).toBe(false);
  });
});

describe('realDelayState', () => {
  it.each<[string, DelaySessionFacts, RealDelayState]>([
    [
      'simulated here',
      facts({ simulation: simulation('simulated') }),
      { kind: 'not-delayed', simulation: 'session' }
    ],
    [
      'CSP-blocked (identity)',
      facts({ simulation: simulation('csp-blocked') }),
      { kind: 'not-delayed', simulation: 'none' }
    ],
    ['already served', facts({ simulation: simulation('already-served') }), { kind: 'delayed' }],
    ['AMP', facts({ simulation: simulation('not-applicable', 'amp') }), { kind: 'amp' }],
    [
      'not reproducible',
      facts({ simulation: simulation('not-applicable', 'beyond-exact-reproduction') }),
      { kind: 'not-delayed', simulation: 'none' }
    ],
    [
      'unsupported charset',
      facts({ simulation: simulation('not-applicable', 'unsupported-charset') }),
      { kind: 'not-delayed', simulation: 'none' }
    ],
    [
      'Disabled applied where WP Rocket delays',
      facts({ disableDelayJs: true, delayReport: delayReport(2) }),
      { kind: 'delayed' }
    ],
    [
      'Disabled applied: only WP Rocket’s Delay JS scripts removed',
      facts({ disableDelayJs: true, delayReport: { ...delayReport(0), regionRemovals: 1 } }),
      { kind: 'delayed' }
    ],
    [
      'Disabled applied where nothing was delayed',
      facts({ disableDelayJs: true }),
      { kind: 'not-delayed', simulation: 'none' }
    ],
    [
      'rows restored every delayed script',
      facts({ delayReport: delayReport(2) }),
      { kind: 'delayed' }
    ]
  ])('the session’s report decides: %s', (_name, session, expected) => {
    // The live page says the opposite each time: the report wins.
    const misleading = page({ footprints: expected.kind !== 'delayed', amp: false });
    expect(realDelayState(session, misleading, true)).toEqual(expected);
  });

  it('falls through when the session’s report says nothing Delay JS-specific', () => {
    expect(realDelayState(facts(), page({ footprints: true }), true)).toEqual({ kind: 'delayed' });
    expect(realDelayState(facts({ delayReport: undefined }), page(), true)).toEqual({
      kind: 'not-delayed',
      simulation: 'none'
    });
  });

  it('reads the builder’s Delay-off marker as delayed only while a session is on', () => {
    expect(realDelayState(null, page({ builderDelayOff: true }), true)).toEqual({
      kind: 'delayed'
    });
    // No session in this tab: the marker is page markup (a saved or forged copy).
    expect(realDelayState(null, page({ builderDelayOff: true }), false)).toEqual({
      kind: 'not-delayed',
      simulation: 'none'
    });
  });

  it('reads a verified marker as a kept simulation (e.g. after Stop)', () => {
    expect(realDelayState(null, page({ marker: 'verified', footprints: true }), true)).toEqual({
      kind: 'not-delayed',
      simulation: 'kept'
    });
  });

  it('waits while the marker is being verified', () => {
    expect(realDelayState(null, page({ marker: 'checking', footprints: true }), true)).toEqual({
      kind: 'checking'
    });
  });

  it('falls through a forged (unverified) marker to the live page', () => {
    expect(realDelayState(null, page({ marker: 'unverified', footprints: true }), true)).toEqual({
      kind: 'delayed'
    });
    expect(realDelayState(null, page({ marker: 'unverified' }), true)).toEqual({
      kind: 'not-delayed',
      simulation: 'none'
    });
  });

  it('reads an AMP root before any apply, then footprints, then nothing', () => {
    expect(realDelayState(null, page({ amp: true, footprints: true }), true)).toEqual({
      kind: 'amp'
    });
    expect(realDelayState(null, page({ footprints: true }), true)).toEqual({ kind: 'delayed' });
    expect(realDelayState(null, page(), true)).toEqual({ kind: 'not-delayed', simulation: 'none' });
  });

  it('reads a page the builder’s rewrite touched as unproven when only the live page speaks', () => {
    const touched = page({ builderDelayTouched: true });
    // No session (e.g. right after Stop): its missing footprints prove nothing.
    expect(realDelayState(null, touched, false)).toEqual({
      kind: 'not-delayed',
      simulation: 'none',
      unproven: true
    });
    // Footprints still prove a delay; the session's report still decides.
    expect(
      realDelayState(null, page({ builderDelayTouched: true, footprints: true }), false)
    ).toEqual({ kind: 'delayed' });
    expect(
      realDelayState(facts({ disableDelayJs: true, delayReport: delayReport(0) }), touched, true)
    ).toEqual({ kind: 'not-delayed', simulation: 'none' });
  });
});

describe('availability', () => {
  it('blocks per real state, As served always offered', () => {
    expect(delayModeBlocks({ kind: 'delayed' })).toEqual({
      served: null,
      simulated: 'already-delayed',
      disabled: null
    });
    // Disabled stays selectable where nothing is delayed (a harmless no-op).
    expect(delayModeBlocks({ kind: 'not-delayed', simulation: 'none' })).toEqual({
      served: null,
      simulated: null,
      disabled: null
    });
    expect(delayModeBlocks({ kind: 'amp' })).toEqual({
      served: null,
      simulated: 'amp',
      disabled: 'amp'
    });
    expect(delayModeBlocks({ kind: 'checking' })).toEqual({
      served: null,
      simulated: 'checking',
      disabled: null
    });
  });

  it('checks nothing for an unavailable mode (naming it), never while checking', () => {
    expect(shownDelayMode('simulated', { kind: 'delayed' })).toEqual({
      mode: null,
      replaced: 'simulated'
    });
    expect(shownDelayMode('disabled', { kind: 'amp' })).toEqual({
      mode: null,
      replaced: 'disabled'
    });
    expect(shownDelayMode('disabled', { kind: 'delayed' })).toEqual({
      mode: 'disabled',
      replaced: null
    });
    expect(shownDelayMode('simulated', { kind: 'checking' })).toEqual({
      mode: 'simulated',
      replaced: null
    });
    expect(shownDelayMode('disabled', { kind: 'not-delayed', simulation: 'none' })).toEqual({
      mode: 'disabled',
      replaced: null
    });
  });

  it('says a shown Disabled changes nothing only where nothing delays scripts', () => {
    const plain: RealDelayState = { kind: 'not-delayed', simulation: 'none' };
    expect(disabledChangesNothing('disabled', plain)).toBe(true);
    expect(disabledChangesNothing('served', plain)).toBe(false);
    expect(disabledChangesNothing('disabled', { kind: 'delayed' })).toBe(false);
    // A simulation runs: Disabled drops it.
    expect(disabledChangesNothing('disabled', { kind: 'not-delayed', simulation: 'kept' })).toBe(
      false
    );
    expect(disabledChangesNothing('disabled', null)).toBe(false);
    expect(disabledChangesNothing(null, plain)).toBe(false);
    // Not known yet (a marker being verified): never said early.
    expect(disabledChangesNothing('disabled', { kind: 'checking' })).toBe(false);
    // Only the live page says so, and a session's rewrite touched it (e.g. after Stop).
    expect(disabledChangesNothing('disabled', { ...plain, unproven: true })).toBe(false);
  });

  it('says whether the page runs a simulation', () => {
    expect(runsSimulation(null)).toBe(false);
    expect(runsSimulation({ kind: 'delayed' })).toBe(false);
    expect(runsSimulation({ kind: 'not-delayed', simulation: 'none' })).toBe(false);
    expect(runsSimulation({ kind: 'not-delayed', simulation: 'session' })).toBe(true);
    expect(runsSimulation({ kind: 'not-delayed', simulation: 'kept' })).toBe(true);
  });
});
