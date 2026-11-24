/**
 * The simulation stage's Defer JS step: its place in the registry order,
 * its report (counts, its own list provenance), no CSP check (no runtime),
 * the delay-served refusal; with both features, the page each outcome pair
 * serves (one buffer when both simulate, one feature's page when the other
 * does not) and the Delay JS step's CSP read against the document as
 * decoded.
 */
import { describe, expect, it } from 'vitest';
import { composeSteps } from '../exclusion-builder/pipeline';
import type { DocumentSimulationInput } from '../messaging/exclusion-simulation';
import { simulateDeferJs } from '../wp-rocket-simulation/defer-js-forward';
import { simulationStage, wireSimulationReport } from './simulation-stage';
import { simulationStepIds } from '../wp-rocket-simulation/spec';

const RUNTIME = 'RocketLazyLoadScripts.run();';

/** An input simulating the given features, Defer JS lists from the latest copy. */
function input(
  features: DocumentSimulationInput['features'],
  extra: Pick<DocumentSimulationInput, 'csp'> = {}
): DocumentSimulationInput {
  return {
    features,
    wpRocketVersion: '3.24.1',
    runtime: RUNTIME,
    fallback: 'if(0){}',
    listRows: [],
    listSource: 'bundled',
    listMiss: 'never-fetched',
    ...(features.includes('defer_all_js')
      ? {
          deferLists: {
            external: ['keep.js'],
            inline: ['keepInline'],
            listSource: 'latest',
            listFetchedAt: 7
          }
        }
      : {}),
    ...extra
  };
}

/** Run a stage's steps over a page. */
function run(html: string, simulate: DocumentSimulationInput) {
  const stage = simulationStage(simulate);
  const composition = composeSteps(html, stage.steps);
  if (!composition.completed) throw new Error('stopped');
  return composition;
}

const PAGE =
  '<html><head><script src="/a.js"></script><script src="/keep.js"></script></head>' +
  '<body><script>jQuery(go)</script><script>jQuery(keepInline)</script></body></html>';

describe('the Defer JS step', () => {
  it('runs first, as WP Rocket defers before it delays', () => {
    expect(simulationStepIds(['delay_js', 'defer_all_js'])).toEqual(['defer_all_js', 'delay_js']);
  });

  it('serves the forward transform’s page with its counts and its own list provenance', () => {
    const out = run(PAGE, input(['defer_all_js']));
    const forward = simulateDeferJs({
      html: PAGE,
      rows: [],
      lists: { external: ['keep.js'], inline: ['keepInline'] },
      inlineQuoteDelimiter: '/'
    });
    expect(out.html).toBe(forward.html);
    expect(out.reports).toEqual([
      {
        feature: 'defer_all_js',
        state: 'simulated',
        deferred: 1,
        wrapped: 1,
        wpRocketVersion: '3.24.1',
        listSource: 'latest',
        listFetchedAt: 7
      }
    ]);
  });

  it('is never CSP-checked: it injects no runtime', () => {
    const csp = {
      browser: 'chromium' as const,
      headers: [{ name: 'Content-Security-Policy', value: "script-src 'none'; sandbox" }],
      metas: []
    };
    const out = run(PAGE, input(['defer_all_js'], { csp }));
    expect(out.reports[0]).toMatchObject({ state: 'simulated', deferred: 1 });
    expect(out.reports[0]).not.toHaveProperty('cspLimits');
    expect(out.reports[0]).not.toHaveProperty('cspUnavailable');
    // Nor does an unevaluable policy reach its report: it never reads one.
    const unevaluable = run(PAGE, { ...input(['defer_all_js']), cspUnavailable: 'oversized' });
    expect(unevaluable.reports[0]).not.toHaveProperty('cspUnavailable');
  });

  it('refuses a page WP Rocket already delays, as is (delay-js-served)', () => {
    const delayed =
      '<html><head></head><body><script type="rocketlazyloadscript" data-rocket-src="/a.js"></script></body></html>';
    const out = run(delayed, input(['defer_all_js']));
    expect(out.html).toBe(delayed);
    expect(out.reports[0]).toEqual({
      feature: 'defer_all_js',
      state: 'not-applicable',
      reason: 'delay-js-served',
      deferred: 0,
      wrapped: 0,
      wpRocketVersion: '3.24.1',
      listSource: 'latest',
      listFetchedAt: 7
    });
  });

  it('reports zero counts on a page that already defers', () => {
    const deferring =
      '<html><head><script src="/a.js" data-rocket-defer defer></script></head></html>';
    const out = run(deferring, input(['defer_all_js']));
    expect(out.reports[0]).toMatchObject({ state: 'already-served', deferred: 0, wrapped: 0 });
  });

  it('throws on an input without its lists (the input guard refuses it first)', () => {
    const bare: DocumentSimulationInput = { ...input(['delay_js']), features: ['defer_all_js'] };
    expect(() => run(PAGE, bare)).toThrow(/lacks its lists/);
  });
});

describe('the Delay JS step after Defer JS', () => {
  it('reads CSP meta offsets against the document as decoded, not the deferred page', () => {
    // A script before <head…> moves `<head>` right once deferred; the meta
    // right after it would then read as before the runtime and block it.
    const page =
      '<script src="/early.js"></script><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"></head><body></body></html>';
    const offset = page.indexOf('<meta');
    const csp = {
      browser: 'chromium' as const,
      headers: [],
      metas: [{ content: "script-src 'self'", offset }]
    };
    const both = run(page, input(['defer_all_js', 'delay_js'], { csp }));
    expect(both.reports.map((report) => report.state)).toEqual(['simulated', 'simulated']);
  });

  it('carries no Defer JS counts on its report', () => {
    const out = run(PAGE, input(['defer_all_js', 'delay_js']));
    expect(out.reports[1]).toMatchObject({ feature: 'delay_js', state: 'simulated' });
    expect(out.reports[1]).not.toHaveProperty('deferred');
    expect(out.reports[1]).toMatchObject({ listSource: 'bundled', listMiss: 'never-fetched' });
  });
});

describe('both features: the page per outcome pair', () => {
  const blocking = {
    browser: 'chromium' as const,
    headers: [{ name: 'Content-Security-Policy', value: "script-src 'none'" }],
    metas: []
  };
  const deferOnly = (html: string) =>
    simulateDeferJs({
      html,
      rows: [],
      lists: { external: ['keep.js'], inline: ['keepInline'] },
      inlineQuoteDelimiter: '/'
    });

  it('serves Defer JS’s page when Delay JS is csp-blocked', () => {
    const out = run(PAGE, input(['defer_all_js', 'delay_js'], { csp: blocking }));
    expect(out.reports.map((report) => report.state)).toEqual(['simulated', 'csp-blocked']);
    expect(out.html).toBe(deferOnly(PAGE).html);
  });

  it('serves Defer JS’s page when Delay JS is beyond exact reproduction', () => {
    const page = PAGE.replace('</body>', `${'<svg>'.repeat(200_000)}</body>`);
    const out = run(page, input(['defer_all_js', 'delay_js']));
    expect(out.reports.map((report) => report.state)).toEqual(['simulated', 'not-applicable']);
    expect(out.reports[1]).toMatchObject({ reason: 'beyond-exact-reproduction' });
    expect(out.html).toBe(deferOnly(page).html);
  });

  it('serves Delay JS’s page alone when Defer JS is beyond exact reproduction', () => {
    const page = PAGE.replace('</body>', `<!--${'x'.repeat(600_000)}</body>`);
    const out = run(page, input(['defer_all_js', 'delay_js']));
    expect(out.reports.map((report) => report.state)).toEqual(['not-applicable', 'simulated']);
    expect(out.html).toBe(run(page, input(['delay_js'])).html);
  });

  it('serves Delay JS’s page alone on a page that already defers', () => {
    const page = PAGE.replace(
      '</body>',
      '<script src="/x.js" data-rocket-defer defer></script></body>'
    );
    const out = run(page, input(['defer_all_js', 'delay_js']));
    expect(out.reports.map((report) => report.state)).toEqual(['already-served', 'simulated']);
    expect(out.html).toBe(run(page, input(['delay_js'])).html);
  });
});

describe('the Defer JS step under stored rows', () => {
  /** `count` distinct stored rows of 30 characters. */
  const stored = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      `s${String(index).padStart(5, '0')}`.padEnd(30, 'x')
    );

  /** The stage's reports on PAGE with these stored Defer JS rows. */
  const reports = (rows: readonly string[]) => {
    const stage = simulationStage(input(['defer_all_js', 'delay_js']), undefined, rows);
    const composition = composeSteps(PAGE, stage.steps);
    if (!composition.completed) throw new Error('stopped');
    return composition;
  };

  it('simulates when the rows leave the file pre-check as the list sets it', () => {
    const out = reports(['/a.js', 'other']);
    expect(out.reports.map((report) => report.state)).toEqual(['simulated', 'simulated']);
    expect(out.html).toBe(run(PAGE, input(['defer_all_js', 'delay_js'])).html);
  });

  it('refuses when the rows grow the join past what can be told (2 000 × 30: WP Rocket defers nothing)', () => {
    const out = reports(stored(2000));
    expect(out.reports[0]).toMatchObject({
      state: 'not-applicable',
      reason: 'beyond-exact-reproduction',
      unreproducedRegex: 'defer-file-exclusions',
      deferred: 0,
      wrapped: 0
    });
    // Delay JS then runs alone, on the page as served.
    expect(out.reports[1]).toMatchObject({ state: 'simulated' });
    expect(out.html).toBe(run(PAGE, input(['delay_js'])).html);
  });
});

describe('wireSimulationReport per feature', () => {
  it('wires a Defer JS report without Delay JS’s fields, its counts zeroed off `simulated`', () => {
    const simulate = { ...input(['defer_all_js']), cspUnavailable: 'oversized' as const };
    const report = wireSimulationReport(
      'defer_all_js',
      { state: 'already-served', deferred: 3, wrapped: 1 },
      simulate
    );
    expect(report).toEqual({
      feature: 'defer_all_js',
      state: 'already-served',
      deferred: 0,
      wrapped: 0,
      wpRocketVersion: '3.24.1',
      listSource: 'latest',
      listFetchedAt: 7
    });
  });

  it('refuses a step’s report of another feature (a broken invariant)', () => {
    const deferReport = { state: 'simulated' as const, deferred: 0, wrapped: 0 };
    expect(() =>
      wireSimulationReport('delay_js', deferReport as never, input(['delay_js']), [])
    ).toThrow(/another feature's report/);
  });
});
