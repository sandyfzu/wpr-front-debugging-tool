/**
 * The host half of a simulation: before an engine run, build the
 * simulation input for one decoded document — the WP Rocket version to
 * simulate (per document, from its generator meta), that version's
 * packaged runtime, IE fallback and exclusion list, the marker id, and the
 * page's CSP — through injected sources. The same preparation feeds both
 * engines (in-process and worker), so both simulate on identical inputs;
 * page-derived parts are fitted here (an unfit served version is omitted,
 * an unfit CSP becomes `cspUnavailable`), the extension's own are checked
 * strictly (a bad one is our bug: the run fails, the document is served
 * unchanged).
 *
 * Every source has an inert default, so each one lands later without
 * touching the pipeline: no runtime (every document `runtime-unavailable`;
 * an unusable LazyLoad runtime fails LazyLoad alone)
 * until the packaged data loads, the bundled list (never fetched) until a
 * latest list is kept, no marker id until markers are written, no CSP
 * known until it is captured.
 */
import type { InterceptedDocument } from './backend';
import {
  fitSimulationCsp,
  fitSiteVersion,
  parseDocumentSimulationInput,
  type DocumentSimulationInput,
  type SimulationDeferLists,
  type SimulationLazyloadInput,
  type SimulationListProvenance
} from '../messaging/exclusion-simulation';
import type { LazyloadTextParts } from '../wp-rocket-simulation/lazyload-hook-texts';
import type { DeferJsLists } from '../wp-rocket-simulation/defer-js-forward';
import { scheduleWithTimeout, type ScheduleTimer } from '../messaging/bounded-ask';
import { selectWprVersion } from '../wp-rocket-simulation/select-version';
import type {
  SimulateSpec,
  SimulatedFeatureId,
  SimulationRuntimeUnavailableCause
} from '../wp-rocket-simulation/spec';
import { DeadlineExceededError, SIMULATION_SOURCE_TIMEOUTS_MS, withinDeadline } from './timeouts';

/** One version's packaged LazyLoad inputs: its printed texts, image literals and runtime pin. */
export interface SimulationLazyloadPackage extends LazyloadTextParts {
  readonly excludedAttributes: readonly string[];
  readonly excludedSrc: readonly string[];
  /** The packaged runtime file's pin (its path is `runtimeJsPath` under the data folder). */
  readonly runtime: { readonly sha256: string; readonly bytes: number };
}

/** One supported WP Rocket version's packaged simulation texts and bundled list. */
export interface SimulationPackage {
  /** The Delay JS runtime file's text. */
  readonly runtime: string;
  /** The IE fallback script's text. */
  readonly fallback: string;
  /** The version's bundled `delay_js_exclusions` rows. */
  readonly bundledListRows: readonly string[];
  /** The version's bundled Defer JS lists. */
  readonly bundledDeferLists: DeferJsLists;
  /** The version's LazyLoad inputs. */
  readonly lazyload: SimulationLazyloadPackage;
}

/** A packaged LazyLoad runtime check: sound, or why it is unusable. */
export type LazyloadRuntimeCheck =
  { readonly ok: true } | { readonly ok: false; readonly cause: SimulationRuntimeUnavailableCause };

/** A runtime source's answer: the version's package, or why there is none. */
export type SimulationPackageRead =
  | { readonly ok: true; readonly package: SimulationPackage }
  | { readonly ok: false; readonly cause: SimulationRuntimeUnavailableCause };

/** The exclusion list a simulation uses, with where it came from. */
export type SimulationListChoice = SimulationListProvenance & {
  readonly listRows: readonly string[];
};

/** Where a host's simulation inputs come from — each one a seam with an inert default. */
export interface SimulationSources {
  /** The packaged inputs of a WP Rocket version. Resolves (never rejects). */
  readonly runtime: (version: string) => Promise<SimulationPackageRead>;
  /**
   * Whether a version's packaged LazyLoad runtime file is sound (readable,
   * its size and sha256 equal to the pin) — asked only for LazyLoad: the
   * page will request that runtime. Resolves (never rejects).
   */
  readonly lazyloadRuntime: (lazyload: SimulationLazyloadPackage) => Promise<LazyloadRuntimeCheck>;
  /** The exclusion list to use for a version, given its bundled rows. Resolves (never rejects). */
  readonly list: (version: string, bundledRows: readonly string[]) => Promise<SimulationListChoice>;
  /** The Defer JS lists to use for a version, given its bundled ones. Resolves (never rejects). */
  readonly deferLists: (version: string, bundled: DeferJsLists) => Promise<SimulationDeferLists>;
  /** The marker id for a document about to be simulated (undefined: none). */
  readonly markerId: (
    document: InterceptedDocument,
    simulate: SimulateSpec
  ) => Promise<string | undefined>;
  /**
   * Narrow a written marker's memo entry to the features that simulated on
   * its document (called only when they differ from the requested ones).
   * Rejects when it cannot: the document is then served unmodified.
   */
  readonly settleMarker: (
    document: InterceptedDocument,
    markerId: string,
    simulated: readonly SimulatedFeatureId[]
  ) => Promise<void>;
  /** The page's raw CSP inputs (undefined: none known), fitted before use. */
  readonly csp: (document: InterceptedDocument, html: string) => unknown;
}

/**
 * The inert sources: no packaged runtime is loaded (`asset-unreachable`,
 * LazyLoad's too), the bundled list (`never-fetched`), no marker, no CSP known.
 */
export const INERT_SIMULATION_SOURCES: SimulationSources = {
  runtime: () => Promise.resolve({ ok: false, cause: 'asset-unreachable' }),
  lazyloadRuntime: () => Promise.resolve({ ok: false, cause: 'asset-unreachable' }),
  list: (_version, bundledRows) =>
    Promise.resolve({ listRows: bundledRows, listSource: 'bundled', listMiss: 'never-fetched' }),
  deferLists: (_version, bundled) =>
    Promise.resolve({ ...bundled, listSource: 'bundled', listMiss: 'never-fetched' }),
  markerId: () => Promise.resolve(undefined),
  settleMarker: () => Promise.resolve(),
  csp: () => undefined
};

/** A preparation: the engine's simulation input, or why the document cannot be simulated. */
export type PreparedSimulation =
  | { readonly ok: true; readonly input: DocumentSimulationInput }
  | { readonly ok: false; readonly cause: SimulationRuntimeUnavailableCause };

/** Prepares one decoded document's simulation (bound to its document and the session's spec). */
export type SimulationPreparer = (html: string) => Promise<PreparedSimulation>;

/**
 * Thrown when a document's simulation inputs cannot be prepared — a source
 * rejected (or threw) or an own input fails the engine contract. Its own
 * type so the host logs it as a preparation failure, not an engine one
 * (the outcome is `engine-failed` either way).
 */
export class SimulationPreparationError extends Error {
  override readonly name = 'SimulationPreparationError';
}

/**
 * The sources, each awaited one under its own deadline
 * ({@link SIMULATION_SOURCE_TIMEOUTS_MS}): a runtime past it reads as
 * `asset-unreachable`, a list (Defer JS's under the list deadline too: both
 * read the same kept record, at once) as the bundled rows (miss `unreadable`: a
 * list source reads only the kept copy, never the network, so a hang is a
 * stuck read, not a fetch timeout); a
 * marker id past it rejects (no simulated page without its id — the
 * document is served unmodified). A source's own rejection passes through.
 *
 * @param sources The sources.
 * @param schedule Timer seam.
 */
export function deadlinedSources(
  sources: SimulationSources,
  schedule: ScheduleTimer = scheduleWithTimeout
): SimulationSources {
  const limits = SIMULATION_SOURCE_TIMEOUTS_MS;
  return {
    runtime: (version) =>
      orOnDeadline(
        withinDeadline(
          'Simulation runtime source',
          limits.runtime,
          () => sources.runtime(version),
          schedule
        ),
        { ok: false, cause: 'asset-unreachable' }
      ),
    lazyloadRuntime: (lazyload) =>
      orOnDeadline(
        withinDeadline(
          'Simulation LazyLoad runtime source',
          limits.runtime,
          () => sources.lazyloadRuntime(lazyload),
          schedule
        ),
        { ok: false, cause: 'asset-unreachable' }
      ),
    list: (version, bundledRows) =>
      orOnDeadline(
        withinDeadline(
          'Simulation list source',
          limits.list,
          () => sources.list(version, bundledRows),
          schedule
        ),
        { listRows: bundledRows, listSource: 'bundled', listMiss: 'unreadable' }
      ),
    deferLists: (version, bundled) =>
      orOnDeadline(
        withinDeadline(
          'Simulation Defer JS lists source',
          limits.list,
          () => sources.deferLists(version, bundled),
          schedule
        ),
        { ...bundled, listSource: 'bundled', listMiss: 'unreadable' }
      ),
    markerId: (document, simulate) =>
      withinDeadline(
        'Simulation marker id source',
        limits.markerId,
        () => sources.markerId(document, simulate),
        schedule
      ),
    settleMarker: (document, markerId, simulated) =>
      withinDeadline(
        'Simulation marker settler',
        limits.settleMarker,
        () => sources.settleMarker(document, markerId, simulated),
        schedule
      ),
    csp: sources.csp
  };
}

/**
 * A deadlined source's answer, or `fallback` when its deadline passed (any
 * other rejection passes through).
 *
 * @param answer The deadlined answer.
 * @param fallback The answer past the deadline.
 */
async function orOnDeadline<T>(answer: Promise<T>, fallback: T): Promise<T> {
  try {
    return await answer;
  } catch (cause) {
    if (cause instanceof DeadlineExceededError) return fallback;
    throw cause;
  }
}

/**
 * Prepare one document's simulation input, every awaited source under its
 * deadline (see {@link deadlinedSources}).
 *
 * @param html The decoded document.
 * @param simulate The session's simulate spec.
 * @param document The intercepted document (what the marker and CSP sources read).
 * @param sources The input sources.
 * @param schedule Timer seam for the source deadlines.
 * @returns The input, or the runtime-unavailable cause.
 * @throws {@link SimulationPreparationError} when a source fails (a marker
 *   id past its deadline included) or an own input fails the engine
 *   contract (a source bug — never page-derived); the original failure is
 *   its `cause`.
 */
export async function prepareSimulation(
  html: string,
  simulate: SimulateSpec,
  document: InterceptedDocument,
  sources: SimulationSources,
  schedule: ScheduleTimer = scheduleWithTimeout
): Promise<PreparedSimulation> {
  try {
    return await assembleSimulation(html, simulate, document, deadlinedSources(sources, schedule));
  } catch (cause) {
    if (cause instanceof SimulationPreparationError) throw cause;
    throw new SimulationPreparationError('A simulation input source failed', { cause });
  }
}

/**
 * {@link prepareSimulation}'s work, unguarded: a source failure propagates as is.
 *
 * @throws {@link SimulationPreparationError} when an own input fails the engine contract.
 */
async function assembleSimulation(
  html: string,
  simulate: SimulateSpec,
  document: InterceptedDocument,
  sources: SimulationSources
): Promise<PreparedSimulation> {
  const { selected, siteVersion } = selectWprVersion(html);
  const read = await sources.runtime(selected.version);
  if (!read.ok) return read;
  const lazyloaded = simulate.features.includes('lazyload');
  // Both lists read the same kept record: asked at once, so one list deadline bounds both;
  // LazyLoad's runtime check is independent of them, asked alongside.
  const [list, deferLists, lazyloadRuntime] = await Promise.all([
    sources.list(selected.version, read.package.bundledListRows),
    simulate.features.includes('defer_all_js')
      ? sources.deferLists(selected.version, read.package.bundledDeferLists)
      : undefined,
    lazyloaded ? sources.lazyloadRuntime(read.package.lazyload) : undefined
  ]);
  const markerId = await sources.markerId(document, simulate);
  const rawCsp = sources.csp(document, html);
  const fitted = fitSiteVersion(siteVersion);
  const draft: DocumentSimulationInput = {
    ...list,
    features: simulate.features,
    wpRocketVersion: selected.version,
    ...(fitted === undefined ? {} : { siteVersion: fitted }),
    runtime: read.package.runtime,
    fallback: read.package.fallback,
    ...(deferLists === undefined ? {} : { deferLists }),
    ...(lazyloadRuntime === undefined
      ? {}
      : {
          lazyload: lazyloadInput(
            read.package.lazyload,
            document.documentUrl,
            lazyloadRuntime.ok ? undefined : lazyloadRuntime.cause
          )
        }),
    ...(markerId === undefined ? {} : { markerId }),
    ...(rawCsp === undefined ? {} : fitSimulationCsp(rawCsp, html.length))
  };
  // The engine contract, checked once here so both engines run it alike.
  const input = parseDocumentSimulationInput(draft, html.length);
  if (input === null) {
    throw new SimulationPreparationError(
      `Simulation input for WP Rocket ${selected.version} fails the engine contract (runtime, fallback, lists or marker id)`
    );
  }
  return { ok: true, input };
}

/**
 * The engine's LazyLoad input from a version's package and the document's URL.
 *
 * @param lazyload The version's LazyLoad package.
 * @param pageUrl The document's URL.
 * @param runtimeUnavailable Why the packaged runtime is unusable (absent: it is sound).
 */
export function lazyloadInput(
  lazyload: SimulationLazyloadPackage,
  pageUrl: string,
  runtimeUnavailable?: SimulationRuntimeUnavailableCause
): SimulationLazyloadInput {
  return {
    pageUrl,
    noJsStyle: lazyload.noJsStyle,
    optionsScript: lazyload.optionsScript,
    runtimeTagBeforeUrl: lazyload.runtimeTagBeforeUrl,
    runtimeTagAfterUrl: lazyload.runtimeTagAfterUrl,
    runtimeJsPath: lazyload.runtimeJsPath,
    excludedAttributes: lazyload.excludedAttributes,
    excludedSrc: lazyload.excludedSrc,
    ...(runtimeUnavailable === undefined ? {} : { runtimeUnavailable })
  };
}

/**
 * Bind a preparer to one document of a session.
 *
 * @param simulate The session's simulate spec.
 * @param document The intercepted document.
 * @param sources The input sources.
 */
export function simulationPreparer(
  simulate: SimulateSpec,
  document: InterceptedDocument,
  sources: SimulationSources
): SimulationPreparer {
  return (html) => prepareSimulation(html, simulate, document, sources);
}

/**
 * Bind the marker settler to one document of a session, under its
 * deadline (see {@link deadlinedSources}); a failure rejects as a
 * {@link SimulationPreparationError} (the host logs it as one).
 *
 * @param document The intercepted document.
 * @param sources The input sources.
 * @param schedule Timer seam for the deadline.
 */
export function simulationMarkerSettler(
  document: InterceptedDocument,
  sources: SimulationSources,
  schedule: ScheduleTimer = scheduleWithTimeout
): MarkerSettler {
  const deadlined = deadlinedSources(sources, schedule);
  return async (markerId, simulated) => {
    try {
      await deadlined.settleMarker(document, markerId, simulated);
    } catch (cause) {
      throw new SimulationPreparationError(
        'The simulation marker could not be narrowed to the simulated features',
        { cause }
      );
    }
  };
}

/** Narrows one document's written marker to the features that simulated on it (rejects when it cannot). */
export type MarkerSettler = (
  markerId: string,
  simulated: readonly SimulatedFeatureId[]
) => Promise<void>;
