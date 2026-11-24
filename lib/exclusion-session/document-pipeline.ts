/**
 * The engine run itself: the exclusion pipeline (after the simulation
 * stage, when a request simulates) under the request's wall-time budget.
 * Imported only where the engine runs — the in-process runner a backend
 * row picks for its thread, or the worker that hosts it — never by the
 * document step or a worker's host, so a bundle that does not run the
 * engine does not carry it.
 */
import { runExclusionPipeline } from '../exclusion-builder/pipeline';
import type { ExclusionFeatureId } from '../exclusion-builder/set';
import type { SimulationStage } from '../wp-rocket-simulation/spec';
import {
  engineFailed,
  overBudgetOutcome,
  type DocumentTransformRequest,
  type DocumentTransformResult,
  type DocumentTransformRunner
} from './document-transform';
import { simulationStage } from './simulation-stage';

/** Called as each step starts: its feature, and `stage` for a simulation step. */
export type StepStartListener = (feature: ExclusionFeatureId, stage?: SimulationStage) => void;

/**
 * Run the exclusion pipeline (`runExclusionPipeline`) — after the
 * request's simulation steps when it simulates — checking the cumulative
 * wall time after each step: the step that crosses the budget is the
 * overrun (its output is discarded, nothing is served rewritten; a
 * simulation step's overrun names `stage: 'simulate'`). A run within the
 * budget ends with the marker steps.
 *
 * @param request The text, set, budget, decoding facts and simulation input.
 * @param now A monotonic clock (ms).
 * @param onStepStart Called with each feature (and stage) as its step
 *   starts (lets a preempting host know which step a killed run was in).
 * @returns The rewritten text and reports (with the simulation's report
 *   when the request simulates), or the unmodified outcome: `over-budget`,
 *   or `engine-failed` (an invalid set — the apply gate should have
 *   refused it — or an engine throw).
 */
export function runDocumentPipeline(
  request: DocumentTransformRequest,
  now: () => number,
  onStepStart?: StepStartListener
): DocumentTransformResult {
  try {
    const started = now();
    // An invalid set throws (the apply gate should have refused it): engine-failed below.
    const run = runExclusionPipeline(request.html, request.set, {
      ...(request.bytes === undefined ? {} : { bytes: request.bytes }),
      ...(onStepStart === undefined ? {} : { onStepStart }),
      stopAfter: () => now() - started > request.budgetMs,
      ...(request.simulate === undefined
        ? {}
        : { pre: simulationStage(request.simulate, request.bytes, request.set.rows.deferJs) })
    });
    if (!run.completed) {
      return {
        ok: false,
        outcome: overBudgetOutcome(request.set, run.stoppedAt, request.budgetMs, run.stage)
      };
    }
    // One report per simulated feature, each in its own outcome field.
    const simulation = run.simulation?.find((report) => report.feature === 'delay_js');
    const deferSimulation = run.simulation?.find((report) => report.feature === 'defer_all_js');
    const lazyloadSimulation = run.simulation?.find((report) => report.feature === 'lazyload');
    // The marker steps ran after the last budget check, unbudgeted: linear
    // scans; only a preempting runner's deadline bounds them.
    return {
      ok: true,
      html: run.html,
      outcome: {
        outcome: 'rewritten',
        reports: run.reports,
        ...(simulation === undefined ? {} : { simulation }),
        ...(deferSimulation === undefined ? {} : { deferSimulation }),
        ...(lazyloadSimulation === undefined ? {} : { lazyloadSimulation })
      }
    };
  } catch (cause) {
    return engineFailed(cause);
  }
}

/**
 * The in-process runner: {@link runDocumentPipeline} on the calling
 * thread (budget enforced between steps) — for a backend whose thread may
 * run the engine (a service worker cannot host a `Worker`).
 *
 * @param now The monotonic clock; defaults to `performance.now`.
 */
export function createInProcessTransformRunner(
  now: () => number = () => performance.now()
): DocumentTransformRunner {
  return (request) => Promise.resolve(runDocumentPipeline(request, now));
}
