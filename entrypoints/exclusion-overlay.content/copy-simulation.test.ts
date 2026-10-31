/**
 * The simulation's words (owner-approved, pinned so every change is
 * deliberate) and the banners that carry them: each state titled with a way
 * forward, limits as notes, the Stop banner naming the simulation.
 */
import { describe, expect, it } from 'vitest';
import type { DelaySimulationReport } from '../../lib/messaging/exclusion-simulation';
import {
  deferSimulatedReport,
  lazyloadSimulatedReport,
  simulatedReport
} from '../../lib/messaging/exclusion-simulation.fixtures';
import {
  LATEST_LIST_MISSES,
  SIMULATION_CSP_LIMITS,
  SIMULATION_NOT_APPLICABLE_REASONS,
  UNREPRODUCED_REGEXES
} from '../../lib/wp-rocket-simulation/spec';
import { noticeBanner, stateBanner } from './banner-model';
import {
  DELAY_MODE_COPY,
  SIMULATED_INDICATOR,
  SESSION_PERSISTS_NOTE,
  SIMULATION_LANE_COPY,
  simulationLaneLimits,
  simulationLimitLines,
  simulationListCopy,
  simulationOutcomeCopy,
  stoppedBody,
  unmodifiedCopy,
  viewCopy
} from './copy';
import type { OverlayState } from './session/machine';
import type { SessionView } from './session/session-view';

/** A report in a non-simulated state. */
function report(
  state: Exclude<DelaySimulationReport['state'], 'simulated'>,
  extra: Partial<DelaySimulationReport> = {}
): DelaySimulationReport {
  return {
    feature: 'delay_js',
    state,
    delayed: 0,
    runtimeInjected: false,
    wpRocketVersion: '3.24',
    listSource: 'bundled',
    listMiss: 'never-fetched',
    ...extra
  } as DelaySimulationReport;
}

/** An applied view carrying a simulation. */
function applied(simulation: DelaySimulationReport): Extract<SessionView, { kind: 'applied' }> {
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
      'already-served':
        'WP Rocket already delays scripts on this page — exclusions apply to its output.',
      amp: 'WP Rocket never delays AMP pages.',
      checking: 'Checking whether WP Rocket delays scripts on this page…'
    });
    expect(DELAY_MODE_COPY.blockedDraft('already-served')).toBe(
      'Set for this site; doesn’t apply on this page (WP Rocket already does it). Choose As served to clear it.'
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
      body: 'Rendered with your exclusions and simulated Delay JS — not the site’s real setup. The site’s own WP Rocket exclusions aren’t included; add them as rows.'
    });
  });

  it('names the site exclusions the simulation lacks only on a simulated page', () => {
    for (const state of ['csp-blocked', 'already-served', 'not-applicable'] as const) {
      expect(viewCopy(applied(report(state))).body).not.toContain('own WP Rocket exclusions');
    }
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
    ).toBe('Not simulated: page isn’t UTF-8');
    expect(
      simulationOutcomeCopy(
        report('not-applicable', {
          reason: 'beyond-exact-reproduction',
          unreproducedRegex: 'xmp-mask'
        })
      )?.body
    ).toContain('WP Rocket’s <xmp> masking pattern may stop on this page');
  });

  it('names LazyLoad’s script and options when the policy blocks LazyLoad (draft words)', () => {
    const lazyload = {
      feature: 'lazyload',
      state: 'csp-blocked',
      wpRocketVersion: '3.24',
      images: 0,
      pictures: 0,
      backgrounds: 0
    } as const;
    expect(simulationOutcomeCopy(lazyload)).toEqual({
      title: 'Not simulated: blocked by this page’s Content Security Policy',
      body: 'The policy forbids WP Rocket’s LazyLoad script or its inline options, as it would on the site, so no image was lazy loaded and the page was rendered with your exclusions only. Test on another page of the site, or choose As served to apply your exclusions without the simulation.'
    });
    expect(
      simulationOutcomeCopy({
        ...lazyload,
        state: 'not-applicable',
        reason: 'runtime-undeliverable'
      })
    ).toEqual({
      title: 'Not simulated: LazyLoad’s script can’t be served on this page',
      body: 'This page’s Content Security Policy sandboxes it without allow-same-origin, and Firefox then hides the page from the extension, so LazyLoad’s script can’t be served for it and the page was rendered as served, with your exclusions. Test in a Chromium-based browser, or choose As served to stop asking for the simulation.'
    });
    expect(
      simulationOutcomeCopy({
        ...lazyload,
        state: 'not-applicable',
        reason: 'runtime-mixed-content'
      })
    ).toEqual({
      title: 'Not simulated: LazyLoad’s script would be blocked as mixed content',
      body: 'This https page would load LazyLoad’s script over http, which the browser blocks (as it would on the site), so the page was rendered as served, with your exclusions. Serve WP Rocket’s assets over https, or choose As served to stop asking for the simulation.'
    });
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
      'CSP blocks eval: delayed elements’ event handlers fail, as on the site.',
      'CSP blocks inline scripts: delayed inline scripts fail, as on the site.',
      'Combined JS served here; with Delay JS, WP Rocket serves it uncombined, which the simulation can’t.'
    ]);
    const all = simulationLimitLines({
      ...simulatedReport(),
      cspLimits: [...SIMULATION_CSP_LIMITS]
    });
    expect(new Set(all).size).toBe(all.length);
    const unevaluated: DelaySimulationReport = {
      ...simulatedReport(),
      cspLimits: undefined,
      caveats: undefined,
      cspUnavailable: 'oversized'
    };
    expect(simulationLimitLines(unevaluated)).toEqual([
      'CSP not evaluated (too large to check): Delay JS scripts it blocks aren’t named.'
    ]);
    expect(simulationLimitLines({ ...unevaluated, cspUnavailable: 'unreadable' })).toEqual([
      'CSP not evaluated (unreadable): Delay JS scripts it blocks aren’t named.'
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
      'Simulating Delay JS took longer than 2000 ms (the simulation counts toward the time budget), so the page was served unmodified. Reload to try again, or choose As served to apply your exclusions without the simulation.'
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

  it('says a row billed over budget shares the budget with the simulation', () => {
    const row = { kind: 'over-budget', feature: 'defer_all_js', row: 'x', budgetMs: 2000 } as const;
    expect(unmodifiedCopy({ ...row, simulating: true })).toBe(
      'Load JavaScript deferred (row x) ran past the 2000 ms budget, so the page was served unmodified. The simulation’s time counts toward that budget, so the row may not be slow on its own. Simplify the row, or choose As served, then apply again.'
    );
    // Without a simulation the row alone spent the budget: the plain words.
    expect(unmodifiedCopy(row)).toBe(
      'Load JavaScript deferred (row x) took longer than 2000 ms, so the page was served unmodified. Simplify the row, then apply again.'
    );
  });

  it('pins the lane lines', () => {
    expect(SIMULATION_LANE_COPY.line(5, 2)).toBe(
      '5 delayed by the simulation · 2 excluded by your rows'
    );
    expect(SIMULATION_LANE_COPY.undetermined(1)).toBe(
      '1 left as served: WP Rocket decides it with random ids.'
    );
    expect(SIMULATION_LANE_COPY.undetermined(2)).toBe(
      '2 left as served: WP Rocket decides them with random ids.'
    );
    expect(SIMULATION_LANE_COPY.regexLimit).toBe(
      'Delay JS’s pattern stops here (PHP backtracking limit): nothing delayed, as on the site.'
    );
    expect(SIMULATION_LANE_COPY.limits(1)).toBe('1 limit');
    expect(SIMULATION_LANE_COPY.limits(3)).toBe('3 limits');
  });

  it('ends every simulated lane’s version line with the site-exclusions note in short', () => {
    const TAIL = ' · without the site’s own exclusions';
    expect(SIMULATION_LANE_COPY.version(simulatedReport())).toBe(
      `Simulated · WP Rocket 3.24 (the site serves 3.12.1)${TAIL}`
    );
    for (const report of [
      { ...simulatedReport(), siteVersion: '3.24' },
      deferSimulatedReport(),
      lazyloadSimulatedReport()
    ])
      expect(SIMULATION_LANE_COPY.version(report)).toBe(`Simulated · WP Rocket 3.24${TAIL}`);
    expect(
      SIMULATION_LANE_COPY.version({ ...lazyloadSimulatedReport(), siteVersion: '3.12.1' })
    ).toBe(`Simulated · WP Rocket 3.24 (the site serves 3.12.1)${TAIL}`);
  });

  it('puts nothing of Delay JS or Defer JS behind a lane disclosure', () => {
    // Scripts left as served and a stopped pattern are outcomes (visible lane lines), never limits.
    expect(simulationLaneLimits(simulatedReport(), 0)).toEqual([]);
    const stopped: DelaySimulationReport = {
      ...simulatedReport(),
      delayed: 0,
      regexLimitHit: true
    };
    delete (stopped as { undetermined?: number }).undetermined;
    expect(simulationLaneLimits(stopped, 0)).toEqual([]);
    expect(simulationLaneLimits(deferSimulatedReport(), 2)).toEqual([]);
  });
});

describe('simulation banners', () => {
  it('warns on a simulated page the CSP limits, visible, the session notes apart', () => {
    const banner = stateBanner(READY, applied(simulatedReport()));
    expect(banner).toMatchObject({ tone: 'warn', glyph: 'alert' });
    expect(banner?.notes).toEqual(simulationLimitLines(simulatedReport()));
    expect(banner?.sessionNotes).toEqual([SESSION_PERSISTS_NOTE]);
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

describe('owner words: the latest-list misses and the inline-after-fallback limit', () => {
  it('starts every miss with "latest list", one voice', () => {
    const misses = LATEST_LIST_MISSES.map((listMiss) =>
      simulationListCopy({ listSource: 'bundled', listMiss, wpRocketVersion: '3.24' }, 0)
    );
    for (const line of misses) {
      expect(line).toMatch(/^Exclusion list: bundled with WP Rocket 3\.24 \(latest list .+\)$/);
    }
    expect(
      simulationListCopy({ listSource: 'bundled', listMiss: 'expired', wpRocketVersion: '3.24' }, 0)
    ).toBe('Exclusion list: bundled with WP Rocket 3.24 (latest list copy over 14 days old)');
  });

  it('words the inline-after-fallback limit from the earlier page’s fallback', () => {
    expect(
      simulationLimitLines({
        ...simulatedReport(),
        cspLimits: ['inline-after-fallback'],
        caveats: undefined
      })
    ).toEqual([
      'If Delay JS switched to inline copies on an earlier page in this tab, CSP blocks them here, as on the site.'
    ]);
  });
});
