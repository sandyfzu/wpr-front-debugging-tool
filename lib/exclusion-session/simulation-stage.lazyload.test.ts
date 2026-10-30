/**
 * The LazyLoad step inside the simulation stage: its report as the
 * session records it, its refusals (uncountable bytes, a runtime URL the
 * report cannot carry, later features touching its printed scripts) with
 * the other features still running, each step run once in order (its
 * time its own), and the marker naming it.
 */
import { describe, expect, it, vi } from 'vitest';
import { LINEAR_SCALING_TIMEOUT_MS, linearScaling } from '../../vitest.shared';
import { composeSteps } from '../exclusion-builder/pipeline';
import { EMPTY_EXCLUSION_SET } from '../exclusion-builder/set';
import type { DocumentSimulationInput } from '../messaging/exclusion-simulation';
import { SIMULATION_MARKER_META_NAME } from '../wp-rocket/constants';
import * as deferForward from '../wp-rocket-simulation/defer-js-forward';
import * as delayForward from '../wp-rocket-simulation/delay-js-forward';
import { runDocumentPipeline, type DocumentTransformResult } from './document-transform';
import { LAZYLOAD_PACKAGE_FIXTURE } from './simulation-package.fixtures';
import { lazyloadInput } from './simulation-sources';
import { simulationStage } from './simulation-stage';

/** The fixture's engine input pieces (the page URL set per test). */
const LAZYLOAD_TEXTS = lazyloadInput(LAZYLOAD_PACKAGE_FIXTURE, 'https://example.org/');

const PAGE =
  '<!doctype html><html><head><title>t</title></head><body>' +
  '<img src="/a.png" alt="a"><script src="/app.js"></script></body></html>';

/** A simulation input for `features`. */
function input(
  features: DocumentSimulationInput['features'],
  overrides: Partial<Pick<DocumentSimulationInput, 'deferLists' | 'lazyload' | 'markerId'>> = {}
): DocumentSimulationInput {
  return {
    features,
    wpRocketVersion: '3.24',
    runtime: 'RocketLazyLoadScripts.run();',
    fallback: 'if(0){}',
    listRows: ['lazyLoadOptions', 'wp-rocket/assets/js/lazyload/(.*)'],
    listSource: 'bundled',
    listMiss: 'never-fetched',
    lazyload: { ...LAZYLOAD_TEXTS, pageUrl: 'https://example.org/' },
    ...(features.includes('defer_all_js')
      ? {
          deferLists: {
            external: [],
            inline: ['window.lazyLoadOptions'],
            listSource: 'bundled',
            listMiss: 'never-fetched'
          }
        }
      : {}),
    ...overrides
  };
}

/** A run's html and reports. */
function run(html: string, simulate: DocumentSimulationInput) {
  const result: DocumentTransformResult = runDocumentPipeline(
    { html, set: EMPTY_EXCLUSION_SET, budgetMs: 60_000, simulate },
    () => 0
  );
  if (!result.ok) throw new Error(JSON.stringify(result.outcome));
  return { html: result.html, ...result.outcome };
}

describe('the LazyLoad step', () => {
  it('records a simulated report: counts and the page facts, no list provenance', () => {
    const result = run(PAGE, input(['lazyload']));
    expect(result.lazyloadSimulation).toEqual({
      feature: 'lazyload',
      state: 'simulated',
      wpRocketVersion: '3.24',
      images: 1,
      pictures: 0,
      backgrounds: 0,
      runtimeUrl:
        'https://example.org/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js',
      assetsUrlSource: 'default',
      delivery: 'external',
      placement: { head: 'before-end-tag', footer: 'before-end-tag', fallbacks: [] },
      caveats: ['hook-text-placement', 'runtime-url', 'above-the-fold-exclusions', 'site-filters']
    });
    expect(result.html).toContain('data-lazy-src="/a.png"');
  });

  it('serves a page whose bytes cannot be counted as is (unsupported-charset)', () => {
    const html = PAGE.replace('<title>t</title>', '<title>é</title>');
    const result = runDocumentPipeline(
      {
        html,
        set: EMPTY_EXCLUSION_SET,
        budgetMs: 60_000,
        simulate: input(['lazyload']),
        bytes: { encoding: 'windows-1252', bom: false }
      },
      () => 0
    );
    if (!result.ok) throw new Error('not rewritten');
    expect(result.html).toBe(html);
    expect(result.outcome.lazyloadSimulation).toMatchObject({
      state: 'not-applicable',
      reason: 'unsupported-charset',
      images: 0
    });
  });

  it('refuses a runtime URL longer than the report carries (lazyload-runtime-url)', () => {
    const long = `https://example.org/${'x'.repeat(9000)}/wp-content/plugins/wp-rocket/assets/js/`;
    const beacon =
      `<script>var rocket_beacon_data = {"a":1}</script>` +
      `<script data-name="wpr-wpr-beacon" src='${long}wpr-beacon.min.js' async></script>`;
    const html = PAGE.replace('</body>', `${beacon}</body>`);
    const result = run(html, input(['lazyload']));
    expect(result.html).toBe(html);
    expect(result.lazyloadSimulation).toMatchObject({
      state: 'not-applicable',
      reason: 'beyond-exact-reproduction',
      unreproducedRegex: 'lazyload-runtime-url'
    });
  });

  it('refuses LazyLoad alone when its packaged runtime is unusable (runtime-unavailable)', () => {
    const lazyload = { ...LAZYLOAD_TEXTS, runtimeUnavailable: 'hash-mismatch' as const };
    const result = run(PAGE, input(['lazyload', 'delay_js'], { lazyload }));
    expect(result.lazyloadSimulation).toMatchObject({
      state: 'not-applicable',
      reason: 'runtime-unavailable',
      images: 0
    });
    expect(result.lazyloadSimulation).not.toHaveProperty('runtimeUrl');
    const delayOnly = run(PAGE, input(['delay_js']));
    expect(result.html).toBe(delayOnly.html);
    expect(result.simulation).toMatchObject({ state: 'simulated', delayed: 1 });
  });

  it('keeps an identity state over an unusable runtime (the page never requests it)', () => {
    const lazyload = { ...LAZYLOAD_TEXTS, runtimeUnavailable: 'asset-unreachable' as const };
    const amp = PAGE.replace('<html>', '<html amp>');
    const result = run(amp, input(['lazyload'], { lazyload }));
    expect(result.lazyloadSimulation).toMatchObject({ state: 'not-applicable', reason: 'amp' });
  });

  it('refuses LazyLoad, keeping Defer JS, when Defer JS would wrap its options script', () => {
    const simulate = input(['lazyload', 'defer_all_js'], {
      deferLists: {
        external: ['gist.github.com'],
        inline: ['DOMContentLoaded'],
        listSource: 'bundled',
        listMiss: 'never-fetched'
      },
      lazyload: {
        ...LAZYLOAD_TEXTS,
        optionsScript: '<script>window.lazyLoadOptions=1;jQuery(document);</script>',
        pageUrl: 'https://example.org/'
      }
    });
    const result = run(PAGE, simulate);
    expect(result.lazyloadSimulation).toMatchObject({
      unreproducedRegex: 'lazyload-injected-scripts'
    });
    expect(result.deferSimulation).toMatchObject({ state: 'simulated', deferred: 1 });
    expect(result.html).not.toContain('lazyLoadOptions');
    expect(result.html).toContain('<script src="/app.js" data-rocket-defer defer></script>');
  });

  it('runs each step once, in order, each pass continuing the buffer the earlier ones left', () => {
    const defer = vi.spyOn(deferForward, 'simulateDeferJs');
    const delay = vi.spyOn(delayForward, 'simulateDelayJs');
    const deferPasses = vi.spyOn(deferForward, 'deferJsPasses');
    try {
      const result = run(PAGE, input(['lazyload', 'defer_all_js', 'delay_js']));
      expect(defer).toHaveBeenCalledTimes(1);
      expect(delay).toHaveBeenCalledTimes(1);
      // Delay JS continues Defer JS's buffer: it never reruns the Defer JS passes.
      expect(deferPasses).not.toHaveBeenCalled();
      expect(defer.mock.calls[0]?.[0].buffer).toBeDefined();
      const deferred = defer.mock.results[0];
      expect(deferred?.type).toBe('return');
      expect(delay.mock.calls[0]?.[0].buffer).toBe(
        (deferred?.value as deferForward.DeferJsForwardResult | undefined)?.buffer
      );
      expect(result.lazyloadSimulation?.state).toBe('simulated');
      expect(result.deferSimulation?.state).toBe('simulated');
      expect(result.simulation?.state).toBe('simulated');
      // The runtime tag survives Delay JS (its list excludes it) and Defer JS (async).
      expect(result.html).toContain(
        `${LAZYLOAD_TEXTS.runtimeTagBeforeUrl}https://example.org/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js${LAZYLOAD_TEXTS.runtimeTagAfterUrl}`
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('runs no later feature inside LazyLoad’s step', () => {
    // Without its lists, Defer JS throws — only once its own step runs.
    const stage = simulationStage(input(['lazyload', 'defer_all_js'], { deferLists: undefined }));
    const lazy = stage.steps[0]?.apply(PAGE);
    expect(lazy?.report).toMatchObject({ feature: 'lazyload', state: 'simulated' });
    expect(() => stage.steps[1]?.apply(lazy?.html ?? '')).toThrow(/lacks its lists/);
  });

  it('names the feature that overran the budget, not LazyLoad', () => {
    let clock = 0;
    const defer = vi
      .spyOn(deferForward, 'simulateDeferJs')
      .mockImplementation((given: deferForward.DeferJsForwardInput) => {
        clock = 10_000;
        return { html: given.html, report: { state: 'not-applicable', deferred: 0, wrapped: 0 } };
      });
    try {
      const result = runDocumentPipeline(
        {
          html: PAGE,
          set: EMPTY_EXCLUSION_SET,
          budgetMs: 2_000,
          simulate: input(['lazyload', 'defer_all_js', 'delay_js'])
        },
        () => clock
      );
      expect(result).toMatchObject({
        ok: false,
        outcome: { outcome: 'over-budget', feature: 'defer_all_js', stage: 'simulate' }
      });
    } finally {
      defer.mockRestore();
    }
  });

  it('swaps in the rerun’s reports when Delay JS would delay LazyLoad’s scripts', () => {
    const withLazyload = { ...input(['lazyload', 'defer_all_js', 'delay_js']), listRows: [] };
    const result = run(PAGE, withLazyload);
    expect(result.lazyloadSimulation).toMatchObject({
      state: 'not-applicable',
      unreproducedRegex: 'lazyload-injected-scripts',
      images: 0
    });
    // The rerun on the served page: exactly the run without LazyLoad.
    const without = run(PAGE, { ...withLazyload, features: ['defer_all_js', 'delay_js'] });
    expect(result.html).toBe(without.html);
    expect(result.deferSimulation).toEqual(without.deferSimulation);
    expect(result.simulation).toEqual(without.simulation);
    expect(result.simulation).toMatchObject({ state: 'simulated', delayed: 1 });
  });

  it(
    'composes the three features linearly, each pass once: near LazyLoad alone',
    () => {
      const block = (index: number): string =>
        `<img src="/i${String(index)}.jpg" width="10" height="10">\n` +
        (index % 20 === 0
          ? `<script src="/wp-content/plugins/x/s${String(index)}.js"></script><script>var v${String(index)}=1;</script>\n`
          : '');
      const page = (bytes: number): string => {
        let body = '';
        for (let index = 0; body.length < bytes; index++) body += block(index);
        return `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;
      };
      const staged = (features: DocumentSimulationInput['features']) => (html: string) =>
        composeSteps(html, simulationStage(input(features)).steps);
      const composed = linearScaling(page, staged(['lazyload', 'defer_all_js', 'delay_js']));
      expect(composed.violation).toBeUndefined();
      const reports = composed.output?.completed === true ? composed.output.reports : [];
      expect(reports.map((report) => report.state)).toEqual([
        'simulated',
        'simulated',
        'simulated'
      ]);
      // Measured at 4 MiB (≈ 93 000 images): LazyLoad alone 0.43 s, all three 0.59 s (×1.4;
      // ×2.7 when the later features reran LazyLoad's pass). Ratio only: no absolute ceiling
      // (machine-dependent; the runtime over-budget outcome enforces the budget).
      const alone = linearScaling(page, staged(['lazyload']));
      expect(composed.largeMs / alone.largeMs).toBeLessThan(2);
    },
    2 * LINEAR_SCALING_TIMEOUT_MS
  );

  it('writes one marker naming every simulated feature, LazyLoad first', () => {
    const markerId = '0123456789abcdef0123456789abcdef';
    const result = run(PAGE, input(['lazyload', 'delay_js'], { markerId }));
    expect(result.html).toContain(
      `<meta name="${SIMULATION_MARKER_META_NAME}" content="v1 lazyload=simulated delay_js=simulated id=${markerId}">`
    );
    expect(result.lazyloadSimulation?.markerId).toBe(markerId);
  });

  it('throws without its inputs (the input guard refuses that request)', () => {
    const stage = simulationStage(input(['lazyload'], { lazyload: undefined }));
    expect(() => stage.steps[0]?.apply(PAGE)).toThrow(/lacks its texts/);
  });
});
