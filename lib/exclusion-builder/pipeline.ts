/**
 * The exclusion pipeline: the four transforms composed in their one
 * declared order (the set registry's — `EXCLUSION_FEATURES`), plus the
 * generic composition seam a session backend (or a later tester mode)
 * plugs other operations into. `runExclusionPipeline` is the engine's one path:
 * served html + exclusion set → rewritten html and a combined per-transform
 * report for UI/status consumption. After the feature steps, the final
 * step (`markBuilderEffects`) leaves the builder marker stating what they
 * changed.
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
import { markBuilderEffects } from './builder-marker-write';
import { ExclusionValidationError, type InvalidExclusionRow } from './errors';
import { notStoredRows } from './field-text';
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
 * The exclusion pipeline's feature steps for one set, in execution order —
 * what {@link runExclusionPipeline} runs before its final marker step (no
 * feature's work, so not one of these keyed, per-feature steps). Hosts
 * that observe a run step by step use that function's hooks; a direct
 * caller must check {@link pipelineSetProblems} first, as it does, or a
 * step throws its feature's validation error mid-run (or reads rows WP
 * Rocket would never run).
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
 * Why a set cannot run, before anything runs: its rows outside WP Rocket's
 * stored form (the transforms read rows as WP Rocket stored them — deduped,
 * sanitized; two identical named-group Defer rows, which WP Rocket would
 * dedupe, would otherwise read as a page-wide failure), else every blocking
 * row problem. Empty when the set can run.
 *
 * @param set The exclusion set.
 * @returns The offending rows (all of them, never first-only).
 */
export function pipelineSetProblems(set: ExclusionSet): readonly InvalidExclusionRow[] {
  const notStored = notStoredRows(set);
  return notStored.length > 0 ? notStored : prevalidateExclusionSet(set).invalid;
}

/** Optional hooks a bounded host passes to {@link runExclusionPipeline}. */
export interface PipelineRunHooks {
  /** How the session decoded the page, when known (see {@link exclusionPipelineSteps}). */
  readonly bytes?: DocumentBytes;
  /** Called with each step's feature as the step starts. */
  readonly onStepStart?: (feature: ExclusionFeatureId) => void;
  /**
   * Called with each step's feature after the step ran: `true` discards its
   * output and stops the run there (a host's budget check between steps).
   */
  readonly stopAfter?: (feature: ExclusionFeatureId) => boolean;
}

/**
 * One pipeline run: completed (rewritten html, marker step included, and
 * one report per feature), or stopped by the host after a step.
 */
export type PipelineRun =
  | ({ readonly completed: true } & CompositionOutput<TransformReport>)
  | { readonly completed: false; readonly stoppedAt: ExclusionFeatureId };

/**
 * The exclusion pipeline, the one path every caller runs: validate the
 * whole set up front (every invalid row named at once, before anything
 * runs: {@link pipelineSetProblems}), then the steps of
 * {@link exclusionPipelineSteps} in order, then the final step: the
 * builder marker for what they changed (`markBuilderEffects`). The marker
 * step is no feature's work (no feature to stop at), so `stopAfter` never
 * sees it: it is one linear scan of the document.
 *
 * Each transform rescans the (linear) document, so the whole pipeline stays
 * linear in the document size times the feature count; pattern compilation
 * is memoized across calls.
 *
 * @param html The served document (decoded text; byte handling is the
 *   session backends' job, never the engine's).
 * @param set The exclusion set (rows + feature-wide disables).
 * @param hooks Decoding facts and the host's step hooks.
 * @returns The completed run, or where the host stopped it.
 * @throws {@link ExclusionValidationError} naming every row outside the
 *   stored form, else every invalid row, before any step runs.
 */
export function runExclusionPipeline(
  html: string,
  set: ExclusionSet,
  hooks: PipelineRunHooks = {}
): PipelineRun {
  const problems = pipelineSetProblems(set);
  if (problems.length > 0) throw new ExclusionValidationError(problems);
  let current = html;
  const reports: TransformReport[] = [];
  for (const step of exclusionPipelineSteps(set, hooks.bytes)) {
    hooks.onStepStart?.(step.id);
    const result = step.apply(current);
    if (hooks.stopAfter?.(step.id) === true) return { completed: false, stoppedAt: step.id };
    current = result.html;
    if (result.report !== null) reports.push(result.report);
  }
  return { completed: true, html: markBuilderEffects(current, reports), reports };
}

/**
 * {@link runExclusionPipeline} unbounded (no hooks, so it always
 * completes): served html + set → rewritten html and one report per
 * feature, in pipeline order.
 *
 * @param html The served document (decoded text).
 * @param set The exclusion set.
 * @returns The rewritten html and the feature reports.
 * @throws {@link ExclusionValidationError} as {@link runExclusionPipeline}.
 */
export function applyPipeline(html: string, set: ExclusionSet): CompositionOutput<TransformReport> {
  const run = runExclusionPipeline(html, set);
  // Unreachable: without a `stopAfter` hook nothing stops the run.
  if (!run.completed) throw new Error(`[WPR FDT] unbounded pipeline stopped at ${run.stoppedAt}`);
  return { html: run.html, reports: run.reports };
}
