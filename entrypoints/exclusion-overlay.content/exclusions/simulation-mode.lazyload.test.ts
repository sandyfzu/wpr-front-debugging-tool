/**
 * The LazyLoad lane's mode model: As served · Simulated only (its feature
 * has no feature-wide disable), its real state from the session's LazyLoad
 * report and the live page, and Simulated unavailable where WP Rocket
 * already lazy loads, on AMP pages and on the URLs it never lazy loads.
 */
import { describe, expect, it } from 'vitest';
import { lazyloadTransform } from '../../../lib/exclusion-builder/lazyload';
import { EMPTY_EXCLUSION_SET } from '../../../lib/exclusion-builder/set';
import { alreadyServesLazyload } from '../../../lib/wp-rocket-simulation/already-served';
import type { LazyloadSimulationReport } from '../../../lib/messaging/exclusion-simulation';
import { lazyloadSimulatedReport } from '../../../lib/messaging/exclusion-simulation.fixtures';
import {
  NO_PAGE_EVIDENCE,
  SIMULATION_LANE_KEYS,
  SIMULATION_MODES,
  laneDisabled,
  laneModeBlocks,
  laneModeFields,
  laneModeOf,
  laneModes,
  laneToggleKey,
  realFeatureState,
  REPORT_PROVES_SERVED,
  draftModeBlock,
  type LaneSessionFacts
} from './simulation-mode';
import { readSimulationPage } from './simulation-page';

const PAGE_URL = 'https://e.org/p/';

/** A LazyLoad report of a step that did not run (no marker, no counts). */
function notRun(
  state: LazyloadSimulationReport['state'],
  reason?: LazyloadSimulationReport['reason']
): LazyloadSimulationReport {
  return {
    feature: 'lazyload',
    state,
    ...(reason === undefined ? {} : { reason }),
    images: 0,
    pictures: 0,
    backgrounds: 0,
    wpRocketVersion: '3.24'
  };
}

/** The session's facts with a LazyLoad report (nothing disabled: LazyLoad has no disable). */
function facts(simulation: LazyloadSimulationReport | undefined): LaneSessionFacts {
  return { simulation, disabled: false, report: undefined, reportProvesServed: false };
}

describe('the LazyLoad lane’s modes', () => {
  it('lists the lanes in on-screen order, LazyLoad last', () => {
    expect(SIMULATION_LANE_KEYS).toEqual(['delayJs', 'deferJs', 'lazyload']);
  });

  it('offers no Disabled: the feature has no feature-wide disable', () => {
    expect(laneToggleKey('lazyload')).toBeNull();
    expect(laneModes('lazyload')).toEqual(['served', 'simulated']);
    expect(laneToggleKey('delayJs')).toBe('delayJs');
    expect(laneModes('delayJs')).toEqual(SIMULATION_MODES);
    expect(laneModes('deferJs')).toEqual(SIMULATION_MODES);
  });

  it('never reads a disable for LazyLoad, whatever the set holds', () => {
    const allOff = { delayJs: true, deferJs: true, lazyRender: true };
    expect(laneDisabled(allOff, 'lazyload')).toBe(false);
    expect(laneDisabled(allOff, 'deferJs')).toBe(true);
    expect(laneDisabled(EMPTY_EXCLUSION_SET.disable, 'delayJs')).toBe(false);
  });

  it('maps Simulated and As served onto the spec, keeping the other features', () => {
    expect(laneModeOf('lazyload', false, { features: ['lazyload', 'delay_js'] })).toBe('simulated');
    expect(laneModeOf('lazyload', false, { features: ['delay_js'] })).toBe('served');
    expect(laneModeFields('lazyload', 'simulated', { features: ['delay_js'] })).toEqual({
      disable: false,
      simulate: { features: ['lazyload', 'delay_js'] }
    });
    expect(laneModeFields('lazyload', 'served', { features: ['lazyload'] })).toEqual({
      disable: false,
      simulate: undefined
    });
  });

  it('refuses Disabled on LazyLoad, naming the lane', () => {
    expect(() => laneModeFields('lazyload', 'disabled', undefined)).toThrow(
      'The lazyload lane offers no disabled mode'
    );
  });
});

describe('the LazyLoad lane’s real state', () => {
  it('reads a simulated report as the session’s simulation', () => {
    expect(realFeatureState(facts(lazyloadSimulatedReport()), NO_PAGE_EVIDENCE, true)).toEqual({
      kind: 'not-served',
      simulation: 'session'
    });
  });

  it.each([['preview' as const], ['search' as const], ['page-builder-editor' as const]])(
    'reads a %s refusal as a URL WP Rocket never lazy loads',
    (reason) => {
      expect(
        realFeatureState(facts(notRun('not-applicable', reason)), NO_PAGE_EVIDENCE, true)
      ).toEqual({ kind: 'skipped', reason });
    }
  );

  it.each([
    ['already-served', undefined, { kind: 'served' }],
    ['csp-blocked', undefined, { kind: 'not-served', simulation: 'none' }],
    ['not-applicable', 'amp', { kind: 'amp' }],
    ['not-applicable', 'no-body-end', { kind: 'not-served', simulation: 'none' }],
    ['not-applicable', 'runtime-unavailable', { kind: 'not-served', simulation: 'none' }],
    ['not-applicable', 'runtime-undeliverable', { kind: 'not-served', simulation: 'none' }],
    ['not-applicable', 'runtime-mixed-content', { kind: 'not-served', simulation: 'none' }],
    ['not-applicable', 'beyond-exact-reproduction', { kind: 'not-served', simulation: 'none' }]
  ] as const)('reads %s (%s) from the session first', (state, reason, expected) => {
    // Live footprints (the page the session served) never override the session's word.
    const page = { ...NO_PAGE_EVIDENCE, footprints: true, skip: 'search' as const };
    expect(realFeatureState(facts(notRun(state, reason)), page, true)).toEqual(expected);
  });

  it('reads the auditor’s foreign-markup page as not served: the transform counts alone prove nothing', () => {
    const html =
      '<!doctype html><html><head></head><body><img data-lazy-src="/a.png" src="/ph.gif" class="lazy">' +
      '<script src="/wp-content/themes/x/lazyload.min.js"></script>' +
      '<script>new LazyLoad({elements_selector:".lazy"})</script></body></html>';
    const page = readSimulationPage(new DOMParser().parseFromString(html, 'text/html'), PAGE_URL);
    const set = {
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, lazyload: ['zzz'] }
    };
    const { report } = lazyloadTransform(html, set);
    expect(report.candidates).toBeGreaterThan(0);
    expect(alreadyServesLazyload(html)).toBe(false);
    const evidence = { ...NO_PAGE_EVIDENCE, ...page.lanes.lazyload };
    const state = realFeatureState({ ...facts(undefined), report }, evidence, true);
    expect(state).toEqual({ kind: 'not-served', simulation: 'none' });
    expect(laneModeBlocks('lazyload', state, null).simulated).toBeNull();
    // The same counts on a page with WP Rocket's own footprints: served.
    expect(
      realFeatureState({ ...facts(undefined), report }, { ...evidence, footprints: true }, true)
    ).toEqual({ kind: 'served' });
    // A lane whose counts are its own proof reads them alone.
    expect(
      realFeatureState(
        { ...facts(undefined), report, reportProvesServed: true },
        NO_PAGE_EVIDENCE,
        true
      )
    ).toEqual({ kind: 'served' });
  });

  it('takes the counts as proof for Delay JS and Defer JS only', () => {
    expect(REPORT_PROVES_SERVED).toEqual({ delayJs: true, deferJs: true, lazyload: false });
  });

  it('reads the page’s URL skip after its footprints: a site that lazy loads it anyway serves it', () => {
    expect(realFeatureState(null, { ...NO_PAGE_EVIDENCE, skip: 'search' }, false)).toEqual({
      kind: 'skipped',
      reason: 'search'
    });
    expect(
      realFeatureState(null, { ...NO_PAGE_EVIDENCE, skip: 'search', footprints: true }, false)
    ).toEqual({ kind: 'served' });
    expect(
      realFeatureState(null, { ...NO_PAGE_EVIDENCE, skip: 'preview', amp: true }, false)
    ).toEqual({ kind: 'amp' });
  });

  it('reads a verified marker before the URL skip (a simulation the page keeps)', () => {
    expect(
      realFeatureState(null, { ...NO_PAGE_EVIDENCE, skip: 'search', marker: 'verified' }, false)
    ).toEqual({ kind: 'not-served', simulation: 'kept' });
  });
});

describe('the LazyLoad lane’s availability', () => {
  it.each([
    [{ kind: 'served' } as const, 'already-served'],
    [{ kind: 'amp' } as const, 'amp'],
    [{ kind: 'checking' } as const, 'checking'],
    [{ kind: 'skipped', reason: 'search' } as const, 'search'],
    [{ kind: 'skipped', reason: 'preview' } as const, 'preview'],
    [{ kind: 'skipped', reason: 'page-builder-editor' } as const, 'page-builder-editor'],
    [{ kind: 'not-served', simulation: 'none' } as const, null]
  ])('state %j blocks Simulated with %j; As served stays', (state, block) => {
    const blocks = laneModeBlocks('lazyload', state, null);
    expect(blocks.simulated).toBe(block);
    expect(blocks.served).toBeNull();
  });

  it('blocks a saved Simulated on a skipped page, never As served', () => {
    expect(
      draftModeBlock('lazyload', 'simulated', { kind: 'skipped', reason: 'search' }, null)
    ).toBe('search');
    expect(
      draftModeBlock('lazyload', 'served', { kind: 'skipped', reason: 'search' }, null)
    ).toBeNull();
  });

  it('never lets Delay JS decide LazyLoad (it runs first in WP Rocket’s buffer)', () => {
    expect(
      laneModeBlocks('lazyload', { kind: 'not-served', simulation: 'none' }, { kind: 'served' })
        .simulated
    ).toBeNull();
  });
});
