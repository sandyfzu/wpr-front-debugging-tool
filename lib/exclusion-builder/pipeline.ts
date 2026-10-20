/**
 * The exclusion pipeline: the four transforms composed in their one
 * declared order, plus the generic composition seam a session backend (or
 * a later tester mode) plugs other operations into. `applyPipeline` is the
 * engine's front door: served html + exclusion set → rewritten html and a
 * combined per-transform report for UI/status consumption.
 */
import { delayJsTransform } from './delay-js';
import { deferJsTransform } from './defer-js';
import { lazyloadTransform } from './lazyload';
import { lazyRenderTransform } from './lazy-render';
import { ExclusionValidationError } from './errors';
import { prevalidateExclusionSet } from './validate';
import type { TransformReport, TransformResult } from './report';
import type { ExclusionFeatureId, ExclusionSet } from './set';

/** One composition step: a named transform over the html so far. */
export interface PipelineStep<R> {
  readonly id: string;
  apply: (html: string) => { readonly html: string; readonly report: R };
}

/** The composition's output: the fully rewritten html plus every step's report, in step order. */
export interface CompositionOutput<R> {
  readonly html: string;
  readonly reports: readonly R[];
}

/**
 * Compose steps left-to-right: each step consumes its predecessor's html,
 * and every report is collected in step order — the mechanics any consumer
 * (the exclusion pipeline, a fixture tester) rides.
 *
 * @param html The input html.
 * @param steps The steps, in execution order.
 */
export function composeSteps<R>(
  html: string,
  steps: readonly PipelineStep<R>[]
): CompositionOutput<R> {
  let current = html;
  const reports: R[] = [];
  for (const step of steps) {
    const result = step.apply(current);
    current = result.html;
    reports.push(result.report);
  }
  return { html: current, reports };
}

/** One feature's slice of the pipeline: its transform, keyed by id. */
interface FeatureEntry {
  readonly id: ExclusionFeatureId;
  readonly transform: (servedHtml: string, set: ExclusionSet) => TransformResult;
}

/**
 * The four transforms in their one declared execution order: Delay JS
 * first (its restore reclaims `src`, which the Defer matcher then reads as
 * the effective URL), then Defer JS, then the two markup features. Adding
 * a feature = one row here + its transform module.
 */
const FEATURE_PIPELINE: readonly FeatureEntry[] = [
  { id: 'delay_js', transform: delayJsTransform },
  { id: 'defer_all_js', transform: deferJsTransform },
  { id: 'lazyload', transform: lazyloadTransform },
  { id: 'automatic_lazy_rendering', transform: lazyRenderTransform }
];

/** The pipeline's execution order, for consumers that display it. */
export const EXCLUSION_PIPELINE_IDS: readonly ExclusionFeatureId[] = FEATURE_PIPELINE.map(
  (entry) => entry.id
);

/**
 * The exclusion pipeline: validate the whole set up front (every invalid
 * row named at once, before anything runs), then apply the four transforms
 * in their declared order.
 *
 * Each transform rescans the (linear) document, so the whole pipeline stays
 * linear in the document size times the feature count; pattern compilation
 * is memoized across calls.
 *
 * @param html The served document (decoded text — byte handling is the
 *   session backends' job, never the engine's).
 * @param set The exclusion set (rows + feature-wide disables).
 * @returns The rewritten html and one report per transform, in pipeline order.
 * @throws {@link ExclusionValidationError} naming every invalid row across
 *   every feature, before any transform runs.
 */
export function applyPipeline(html: string, set: ExclusionSet): CompositionOutput<TransformReport> {
  const problems = prevalidateExclusionSet(set);
  if (!problems.valid) throw new ExclusionValidationError(problems.invalid);
  const steps: PipelineStep<TransformReport>[] = FEATURE_PIPELINE.map((entry) => ({
    id: entry.id,
    apply: (stepHtml: string) => {
      const result = entry.transform(stepHtml, set);
      return { html: result.html, report: result.report };
    }
  }));
  return composeSteps(html, steps);
}
