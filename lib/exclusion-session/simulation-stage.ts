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
import {
  isLazyloadRuntimeUrl,
  type DeferSimulationReport,
  type DelaySimulationReport,
  type DocumentSimulationInput,
  type DocumentSimulationReport,
  type LazyloadSimulationReport,
  type SimulationListProvenance
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
import type { FeatureBuffer } from '../wp-rocket-simulation/ie-conditionals';
import {
  simulateLazyload,
  type LazyloadSimulationResult,
  type LazyloadStepReport
} from '../wp-rocket-simulation/lazyload-simulation';
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
 * What every feature's report echoes: the state and its why, and the versions.
 *
 * @param report The step's report.
 * @param input The simulation input.
 */
function reportCore(
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
    ...(input.siteVersion === undefined ? {} : { siteVersion: input.siteVersion })
  };
}

/**
 * {@link reportCore} plus the list provenance of a feature that runs with
 * an exclusion list.
 *
 * @param feature The simulated feature.
 * @param report The step's report.
 * @param input The simulation input.
 */
function reportBase(
  feature: 'defer_all_js' | 'delay_js',
  report: Pick<DelayStepReport, 'state' | 'reason' | 'unreproducedRegex'>,
  input: DocumentSimulationInput
) {
  return { ...reportCore(report, input), ...listProvenance(feature, input) };
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
  feature: 'lazyload',
  report: LazyloadStepReport,
  input: DocumentSimulationInput
): LazyloadSimulationReport;
export function wireSimulationReport(
  feature: SimulatedFeatureId,
  report: DelayStepReport | DeferJsForwardReport | LazyloadStepReport,
  input: DocumentSimulationInput,
  cspLimits: readonly SimulationCspLimit[] = [],
  cspUnavailable: SimulationCspUnavailableReason | undefined = input.cspUnavailable
): DocumentSimulationReport {
  if (feature === 'delay_js' && 'delayed' in report) {
    return wireDelayReport(report, input, cspLimits, cspUnavailable);
  }
  if (feature === 'defer_all_js' && 'deferred' in report) return wireDeferReport(report, input);
  if (feature === 'lazyload' && 'images' in report) return wireLazyloadReport(report, input);
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

/** {@link wireSimulationReport} for LazyLoad: counts (0 unless `simulated`) and the page facts. */
function wireLazyloadReport(
  report: LazyloadStepReport,
  input: DocumentSimulationInput
): LazyloadSimulationReport {
  const page = report.state === 'simulated' ? report.page : undefined;
  return {
    feature: 'lazyload',
    ...reportCore(report, input),
    images: report.images,
    pictures: report.pictures,
    backgrounds: report.backgrounds,
    ...(page === undefined
      ? {}
      : {
          runtimeUrl: page.runtimeUrl,
          assetsUrlSource: page.assetsUrlSource,
          delivery: page.delivery,
          placement: {
            head: page.placement.head,
            footer: page.placement.footer,
            fallbacks: [...page.placement.fallbacks]
          },
          caveats: [...page.caveats]
        })
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

/** A Defer JS step's result, and the buffer after it (the one given when it did not simulate). */
interface DeferStepRun {
  readonly step: StepResult;
  readonly buffer: FeatureBuffer | undefined;
}

/**
 * The Defer JS step: the forward transform on the page as given — or, when
 * an earlier feature simulated (LazyLoad), on the page its buffer started
 * from, continuing that buffer (no CSP check: Defer JS injects no runtime
 * — it stamps `defer` on external scripts and edits inline scripts' own
 * bodies, which the browser then judges exactly as on WP Rocket's page).
 * Any state but `simulated` serves the page as given.
 *
 * @param html The page as given (LazyLoad's when it simulated).
 * @param input The simulation input.
 * @param bytes How the session decoded the page.
 * @param storedRows The session's stored Defer JS rows (checked, never applied).
 * @param buffer The buffer the earlier features left (absent: none simulated).
 */
function deferStep(
  html: string,
  input: DocumentSimulationInput,
  bytes: DocumentBytes | undefined,
  storedRows: readonly string[],
  buffer: FeatureBuffer | undefined
): DeferStepRun {
  const identity = (why: Pick<DeferJsForwardReport, 'reason' | 'unreproducedRegex'>) => ({
    step: {
      html,
      report: wireSimulationReport(
        'defer_all_js',
        { state: 'not-applicable', ...why, ...NO_DEFER_COUNTS },
        input
      )
    },
    buffer
  });
  const page = buffer?.start ?? html;
  const measure = servedByteMeasure(bytes, page);
  if (measure === null) return identity({ reason: 'unsupported-charset' });
  const pass = deferPassInput(input);
  if (!storedRowsKeepPage(pass, storedRows)) {
    return identity({
      reason: 'beyond-exact-reproduction',
      unreproducedRegex: 'defer-file-exclusions'
    });
  }
  const result = simulateDeferJs({
    html: page,
    ...pass,
    measure,
    ...(buffer === undefined ? {} : { buffer })
  });
  const simulated = result.report.state === 'simulated';
  return {
    step: {
      html: simulated ? result.html : html,
      report: wireSimulationReport('defer_all_js', result.report, input)
    },
    buffer: result.buffer ?? buffer
  };
}

/**
 * The Delay JS step: the served page's bytes must be countable (else
 * `not-applicable`, page as is); the forward transform runs; a simulated
 * page is then checked against the page's CSP (blocked: the page as
 * given, `csp-blocked`).
 *
 * When an earlier feature simulated, the transform runs on the page its
 * buffer started from, continuing that buffer — WP Rocket's one buffer,
 * whose IE conditionals are set aside once for every feature (setting
 * them aside around each feature in turn would re-read their `$` and `\`
 * on the way back). Any Delay JS state but `simulated` then serves the
 * page as given: the earlier features' page.
 *
 * @param html The page as given (the earlier features' page).
 * @param input The simulation input.
 * @param bytes How the session decoded the page.
 * @param served The document as the session decoded it, before any step —
 *   the CSP metas' offsets are into it.
 * @param buffer The buffer the earlier features left (absent: none simulated).
 */
function delayStep(
  html: string,
  input: DocumentSimulationInput,
  bytes: DocumentBytes | undefined,
  served: string,
  buffer: FeatureBuffer | undefined
): StepResult {
  const page = buffer?.start ?? html;
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
    ...(buffer === undefined ? {} : { buffer })
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
 * The LazyLoad step's own run: the served page's bytes must be countable,
 * then {@link simulateLazyload} (never with the stored rows: the exclusion
 * steps restore their images). A simulated page whose runtime URL the
 * report cannot carry is refused (`lazyload-runtime-url`), and so is one
 * whose packaged runtime is unusable (`runtime-unavailable`).
 *
 * @param html The served page.
 * @param input The simulation input.
 * @param bytes How the session decoded the page.
 * @throws {@link Error} when the input lacks the LazyLoad inputs (the input guard refuses that).
 */
function lazyloadRun(
  html: string,
  input: DocumentSimulationInput,
  bytes: DocumentBytes | undefined
): LazyloadSimulationResult {
  const lazy = input.lazyload;
  if (lazy === undefined) {
    throw new Error(
      `LazyLoad simulation input for WP Rocket ${input.wpRocketVersion} lacks its texts`
    );
  }
  const refused = (why: Pick<LazyloadStepReport, 'reason' | 'unreproducedRegex'>) => ({
    html,
    report: { state: 'not-applicable' as const, ...why, ...NO_LAZYLOAD_COUNTS }
  });
  const measure = servedByteMeasure(bytes, html);
  if (measure === null) return refused({ reason: 'unsupported-charset' });
  const result = simulateLazyload({
    html,
    pageUrl: lazy.pageUrl,
    texts: lazy,
    literals: { excludedAttributes: lazy.excludedAttributes, excludedSrc: lazy.excludedSrc },
    rows: [],
    measure
  });
  if (result.report.state !== 'simulated') return result;
  // The simulated page requests the runtime: an unusable packaged copy fails LazyLoad alone.
  if (lazy.runtimeUnavailable !== undefined) return refused({ reason: 'runtime-unavailable' });
  if (result.report.page !== undefined && !isLazyloadRuntimeUrl(result.report.page.runtimeUrl)) {
    return refused({
      reason: 'beyond-exact-reproduction',
      unreproducedRegex: 'lazyload-runtime-url'
    });
  }
  return result;
}

/** The LazyLoad counts of a step that changed nothing. */
const NO_LAZYLOAD_COUNTS = { images: 0, pictures: 0, backgrounds: 0 } as const;

/**
 * How many times `needle` occurs in `text` (non-overlapping).
 *
 * @param text The page.
 * @param needle A non-empty text.
 */
function occurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
    count++;
  }
  return count;
}

/**
 * Whether the later features left LazyLoad's printed scripts as printed:
 * each occurs on their final page as often as on LazyLoad's (WP Rocket's
 * own lists exclude both; a list that defers, wraps or delays one would
 * break the page in a way WP Rocket's bundled lists never do).
 *
 * @param lazyPage LazyLoad's page.
 * @param finalPage The page after every later step.
 * @param scripts LazyLoad's printed scripts.
 */
function injectedScriptsSurvive(
  lazyPage: string,
  finalPage: string,
  scripts: readonly string[]
): boolean {
  return scripts.every(
    (script) => occurrences(finalPage, script) === occurrences(lazyPage, script)
  );
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

/** LazyLoad's simulated page and the scripts it printed (the later features must leave them). */
interface LazyloadPrinted {
  readonly page: string;
  readonly scripts: readonly string[];
}

/** LazyLoad's report when a later feature would change its printed scripts. */
const INJECTED_SCRIPTS_REFUSAL: LazyloadStepReport = {
  state: 'not-applicable',
  reason: 'beyond-exact-reproduction',
  unreproducedRegex: 'lazyload-injected-scripts',
  ...NO_LAZYLOAD_COUNTS
};

/**
 * The simulation stage for one engine run: LazyLoad, then Defer JS, then
 * Delay JS, each when requested, in WP Rocket's one buffer — each step
 * runs once, in order, continuing the buffer the simulated earlier steps
 * left (see {@link delayStep}), so the page is WP Rocket's with every
 * simulated feature, and a feature that does not simulate serves the page
 * as given: the earlier features' page.
 *
 * LazyLoad prints two scripts the later features must leave as printed:
 * the last step checks its page against LazyLoad's; when a later feature
 * changed either script, the last step reruns the later features on the
 * served page (inside its own step: the rare price of a list that names
 * LazyLoad's scripts) and `finish` swaps in LazyLoad's refusal
 * (`lazyload-injected-scripts`) and the rerun's reports.
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
  const steps = simulationStepIds(input.features);
  const later = steps.filter((feature) => feature !== 'lazyload');
  // The document the first step is given (the stage's own input).
  let served: string | undefined;
  // The buffer after the simulated steps so far.
  let buffer: FeatureBuffer | undefined;
  // LazyLoad's page and printed scripts, when it simulated.
  let printed: LazyloadPrinted | undefined;
  // Reports the rerun replaced, swapped in by `finish`.
  const replaced = new Map<SimulatedFeatureId, DocumentSimulationReport>();

  /** A later step on its page, continuing (and advancing) `from`. */
  const runLater = (
    feature: 'defer_all_js' | 'delay_js',
    html: string,
    from: FeatureBuffer | undefined
  ): DeferStepRun =>
    feature === 'delay_js'
      ? { step: delayStep(html, input, bytes, served ?? html, from), buffer: from }
      : deferStep(html, input, bytes, storedDeferRows, from);

  /** The later features on the served page, LazyLoad refused: the last one's result. */
  const rerunWithoutLazyload = (page: string): StepResult => {
    let step: StepResult = {
      html: page,
      report: wireSimulationReport('lazyload', INJECTED_SCRIPTS_REFUSAL, input)
    };
    let from: FeatureBuffer | undefined;
    replaced.set('lazyload', step.report);
    for (const feature of later) {
      const run = runLater(feature, step.html, from);
      ({ step, buffer: from } = run);
      replaced.set(feature, step.report);
    }
    return step;
  };

  /** The LazyLoad step: its run, its buffer handed forward when it simulated. */
  const runLazyload = (html: string): StepResult => {
    const result = lazyloadRun(html, input, bytes);
    if (result.buffer !== undefined && result.injectedScripts !== undefined) {
      buffer = result.buffer;
      printed = { page: result.html, scripts: result.injectedScripts };
    }
    return { html: result.html, report: wireSimulationReport('lazyload', result.report, input) };
  };

  const apply = (feature: SimulatedFeatureId, html: string): StepResult => {
    const page = (served ??= html);
    if (feature === 'lazyload') return runLazyload(html);
    const run = runLater(feature, html, buffer);
    buffer = run.buffer;
    const isLast = feature === later.at(-1);
    if (!isLast || printed === undefined) return run.step;
    if (injectedScriptsSurvive(printed.page, run.step.html, printed.scripts)) return run.step;
    return rerunWithoutLazyload(page);
  };
  const finishMarker = markerStep(input);
  return {
    steps: steps.map((feature) => ({
      id: feature,
      apply: (html: string) => apply(feature, html)
    })),
    finish: (html, reports) =>
      finishMarker(
        html,
        reports.map((report) => replaced.get(report.feature) ?? report)
      )
  };
}
