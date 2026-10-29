import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKER_ID } from '../../../lib/messaging/exclusion-simulation.fixtures';
import type {
  SimulationMarkerCheck,
  SimulationMarkerCheckOutcome
} from '../../../lib/messaging/simulation-marker-verifier';
import type { SimulatedFeatureId } from '../../../lib/wp-rocket-simulation/spec';
import { NO_DELAY_EVIDENCE } from './delay-mode';
import { createDelayEvidence, readDelayPage, type DelayPageReading } from './delay-page';

const MARKER = `<meta name="wpr-fdt-simulation" content="v1 delay_js=simulated id=${MARKER_ID}">`;

/** A parsed document from markup. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readDelayPage', () => {
  it('reads a plain page as nothing', () => {
    expect(readDelayPage(parse('<html><head></head><body><script src="a.js"></script>'))).toEqual({
      amp: false,
      footprints: false,
      builderDelayOff: false,
      builderDelayTouched: false,
      marker: null
    });
  });

  it('reads an AMP root (<html amp>, <html ⚡>)', () => {
    expect(readDelayPage(parse('<html amp><body>')).amp).toBe(true);
    // The test DOM's parser drops the non-ASCII name (browsers keep it): set it directly.
    const bolt = parse('<html><body>');
    bolt.documentElement.setAttribute('⚡', '');
    expect(readDelayPage(bolt).amp).toBe(true);
    expect(readDelayPage(parse('<html lang="en"><body amp>')).amp).toBe(false);
  });

  it('reads delayed scripts as footprints', () => {
    expect(
      readDelayPage(parse('<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>'))
        .footprints
    ).toBe(true);
    expect(readDelayPage(parse('<script data-rocket-src="a.js"></script>')).footprints).toBe(true);
  });

  it('reads the builder’s Delay-off fact', () => {
    const doc = parse('<head><meta name="wpr-fdt-exclusion-builder" content="v1 delay_js=off">');
    expect(readDelayPage(doc).builderDelayOff).toBe(true);
    expect(readDelayPage(doc).builderDelayTouched).toBe(true);
  });

  it('reads any builder Delay JS fact as touched, the Delay-off one only as off', () => {
    const doc = parse(
      '<head><meta name="wpr-fdt-exclusion-builder" content="v1 delay_js=excluded:3">'
    );
    expect(readDelayPage(doc).builderDelayTouched).toBe(true);
    expect(readDelayPage(doc).builderDelayOff).toBe(false);
  });

  it('reads the simulation marker’s id, and an unverifiable conflict as a null id', () => {
    expect(readDelayPage(parse(`<head>${MARKER}`)).marker).toEqual({ id: MARKER_ID });
    const other = MARKER.replace(MARKER_ID, 'f'.repeat(32));
    expect(readDelayPage(parse(`<head>${MARKER}${other}`)).marker).toEqual({ id: null });
  });
});

/** Build the evidence in a root over a settable reading. */
function evidenceRig(first: DelayPageReading, verify: SimulationMarkerCheck) {
  const [reading, setReading] = createSignal(first);
  const log = { warn: vi.fn() };
  let failing = false;
  return createRoot((dispose) => {
    const evidence = createDelayEvidence({
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

const PLAIN: DelayPageReading = {
  amp: false,
  footprints: true,
  builderDelayOff: false,
  builderDelayTouched: false,
  marker: null
};

describe('createDelayEvidence', () => {
  it('passes a marker-free reading through', () => {
    const rig = evidenceRig(PLAIN, vi.fn());
    expect(rig.evidence()).toEqual({ ...NO_DELAY_EVIDENCE, footprints: true });
    rig.dispose();
  });

  it('verifies a marker once: checking, then verified', async () => {
    const verify = vi.fn(() => answered(['delay_js']));
    const rig = evidenceRig({ ...PLAIN, marker: { id: MARKER_ID } }, verify);
    expect(rig.evidence().marker).toBe('checking');
    await settle();
    expect(rig.evidence().marker).toBe('verified');
    rig.setReading({ ...PLAIN, footprints: false, marker: { id: MARKER_ID } });
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence()).toMatchObject({ footprints: false, marker: 'verified' });
    rig.dispose();
  });

  it('reads an id the background does not vouch for as unverified', async () => {
    const verify = vi.fn(() => answered([]));
    const rig = evidenceRig({ ...PLAIN, marker: { id: MARKER_ID } }, verify);
    await settle();
    expect(rig.evidence().marker).toBe('unverified');
    // An answer is final: a rescan never asks again.
    rig.setReading({ ...PLAIN, marker: { id: MARKER_ID } });
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    rig.dispose();
  });

  it('asks once more after a transient miss, on the next rescan only', async () => {
    const verify = vi.fn<SimulationMarkerCheck>(() => missed(true));
    const rig = evidenceRig({ ...PLAIN, marker: { id: MARKER_ID } }, verify);
    await settle();
    expect(rig.evidence().marker).toBe('unverified');
    expect(verify).toHaveBeenCalledTimes(1);
    verify.mockImplementation(() => answered(['delay_js']));
    rig.setReading({ ...PLAIN, marker: { id: MARKER_ID } });
    await settle();
    expect(verify).toHaveBeenCalledTimes(2);
    expect(rig.evidence().marker).toBe('verified');
    rig.dispose();
  });

  it('bounds the retry: two transient misses, then no more asks', async () => {
    const verify = vi.fn<SimulationMarkerCheck>(() => missed(true));
    const rig = evidenceRig({ ...PLAIN, marker: { id: MARKER_ID } }, verify);
    for (let scan = 0; scan < 4; scan++) {
      await settle();
      rig.setReading({ ...PLAIN, marker: { id: MARKER_ID } });
    }
    await settle();
    expect(verify).toHaveBeenCalledTimes(2);
    expect(rig.evidence().marker).toBe('unverified');
    rig.dispose();
  });

  it('never re-asks after a definite miss (a malformed answer)', async () => {
    const verify = vi.fn<SimulationMarkerCheck>(() => missed(false));
    const rig = evidenceRig({ ...PLAIN, marker: { id: MARKER_ID } }, verify);
    await settle();
    rig.setReading({ ...PLAIN, marker: { id: MARKER_ID } });
    await settle();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence().marker).toBe('unverified');
    rig.dispose();
  });

  it('never asks twice while an ask is out (rescans meanwhile)', async () => {
    let answer!: (outcome: SimulationMarkerCheckOutcome) => void;
    const verify = vi.fn<SimulationMarkerCheck>(() => new Promise((resolve) => (answer = resolve)));
    const rig = evidenceRig({ ...PLAIN, marker: { id: MARKER_ID } }, verify);
    rig.setReading({ ...PLAIN, marker: { id: MARKER_ID } });
    rig.setReading({ ...PLAIN, footprints: false, marker: { id: MARKER_ID } });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rig.evidence().marker).toBe('checking');
    answer({ kind: 'answered', features: ['delay_js'] });
    await settle();
    expect(rig.evidence().marker).toBe('verified');
    rig.dispose();
  });

  it('never asks about conflicting copies (unverified at once)', () => {
    const verify = vi.fn();
    const rig = evidenceRig({ ...PLAIN, marker: { id: null } }, verify);
    expect(rig.evidence().marker).toBe('unverified');
    expect(verify).not.toHaveBeenCalled();
    rig.dispose();
  });

  it('drops an answer that lands after disposal', async () => {
    let answer!: (outcome: SimulationMarkerCheckOutcome) => void;
    const rig = evidenceRig(
      { ...PLAIN, marker: { id: MARKER_ID } },
      () => new Promise((resolve) => (answer = resolve))
    );
    const evidence = rig.evidence;
    rig.dispose();
    answer({ kind: 'answered', features: ['delay_js'] });
    await settle();
    expect(evidence().marker).toBe('checking');
  });

  it('degrades a throwing read to no evidence, logged', () => {
    const rig = evidenceRig(PLAIN, vi.fn());
    rig.failReads();
    rig.setReading({ ...PLAIN });
    expect(rig.evidence()).toEqual(NO_DELAY_EVIDENCE);
    expect(rig.log.warn).toHaveBeenCalledWith('Delay JS page evidence not read', expect.any(Error));
    rig.dispose();
  });
});
