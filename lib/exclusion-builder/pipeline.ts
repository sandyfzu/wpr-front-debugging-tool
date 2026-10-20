/**
 * The exclusion pipeline: the four transforms composed in their one
 * declared order (the set registry's — `EXCLUSION_FEATURES`), plus the
 * generic composition seam a session backend (or a later tester mode)
 * plugs other operations into. `applyPipeline` is the engine's front door:
 * served html + exclusion set → rewritten html and a combined per-transform
 * report for UI/status consumption.
 *
 * Consumers must bound the pipeline's wall time: rows are operator-provided
 * patterns, so a pathological one can run long — the engine stays pure and
 * unbounded by design; the session backend owns the budget (an overrun is
 * a typed session failure naming the offending feature/row, never a hung
 * navigation).
 */
import { delayJsTransform } from './delay-js';
import { deferJsTransform } from './defer-js';
import { lazyloadTransform } from './lazyload';
import { lazyRenderTransform } from './lazy-render';
import { ExclusionValidationError } from './errors';
import { prevalidateExclusionSet } from './validate';
import { EXCLUSION_FEATURES, type ExclusionFeatureId, type ExclusionSet } from './set';
import type { TransformReport, TransformResult } from './report';

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
 * Feature id → transform. The execution order is owned by the set registry
 * (`EXCLUSION_FEATURES` — the one declaring site); this table only binds
 * each feature to its operation, so adding a feature cannot fork the order.
 */
const FEATURE_TRANSFORMS: Record<
  ExclusionFeatureId,
  (servedHtml: string, set: ExclusionSet) => TransformResult
> = {
  delay_js: delayJsTransform,
  defer_all_js: deferJsTransform,
  lazyload: lazyloadTransform,
  automatic_lazy_rendering: lazyRenderTransform
};

/** The pipeline steps, derived from the registry's declared execution order. */
const FEATURE_PIPELINE: readonly FeatureEntry[] = EXCLUSION_FEATURES.map(({ id }) => ({
  id,
  transform: FEATURE_TRANSFORMS[id]
}));

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
