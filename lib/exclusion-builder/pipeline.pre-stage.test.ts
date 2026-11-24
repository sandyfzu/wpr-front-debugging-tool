/**
 * `runExclusionPipeline`'s pre-exclusion stage: its steps run first (seen
 * by the hooks with `stage: 'simulate'`), the exclusion steps act on their
 * output, its `finish` runs after the builder marker; without a stage the
 * run is exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { applyPipeline, runExclusionPipeline, type PreExclusionStage } from './pipeline';
import { EXCLUSION_PIPELINE_STEP_IDS } from './pipeline-steps';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';

const SET: ExclusionSet = {
  rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['a\\.js'] },
  disable: EMPTY_EXCLUSION_SET.disable
};

const SERVED = '<html><head></head><body><script src="/a.js"></script></body></html>';
const DELAYED =
  '<html><head></head><body><script type="rocketlazyloadscript" data-rocket-src="/a.js"></script></body></html>';

/** A stage whose one step turns the served page into the delayed one, recording `finish`. */
function stage(finished: string[] = []): PreExclusionStage<string> {
  return {
    steps: [
      { id: 'delay_js', apply: (html) => ({ html: html.replace(SERVED, DELAYED), report: 'r1' }) }
    ],
    finish: (html, reports) => {
      finished.push(html);
      return { html: `${html}<!--done-->`, reports: [...reports, 'finished'] };
    }
  };
}

describe('runExclusionPipeline — pre-exclusion stage', () => {
  it('runs the exclusion steps on the stage’s output, then finish after the builder marker', () => {
    const finished: string[] = [];
    const run = runExclusionPipeline(SERVED, SET, { pre: stage(finished) });
    const real = applyPipeline(DELAYED, SET);
    expect(finished).toEqual([real.html]);
    expect(run).toEqual({
      completed: true,
      html: `${real.html}<!--done-->`,
      reports: real.reports,
      simulation: ['r1', 'finished']
    });
  });

  it('shows hooks each pre-step with stage simulate before the exclusion steps', () => {
    const calls: string[] = [];
    runExclusionPipeline(SERVED, SET, {
      pre: stage(),
      onStepStart: (id, stage) => calls.push(`start:${id}:${stage ?? '-'}`),
      stopAfter: (id, stage) => {
        calls.push(`after:${id}:${stage ?? '-'}`);
        return false;
      }
    });
    expect(calls).toEqual([
      'start:delay_js:simulate',
      'after:delay_js:simulate',
      ...EXCLUSION_PIPELINE_STEP_IDS.flatMap((id) => [`start:${id}:-`, `after:${id}:-`])
    ]);
  });

  it('stops at a pre-step with stage simulate, running no exclusion step nor finish', () => {
    const finished: string[] = [];
    const started: string[] = [];
    const run = runExclusionPipeline(SERVED, SET, {
      pre: stage(finished),
      onStepStart: (id) => started.push(id),
      stopAfter: (_id, stage) => stage === 'simulate'
    });
    expect(run).toEqual({ completed: false, stoppedAt: 'delay_js', stage: 'simulate' });
    expect(started).toEqual(['delay_js']);
    expect(finished).toEqual([]);
  });

  it('names no stage when an exclusion step after a stage stops the run', () => {
    let after = 0;
    const run = runExclusionPipeline(SERVED, SET, { pre: stage(), stopAfter: () => ++after === 2 });
    expect(run).toEqual({ completed: false, stoppedAt: EXCLUSION_PIPELINE_STEP_IDS[0] });
  });

  it('validates the set before any pre-step runs', () => {
    const started: string[] = [];
    const bad = { ...SET, rows: { ...SET.rows, delayJs: ['(bad['] } };
    expect(() =>
      runExclusionPipeline(SERVED, bad, { pre: stage(), onStepStart: (id) => started.push(id) })
    ).toThrow();
    expect(started).toEqual([]);
  });

  it('without a stage: no simulation field, the run as before', () => {
    expect(runExclusionPipeline(SERVED, SET)).toEqual({
      completed: true,
      ...applyPipeline(SERVED, SET)
    });
  });
});
