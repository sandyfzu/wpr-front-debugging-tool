import { describe, expect, it } from 'vitest';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import type {
  DeferSimulationReport,
  DelaySimulationReport
} from '../../../lib/messaging/exclusion-simulation';
import {
  deferSimulatedReport,
  simulatedReport
} from '../../../lib/messaging/exclusion-simulation.fixtures';
import {
  SIMULATION_MODES,
  NO_PAGE_EVIDENCE,
  NO_SIMULATION_EVIDENCE,
  isSimulationLane,
  laneModeBlocks,
  laneModeFields,
  laneModeOf,
  disabledChangesNothing,
  shownLaneMode,
  realFeatureState,
  runsSimulation,
  sameSimulate,
  type LanePageEvidence,
  type LaneSessionFacts,
  type RealFeatureState
} from './simulation-mode';

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
  state: DelaySimulationReport['state'],
  reason?: DelaySimulationReport['reason']
): DelaySimulationReport {
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
function facts(over: Partial<LaneSessionFacts> = {}): LaneSessionFacts {
  return {
    simulation: undefined,
    disabled: false,
    report: delayReport(0),
    reportProvesServed: true,
    ...over
  };
}

/** Page evidence over the empty page. */
function page(over: Partial<LanePageEvidence> = {}): LanePageEvidence {
  return { ...NO_PAGE_EVIDENCE, ...over };
}

describe('mode ↔ wire fields', () => {
  it('maps each mode both ways', () => {
    for (const mode of SIMULATION_MODES) {
      const fields = laneModeFields('delayJs', mode, undefined);
      expect(laneModeOf('delayJs', fields.disable, fields.simulate)).toBe(mode);
    }
    expect(laneModeFields('delayJs', 'served', undefined)).toEqual({
      disable: false,
      simulate: undefined
    });
    expect(laneModeFields('delayJs', 'simulated', undefined)).toEqual({
      disable: false,
      simulate: SIMULATE
    });
    expect(laneModeFields('delayJs', 'disabled', SIMULATE)).toEqual({
      disable: true,
      simulate: undefined
    });
  });

  it('never produces the contradictory pair (disabled and simulated)', () => {
    for (const mode of SIMULATION_MODES) {
      for (const current of [undefined, SIMULATE]) {
        const fields = laneModeFields('delayJs', mode, current);
        expect(fields.disable && fields.simulate !== undefined).toBe(false);
      }
    }
  });

  it('reads the contradictory pair as Disabled (the stored-set rule)', () => {
    expect(laneModeOf('delayJs', true, SIMULATE)).toBe('disabled');
    expect(laneModeOf('delayJs', false, { features: [] })).toBe('served');
  });

  it('compares simulate specs order-free, absent = empty', () => {
    expect(sameSimulate(undefined, undefined)).toBe(true);
    expect(sameSimulate(undefined, { features: [] })).toBe(true);
    expect(sameSimulate(SIMULATE, { features: ['delay_js'] })).toBe(true);
    expect(sameSimulate(SIMULATE, undefined)).toBe(false);
  });
});

describe('realFeatureState', () => {
  it.each<[string, LaneSessionFacts, RealFeatureState]>([
    [
      'simulated here',
      facts({ simulation: simulation('simulated') }),
      { kind: 'not-served', simulation: 'session' }
    ],
    [
      'CSP-blocked (identity)',
      facts({ simulation: simulation('csp-blocked') }),
      { kind: 'not-served', simulation: 'none' }
    ],
    ['already served', facts({ simulation: simulation('already-served') }), { kind: 'served' }],
    ['AMP', facts({ simulation: simulation('not-applicable', 'amp') }), { kind: 'amp' }],
    [
      'not reproducible',
      facts({ simulation: simulation('not-applicable', 'beyond-exact-reproduction') }),
      { kind: 'not-served', simulation: 'none' }
    ],
    [
      'unsupported charset',
      facts({ simulation: simulation('not-applicable', 'unsupported-charset') }),
      { kind: 'not-served', simulation: 'none' }
    ],
    [
      'Disabled applied where WP Rocket delays',
      facts({ disabled: true, report: delayReport(2) }),
      { kind: 'served' }
    ],
    [
      'Disabled applied: only WP Rocket’s Delay JS scripts removed',
      facts({ disabled: true, report: { ...delayReport(0), regionRemovals: 1 } }),
      { kind: 'served' }
    ],
    ['rows restored every delayed script', facts({ report: delayReport(2) }), { kind: 'served' }]
  ])('the session’s report decides: %s', (_name, session, expected) => {
    // The live page says the opposite each time: the report wins.
    const misleading = page({ footprints: expected.kind !== 'served', amp: false });
    expect(realFeatureState(session, misleading, true)).toEqual(expected);
  });

  it('reads a zero-count Disabled as not served unless the live page shows the feature served', () => {
    const nothing = facts({ disabled: true });
    expect(realFeatureState(nothing, page(), true)).toEqual({
      kind: 'not-served',
      simulation: 'none'
    });
    // Positive live evidence (footprints, e.g. Defer JS's generator token on a
    // page whose every script is excluded, or the builder's off fact) wins.
    expect(realFeatureState(nothing, page({ footprints: true }), true)).toEqual({
      kind: 'served'
    });
    expect(realFeatureState(nothing, page({ builderOff: true }), true)).toEqual({
      kind: 'served'
    });
    // Its off fact is page markup without a session in this tab: no evidence.
    expect(realFeatureState(nothing, page({ builderOff: true }), false)).toEqual({
      kind: 'not-served',
      simulation: 'none'
    });
    // Served: Simulated stays blocked, and Disabled is never said to change nothing.
    const served = realFeatureState(nothing, page({ footprints: true }), true);
    expect(laneModeBlocks('deferJs', served, null).simulated).toBe('already-served');
    expect(disabledChangesNothing('disabled', served)).toBe(false);
  });

  it('falls through when the session’s report says nothing Delay JS-specific', () => {
    expect(realFeatureState(facts(), page({ footprints: true }), true)).toEqual({ kind: 'served' });
    expect(realFeatureState(facts({ report: undefined }), page(), true)).toEqual({
      kind: 'not-served',
      simulation: 'none'
    });
  });

  it('reads the builder’s Delay-off marker as delayed only while a session is on', () => {
    expect(realFeatureState(null, page({ builderOff: true }), true)).toEqual({
      kind: 'served'
    });
    // No session in this tab: the marker is page markup (a saved or forged copy).
    expect(realFeatureState(null, page({ builderOff: true }), false)).toEqual({
      kind: 'not-served',
      simulation: 'none'
    });
  });

  it('reads a verified marker as a kept simulation (e.g. after Stop)', () => {
    expect(realFeatureState(null, page({ marker: 'verified', footprints: true }), true)).toEqual({
      kind: 'not-served',
      simulation: 'kept'
    });
  });

  it('waits while the marker is being verified', () => {
    expect(realFeatureState(null, page({ marker: 'checking', footprints: true }), true)).toEqual({
      kind: 'checking'
    });
  });

  it('falls through a forged (unverified) marker to the live page', () => {
    expect(realFeatureState(null, page({ marker: 'unverified', footprints: true }), true)).toEqual({
      kind: 'served'
    });
    expect(realFeatureState(null, page({ marker: 'unverified' }), true)).toEqual({
      kind: 'not-served',
      simulation: 'none'
    });
  });

  it('reads an AMP root before any apply, then footprints, then nothing', () => {
    expect(realFeatureState(null, page({ amp: true, footprints: true }), true)).toEqual({
      kind: 'amp'
    });
    expect(realFeatureState(null, page({ footprints: true }), true)).toEqual({ kind: 'served' });
    expect(realFeatureState(null, page(), true)).toEqual({
      kind: 'not-served',
      simulation: 'none'
    });
  });

  it('reads a page the builder’s rewrite touched as unproven when only the live page speaks', () => {
    const touched = page({ builderTouched: true });
    // No session (e.g. right after Stop): its missing footprints prove nothing.
    expect(realFeatureState(null, touched, false)).toEqual({
      kind: 'not-served',
      simulation: 'none',
      unproven: true
    });
    // Footprints still prove a delay; the session's report still decides.
    expect(realFeatureState(null, page({ builderTouched: true, footprints: true }), false)).toEqual(
      { kind: 'served' }
    );
    expect(
      realFeatureState(facts({ disabled: true, report: delayReport(0) }), touched, true)
    ).toEqual({ kind: 'not-served', simulation: 'none' });
  });
});

describe('availability', () => {
  it('blocks per real state, As served always offered', () => {
    expect(laneModeBlocks('delayJs', { kind: 'served' }, null)).toEqual({
      served: null,
      simulated: 'already-served',
      disabled: null
    });
    // Disabled stays selectable where nothing is delayed (a harmless no-op).
    expect(laneModeBlocks('delayJs', { kind: 'not-served', simulation: 'none' }, null)).toEqual({
      served: null,
      simulated: null,
      disabled: null
    });
    expect(laneModeBlocks('delayJs', { kind: 'amp' }, null)).toEqual({
      served: null,
      simulated: 'amp',
      disabled: 'amp'
    });
    expect(laneModeBlocks('delayJs', { kind: 'checking' }, null)).toEqual({
      served: null,
      simulated: 'checking',
      disabled: null
    });
  });

  it('checks nothing for an unavailable mode (naming it), never while checking', () => {
    expect(shownLaneMode('delayJs', 'simulated', { kind: 'served' }, null)).toEqual({
      mode: null,
      replaced: 'simulated'
    });
    expect(shownLaneMode('delayJs', 'disabled', { kind: 'amp' }, null)).toEqual({
      mode: null,
      replaced: 'disabled'
    });
    expect(shownLaneMode('delayJs', 'disabled', { kind: 'served' }, null)).toEqual({
      mode: 'disabled',
      replaced: null
    });
    expect(shownLaneMode('delayJs', 'simulated', { kind: 'checking' }, null)).toEqual({
      mode: 'simulated',
      replaced: null
    });
    expect(
      shownLaneMode('delayJs', 'disabled', { kind: 'not-served', simulation: 'none' }, null)
    ).toEqual({
      mode: 'disabled',
      replaced: null
    });
  });

  it('says a shown Disabled changes nothing only where nothing delays scripts', () => {
    const plain: RealFeatureState = { kind: 'not-served', simulation: 'none' };
    expect(disabledChangesNothing('disabled', plain)).toBe(true);
    expect(disabledChangesNothing('served', plain)).toBe(false);
    expect(disabledChangesNothing('disabled', { kind: 'served' })).toBe(false);
    // A simulation runs: Disabled drops it.
    expect(disabledChangesNothing('disabled', { kind: 'not-served', simulation: 'kept' })).toBe(
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
    expect(runsSimulation({ kind: 'served' })).toBe(false);
    expect(runsSimulation({ kind: 'not-served', simulation: 'none' })).toBe(false);
    expect(runsSimulation({ kind: 'not-served', simulation: 'session' })).toBe(true);
    expect(runsSimulation({ kind: 'not-served', simulation: 'kept' })).toBe(true);
  });
});

describe('the Defer JS lane', () => {
  const BOTH = { features: ['defer_all_js' as const, 'delay_js' as const] };

  it('maps its mode both ways, keeping the Delay JS simulation (registry order)', () => {
    expect(laneModeFields('deferJs', 'simulated', SIMULATE)).toEqual({
      disable: false,
      simulate: BOTH
    });
    expect(laneModeFields('deferJs', 'disabled', BOTH)).toEqual({
      disable: true,
      simulate: SIMULATE
    });
    expect(laneModeFields('deferJs', 'served', { features: ['defer_all_js'] })).toEqual({
      disable: false,
      simulate: undefined
    });
    expect(laneModeOf('deferJs', false, BOTH)).toBe('simulated');
    expect(laneModeOf('deferJs', false, SIMULATE)).toBe('served');
    // The contradictory pair reads as Disabled.
    expect(laneModeOf('deferJs', true, BOTH)).toBe('disabled');
    expect(laneModeOf('delayJs', false, { features: ['defer_all_js'] })).toBe('served');
  });

  it('knows which lanes carry the control', () => {
    expect(isSimulationLane('deferJs')).toBe(true);
    expect(isSimulationLane('delayJs')).toBe(true);
    expect(isSimulationLane('lazyRender')).toBe(false);
    expect(isSimulationLane('lazyload')).toBe(true);
  });

  it('reads every Defer JS report state', () => {
    const defer = (
      state: DeferSimulationReport['state'],
      reason?: DeferSimulationReport['reason']
    ): DeferSimulationReport => ({
      ...deferSimulatedReport(),
      state,
      ...(reason === undefined ? {} : { reason })
    });
    const read = (report: DeferSimulationReport): RealFeatureState =>
      realFeatureState(facts({ simulation: report }), page({ footprints: true }), true);
    expect(read(defer('simulated'))).toEqual({ kind: 'not-served', simulation: 'session' });
    expect(read(defer('already-served'))).toEqual({ kind: 'served' });
    expect(read(defer('not-applicable', 'amp'))).toEqual({ kind: 'amp' });
    for (const reason of [
      'delay-js-served',
      'beyond-exact-reproduction',
      'unsupported-charset'
    ] as const) {
      expect(read(defer('not-applicable', reason))).toEqual({
        kind: 'not-served',
        simulation: 'none'
      });
    }
  });

  it('blocks Simulated where WP Rocket delays (only the Defer JS lane), never Disabled', () => {
    const notServed: RealFeatureState = { kind: 'not-served', simulation: 'none' };
    const delayed: RealFeatureState = { kind: 'served' };
    expect(laneModeBlocks('deferJs', notServed, delayed)).toEqual({
      served: null,
      simulated: 'delay-served',
      disabled: null
    });
    expect(laneModeBlocks('delayJs', notServed, delayed).simulated).toBeNull();
    for (const other of [
      null,
      notServed,
      { kind: 'checking' } as const,
      { kind: 'amp' } as const
    ]) {
      expect(laneModeBlocks('deferJs', notServed, other).simulated).toBeNull();
    }
    // Already deferred wins over the delayed page.
    expect(laneModeBlocks('deferJs', delayed, delayed).simulated).toBe('already-served');
  });

  it('shows a Simulated draft as none checked on a delayed page', () => {
    const notServed: RealFeatureState = { kind: 'not-served', simulation: 'none' };
    expect(shownLaneMode('deferJs', 'simulated', notServed, { kind: 'served' })).toEqual({
      mode: null,
      replaced: 'simulated'
    });
    expect(shownLaneMode('deferJs', 'simulated', notServed, null)).toEqual({
      mode: 'simulated',
      replaced: null
    });
  });

  it('says a page with no evidence of either lane, every lane', () => {
    expect(NO_SIMULATION_EVIDENCE).toEqual({
      delayJs: NO_PAGE_EVIDENCE,
      deferJs: NO_PAGE_EVIDENCE,
      lazyload: NO_PAGE_EVIDENCE
    });
  });
});
