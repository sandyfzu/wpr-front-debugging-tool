import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKER_ID } from '../../../lib/messaging/exclusion-simulation.fixtures';
import type {
  SimulationMarkerCheck,
  SimulationMarkerCheckOutcome
} from '../../../lib/messaging/simulation-marker-verifier';
import type { SimulatedFeatureId } from '../../../lib/wp-rocket-simulation/spec';
import { NO_PAGE_EVIDENCE, NO_SIMULATION_EVIDENCE } from './simulation-mode';
import {
  createSimulationEvidence,
  readSimulationPage,
  type LanePageReading,
  type SimulationPageReading
} from './simulation-page';

const MARKER = `<meta name="wpr-fdt-simulation" content="v1 delay_js=simulated id=${MARKER_ID}">`;

/** A parsed document from markup. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** The Delay JS lane's reading of markup. */
function delayLane(html: string): LanePageReading {
  return readSimulationPage(parse(html)).lanes.delayJs;
}

/** The Defer JS lane's reading of markup. */
function deferLane(html: string): LanePageReading {
  return readSimulationPage(parse(html)).lanes.deferJs;
}

const NOTHING: LanePageReading = { footprints: false, builderOff: false, builderTouched: false };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readSimulationPage', () => {
  it('reads a plain page as nothing', () => {
    expect(
      readSimulationPage(parse('<html><head></head><body><script src="a.js"></script>'))
    ).toEqual({
      amp: false,
      lanes: { delayJs: NOTHING, deferJs: NOTHING },
      marker: null
    });
  });

  it('reads an AMP root (<html amp>, <html ⚡>)', () => {
    expect(readSimulationPage(parse('<html amp><body>')).amp).toBe(true);
    // The test DOM's parser drops the non-ASCII name (browsers keep it): set it directly.
    const bolt = parse('<html><body>');
    bolt.documentElement.setAttribute('⚡', '');
    expect(readSimulationPage(bolt).amp).toBe(true);
    expect(readSimulationPage(parse('<html lang="en"><body amp>')).amp).toBe(false);
  });

  it('reads delayed scripts as Delay JS footprints only', () => {
    expect(
      delayLane('<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>').footprints
    ).toBe(true);
    expect(delayLane('<script data-rocket-src="a.js"></script>').footprints).toBe(true);
    expect(deferLane('<script data-rocket-src="a.js"></script>').footprints).toBe(false);
  });

  it('reads stamped deferred scripts as Defer JS footprints only', () => {
    const html = '<script src="a.js" data-rocket-defer defer></script>';
    expect(deferLane(html).footprints).toBe(true);
    expect(delayLane(html).footprints).toBe(false);
    // A native defer is the page's own, not WP Rocket's.
    expect(deferLane('<script src="a.js" defer></script>').footprints).toBe(false);
  });

  it('reads the generator meta declaring Defer JS as its footprint (every script excluded)', () => {
    const meta = (features: string): string =>
      `<head><meta name="generator" content="WP Rocket 3.24" data-wpr-features="${features}">`;
    expect(deferLane(meta('wpr_defer_js wpr_cdn')).footprints).toBe(true);
    expect(deferLane(meta('wpr_delay_js')).footprints).toBe(false);
    // The Delay JS lane reads only its scripts.
    expect(delayLane(meta('wpr_delay_js')).footprints).toBe(false);
  });

  it('reads the builder’s Delay-off fact', () => {
    const lane = delayLane(
      '<head><meta name="wpr-fdt-exclusion-builder" content="v1 delay_js=off">'
    );
    expect(lane.builderOff).toBe(true);
    expect(lane.builderTouched).toBe(true);
  });

  it('reads any builder Delay JS fact as touched, the Delay-off one only as off', () => {
    const lane = delayLane(
      '<head><meta name="wpr-fdt-exclusion-builder" content="v1 delay_js=excluded:3">'
    );
    expect(lane.builderTouched).toBe(true);
    expect(lane.builderOff).toBe(false);
  });

  it('reads each lane’s builder facts apart', () => {
    const html = '<head><meta name="wpr-fdt-exclusion-builder" content="v1 defer_all_js=page-off">';
    expect(deferLane(html)).toEqual({ footprints: false, builderOff: true, builderTouched: true });
    expect(delayLane(html)).toEqual(NOTHING);
    expect(
      deferLane('<head><meta name="wpr-fdt-exclusion-builder" content="v1 defer_all_js=off">')
        .builderOff
    ).toBe(true);
    expect(
      deferLane(
        '<head><meta name="wpr-fdt-exclusion-builder" content="v1 defer_all_js=excluded:2">'
      )
    ).toEqual({ footprints: false, builderOff: false, builderTouched: true });
  });

  it('reads the simulation marker’s id and features, and an unverifiable conflict as a null id', () => {
    expect(readSimulationPage(parse(`<head>${MARKER}`)).marker).toEqual({
      id: MARKER_ID,
      features: ['delay_js']
    });
    const other = MARKER.replace(MARKER_ID, 'f'.repeat(32));
    expect(readSimulationPage(parse(`<head>${MARKER}${other}`)).marker).toEqual({
      id: null,
      features: ['delay_js']
    });
  });
});

/**
 * A reading: the Delay JS lane's footprints and the marker (the features
 * default to Delay JS's), the Defer JS lane as given.
 */
function reading(
  over: {
    readonly footprints?: boolean;
    readonly marker?: {
      readonly id: string | null;
      readonly features?: SimulatedFeatureId[];
    } | null;
    readonly defer?: Partial<LanePageReading>;
  } = {}
): SimulationPageReading {
  const marker = over.marker ?? null;
  return {
    amp: false,
    lanes: {
      delayJs: { ...NOTHING, footprints: over.footprints ?? true },
      deferJs: { ...NOTHING, ...over.defer }
    },
    marker: marker === null ? null : { id: marker.id, features: marker.features ?? ['delay_js'] }
  };
}

/** Build the evidence in a root over a settable reading. */
function evidenceRig(first: SimulationPageReading, verify: SimulationMarkerCheck) {
  const [reading, setReading] = createSignal(first);
  const log = { warn: vi.fn() };
  let failing = false;
  return createRoot((dispose) => {
    const evidence = createSimulationEvidence({
      read: () => {
        if (failing) throw new Error('boom');
        return reading();
      },
      changed: reading,
      verify,
      log
    });
    return {
      evidence,
      setReading,
      dispose,
      log,
      failReads: () => {
        failing = true;
      }
    };
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The background's answer naming `features`. */
const answered = (features: readonly SimulatedFeatureId[]): Promise<SimulationMarkerCheckOutcome> =>
  Promise.resolve({ kind: 'answered', features });

/** A miss (`transient`: asking again may answer). */
const missed = (transient: boolean): Promise<SimulationMarkerCheckOutcome> =>
  Promise.resolve({ kind: 'missed', transient });

describe('createSimulationEvidence', () => {
  it('passes a marker-free reading through', () => {
    const rig = evidenceRig(reading(), vi.fn());
    expect(rig.evidence()).toEqual({
      delayJs: { ...NO_PAGE_EVIDENCE, footprints: true },
      deferJs: NO_PAGE_EVIDENCE
    });
    rig.dispose();
  });

  it('verifies a marker once: checking, then verified', async () => {
    const verify = vi.fn(() => answered(['delay_js']));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    expect(rig.evidence().delayJs.marker).toBe('checking');
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('verified');
    rig.setReading(reading({ footprints: false, marker: { id: MARKER_ID } }));
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence().delayJs).toMatchObject({ footprints: false, marker: 'verified' });
    rig.dispose();
  });

  it('reads an id the background does not vouch for as unverified', async () => {
    const verify = vi.fn(() => answered([]));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('unverified');
    // An answer is final: a rescan never asks again.
    rig.setReading(reading({ marker: { id: MARKER_ID } }));
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    rig.dispose();
  });

  it('asks once more after a transient miss, on the next rescan only', async () => {
    const verify = vi.fn<SimulationMarkerCheck>(() => missed(true));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('unverified');
    expect(verify).toHaveBeenCalledTimes(1);
    verify.mockImplementation(() => answered(['delay_js']));
    rig.setReading(reading({ marker: { id: MARKER_ID } }));
    await settle();
    expect(verify).toHaveBeenCalledTimes(2);
    expect(rig.evidence().delayJs.marker).toBe('verified');
    rig.dispose();
  });

  it('bounds the retry: two transient misses, then no more asks', async () => {
    const verify = vi.fn<SimulationMarkerCheck>(() => missed(true));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    for (let scan = 0; scan < 4; scan++) {
      await settle();
      rig.setReading(reading({ marker: { id: MARKER_ID } }));
    }
    await settle();
    expect(verify).toHaveBeenCalledTimes(2);
    expect(rig.evidence().delayJs.marker).toBe('unverified');
    rig.dispose();
  });

  it('never re-asks after a definite miss (a malformed answer)', async () => {
    const verify = vi.fn<SimulationMarkerCheck>(() => missed(false));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    await settle();
    rig.setReading(reading({ marker: { id: MARKER_ID } }));
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence().delayJs.marker).toBe('unverified');
    rig.dispose();
  });

  it('never asks twice while an ask is out (rescans meanwhile)', async () => {
    let answer!: (outcome: SimulationMarkerCheckOutcome) => void;
    const verify = vi.fn<SimulationMarkerCheck>(() => new Promise((resolve) => (answer = resolve)));
    const rig = evidenceRig(reading({ marker: { id: MARKER_ID } }), verify);
    rig.setReading(reading({ marker: { id: MARKER_ID } }));
    rig.setReading(reading({ footprints: false, marker: { id: MARKER_ID } }));
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence().delayJs.marker).toBe('checking');
    answer({ kind: 'answered', features: ['delay_js'] });
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('verified');
    rig.dispose();
  });

  it('never asks about conflicting copies (unverified at once)', () => {
    const verify = vi.fn();
    const rig = evidenceRig(reading({ marker: { id: null } }), verify);
    expect(rig.evidence().delayJs.marker).toBe('unverified');
    expect(verify).not.toHaveBeenCalled();
    rig.dispose();
  });

  it('drops an answer that lands after disposal', async () => {
    let answer!: (outcome: SimulationMarkerCheckOutcome) => void;
    const rig = evidenceRig(
      reading({ marker: { id: MARKER_ID } }),
      () => new Promise((resolve) => (answer = resolve))
    );
    const evidence = rig.evidence;
    rig.dispose();
    answer({ kind: 'answered', features: ['delay_js'] });
    await settle();
    expect(evidence().delayJs.marker).toBe('checking');
  });

  it('degrades a throwing read to no evidence, logged', () => {
    const rig = evidenceRig(reading(), vi.fn());
    rig.failReads();
    rig.setReading(reading());
    expect(rig.evidence()).toEqual(NO_SIMULATION_EVIDENCE);
    expect(rig.log.warn).toHaveBeenCalledWith(
      'Simulation page evidence not read',
      expect.any(Error)
    );
    rig.dispose();
  });

  it('answers every lane with one ask: each lane verified only for the features vouched for', async () => {
    const verify = vi.fn(() => answered(['defer_all_js', 'delay_js']));
    const rig = evidenceRig(
      reading({ marker: { id: MARKER_ID, features: ['defer_all_js', 'delay_js'] } }),
      verify
    );
    expect(rig.evidence().deferJs.marker).toBe('checking');
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence().delayJs.marker).toBe('verified');
    expect(rig.evidence().deferJs.marker).toBe('verified');
    rig.dispose();
  });

  it('reads a lane the marker does not name as none, and one the background left out as unverified', async () => {
    const rig = evidenceRig(
      reading({ marker: { id: MARKER_ID, features: ['defer_all_js', 'delay_js'] } }),
      () => answered(['delay_js'])
    );
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('verified');
    expect(rig.evidence().deferJs.marker).toBe('unverified');
    rig.setReading(reading({ marker: { id: MARKER_ID, features: ['defer_all_js'] } }));
    await settle();
    expect(rig.evidence().delayJs.marker).toBe('none');
    rig.dispose();
  });

  it('carries the AMP root and each lane’s own reading', () => {
    const rig = evidenceRig(
      { ...reading({ defer: { footprints: true, builderTouched: true } }), amp: true },
      vi.fn()
    );
    expect(rig.evidence().deferJs).toEqual({
      amp: true,
      footprints: true,
      builderOff: false,
      builderTouched: true,
      marker: 'none'
    });
    expect(rig.evidence().delayJs.amp).toBe(true);
    rig.dispose();
  });
});
