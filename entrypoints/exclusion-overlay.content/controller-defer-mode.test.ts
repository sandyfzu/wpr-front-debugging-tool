/**
 * The Defer JS lane's mode through the controller: its own real-state
 * evidence, its availability (Simulated never where WP Rocket already
 * defers or delays), and both lanes' modes carried by one save, apply and
 * reset.
 */
import { createHash } from 'node:crypto';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../../lib/exclusion-builder/set';
import type { TransformReport } from '../../lib/exclusion-builder/report';
import type {
  ActiveExclusionSession,
  ExclusionSessionStatus
} from '../../lib/messaging/exclusion-session';
import type {
  DeferSimulationReport,
  DelaySimulationReport
} from '../../lib/messaging/exclusion-simulation';
import {
  deferSimulatedReport,
  simulatedReport
} from '../../lib/messaging/exclusion-simulation.fixtures';
import type { SimulateSpec } from '../../lib/wp-rocket-simulation/spec';
import { AUTOSAVE_DELAY_MS, createOverlayController, type OverlayController } from './controller';
import {
  NO_PAGE_EVIDENCE,
  NO_SIMULATION_EVIDENCE,
  type SimulationPageEvidence
} from './exclusions/simulation-mode';
import type { ExclusionSessionPort, PortOutcome } from './session/port';

const PAGE = 'https://example.com/';
const BOTH: SimulateSpec = { features: ['defer_all_js', 'delay_js'] };
const DEFER: SimulateSpec = { features: ['defer_all_js'] };
const SET: ExclusionSet = {
  ...EMPTY_EXCLUSION_SET,
  rows: { ...EMPTY_EXCLUSION_SET.rows, deferJs: ['jquery'] }
};

const reply = <T>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A transform report of a lane's feature. */
function report(feature: 'delay_js' | 'defer_all_js', candidates: number): TransformReport {
  return {
    feature,
    featureWide: false,
    candidates,
    rewritten: 0,
    regionRemovals: 0,
    matchedRows: [],
    unmatchedRows: []
  };
}

/** An active session that rewrote this page with the given reports. */
function session(
  simulate: SimulateSpec | undefined,
  reports: {
    readonly simulation?: DelaySimulationReport;
    readonly deferSimulation?: DeferSimulationReport;
    readonly deferCandidates?: number;
  } = {}
): ActiveExclusionSession {
  return {
    state: 'active',
    origin: 'https://example.com',
    set: SET,
    ...(simulate === undefined ? {} : { simulate }),
    startedAt: 1,
    document: {
      outcome: 'rewritten',
      reports: [report('delay_js', 0), report('defer_all_js', reports.deferCandidates ?? 0)],
      ...(reports.simulation === undefined ? {} : { simulation: reports.simulation }),
      ...(reports.deferSimulation === undefined
        ? {}
        : { deferSimulation: reports.deferSimulation }),
      served: {
        urlPath: PAGE,
        urlDigest: createHash('sha256').update(PAGE, 'utf8').digest('hex'),
        token: 't-1',
        order: 1,
        receivedAt: 40,
        speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: true },
        copy: true,
        serviceWorkersBypassed: true
      }
    }
  };
}

/** A port answering a status and a saved entry. */
function fakePort(
  status: ExclusionSessionStatus,
  saved: { set: ExclusionSet; simulate?: SimulateSpec } | null = null
) {
  return {
    status: vi.fn(() => reply(status)),
    savedSet: vi.fn(() => reply(saved ?? { set: null })),
    apply: vi.fn(() => reply({ outcome: 'applying' as const })),
    stop: vi.fn(() => reply<ExclusionSessionStatus>({ state: 'inactive' })),
    save: vi.fn(() => reply({ outcome: 'saved' as const })),
    onStatus: vi.fn(() => () => undefined)
  } satisfies ExclusionSessionPort;
}

/** A started controller over settable evidence of both lanes. */
async function started(
  port: ExclusionSessionPort,
  evidence: SimulationPageEvidence = NO_SIMULATION_EVIDENCE
) {
  const timers: { run: () => void; ms: number }[] = [];
  const [page, setPage] = createSignal(evidence);
  let controller: OverlayController | undefined;
  createRoot(() => {
    controller = createOverlayController({
      port,
      pageFacts: () => ({ href: PAGE, documentUrl: PAGE, navigationStart: 0, responseEnd: null }),
      now: () => 1,
      schedule: (run, ms) => {
        timers.push({ run, ms });
        return () => undefined;
      },
      reload: vi.fn(),
      log: { warn: vi.fn() },
      simulationEvidence: page
    });
  });
  if (controller === undefined) throw new Error('controller not built');
  controller.start();
  await settle();
  const fireAutosave = async (): Promise<void> => {
    for (const timer of timers.splice(0)) if (timer.ms === AUTOSAVE_DELAY_MS) timer.run();
    await settle();
  };
  return { controller, setPage, fireAutosave };
}

/** Evidence of a page: Delay JS and Defer JS footprints as given. */
function pageWith(delayed: boolean, deferred: boolean): SimulationPageEvidence {
  return {
    delayJs: { ...NO_PAGE_EVIDENCE, footprints: delayed },
    deferJs: { ...NO_PAGE_EVIDENCE, footprints: deferred }
  };
}

describe('Defer JS mode: availability from its own evidence', () => {
  it('offers every mode on a page WP Rocket neither defers nor delays', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }));
    expect(controller.laneBlocks('deferJs')).toEqual({
      served: null,
      simulated: null,
      disabled: null
    });
  });

  it('blocks Simulated where WP Rocket already defers', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }), pageWith(false, true));
    expect(controller.laneState('deferJs')).toEqual({ kind: 'served' });
    expect(controller.laneBlocks('deferJs')?.simulated).toBe('already-served');
  });

  it('blocks Simulated where WP Rocket delays (it defers before it delays); Disabled stays', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }), pageWith(true, false));
    expect(controller.laneState('deferJs')).toEqual({ kind: 'not-served', simulation: 'none' });
    expect(controller.laneBlocks('deferJs')).toEqual({
      served: null,
      simulated: 'delay-served',
      disabled: null
    });
    // Delay JS's own lane is untouched by Defer JS's evidence.
    expect(controller.laneBlocks('delayJs')?.simulated).toBe('already-served');
    controller.setLaneMode('deferJs', 'simulated');
    expect(controller.draft().simulate).toBeUndefined();
    controller.setLaneMode('deferJs', 'disabled');
    expect(controller.draft().disable.deferJs).toBe(true);
  });

  it('blocks both on an AMP page', async () => {
    const amp = { ...NO_PAGE_EVIDENCE, amp: true };
    const { controller } = await started(fakePort({ state: 'inactive' }), {
      delayJs: amp,
      deferJs: amp
    });
    expect(controller.laneBlocks('deferJs')).toEqual({
      served: null,
      simulated: 'amp',
      disabled: 'amp'
    });
  });

  it('reads the session’s Defer JS report first: a simulated page stays switchable', async () => {
    // The simulation stamped scripts deferred: the live page alone would read "already defers".
    const { controller } = await started(
      fakePort(session(DEFER, { deferSimulation: deferSimulatedReport(), deferCandidates: 4 })),
      pageWith(false, true)
    );
    expect(controller.laneState('deferJs')).toEqual({ kind: 'not-served', simulation: 'session' });
    expect(controller.laneMode('deferJs')).toBe('simulated');
    expect(controller.runsSimulation()).toBe(true);
  });

  it('reads delay-js-served as not deferred, blocked by the delayed page', async () => {
    // A report of a step that did not run carries no marker.
    const withoutMarker: DeferSimulationReport = {
      feature: 'defer_all_js',
      state: 'not-applicable',
      reason: 'delay-js-served',
      deferred: 0,
      wrapped: 0,
      wpRocketVersion: '3.24',
      listSource: 'bundled',
      listMiss: 'never-fetched'
    };
    const { controller } = await started(
      fakePort(session(DEFER, { deferSimulation: withoutMarker })),
      pageWith(true, false)
    );
    expect(controller.laneState('deferJs')).toEqual({ kind: 'not-served', simulation: 'none' });
    // The draft keeps Simulated: shown as none checked, the page runs as served.
    expect(controller.laneMode('deferJs')).toBeNull();
    expect(controller.replacedLaneMode('deferJs')).toBe('simulated');
    expect(controller.dirty()).toBe(false);
  });

  it('reads the session’s Defer JS transform report: rows restored every deferred script', async () => {
    const { controller } = await started(
      fakePort(session(undefined, { deferCandidates: 3 })),
      pageWith(false, false)
    );
    expect(controller.laneState('deferJs')).toEqual({ kind: 'served' });
  });

  it('reads a verified marker naming Defer JS as a kept simulation', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }), {
      delayJs: NO_PAGE_EVIDENCE,
      deferJs: { ...NO_PAGE_EVIDENCE, footprints: true, marker: 'verified' }
    });
    expect(controller.laneState('deferJs')).toEqual({ kind: 'not-served', simulation: 'kept' });
    expect(controller.laneState('delayJs')).toEqual({ kind: 'not-served', simulation: 'none' });
    expect(controller.runsSimulation()).toBe(true);
  });
});

describe('Defer JS mode: one save, apply and reset carry both lanes', () => {
  it('saves and applies both simulated features in one spec (buffer order)', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET });
    const { controller, fireAutosave } = await started(port);
    controller.setLaneMode('delayJs', 'simulated');
    controller.setLaneMode('deferJs', 'simulated');
    expect(controller.draft().simulate).toEqual(BOTH);
    await fireAutosave();
    expect(port.save).toHaveBeenLastCalledWith(SET, BOTH);
    controller.apply();
    await settle();
    expect(port.apply).toHaveBeenLastCalledWith(SET, BOTH);
  });

  it('restores both lanes’ modes from a saved entry', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET, simulate: BOTH });
    const { controller } = await started(port);
    expect(controller.laneMode('deferJs')).toBe('simulated');
    expect(controller.laneMode('delayJs')).toBe('simulated');
  });

  it('changes one lane without touching the other; Reset restores both', async () => {
    const port = fakePort(
      session(BOTH, {
        deferSimulation: deferSimulatedReport(),
        simulation: simulatedReport()
      })
    );
    const { controller } = await started(port);
    controller.setLaneMode('deferJs', 'disabled');
    expect(controller.draft().simulate).toEqual({ features: ['delay_js'] });
    expect(controller.draft().disable.deferJs).toBe(true);
    expect(controller.dirty()).toBe(true);
    controller.reset();
    await settle();
    expect(controller.draft().simulate).toEqual(BOTH);
    expect(controller.draft().disable.deferJs).toBe(false);
  });
});
