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
import { delayJsTransform, delayJsTransformAfterInlinePass } from './delay-js';
import { deferJsTransform, deferJsTransformAfterInlinePass } from './defer-js';
import { replayInlinePass, type InlinePassReplay } from './defer-inline-js';
import { lazyloadTransform } from './lazyload';
import { lazyRenderTransform } from './lazy-render';
import { ExclusionValidationError } from './errors';
import { prevalidateExclusionSet } from './validate';
import type { DocumentBytes } from './libxml/charset';
import { EXCLUSION_FEATURES, type ExclusionFeatureId, type ExclusionSet } from './set';
import type { TransformReport, TransformResult } from './report';

/** One composition step: a named transform over the html so far. */
export interface PipelineStep<R, Id extends string = string> {
  readonly id: Id;
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

/**
 * One feature's transform: the served html + the set (+ how the session
 * decoded the page, which only transforms that rebuild WP Rocket's
 * byte-level view read) → its result.
 */
type FeatureTransform = (
  servedHtml: string,
  set: ExclusionSet,
  bytes?: DocumentBytes
) => TransformResult;

/** One feature's slice of the pipeline: its transform, keyed by id. */
interface FeatureEntry {
  readonly id: ExclusionFeatureId;
  readonly transform: FeatureTransform;
}

/**
 * Feature id → transform. The execution order is owned by the set registry
 * (`EXCLUSION_FEATURES` — the one declaring site); this table only binds
 * each feature to its operation, so adding a feature cannot fork the order.
 */
const FEATURE_TRANSFORMS: Record<ExclusionFeatureId, FeatureTransform> = {
  delay_js: delayJsTransform,
  defer_all_js: deferJsTransform,
  lazyload: lazyloadTransform,
  automatic_lazy_rendering: lazyRenderTransform
};

/**
 * The transforms that read the Defer JS inline pass, in their form for a
 * page the pipeline already replayed it on (see {@link exclusionPipelineSteps}).
 */
const AFTER_INLINE_PASS: Partial<
  Record<
    ExclusionFeatureId,
    (html: string, set: ExclusionSet, inline: InlinePassReplay) => TransformResult
  >
> = {
  delay_js: delayJsTransformAfterInlinePass,
  defer_all_js: deferJsTransformAfterInlinePass
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
 * One exclusion-pipeline step, keyed by the feature whose work it does: a
 * feature's transform (its report), or the Defer JS inline-pass replay
 * (no report of its own — Defer JS reports it).
 */
export type ExclusionPipelineStep = PipelineStep<TransformReport | null, ExclusionFeatureId>;

/** The feature whose work the inline-pass replay is (WP Rocket's Defer JS). */
const INLINE_PASS_FEATURE: ExclusionFeatureId = 'defer_all_js';

/**
 * The ids of {@link exclusionPipelineSteps}' steps, in execution order: the
 * inline-pass replay (as Defer JS), then the features.
 */
export const EXCLUSION_PIPELINE_STEP_IDS: readonly ExclusionFeatureId[] = [
  INLINE_PASS_FEATURE,
  ...EXCLUSION_PIPELINE_IDS
];

/**
 * The exclusion pipeline's steps for one set, in execution order — what
 * {@link applyPipeline} composes. Exposed for consumers that must observe
 * the run step by step (e.g. to bound its wall time between steps and name
 * the feature that overran); they must prevalidate the set first, exactly
 * as `applyPipeline` does, or a step throws its feature's validation error
 * mid-run.
 *
 * WP Rocket's Defer JS inline-jQuery pass ran after its deferral and before
 * Delay JS, so the first step replays it on the served page (before any
 * restore splits identical wrapped copies), under Defer JS's id; the
 * feature steps follow in the declared order, the Delay and Defer ones
 * reading that replay. Run alone, a feature step does its own replay.
 *
 * @param set The exclusion set every step reads.
 * @param bytes How the session decoded the page, when known (Automatic Lazy
 *   Rendering rebuilds libxml's reading of the bytes from it).
 * @returns The replay step, then one step per feature in pipeline order.
 */
export function exclusionPipelineSteps(
  set: ExclusionSet,
  bytes?: DocumentBytes
): readonly ExclusionPipelineStep[] {
  let inline: InlinePassReplay | null = null;
  const replay: ExclusionPipelineStep = {
    id: INLINE_PASS_FEATURE,
    apply: (html: string) => {
      inline = replayInlinePass(html, set);
      return { html: inline.html, report: null };
    }
  };
  const features = FEATURE_PIPELINE.map((entry): ExclusionPipelineStep => ({
    id: entry.id,
    apply: (html: string) => {
      const afterReplay = AFTER_INLINE_PASS[entry.id];
      const result =
        afterReplay !== undefined && inline !== null
          ? afterReplay(html, set, inline)
          : entry.transform(html, set, bytes);
      return { html: result.html, report: result.report };
    }
  }));
  return [replay, ...features];
}

/**
 * The reports a composition collected, without the steps that report
 * nothing (the inline-pass replay): one per feature, in pipeline order.
 *
 * @param reports Every step's report, in step order.
 */
export function featureReports(
  reports: readonly (TransformReport | null)[]
): readonly TransformReport[] {
  return reports.filter((report): report is TransformReport => report !== null);
}

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
  const composed = composeSteps(html, exclusionPipelineSteps(set));
  return { html: composed.html, reports: featureReports(composed.reports) };
}
