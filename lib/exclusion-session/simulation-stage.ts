/**
 * The simulation stage of one engine run: the pre-exclusion steps that turn
 * a page served without a WP Rocket feature into the page WP Rocket would
 * serve with it (one step per simulated feature, in the registry's order),
 * and the marker step the pipeline runs after the builder marker. Pure:
 * every input — the selected version's runtime, IE fallback and exclusion
 * list, the marker id, the page's CSP — arrives in the request, so both
 * engines (in-process and worker) run the same stage on the same inputs.
 *
 * A step never applies stored exclusion rows: the exclusion steps that
 * follow act on the simulated page as on a real one (each row restored and
 * reported by the shipped steps — one row semantics).
 */
import type { PipelineStep, PreExclusionStage } from '../exclusion-builder/pipeline';
import type { DocumentBytes } from '../exclusion-builder/libxml/charset';
import type {
  DeferSimulationReport,
  DelaySimulationReport,
  DocumentSimulationInput,
  DocumentSimulationReport,
  SimulationListProvenance
} from '../messaging/exclusion-simulation';
import { evaluateSimulationCsp } from '../wp-rocket-simulation/csp-evaluation';
import {
  deferUrlMatcher,
  simulateDeferJs,
  type DeferJsForwardReport,
  type DeferJsPassCounts,
  type DeferJsPassInput
} from '../wp-rocket-simulation/defer-js-forward';
import {
  simulateDelayJs,
  type DelayJsForwardReport
} from '../wp-rocket-simulation/delay-js-forward';
import { writeSimulationMarker } from '../wp-rocket-simulation/marker-write';
import { servedByteMeasure } from '../wp-rocket-simulation/served-measure';
import {
  SIMULATED_FEATURES,
  type SimulatedFeatureId,
  type SimulationCspLimit,
  type SimulationCspUnavailableReason,
  type SimulationState
} from '../wp-rocket-simulation/spec';
import { supportedWprVersion } from '../wp-rocket/versions';

/** A Delay JS step's report: the forward transform's, or one the step decided without it. */
type DelayStepReport = Omit<DelayJsForwardReport, 'state' | 'defer'> & {
  readonly state: SimulationState;
};

/**
 * The input's Defer JS pass inputs: its lists and the simulated version's
 * inline-list quoting.
 *
 * @param simulation The simulation input.
 * @throws {@link Error} when the input lacks the Defer JS lists or names an
 *   unsupported version (the input guard refuses both).
 */
function deferPassInput(simulation: DocumentSimulationInput): DeferJsPassInput {
  const version = supportedWprVersion(simulation.wpRocketVersion);
  const lists = simulation.deferLists;
  if (version === undefined || lists === undefined) {
    throw new Error(
      `Defer JS simulation input for WP Rocket ${simulation.wpRocketVersion} lacks its lists or a supported version`
    );
  }
  return {
    rows: [],
    lists: { external: lists.external, inline: lists.inline },
    inlineQuoteDelimiter: version.variants.deferInlineQuoteDelimiter
  };
}

/**
 * The features a request simulates, in the registry's execution order.
 *
 * @param features The request's features.
 */
export function simulationStepIds(
  features: readonly SimulatedFeatureId[]
): readonly SimulatedFeatureId[] {
  return SIMULATED_FEATURES.map((feature) => feature.id).filter((id) => features.includes(id));
}

/** The report of a Delay JS step that serves the page as is, decided without the transform. */
function delayIdentityReport(
  state: 'csp-blocked' | 'not-applicable',
  reason?: 'unsupported-charset'
): DelayStepReport {
  return {
    state,
    ...(reason === undefined ? {} : { reason }),
    delayed: 0,
    runtimeInjected: false,
    caveats: [],
    regexLimitHit: false,
    undetermined: 0
  };
}

/**
 * The provenance of the list a feature ran with, rebuilt as its own value
 * (the input carries each flat beside other fields): Defer JS's lists',
 * or the Delay JS list's.
 *
 * @param feature The simulated feature.
 * @param input The simulation input.
 */
function listProvenance(
  feature: SimulatedFeatureId,
  input: DocumentSimulationInput
): SimulationListProvenance {
  const source: SimulationListProvenance =
    feature === 'defer_all_js' && input.deferLists !== undefined ? input.deferLists : input;
  return source.listSource === 'latest'
    ? { listSource: 'latest', listFetchedAt: source.listFetchedAt }
    : { listSource: 'bundled', listMiss: source.listMiss };
}

/**
 * What every feature's report echoes: the state and its why, the versions
 * and the feature's list provenance.
 *
 * @param feature The simulated feature.
 * @param report The step's report.
 * @param input The simulation input.
 */
function reportBase(
  feature: SimulatedFeatureId,
  report: Pick<DelayStepReport, 'state' | 'reason' | 'unreproducedRegex'>,
  input: DocumentSimulationInput
) {
  return {
    state: report.state,
    ...(report.reason === undefined ? {} : { reason: report.reason }),
    ...(report.unreproducedRegex === undefined
      ? {}
      : { unreproducedRegex: report.unreproducedRegex }),
    wpRocketVersion: input.wpRocketVersion,
    ...(input.siteVersion === undefined ? {} : { siteVersion: input.siteVersion }),
    ...listProvenance(feature, input)
  };
}

/**
 * A step's report as the session records it, per feature. Delay JS: the
 * transform's facts (the `simulated`-only ones only on `simulated`, each
 * only when it says something) and the CSP facts. Defer JS: its counts (0
 * unless `simulated`) — it injects no runtime, so it carries no CSP fact.
 *
 * @param feature The simulated feature.
 * @param report The step's report.
 * @param input The simulation input (versions, list provenance).
 * @param cspLimits The runtime work the page's CSP limits (Delay JS).
 * @param cspUnavailable Why the step could not evaluate the CSP (Delay JS;
 *   over the input's own reason).
 */
export function wireSimulationReport(
  feature: 'delay_js',
  report: DelayStepReport,
  input: DocumentSimulationInput,
  cspLimits: readonly SimulationCspLimit[],
  cspUnavailable?: SimulationCspUnavailableReason
): DelaySimulationReport;
export function wireSimulationReport(
  feature: 'defer_all_js',
  report: DeferJsForwardReport,
  input: DocumentSimulationInput
): DeferSimulationReport;
export function wireSimulationReport(
  feature: SimulatedFeatureId,
  report: DelayStepReport | DeferJsForwardReport,
  input: DocumentSimulationInput,
  cspLimits: readonly SimulationCspLimit[] = [],
  cspUnavailable: SimulationCspUnavailableReason | undefined = input.cspUnavailable
): DocumentSimulationReport {
  if (feature === 'delay_js' && 'delayed' in report) {
    return wireDelayReport(report, input, cspLimits, cspUnavailable);
  }
  if (feature === 'defer_all_js' && 'deferred' in report) return wireDeferReport(report, input);
  throw new Error(`wireSimulationReport: the ${feature} step was given another feature's report`);
}

/** {@link wireSimulationReport} for Delay JS. */
function wireDelayReport(
  report: DelayStepReport,
  input: DocumentSimulationInput,
  cspLimits: readonly SimulationCspLimit[],
  cspUnavailable: SimulationCspUnavailableReason | undefined
): DelaySimulationReport {
  const simulated = report.state === 'simulated';
  return {
    feature: 'delay_js',
    ...reportBase('delay_js', report, input),
    delayed: report.delayed,
    runtimeInjected: report.runtimeInjected,
    ...(simulated && report.undetermined > 0 ? { undetermined: report.undetermined } : {}),
    ...(simulated && report.regexLimitHit ? { regexLimitHit: true as const } : {}),
    ...(simulated && cspLimits.length > 0 ? { cspLimits: [...cspLimits] } : {}),
    ...(simulated && cspUnavailable !== undefined ? { cspUnavailable } : {}),
    ...(simulated && report.caveats.length > 0 ? { caveats: [...report.caveats] } : {})
  };
}

/** {@link wireSimulationReport} for Defer JS: counts kept only on `simulated`. */
function wireDeferReport(
  report: DeferJsForwardReport,
  input: DocumentSimulationInput
): DeferSimulationReport {
  const counts = report.state === 'simulated' ? report : NO_DEFER_COUNTS;
  return {
    feature: 'defer_all_js',
    ...reportBase('defer_all_js', report, input),
    deferred: counts.deferred,
    wrapped: counts.wrapped
  };
}

/** The Defer JS counts of a step that changed nothing. */
const NO_DEFER_COUNTS: DeferJsPassCounts = { deferred: 0, wrapped: 0 };

/** A step's result. */
type StepResult = ReturnType<PipelineStep<DocumentSimulationReport, SimulatedFeatureId>['apply']>;

/**
 * Whether the stored rows leave WP Rocket's file pre-check as the list
 * alone sets it. The step defers by the list only (the exclusion steps
 * restore the rows' scripts after), but WP Rocket joins both into one
 * pattern: one the rows push past PCRE's compiled-size cap, or break,
 * defers nothing there — a page the exclusion steps cannot rebuild.
 *
 * @param pass The list's pass input.
 * @param storedRows The session's stored Defer JS rows.
 * @returns Whether both joins are known and give one page state.
 */
function storedRowsKeepPage(pass: DeferJsPassInput, storedRows: readonly string[]): boolean {
  if (storedRows.length === 0) return true;
  try {
    const alone = deferUrlMatcher(pass) === null;
    return alone === (deferUrlMatcher({ ...pass, rows: storedRows }) === null);
  } catch {
    // A join whose pre-check cannot be replayed, or whose rows clash: no claim.
    return false;
  }
}

/**
 * The Defer JS step: the forward transform on the page as given (no CSP
 * check: Defer JS injects no runtime — it stamps `defer` on external
 * scripts and edits inline scripts' own bodies, which the browser then
 * judges exactly as on WP Rocket's page).
 *
 * @param html The page.
 * @param input The simulation input.
 * @param bytes How the session decoded the page.
 * @param storedRows The session's stored Defer JS rows (checked, never applied).
 */
function deferStep(
  html: string,
  input: DocumentSimulationInput,
  bytes: DocumentBytes | undefined,
  storedRows: readonly string[]
): StepResult {
  const identity = (why: Pick<DeferJsForwardReport, 'reason' | 'unreproducedRegex'>) => ({
    html,
    report: wireSimulationReport(
      'defer_all_js',
      { state: 'not-applicable', ...why, ...NO_DEFER_COUNTS },
      input
    )
  });
  const measure = servedByteMeasure(bytes, html);
  if (measure === null) return identity({ reason: 'unsupported-charset' });
  const pass = deferPassInput(input);
  if (!storedRowsKeepPage(pass, storedRows)) {
    return identity({
      reason: 'beyond-exact-reproduction',
      unreproducedRegex: 'defer-file-exclusions'
    });
  }
  const result = simulateDeferJs({ html, ...pass, measure });
  const served = result.report.state === 'simulated' ? result.html : html;
  return { html: served, report: wireSimulationReport('defer_all_js', result.report, input) };
}

/**
 * The Delay JS step: the served page's bytes must be countable (else
 * `not-applicable`, page as is); the forward transform runs; a simulated
 * page is then checked against the page's CSP (blocked: the page as
 * given, `csp-blocked`).
 *
 * When Defer JS simulated on `deferredFrom`, the transform runs on that
 * page with Defer JS's passes inside its own buffer — WP Rocket's one
 * buffer, whose IE conditionals are set aside once for both features
 * (setting them aside around each feature in turn would re-read their
 * `$` and `\` on the way back). Any Delay JS state but `simulated` then
 * serves the page as given: the Defer JS page.
 *
 * @param html The page as given (Defer JS's page when it simulated).
 * @param input The simulation input.
 * @param bytes How the session decoded the page.
 * @param served The document as the session decoded it, before any step —
 *   the CSP metas' offsets are into it.
 * @param deferredFrom The page Defer JS simulated on (absent: it did not).
 */
function delayStep(
  html: string,
  input: DocumentSimulationInput,
  bytes: DocumentBytes | undefined,
  served: string,
  deferredFrom: string | undefined
): StepResult {
  const page = deferredFrom ?? html;
  const measure = servedByteMeasure(bytes, page);
  if (measure === null) {
    const report = delayIdentityReport('not-applicable', 'unsupported-charset');
    return { html, report: wireSimulationReport('delay_js', report, input, []) };
  }
  const result = simulateDelayJs({
    html: page,
    runtime: input.runtime,
    ieFallback: input.fallback,
    listRows: input.listRows,
    rows: [],
    measure,
    ...(deferredFrom === undefined ? {} : { defer: deferPassInput(input) })
  });
  if (result.report.state !== 'simulated') {
    return { html, report: wireSimulationReport('delay_js', result.report, input, []) };
  }
  const csp = evaluateSimulationCsp({
    csp: input.csp,
    served,
    simulated: result.html,
    runtime: input.runtime
  });
  if (csp.blocked) {
    const report = delayIdentityReport('csp-blocked');
    return { html, report: wireSimulationReport('delay_js', report, input, []) };
  }
  const report =
    'unavailable' in csp
      ? wireSimulationReport('delay_js', result.report, input, [], csp.unavailable)
      : wireSimulationReport('delay_js', result.report, input, csp.limits);
  return { html: result.html, report };
}

/**
 * The marker step: remove every served marker, write this document's when
 * a step simulated (naming the simulated features), and name its id on the
 * simulated reports only when it was written.
 *
 * @param input The simulation input (its marker id).
 */
function markerStep(
  input: DocumentSimulationInput
): PreExclusionStage<DocumentSimulationReport>['finish'] {
  return (html, reports) => {
    const simulated = reports
      .filter((report) => report.state === 'simulated')
      .map((report) => report.feature);
    const marker = writeSimulationMarker(html, input.markerId, simulated);
    const markerId = input.markerId;
    if (!marker.written || markerId === undefined) return { html: marker.html, reports };
    return {
      html: marker.html,
      reports: reports.map((report) =>
        report.state === 'simulated' ? { ...report, markerId } : report
      )
    };
  };
}

/**
 * The simulation stage for one engine run: Defer JS, then Delay JS, each
 * when requested. With both, the Delay JS step runs Defer JS's passes in
 * its own buffer when Defer JS simulated (see {@link delayStep}): the page
 * is WP Rocket's with both features, Defer JS's alone when Delay JS ends
 * in any other state, Delay JS's alone when Defer JS does.
 *
 * @param input The simulation input (features and their packaged inputs).
 * @param bytes How the session decoded the page (absent: UTF-8, no BOM).
 * @param storedDeferRows The set's Defer JS rows (see {@link storedRowsKeepPage}).
 * @returns The pre-exclusion steps, in registry order, and the marker step.
 */
export function simulationStage(
  input: DocumentSimulationInput,
  bytes?: DocumentBytes,
  storedDeferRows: readonly string[] = []
): PreExclusionStage<DocumentSimulationReport> {
  // The document the first step is given (the stage's own input).
  let original: string | undefined;
  // The page Defer JS simulated on, when it did.
  let deferredFrom: string | undefined;
  const apply = (feature: SimulatedFeatureId, html: string): StepResult => {
    original ??= html;
    if (feature === 'delay_js') return delayStep(html, input, bytes, original, deferredFrom);
    const result = deferStep(html, input, bytes, storedDeferRows);
    if (result.report.state === 'simulated') deferredFrom = html;
    return result;
  };
  return {
    steps: simulationStepIds(input.features).map((feature) => ({
      id: feature,
      apply: (html: string) => apply(feature, html)
    })),
    finish: markerStep(input)
  };
}
