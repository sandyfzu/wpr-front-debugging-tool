/**
 * The document step with a simulation: the request's simulation runs before
 * the exclusions under the same budget (an overrun names `stage:
 * 'simulate'`) on both engine paths, and the host's preparation decides
 * `runtime-unavailable` before any engine runs.
 */
import { describe, expect, it } from 'vitest';
import { applyPipeline } from '../exclusion-builder/pipeline';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../exclusion-builder/set';
import type { DocumentSimulationInput } from '../messaging/exclusion-simulation';
import { simulateDelayJs } from '../wp-rocket-simulation/delay-js-forward';
import {
  createInProcessTransformRunner,
  overrunRow,
  rewriteDocument,
  runDocumentPipeline,
  type DocumentTransformRequest,
  type DocumentTransformRunner
} from './document-transform';
import type { SimulationPreparer } from './simulation-sources';
import { createWorkerTransformRunner, handleTransformWorkerMessage } from './transform-worker';

const SET: ExclusionSet = {
  rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['b\\.js'] },
  disable: EMPTY_EXCLUSION_SET.disable
};

const PAGE =
  '<!DOCTYPE html><html><head><title>t</title></head><body><script src="/a.js"></script><script src="/b.js"></script></body></html>';

const SIMULATION: DocumentSimulationInput = {
  features: ['delay_js'],
  wpRocketVersion: '3.24',
  runtime: '/*runtime*/RocketLazyLoadScripts.run();',
  fallback:
    'if(navigator.userAgent.match(/MSIE|Trident/i)){document.location.href+="?nowprocket=1"}',
  listRows: [],
  listSource: 'bundled',
  listMiss: 'never-fetched'
};

/** The page WP Rocket would serve with Delay JS on (the forward step alone). */
const DELAY_ON = simulateDelayJs({
  html: PAGE,
  runtime: SIMULATION.runtime,
  ieFallback: SIMULATION.fallback,
  listRows: [],
  rows: []
}).html;

const REQUEST: DocumentTransformRequest = {
  html: PAGE,
  set: SET,
  budgetMs: 100,
  simulate: SIMULATION
};

/** A clock answering `readings` in order, then the last one. */
function clock(...readings: number[]): () => number {
  let index = 0;
  return () => readings[Math.min(index++, readings.length - 1)] ?? 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('runDocumentPipeline with a simulation', () => {
  it('simulates first, then the exclusions act on the simulated page; the report rides along', () => {
    const result = runDocumentPipeline(REQUEST, clock(0));
    const real = applyPipeline(DELAY_ON, SET);
    expect(result).toEqual({
      ok: true,
      html: real.html,
      outcome: {
        outcome: 'rewritten',
        reports: real.reports,
        simulation: {
          feature: 'delay_js',
          state: 'simulated',
          delayed: 2,
          runtimeInjected: true,
          wpRocketVersion: '3.24',
          listSource: 'bundled',
          listMiss: 'never-fetched'
        }
      }
    });
  });

  it('announces the simulation step (stage simulate) before the exclusion steps', () => {
    const started: string[] = [];
    runDocumentPipeline(REQUEST, clock(0), (feature, stage) =>
      started.push(`${feature}:${stage ?? '-'}`)
    );
    expect(started[0]).toBe('delay_js:simulate');
    expect(started.slice(1).every((entry) => entry.endsWith(':-'))).toBe(true);
  });

  it('names stage simulate (no row) when the simulation step crosses the budget', () => {
    // Readings: start, then the simulation step's end crosses the budget.
    expect(runDocumentPipeline(REQUEST, clock(0, 101))).toEqual({
      ok: false,
      outcome: {
        outcome: 'over-budget',
        feature: 'delay_js',
        row: null,
        budgetMs: 100,
        stage: 'simulate'
      }
    });
  });

  it('bills a later exclusion step’s overrun to that step (the budget is cumulative)', () => {
    // The simulation ends at 60, the first exclusion step (Defer JS's replay) at 101.
    expect(runDocumentPipeline(REQUEST, clock(0, 60, 101))).toEqual({
      ok: false,
      outcome: {
        outcome: 'over-budget',
        feature: 'defer_all_js',
        row: overrunRow(SET, 'defer_all_js'),
        budgetMs: 100
      }
    });
  });

  it('runs identically in the worker (the request crossing its guard)', () => {
    const posted: unknown[] = [];
    handleTransformWorkerMessage(
      structuredClone({ type: 'transform', id: 7, request: REQUEST }),
      (message) => posted.push(message),
      () => 0
    );
    expect(posted[0]).toEqual({ type: 'step', id: 7, feature: 'delay_js', stage: 'simulate' });
    expect(posted.at(-1)).toEqual({
      type: 'result',
      id: 7,
      result: runDocumentPipeline(REQUEST, clock(0))
    });
  });

  it('the worker detects its own simulation overrun with the stage', () => {
    const posted: unknown[] = [];
    handleTransformWorkerMessage(
      { type: 'transform', id: 1, request: REQUEST },
      (message) => posted.push(message),
      clock(0, 101)
    );
    expect(posted.at(-1)).toMatchObject({
      type: 'result',
      result: { ok: false, outcome: { outcome: 'over-budget', stage: 'simulate', row: null } }
    });
  });

  it('a worker killed before any announcement bills the simulation step', async () => {
    let fire: () => void = () => undefined;
    const host = createWorkerTransformRunner({
      spawn: () => ({
        postMessage: () => undefined,
        terminate: () => undefined,
        onmessage: null,
        onerror: null
      }),
      schedule: (run) => {
        fire = run;
        return () => undefined;
      }
    });
    const pending = host.run(REQUEST);
    fire();
    await expect(pending).resolves.toEqual({
      ok: false,
      outcome: {
        outcome: 'over-budget',
        feature: 'delay_js',
        row: null,
        budgetMs: 100,
        stage: 'simulate'
      }
    });
  });
});

/** An intercepted UTF-8 document. */
function document(html: string, contentType = 'text/html; charset=utf-8') {
  return { body: encoder.encode(html), contentType };
}

/** A preparer answering `prepared`, recording the text it was handed. */
function preparer(
  prepared: Awaited<ReturnType<SimulationPreparer>>,
  seen: string[] = []
): SimulationPreparer {
  return (html) => {
    seen.push(html);
    return Promise.resolve(prepared);
  };
}

describe('rewriteDocument with a simulation', () => {
  it('prepares on the decoded text and serves the simulated, excluded page', async () => {
    const seen: string[] = [];
    const runner = createInProcessTransformRunner(clock(0));
    const rewrite = await rewriteDocument(
      document(PAGE),
      SET,
      runner,
      100,
      preparer({ ok: true, input: SIMULATION }, seen)
    );
    expect(seen).toEqual([PAGE]);
    expect(decoder.decode(rewrite.body ?? new Uint8Array())).toBe(
      applyPipeline(DELAY_ON, SET).html
    );
    expect(rewrite.outcome).toMatchObject({
      outcome: 'rewritten',
      simulation: { state: 'simulated', delayed: 2 }
    });
  });

  it('serves the page unchanged as runtime-unavailable without running the engine', async () => {
    const calls: DocumentTransformRequest[] = [];
    const runner: DocumentTransformRunner = (request) => {
      calls.push(request);
      return createInProcessTransformRunner()(request);
    };
    const rewrite = await rewriteDocument(
      document(PAGE),
      SET,
      runner,
      100,
      preparer({ ok: false, cause: 'asset-unreachable' })
    );
    expect(calls).toEqual([]);
    expect(rewrite).toEqual({
      outcome: { outcome: 'runtime-unavailable', cause: 'asset-unreachable' },
      body: null
    });
  });

  it('still removes the speculation rules of a runtime-unavailable page (a session effect)', async () => {
    const rules = '<script type="speculationrules">{"prerender":[]}</script>';
    const rewrite = await rewriteDocument(
      document(`${PAGE}${rules}`),
      SET,
      createInProcessTransformRunner(),
      100,
      preparer({ ok: false, cause: 'hash-mismatch' })
    );
    expect(rewrite.outcome).toEqual({ outcome: 'runtime-unavailable', cause: 'hash-mismatch' });
    expect(decoder.decode(rewrite.body ?? new Uint8Array())).toBe(PAGE);
    expect(rewrite).toMatchObject({ speculationRulesRemoved: 1, rulesOnly: true });
  });

  it('answers engine-failed (cause kept) when the preparer throws', async () => {
    const cause = new Error('broken source');
    const rewrite = await rewriteDocument(
      document(PAGE),
      SET,
      createInProcessTransformRunner(),
      100,
      () => Promise.reject(cause)
    );
    expect(rewrite).toEqual({
      outcome: { outcome: 'failed', reason: 'engine-failed' },
      body: null,
      cause
    });
  });

  it('hands the engine the charset: non-ASCII text in windows-1252 is not simulated', async () => {
    const latin = PAGE.replace('<title>t</title>', '<title>café</title>');
    const body = Uint8Array.from(latin, (char) => char.charCodeAt(0));
    const rewrite = await rewriteDocument(
      { body, contentType: 'text/html; charset=windows-1252' },
      SET,
      createInProcessTransformRunner(),
      100,
      preparer({ ok: true, input: SIMULATION })
    );
    expect(rewrite.outcome).toMatchObject({
      outcome: 'rewritten',
      simulation: { state: 'not-applicable', reason: 'unsupported-charset' }
    });
  });

  it('without a preparer: exactly the run without simulation', async () => {
    const runner = createInProcessTransformRunner(clock(0));
    const plain = await rewriteDocument(document(PAGE), SET, runner, 100);
    expect(plain.outcome).toEqual({
      outcome: 'rewritten',
      reports: applyPipeline(PAGE, SET).reports
    });
  });
});
