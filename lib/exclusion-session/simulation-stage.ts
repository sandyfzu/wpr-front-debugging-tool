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
  DocumentSimulationInput,
  DocumentSimulationReport,
  SimulationListProvenance
} from '../messaging/exclusion-simulation';
import { evaluateSimulationCsp } from '../wp-rocket-simulation/csp-evaluation';
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
  type SimulationState
} from '../wp-rocket-simulation/spec';
import type { ByteMeasure } from '../wp-rocket-simulation/utf8';

/** What a feature's forward transform is given. */
interface ForwardInput {
  readonly html: string;
  readonly simulation: DocumentSimulationInput;
  readonly measure: ByteMeasure;
}

/** A feature's forward transform: the page WP Rocket would serve with it on, and its report. */
type ForwardTransform = (input: ForwardInput) => {
  readonly html: string;
  readonly report: DelayJsForwardReport;
};

/**
 * Simulated feature → its forward transform (the registry owns the order).
 * Stored rows are never passed: the exclusion steps restore them afterwards.
 */
const FORWARD_TRANSFORMS: Record<SimulatedFeatureId, ForwardTransform> = {
  delay_js: ({ html, simulation, measure }) =>
    simulateDelayJs({
      html,
      runtime: simulation.runtime,
      ieFallback: simulation.fallback,
      listRows: simulation.listRows,
      rows: [],
      measure
    })
};

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

/** A step's own report: a forward transform's, or one the step decided without it. */
type StepReport = Omit<DelayJsForwardReport, 'state'> & { readonly state: SimulationState };

/** The report of a step that serves the page as is, decided before or after the transform. */
function identityReport(state: 'csp-blocked'): StepReport;
function identityReport(state: 'not-applicable', reason: 'unsupported-charset'): StepReport;
function identityReport(
  state: 'csp-blocked' | 'not-applicable',
  reason?: 'unsupported-charset'
): StepReport {
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
 * The request's list provenance, rebuilt as its own value (the input
 * carries it flat beside other fields).
 *
 * @param input The simulation input.
 */
function listProvenance(input: DocumentSimulationInput): SimulationListProvenance {
  return input.listSource === 'latest'
    ? { listSource: 'latest', listFetchedAt: input.listFetchedAt }
    : { listSource: 'bundled', listMiss: input.listMiss };
}

/**
 * A step's report as the session records it: the transform's facts (the
 * `simulated`-only ones only on `simulated`, each only when it says
 * something), the versions and list provenance echoed from the input, and
 * the CSP facts.
 *
 * @param feature The simulated feature.
 * @param report The transform's report.
 * @param input The simulation input.
 * @param cspLimits The runtime work the page's CSP limits.
 */
export function wireSimulationReport(
  feature: SimulatedFeatureId,
  report: StepReport,
  input: DocumentSimulationInput,
  cspLimits: readonly SimulationCspLimit[]
): DocumentSimulationReport {
  const simulated = report.state === 'simulated';
  return {
    feature,
    state: report.state,
    ...(report.reason === undefined ? {} : { reason: report.reason }),
    ...(report.unreproducedRegex === undefined
      ? {}
      : { unreproducedRegex: report.unreproducedRegex }),
    delayed: report.delayed,
    runtimeInjected: report.runtimeInjected,
    wpRocketVersion: input.wpRocketVersion,
    ...(input.siteVersion === undefined ? {} : { siteVersion: input.siteVersion }),
    ...listProvenance(input),
    ...(simulated && report.undetermined > 0 ? { undetermined: report.undetermined } : {}),
    ...(simulated && report.regexLimitHit ? { regexLimitHit: true as const } : {}),
    ...(simulated && cspLimits.length > 0 ? { cspLimits: [...cspLimits] } : {}),
    ...(simulated && input.cspUnavailable !== undefined
      ? { cspUnavailable: input.cspUnavailable }
      : {}),
    ...(simulated && report.caveats.length > 0 ? { caveats: [...report.caveats] } : {})
  };
}

/**
 * One feature's simulation step: the served page's bytes must be countable
 * (else `not-applicable`, page as is); the forward transform runs; a
 * simulated page is then checked against the page's CSP (blocked: the page
 * as served, `csp-blocked`).
 *
 * @param feature The simulated feature.
 * @param input The simulation input.
 * @param bytes How the session decoded the page.
 */
function simulationStep(
  feature: SimulatedFeatureId,
  input: DocumentSimulationInput,
  bytes: DocumentBytes | undefined
): PipelineStep<DocumentSimulationReport, SimulatedFeatureId> {
  return {
    id: feature,
    apply: (html) => {
      const measure = servedByteMeasure(bytes, html);
      if (measure === null) {
        const report = identityReport('not-applicable', 'unsupported-charset');
        return { html, report: wireSimulationReport(feature, report, input, []) };
      }
      const result = FORWARD_TRANSFORMS[feature]({ html, simulation: input, measure });
      if (result.report.state !== 'simulated') {
        return { html, report: wireSimulationReport(feature, result.report, input, []) };
      }
      const csp = evaluateSimulationCsp(input.csp, result.html);
      if (csp.blocked) {
        return {
          html,
          report: wireSimulationReport(feature, identityReport('csp-blocked'), input, [])
        };
      }
      return {
        html: result.html,
        report: wireSimulationReport(feature, result.report, input, csp.limits)
      };
    }
  };
}

/**
 * The marker step: write the marker when a step simulated, and name its id
 * on the simulated reports only when it was written.
 *
 * @param input The simulation input (its marker id).
 */
function markerStep(
  input: DocumentSimulationInput
): PreExclusionStage<DocumentSimulationReport>['finish'] {
  return (html, reports) => {
    const simulated = reports.some((report) => report.state === 'simulated');
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
 * The simulation stage for one engine run.
 *
 * @param input The simulation input (features and their packaged inputs).
 * @param bytes How the session decoded the page (absent: UTF-8, no BOM).
 * @returns The pre-exclusion steps, in registry order, and the marker step.
 */
export function simulationStage(
  input: DocumentSimulationInput,
  bytes?: DocumentBytes
): PreExclusionStage<DocumentSimulationReport> {
  return {
    steps: simulationStepIds(input.features).map((feature) =>
      simulationStep(feature, input, bytes)
    ),
    finish: markerStep(input)
  };
}
