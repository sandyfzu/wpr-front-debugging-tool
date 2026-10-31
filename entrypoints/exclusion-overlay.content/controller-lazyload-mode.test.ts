/**
 * The LazyLoad lane's mode through the controller: As served · Simulated
 * only, its availability from its own evidence (already served, AMP, the
 * URLs WP Rocket never lazy loads), and all three lanes' modes carried by
 * one save, apply and reset, in WP Rocket's buffer order.
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
  DelaySimulationReport,
  LazyloadSimulationReport
} from '../../lib/messaging/exclusion-simulation';
import {
  deferSimulatedReport,
  lazyloadSimulatedReport,
  simulatedReport
} from '../../lib/messaging/exclusion-simulation.fixtures';
import type { SimulateSpec } from '../../lib/wp-rocket-simulation/spec';
import { AUTOSAVE_DELAY_MS, createOverlayController, type OverlayController } from './controller';
import {
  NO_PAGE_EVIDENCE,
  NO_SIMULATION_EVIDENCE,
  type LanePageEvidence,
  type SimulationPageEvidence
} from './exclusions/simulation-mode';
import type { ExclusionSessionPort, PortOutcome } from './session/port';

const PAGE = 'https://example.com/';
const ALL: SimulateSpec = { features: ['lazyload', 'defer_all_js', 'delay_js'] };
const LAZYLOAD: SimulateSpec = { features: ['lazyload'] };
const SET: ExclusionSet = {
  ...EMPTY_EXCLUSION_SET,
  rows: { ...EMPTY_EXCLUSION_SET.rows, lazyload: ['hero.jpg'] }
};

const reply = <T>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A transform report of a lane's feature. */
function report(
  feature: 'delay_js' | 'defer_all_js' | 'lazyload',
  candidates: number
): TransformReport {
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
    readonly lazyloadSimulation?: LazyloadSimulationReport;
    readonly deferCandidates?: number;
    readonly lazyloadCandidates?: number;
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
      reports: [
        report('delay_js', 0),
        report('defer_all_js', reports.deferCandidates ?? 0),
        report('lazyload', reports.lazyloadCandidates ?? 0)
      ],
      ...(reports.simulation === undefined ? {} : { simulation: reports.simulation }),
      ...(reports.deferSimulation === undefined
        ? {}
        : { deferSimulation: reports.deferSimulation }),
      ...(reports.lazyloadSimulation === undefined
        ? {}
        : { lazyloadSimulation: reports.lazyloadSimulation }),
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

/** Evidence of a page: the LazyLoad lane's as given, nothing for the others. */
function lazyloadPage(lazyload: Partial<LanePageEvidence>): SimulationPageEvidence {
  return { ...NO_SIMULATION_EVIDENCE, lazyload: { ...NO_PAGE_EVIDENCE, ...lazyload } };
}

describe('LazyLoad mode: availability from its own evidence', () => {
  it('offers As served and Simulated on a page WP Rocket does not lazy load', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }));
    expect(controller.laneMode('lazyload')).toBe('served');
    expect(controller.laneBlocks('lazyload')).toEqual({
      served: null,
      simulated: null,
      disabled: null
    });
    controller.setLaneMode('lazyload', 'simulated');
    expect(controller.draft().simulate).toEqual(LAZYLOAD);
  });

  it('ignores Disabled: the lane does not offer it', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }));
    controller.setLaneMode('lazyload', 'disabled');
    expect(controller.laneMode('lazyload')).toBe('served');
    expect(controller.draft().disable).toEqual(EMPTY_EXCLUSION_SET.disable);
  });

  it.each([
    [{ footprints: true }, { kind: 'served' }, 'already-served'],
    [{ amp: true }, { kind: 'amp' }, 'amp'],
    [{ skip: 'search' as const }, { kind: 'skipped', reason: 'search' }, 'search'],
    [{ skip: 'preview' as const }, { kind: 'skipped', reason: 'preview' }, 'preview'],
    [
      { skip: 'page-builder-editor' as const },
      { kind: 'skipped', reason: 'page-builder-editor' },
      'page-builder-editor'
    ],
    [{ marker: 'checking' as const }, { kind: 'checking' }, 'checking']
  ])('evidence %j reads %j and blocks Simulated (%s)', async (evidence, state, block) => {
    const { controller } = await started(fakePort({ state: 'inactive' }), lazyloadPage(evidence));
    expect(controller.laneState('lazyload')).toEqual(state);
    expect(controller.laneBlocks('lazyload')?.simulated).toBe(block);
    controller.setLaneMode('lazyload', 'simulated');
    expect(controller.draft().simulate).toBeUndefined();
  });

  it('opens a saved Simulated as blocked on a search page (the draft keeps it)', async () => {
    const { controller } = await started(
      fakePort({ state: 'inactive' }, { set: SET, simulate: LAZYLOAD }),
      lazyloadPage({ skip: 'search' })
    );
    expect(controller.laneMode('lazyload')).toBe('simulated');
    expect(controller.blockedLaneMode('lazyload')).toBe('search');
    expect(controller.draft().simulate).toEqual(LAZYLOAD);
  });

  it('reads the session’s LazyLoad report first: a simulated page stays switchable', async () => {
    // The simulation printed LazyLoad's scripts: the live page alone would read "already lazy loads".
    const { controller } = await started(
      fakePort(session(LAZYLOAD, { lazyloadSimulation: lazyloadSimulatedReport() })),
      lazyloadPage({ footprints: true })
    );
    expect(controller.laneState('lazyload')).toEqual({ kind: 'not-served', simulation: 'session' });
    expect(controller.laneMode('lazyload')).toBe('simulated');
    expect(controller.runsSimulation()).toBe(true);
  });

  it('never reads the transform’s counts alone as WP Rocket lazy loading (another plugin’s markup)', async () => {
    // As served: the exclusion transform counted <img data-lazy-src> another plugin printed.
    const foreign = fakePort(session(undefined, { lazyloadCandidates: 3 }));
    const { controller } = await started(foreign, lazyloadPage({ footprints: false }));
    expect(controller.laneState('lazyload')).toEqual({ kind: 'not-served', simulation: 'none' });
    expect(controller.laneBlocks('lazyload')?.simulated).toBeNull();
  });

  it('reads the transform’s counts as served with WP Rocket’s own footprints', async () => {
    const { controller } = await started(
      fakePort(session(undefined, { lazyloadCandidates: 3 })),
      lazyloadPage({ footprints: true, builderTouched: true })
    );
    expect(controller.laneState('lazyload')).toEqual({ kind: 'served' });
    expect(controller.laneBlocks('lazyload')?.simulated).toBe('already-served');
  });

  it('keeps the Defer JS counts alone as proof (its stamps are WP Rocket’s own)', async () => {
    const { controller } = await started(fakePort(session(undefined, { deferCandidates: 2 })));
    expect(controller.laneState('deferJs')).toEqual({ kind: 'served' });
  });

  it('reads a verified marker naming LazyLoad as a kept simulation', async () => {
    const { controller } = await started(
      fakePort({ state: 'inactive' }),
      lazyloadPage({ footprints: true, marker: 'verified' })
    );
    expect(controller.laneState('lazyload')).toEqual({ kind: 'not-served', simulation: 'kept' });
    expect(controller.runsSimulation()).toBe(true);
  });
});

describe('LazyLoad mode: one save, apply and reset carry all three lanes', () => {
  it('saves and applies the three simulated features in one spec (buffer order)', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET });
    const { controller, fireAutosave } = await started(port);
    controller.setLaneMode('delayJs', 'simulated');
    controller.setLaneMode('lazyload', 'simulated');
    controller.setLaneMode('deferJs', 'simulated');
    expect(controller.draft().simulate).toEqual(ALL);
    await fireAutosave();
    expect(port.save).toHaveBeenLastCalledWith(SET, ALL);
    controller.apply();
    await settle();
    expect(port.apply).toHaveBeenLastCalledWith(SET, ALL);
  });

  it('restores the three lanes’ modes from a saved entry', async () => {
    const { controller } = await started(
      fakePort({ state: 'inactive' }, { set: SET, simulate: ALL })
    );
    expect(controller.laneMode('lazyload')).toBe('simulated');
    expect(controller.laneMode('deferJs')).toBe('simulated');
    expect(controller.laneMode('delayJs')).toBe('simulated');
  });

  it('changes LazyLoad without touching the others; Reset restores all three', async () => {
    const port = fakePort(
      session(ALL, {
        lazyloadSimulation: lazyloadSimulatedReport(),
        deferSimulation: deferSimulatedReport(),
        simulation: simulatedReport()
      })
    );
    const { controller } = await started(port);
    controller.setLaneMode('lazyload', 'served');
    expect(controller.draft().simulate).toEqual({ features: ['defer_all_js', 'delay_js'] });
    expect(controller.dirty()).toBe(true);
    controller.reset();
    await settle();
    expect(controller.draft().simulate).toEqual(ALL);
    expect(controller.dirty()).toBe(false);
  });

  it('keeps LazyLoad simulated when Delay JS is disabled (no feature-wide disable of its own)', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }));
    controller.setLaneMode('lazyload', 'simulated');
    controller.setLaneMode('delayJs', 'disabled');
    expect(controller.draft().simulate).toEqual(LAZYLOAD);
    expect(controller.draft().disable.delayJs).toBe(true);
  });
});
