/**
 * The Defer JS simulation's words (pinned so every change is deliberate):
 * its mode control, its outcome banners, the lane count line, and the
 * banners of both features at once — Delay JS simulated on a page Defer JS
 * could not reproduce says it ran without Defer JS.
 */
import { describe, expect, it } from 'vitest';
import type {
  DeferSimulationReport,
  DelaySimulationReport
} from '../../lib/messaging/exclusion-simulation';
import {
  deferSimulatedReport,
  simulatedReport
} from '../../lib/messaging/exclusion-simulation.fixtures';
import { stateBanner } from './banner-model';
import {
  DEFER_MODE_COPY,
  DELAY_MODE_COPY,
  MODE_LANE_COPY,
  SIMULATION_LANE_COPY,
  simulationOutcomeCopy,
  viewCopy
} from './copy';
import {
  SIMULATION_LANES,
  SIMULATION_MODES,
  laneModeBlocks,
  type RealFeatureState,
  type SimulationLane
} from './exclusions/simulation-mode';
import type { OverlayState } from './session/machine';
import type { SessionView } from './session/session-view';

/** A Defer JS report in a non-simulated state. */
function defer(
  state: Exclude<DeferSimulationReport['state'], 'simulated'>,
  reason?: DeferSimulationReport['reason']
): DeferSimulationReport {
  return {
    feature: 'defer_all_js',
    wpRocketVersion: '3.24',
    listSource: 'bundled',
    listMiss: 'never-fetched',
    state,
    deferred: 0,
    wrapped: 0,
    ...(reason === undefined ? {} : { reason })
  };
}

/** A Delay JS report in a non-simulated state. */
function delay(state: Exclude<DelaySimulationReport['state'], 'simulated'>): DelaySimulationReport {
  return {
    feature: 'delay_js',
    state,
    delayed: 0,
    runtimeInjected: false,
    wpRocketVersion: '3.24',
    listSource: 'bundled',
    listMiss: 'never-fetched'
  };
}

/** An applied view carrying the given simulations. */
function applied(
  deferSimulation?: DeferSimulationReport,
  simulation?: DelaySimulationReport
): Extract<SessionView, { kind: 'applied' }> {
  return {
    kind: 'applied',
    reports: [],
    unmatched: 0,
    warnings: [],
    served: undefined,
    ...(simulation === undefined ? {} : { simulation }),
    ...(deferSimulation === undefined ? {} : { deferSimulation })
  };
}

const READY: OverlayState = {
  phase: 'ready',
  status: { state: 'inactive' },
  pending: null,
  notice: null
};

const REMEDY =
  'Test on another page of the site, or choose As served to apply your exclusions without the simulation.';

describe('Defer JS mode words', () => {
  it('pins its own words and shares the rest with Delay JS', () => {
    expect(DEFER_MODE_COPY.groupName).toBe('Load JavaScript deferred on this page');
    expect(DEFER_MODE_COPY.blocks).toEqual({
      'already-served':
        'WP Rocket already defers scripts on this page — exclusions apply to its output.',
      'delay-served':
        'WP Rocket delays scripts on this page and defers them before it delays them, so Defer JS can’t be simulated here.',
      amp: 'WP Rocket never defers AMP pages.',
      checking: 'Checking whether WP Rocket defers scripts on this page…'
    });
    expect(DEFER_MODE_COPY.disabledChangesNothing).toBe(
      'WP Rocket doesn’t defer scripts on this page, so Disabled changes nothing here.'
    );
    expect(DEFER_MODE_COPY.labels).toBe(DELAY_MODE_COPY.labels);
    expect(DEFER_MODE_COPY.kept).toBe(DELAY_MODE_COPY.kept);
    expect(DEFER_MODE_COPY.adminScreen).toBe(DELAY_MODE_COPY.adminScreen);
  });

  it('words every block each lane can meet', () => {
    const states: RealFeatureState[] = [
      { kind: 'checking' },
      { kind: 'served' },
      { kind: 'not-served', simulation: 'none' },
      { kind: 'amp' }
    ];
    for (const lane of Object.keys(SIMULATION_LANES) as SimulationLane[]) {
      for (const state of states) {
        for (const delayState of [null, ...states]) {
          const blocks = laneModeBlocks(lane, state, delayState);
          for (const mode of SIMULATION_MODES) {
            const block = blocks[mode];
            if (block !== null) expect(MODE_LANE_COPY[lane].blocks[block]).toMatch(/\S/);
          }
        }
      }
    }
  });

  it('pins the Defer JS lane count line', () => {
    expect(SIMULATION_LANE_COPY.deferLine(4, 1, 2)).toBe(
      '4 deferred and 1 inline wrapped by the simulation · 2 excluded by your rows'
    );
  });
});

describe('Defer JS outcome words', () => {
  it('names a simulated Defer JS on the applied banner, alone and with Delay JS', () => {
    expect(viewCopy(applied(deferSimulatedReport()))).toEqual({
      title: 'Applied',
      body: 'This page was rendered with your exclusions and WP Rocket’s Load JavaScript deferred simulated — not the site’s real configuration.'
    });
    expect(viewCopy(applied(deferSimulatedReport(), simulatedReport())).body).toBe(
      'This page was rendered with your exclusions and WP Rocket’s Load JavaScript deferred and Delay JavaScript execution simulated — not the site’s real configuration.'
    );
  });

  it('words each non-simulated Defer JS state with its own verb', () => {
    expect(simulationOutcomeCopy(defer('already-served'))).toEqual({
      title: 'Applied — WP Rocket already defers scripts here',
      body: 'Nothing was simulated: your exclusions apply to WP Rocket’s own Load JavaScript deferred, as served.'
    });
    expect(simulationOutcomeCopy(defer('not-applicable', 'amp'))).toEqual({
      title: 'Not simulated: AMP page',
      body: 'WP Rocket never defers scripts on AMP pages, so the page was rendered as served, with your exclusions. Choose As served to stop asking for the simulation.'
    });
    expect(simulationOutcomeCopy(defer('not-applicable', 'delay-js-served'))).toEqual({
      title: 'Not simulated: WP Rocket already delays scripts here',
      body: `WP Rocket defers scripts before it delays them, and this page is already delayed, so Defer JS can’t be reproduced and the page was rendered as served, with your exclusions. ${REMEDY}`
    });
  });

  it('says once that Delay JS ran when Defer JS could not be reproduced (the body names it)', () => {
    const beyond: DeferSimulationReport = {
      ...defer('not-applicable', 'beyond-exact-reproduction'),
      unreproducedRegex: 'defer-replacements'
    };
    expect(viewCopy(applied(beyond, simulatedReport()))).toEqual({
      title: 'Not simulated: this page can’t be reproduced exactly',
      body: `WP Rocket’s Defer JS script rewriting pattern may stop on this page, which the simulation can’t reproduce, so the page was rendered with Delay JavaScript execution simulated and your exclusions. ${REMEDY}`
    });
  });

  it('says the other feature’s outcome beside a step that did not run', () => {
    // Defer JS simulated, Delay JS blocked by the CSP.
    expect(viewCopy(applied(deferSimulatedReport(), delay('csp-blocked')))).toEqual({
      title: 'Not simulated: blocked by this page’s Content Security Policy',
      body: `The policy forbids WP Rocket’s inline Delay JS script, as it would on the site, so nothing was delayed and the page was rendered with Load JavaScript deferred simulated and your exclusions. ${REMEDY}`
    });
    // WP Rocket defers here; Delay JS simulated on its deferred page.
    expect(viewCopy(applied(defer('already-served'), simulatedReport()))).toEqual({
      title: 'Applied — WP Rocket already defers scripts here',
      body: 'Load JavaScript deferred wasn’t simulated: your exclusions apply to WP Rocket’s own Load JavaScript deferred, as served. Delay JavaScript execution was simulated.'
    });
    // Neither ran: the second titled after the first.
    expect(
      viewCopy(applied(defer('not-applicable', 'unsupported-charset'), delay('csp-blocked'))).body
    ).toMatch(
      / Not simulated: blocked by this page’s Content Security Policy \(Delay JavaScript execution\)\.$/
    );
    // A delayed page: Delay JS already served says nothing the Defer JS words don't.
    expect(
      viewCopy(applied(defer('not-applicable', 'delay-js-served'), delay('already-served'))).body
    ).toBe(
      `WP Rocket defers scripts before it delays them, and this page is already delayed, so Defer JS can’t be reproduced and the page was rendered as served, with your exclusions. ${REMEDY}`
    );
  });

  it('warns when either step did not run, clean when both ran', () => {
    const clean = { ...simulatedReport(), cspLimits: undefined, caveats: undefined };
    expect(stateBanner(READY, applied(deferSimulatedReport(), clean))).toMatchObject({
      tone: 'ok'
    });
    expect(stateBanner(READY, applied(defer('already-served'), clean))).toMatchObject({
      tone: 'warn',
      glyph: 'alert'
    });
    // A Defer JS report never carries limits: no notes of its own (the session's only).
    expect(stateBanner(READY, applied(deferSimulatedReport()))?.notes).toEqual(
      stateBanner(READY, applied())?.notes
    );
  });
});
