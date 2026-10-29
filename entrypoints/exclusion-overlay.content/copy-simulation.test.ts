/**
 * The simulation's words (draft wording, pinned so every change is
 * deliberate) and the banners that carry them: each state titled with a way
 * forward, limits as notes, the Stop banner naming the simulation.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentSimulationReport } from '../../lib/messaging/exclusion-simulation';
import { simulatedReport } from '../../lib/messaging/exclusion-simulation.fixtures';
import {
  SIMULATION_CSP_LIMITS,
  SIMULATION_NOT_APPLICABLE_REASONS,
  UNREPRODUCED_REGEXES
} from '../../lib/wp-rocket-simulation/spec';
import { noticeBanner, stateBanner } from './banner-model';
import {
  DELAY_MODE_COPY,
  SIMULATED_INDICATOR,
  SIMULATION_LANE_COPY,
  simulationLimitLines,
  simulationOutcomeCopy,
  stoppedBody,
  unmodifiedCopy,
  viewCopy
} from './copy';
import type { OverlayState } from './session/machine';
import type { SessionView } from './session/session-view';

/** A report in a non-simulated state. */
function report(
  state: Exclude<DocumentSimulationReport['state'], 'simulated'>,
  extra: Partial<DocumentSimulationReport> = {}
): DocumentSimulationReport {
  return {
    feature: 'delay_js',
    state,
    delayed: 0,
    runtimeInjected: false,
    wpRocketVersion: '3.24',
    listSource: 'bundled',
    listMiss: 'never-fetched',
    ...extra
  } as DocumentSimulationReport;
}

/** An applied view carrying a simulation. */
function applied(simulation: DocumentSimulationReport): Extract<SessionView, { kind: 'applied' }> {
  return {
    kind: 'applied',
    reports: [],
    unmatched: 0,
    warnings: [],
    served: undefined,
    simulation
  };
}

/** A ready overlay (the banner reads the view, not this status). */
const READY: OverlayState = {
  phase: 'ready',
  status: { state: 'inactive' },
  pending: null,
  notice: null
};

describe('Delay JS mode words', () => {
  it('pins the options, the reasons and the notes', () => {
    expect(DELAY_MODE_COPY.groupName).toBe('Delay JavaScript execution on this page');
    expect(DELAY_MODE_COPY.labels).toEqual({
      served: 'As served',
      simulated: 'Simulated',
      disabled: 'Disabled'
    });
    expect(DELAY_MODE_COPY.blocks).toEqual({
      'already-delayed':
        'WP Rocket already delays scripts on this page — exclusions apply to its output.',
      amp: 'WP Rocket never delays AMP pages.',
      checking: 'Checking whether WP Rocket delays scripts on this page…'
    });
    expect(DELAY_MODE_COPY.replaced('simulated')).toBe(
      'Simulated isn’t available on this page, so the page runs as served — Simulated stays set for other pages.'
    );
    expect(DELAY_MODE_COPY.disabledChangesNothing).toBe(
      'WP Rocket doesn’t delay scripts on this page, so Disabled changes nothing here.'
    );
    expect(DELAY_MODE_COPY.kept).toBe('Simulated · reload to see the page without it.');
    expect(DELAY_MODE_COPY.adminScreen).toBe(
      'This is a WordPress admin or login screen. WP Rocket never optimizes these screens, so a simulation here shows something the site never serves.'
    );
    expect(SIMULATED_INDICATOR).toEqual({ tone: 'info', label: 'Simulated', glyph: 'simulated' });
  });
});

describe('simulation outcome words', () => {
  it('says nothing extra for a simulated page; the applied banner names the simulation', () => {
    expect(simulationOutcomeCopy(simulatedReport())).toBeNull();
    expect(viewCopy(applied(simulatedReport()))).toEqual({
      title: 'Applied',
      body: 'This page was rendered with WP Rocket Delay JavaScript execution simulated and your exclusions — not the site’s real configuration.'
    });
  });

  it('titles each non-simulated state and gives a way forward', () => {
    expect(simulationOutcomeCopy(report('already-served'))?.title).toBe(
      'Applied — WP Rocket already delays scripts here'
    );
    expect(simulationOutcomeCopy(report('csp-blocked'))).toEqual({
      title: 'Not simulated: blocked by this page’s Content Security Policy',
      body: 'The policy forbids WP Rocket’s inline Delay JS script, as it would on the site, so nothing was delayed and the page was rendered with your exclusions only. Test on another page of the site, or choose As served to apply your exclusions without the simulation.'
    });
    expect(simulationOutcomeCopy(report('not-applicable', { reason: 'amp' }))).toEqual({
      title: 'Not simulated: AMP page',
      body: 'WP Rocket never delays scripts on AMP pages, so the page was rendered as served, with your exclusions. Choose As served to stop asking for the simulation.'
    });
    expect(
      simulationOutcomeCopy(report('not-applicable', { reason: 'unsupported-charset' }))?.title
    ).toBe('Not simulated: character encoding');
    expect(
      simulationOutcomeCopy(
        report('not-applicable', {
          reason: 'beyond-exact-reproduction',
          unreproducedRegex: 'xmp-mask'
        })
      )?.body
    ).toContain('WP Rocket’s <xmp> masking pattern may stop on this page');
  });

  it('words every not-applicable reason and unreproduced pattern', () => {
    for (const reason of SIMULATION_NOT_APPLICABLE_REASONS) {
      for (const regex of UNREPRODUCED_REGEXES) {
        const words = simulationOutcomeCopy(
          report('not-applicable', { reason, unreproducedRegex: regex })
        );
        expect(words?.title).toMatch(/^Not simulated: /);
        expect(words?.body).toMatch(/choose As served|Choose As served/);
      }
    }
  });

  it('lists the CSP limits, an unevaluated CSP and the caveats of a simulated page only', () => {
    expect(simulationLimitLines(simulatedReport())).toEqual([
      'This page’s Content Security Policy blocks eval: event handlers of delayed elements fail here as they would on the site.',
      'This page’s Content Security Policy blocks inline scripts: delayed inline scripts fail here as they would on the site.',
      'This page serves WP Rocket’s combined JavaScript files: with Delay JS on, WP Rocket would serve them uncombined, which the simulation can’t reproduce.'
    ]);
    const all = simulationLimitLines({
      ...simulatedReport(),
      cspLimits: [...SIMULATION_CSP_LIMITS]
    });
    expect(new Set(all).size).toBe(all.length);
    const unevaluated: DocumentSimulationReport = {
      ...simulatedReport(),
      cspLimits: undefined,
      caveats: undefined,
      cspUnavailable: 'oversized'
    };
    expect(simulationLimitLines(unevaluated)).toEqual([
      'CSP not evaluated: this page’s Content Security Policy is too large to check, so scripts it blocks aren’t named.'
    ]);
    expect(simulationLimitLines(report('csp-blocked'))).toEqual([]);
  });

  it('words a simulation-step overrun apart from a row’s', () => {
    const reason = {
      kind: 'over-budget',
      feature: 'delay_js',
      row: null,
      budgetMs: 2000,
      stage: 'simulate'
    } as const;
    expect(unmodifiedCopy(reason)).toBe(
      'Simulating Delay JavaScript execution took longer than 2000 ms (the simulation counts toward the time budget), so the page was served unmodified. Reload to try again, or choose As served to apply your exclusions without the simulation.'
    );
    expect(viewCopy({ kind: 'unmodified', reason, served: undefined }).title).toBe(
      'Served unmodified: the simulation took too long'
    );
    expect(
      viewCopy({
        kind: 'unmodified',
        reason: { kind: 'runtime-unavailable', cause: 'hash-mismatch' },
        served: undefined
      }).title
    ).toBe('Served unmodified: simulation data unavailable');
  });

  it('pins the lane lines', () => {
    expect(SIMULATION_LANE_COPY.line(5, 2)).toBe(
      '5 delayed by the simulation · 2 excluded by your rows'
    );
    expect(SIMULATION_LANE_COPY.version(simulatedReport())).toBe(
      'Simulated · WP Rocket 3.24 (the site serves 3.12.1)'
    );
    expect(SIMULATION_LANE_COPY.version({ ...simulatedReport(), siteVersion: '3.24' })).toBe(
      'Simulated · WP Rocket 3.24'
    );
    expect(SIMULATION_LANE_COPY.undetermined(1)).toBe(
      '1 left undelayed by the simulation: whether WP Rocket delays it depends on ids it draws at random.'
    );
    expect(SIMULATION_LANE_COPY.regexLimit).toContain('nothing is delayed — as on the site');
  });
});

describe('simulation banners', () => {
  it('warns on a simulated page the CSP limits, with the limits as notes first', () => {
    const banner = stateBanner(READY, applied(simulatedReport()));
    expect(banner).toMatchObject({ tone: 'warn', glyph: 'alert' });
    expect(banner?.notes.slice(0, 3)).toEqual(simulationLimitLines(simulatedReport()));
  });

  it('is clean for a simulated page without limits', () => {
    const clean = { ...simulatedReport(), cspLimits: undefined, caveats: undefined };
    const view = applied(clean);
    expect(stateBanner(READY, view)).toMatchObject({ tone: 'ok', glyph: 'check' });
  });

  it('warns when the simulation did not run here', () => {
    const view = applied(report('already-served'));
    expect(stateBanner(READY, view)).toMatchObject({
      tone: 'warn',
      title: 'Applied — WP Rocket already delays scripts here'
    });
  });

  it('says a stopped page still runs the simulation until reloaded', () => {
    expect(noticeBanner({ kind: 'stopped' }, true).body).toBe(stoppedBody(true));
    expect(stoppedBody(true)).toBe('Reload to see the page without exclusions or the simulation.');
    expect(noticeBanner({ kind: 'stopped' }).body).toBe(
      'Reload to see the page without exclusions.'
    );
  });
});
