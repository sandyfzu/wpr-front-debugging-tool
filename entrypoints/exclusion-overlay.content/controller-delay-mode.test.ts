/**
 * The controller's Delay JS mode: restored with the rows, saved and applied
 * as `{set, simulate}` from one mode, reset to the applied pair, and shown
 * as As served (said) when the page does not allow the draft's mode — display
 * only: the draft keeps it (never dirty, re-sent by an apply) until the user
 * picks another — the page's real state read from the session's report
 * first, then the page.
 */
import { createHash } from 'node:crypto';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../../lib/exclusion-builder/set';
import type {
  ActiveExclusionSession,
  ExclusionServedDocument,
  ExclusionSessionStatus
} from '../../lib/messaging/exclusion-session';
import { simulatedReport } from '../../lib/messaging/exclusion-simulation.fixtures';
import type { DelaySimulationReport } from '../../lib/messaging/exclusion-simulation';
import type { SimulateSpec } from '../../lib/wp-rocket-simulation/spec';
import { AUTOSAVE_DELAY_MS, createOverlayController, type OverlayController } from './controller';
import { NO_DELAY_EVIDENCE, type DelayPageEvidence } from './exclusions/delay-mode';
import type { ExclusionSessionPort, PortOutcome } from './session/port';

const PAGE = 'https://example.com/';
const SIMULATE: SimulateSpec = { features: ['delay_js'] };
const SET: ExclusionSet = {
  ...EMPTY_EXCLUSION_SET,
  rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['gtag'] }
};
const DISABLED_SET: ExclusionSet = {
  ...SET,
  disable: { ...SET.disable, delayJs: true }
};

const reply = <T>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The served identity of {@link PAGE}, recorded for this load. */
function served(): ExclusionServedDocument {
  return {
    urlPath: PAGE,
    urlDigest: createHash('sha256').update(PAGE, 'utf8').digest('hex'),
    token: 't-1',
    order: 1,
    receivedAt: 40,
    speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: true },
    copy: true,
    serviceWorkersBypassed: true
  };
}

/** An active session that rewrote this page. */
function session(
  set: ExclusionSet,
  simulate: SimulateSpec | undefined,
  simulation?: DelaySimulationReport,
  candidates = 0
): ActiveExclusionSession {
  return {
    state: 'active',
    origin: 'https://example.com',
    set,
    ...(simulate === undefined ? {} : { simulate }),
    startedAt: 1,
    document: {
      outcome: 'rewritten',
      reports: [
        {
          feature: 'delay_js',
          featureWide: set.disable.delayJs,
          candidates,
          rewritten: 0,
          regionRemovals: 0,
          matchedRows: [],
          unmatchedRows: []
        }
      ],
      ...(simulation === undefined ? {} : { simulation }),
      served: served()
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

/** A started controller with settable page evidence (none: the evidence seam left out). */
async function started(
  port: ExclusionSessionPort,
  evidence: DelayPageEvidence | null = NO_DELAY_EVIDENCE,
  href = PAGE
) {
  const timers: { run: () => void; ms: number }[] = [];
  const [page, setPage] = createSignal<DelayPageEvidence>(evidence ?? NO_DELAY_EVIDENCE);
  let controller: OverlayController | undefined;
  createRoot(() => {
    controller = createOverlayController({
      port,
      pageFacts: () => ({ href, documentUrl: href, navigationStart: 0, responseEnd: null }),
      now: () => 1,
      schedule: (run, ms) => {
        timers.push({ run, ms });
        return () => undefined;
      },
      reload: vi.fn(),
      log: { warn: vi.fn() },
      ...(evidence === null ? {} : { delayEvidence: page })
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

const DELAYED: DelayPageEvidence = { ...NO_DELAY_EVIDENCE, footprints: true };

describe('Delay JS mode: draft, save, apply, reset', () => {
  it('restores the saved mode with its rows (never arming: nothing is applied)', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET, simulate: SIMULATE });
    const { controller } = await started(port);
    expect(controller.delayMode()).toBe('simulated');
    expect(controller.draft().simulate).toEqual(SIMULATE);
    expect(port.apply).not.toHaveBeenCalled();
  });

  it('restores the active session’s mode when no draft is saved', async () => {
    const { controller } = await started(
      fakePort(session(SET, SIMULATE, simulatedReport())),
      DELAYED
    );
    expect(controller.delayMode()).toBe('simulated');
    expect(controller.dirty()).toBe(false);
  });

  it('saves and applies the mode as one {set, simulate} pair', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET });
    const { controller, fireAutosave } = await started(port);
    controller.setDelayMode('simulated');
    await fireAutosave();
    expect(port.save).toHaveBeenLastCalledWith(SET, SIMULATE);
    controller.apply();
    await settle();
    expect(port.apply).toHaveBeenLastCalledWith(SET, SIMULATE);
  });

  it('applies Disabled exactly as the disable switch did (no simulate sent)', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET });
    const { controller } = await started(port, DELAYED);
    controller.setDelayMode('disabled');
    controller.apply();
    await settle();
    expect(port.apply).toHaveBeenLastCalledWith(DISABLED_SET);
    expect(port.apply.mock.lastCall).toHaveLength(1);
  });

  it('never produces the contradictory pair when switching between modes', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET });
    const { controller } = await started(port, null);
    controller.setDelayMode('simulated');
    controller.setDelayMode('disabled');
    expect(controller.draft().disable.delayJs).toBe(true);
    expect(controller.draft().simulate).toBeUndefined();
    controller.setDelayMode('simulated');
    expect(controller.draft().disable.delayJs).toBe(false);
    expect(controller.draft().simulate).toEqual(SIMULATE);
    controller.setDisable('delayJs', true);
    expect(controller.draft().simulate).toBeUndefined();
  });

  it('marks a mode change dirty and resets to the applied mode, re-applying it', async () => {
    const port = fakePort(session(SET, SIMULATE, simulatedReport()));
    const { controller } = await started(port, DELAYED);
    controller.setDelayMode('served');
    expect(controller.dirty()).toBe(true);
    controller.reset();
    expect(controller.delayMode()).toBe('simulated');
    await settle();
    expect(port.apply).toHaveBeenLastCalledWith(SET, SIMULATE);
  });

  it('ignores a mode the page does not allow, and any mode while not editable', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET });
    const { controller } = await started(port, DELAYED);
    controller.setDelayMode('simulated');
    expect(controller.delayMode()).toBe('served');
    controller.apply();
    controller.setDelayMode('disabled');
    expect(controller.delayMode()).toBe('served');
  });
});

describe('Delay JS mode: the page’s real state', () => {
  it('offers every mode when the host cannot read the page', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }), null);
    expect(controller.delayState()).toBeNull();
    controller.setDelayMode('disabled');
    expect(controller.delayMode()).toBe('disabled');
  });

  it('checks nothing for a restored mode the page does not allow, said, without saving', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET, simulate: SIMULATE });
    const { controller, fireAutosave } = await started(port, DELAYED);
    expect(controller.delayState()).toEqual({ kind: 'delayed' });
    expect(controller.delayMode()).toBeNull();
    expect(controller.replacedDelayMode()).toBe('simulated');
    await fireAutosave();
    expect(port.save).not.toHaveBeenCalled();
    // The draft keeps the restored mode (display only).
    expect(controller.draft().simulate).toEqual(SIMULATE);
    // Choosing a mode again ends the note.
    controller.setDelayMode('disabled');
    expect(controller.replacedDelayMode()).toBeNull();
  });

  it('keeps a saved Disabled on a page WP Rocket does not delay (a no-op, never replaced)', async () => {
    const port = fakePort({ state: 'inactive' }, { set: DISABLED_SET });
    const { controller } = await started(port);
    expect(controller.delayMode()).toBe('disabled');
    expect(controller.replacedDelayMode()).toBeNull();
  });

  it('ends the note by itself once the page allows the draft’s mode again', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET, simulate: SIMULATE });
    const { controller, setPage } = await started(port, DELAYED);
    expect(controller.replacedDelayMode()).toBe('simulated');
    setPage(NO_DELAY_EVIDENCE);
    expect(controller.delayMode()).toBe('simulated');
    expect(controller.replacedDelayMode()).toBeNull();
  });

  it('waits for a marker verification before replacing anything', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET, simulate: SIMULATE });
    const { controller, setPage } = await started(port, {
      ...DELAYED,
      marker: 'checking'
    });
    expect(controller.delayState()).toEqual({ kind: 'checking' });
    expect(controller.delayMode()).toBe('simulated');
    setPage({ ...DELAYED, marker: 'verified' });
    expect(controller.delayState()).toEqual({ kind: 'not-delayed', simulation: 'kept' });
    expect(controller.delayMode()).toBe('simulated');
    expect(controller.replacedDelayMode()).toBeNull();
  });

  it('reads a forged (unverified) marker as no evidence: the footprints decide', async () => {
    const port = fakePort({ state: 'inactive' }, { set: SET, simulate: SIMULATE });
    const { controller } = await started(port, { ...DELAYED, marker: 'unverified' });
    expect(controller.delayState()).toEqual({ kind: 'delayed' });
    expect(controller.delayMode()).toBeNull();
  });

  it('applied Simulated, then reloaded: the footprints are the simulation’s, the mode stays switchable', async () => {
    const port = fakePort(session(SET, SIMULATE, simulatedReport(), 4), {
      set: SET,
      simulate: SIMULATE
    });
    const { controller } = await started(port, DELAYED);
    expect(controller.view()?.kind).toBe('applied');
    expect(controller.delayState()).toEqual({ kind: 'not-delayed', simulation: 'session' });
    expect(controller.delayMode()).toBe('simulated');
    // As served + Apply removes the simulation.
    controller.setDelayMode('served');
    controller.apply();
    await settle();
    expect(port.apply).toHaveBeenLastCalledWith(SET);
    expect(port.apply.mock.lastCall).toHaveLength(1);
  });

  it('applied Disabled, then reloaded: no footprints, yet the page is delayed — Disabled stays', async () => {
    // The disable restored 3 delayed scripts: the report still counts them.
    const port = fakePort(session(DISABLED_SET, undefined, undefined, 3), { set: DISABLED_SET });
    const { controller } = await started(port, NO_DELAY_EVIDENCE);
    expect(controller.delayState()).toEqual({ kind: 'delayed' });
    expect(controller.delayMode()).toBe('disabled');
    expect(controller.replacedDelayMode()).toBeNull();
  });

  it('applied Disabled where nothing was delayed: not delayed, Disabled stays', async () => {
    const port = fakePort(session(DISABLED_SET, undefined), { set: DISABLED_SET });
    const { controller } = await started(port, NO_DELAY_EVIDENCE);
    expect(controller.delayState()).toEqual({ kind: 'not-delayed', simulation: 'none' });
    expect(controller.delayMode()).toBe('disabled');
    expect(controller.replacedDelayMode()).toBeNull();
  });

  it('ignores the builder’s Delay-off marker without a session on (page markup alone)', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }), {
      ...NO_DELAY_EVIDENCE,
      builderDelayOff: true
    });
    expect(controller.delayState()).toEqual({ kind: 'not-delayed', simulation: 'none' });
  });

  it('applied As served with rows restoring every delayed script: the report says delayed', async () => {
    const port = fakePort(session(SET, undefined, undefined, 3), { set: SET });
    const { controller } = await started(port, NO_DELAY_EVIDENCE);
    expect(controller.delayState()).toEqual({ kind: 'delayed' });
  });

  it('applied Simulated on a page WP Rocket already delays: nothing checked, said', async () => {
    const already: DelaySimulationReport = {
      feature: 'delay_js',
      state: 'already-served',
      delayed: 0,
      runtimeInjected: false,
      wpRocketVersion: '3.24',
      listSource: 'bundled',
      listMiss: 'never-fetched'
    };
    const port = fakePort(session(SET, SIMULATE, already, 2), { set: SET, simulate: SIMULATE });
    const { controller } = await started(port, DELAYED);
    expect(controller.delayState()).toEqual({ kind: 'delayed' });
    expect(controller.delayMode()).toBeNull();
    expect(controller.replacedDelayMode()).toBe('simulated');
    // Display only: the session's mode is not the user's edit.
    expect(controller.dirty()).toBe(false);
    expect(controller.draft().simulate).toEqual(SIMULATE);
  });

  it('navigating in a Simulated session to a page WP Rocket delays: nothing checked, the session’s mode kept', async () => {
    const already: DelaySimulationReport = {
      feature: 'delay_js',
      state: 'already-served',
      delayed: 0,
      runtimeInjected: false,
      wpRocketVersion: '3.24',
      listSource: 'bundled',
      listMiss: 'never-fetched'
    };
    // Applied Simulated on a plain page, then navigated (the overlay re-opens on the new page).
    const port = fakePort(session(SET, SIMULATE, already, 2), { set: SET, simulate: SIMULATE });
    const { controller, fireAutosave } = await started(port, DELAYED);
    expect(controller.delayMode()).toBeNull();
    expect(controller.replacedDelayMode()).toBe('simulated');
    // Nothing to reset (Reset held) and nothing saved: the site's mode stays.
    expect(controller.dirty()).toBe(false);
    await fireAutosave();
    expect(port.save).not.toHaveBeenCalled();
    // A row edit makes it dirty; Apply re-sends the session's mode.
    const row = controller.draft().rows.delayJs[0];
    if (row === undefined) throw new Error('no row');
    controller.editRow('delayJs', row.id, 'gtag.js');
    expect(controller.dirty()).toBe(true);
    controller.apply();
    await settle();
    expect(port.apply).toHaveBeenLastCalledWith(
      { ...SET, rows: { ...SET.rows, delayJs: ['gtag.js'] } },
      SIMULATE
    );
  });

  it('an AMP page (simulation not applicable) allows only As served', async () => {
    const amp: DelaySimulationReport = {
      feature: 'delay_js',
      state: 'not-applicable',
      reason: 'amp',
      delayed: 0,
      runtimeInjected: false,
      wpRocketVersion: '3.24',
      listSource: 'bundled',
      listMiss: 'never-fetched'
    };
    const port = fakePort(session(SET, SIMULATE, amp), { set: SET, simulate: SIMULATE });
    const { controller } = await started(port, NO_DELAY_EVIDENCE);
    expect(controller.delayState()).toEqual({ kind: 'amp' });
    expect(controller.delayMode()).toBeNull();
    controller.setDelayMode('disabled');
    expect(controller.delayMode()).toBeNull();
    controller.setDelayMode('served');
    expect(controller.delayMode()).toBe('served');
  });

  it('page-local stand-in for the session’s Simulated: As served drops the simulation, Disabled disables', async () => {
    const already: DelaySimulationReport = {
      feature: 'delay_js',
      state: 'already-served',
      delayed: 0,
      runtimeInjected: false,
      wpRocketVersion: '3.24',
      listSource: 'bundled',
      listMiss: 'never-fetched'
    };
    const port = fakePort(session(SET, SIMULATE, already, 2), { set: SET, simulate: SIMULATE });
    const { controller } = await started(port, DELAYED);
    expect(controller.delayMode()).toBeNull();
    // Disabled is a real edit…
    controller.setDelayMode('disabled');
    expect(controller.delayMode()).toBe('disabled');
    expect(controller.replacedDelayMode()).toBeNull();
    expect(controller.dirty()).toBe(true);
    // …and so is As served, which the stand-in no longer pre-checks.
    controller.setDelayMode('served');
    expect(controller.delayMode()).toBe('served');
    expect(controller.dirty()).toBe(true);
    controller.apply();
    await settle();
    // The simulation ends: no spec sent.
    expect(port.apply).toHaveBeenLastCalledWith(SET);
    expect(port.apply.mock.lastCall).toHaveLength(1);
  });

  it('reads a page a session’s rewrite touched, with no session left, as not delayed — unproven', async () => {
    // Stop after a Disabled rewrite: no footprints, the builder's marker stays.
    const { controller } = await started(fakePort({ state: 'inactive' }), {
      ...NO_DELAY_EVIDENCE,
      builderDelayOff: true,
      builderDelayTouched: true
    });
    expect(controller.delayState()).toEqual({
      kind: 'not-delayed',
      simulation: 'none',
      unproven: true
    });
    // Every mode stays offered.
    controller.setDelayMode('simulated');
    expect(controller.delayMode()).toBe('simulated');
  });
});

describe('admin screen', () => {
  it('flags WordPress admin and login screens from the page address', async () => {
    const admin = await started(fakePort({ state: 'inactive' }), null, `${PAGE}wp-admin/`);
    expect(admin.controller.adminScreen()).toBe(true);
    const front = await started(fakePort({ state: 'inactive' }), null);
    expect(front.controller.adminScreen()).toBe(false);
  });
});
