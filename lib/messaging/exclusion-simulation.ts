/**
 * The simulation half of the exclusion-builder session contract: what a
 * session asks to simulate (`simulate`), what the engine is handed to do it
 * (the packaged runtime, the exclusion list, the marker id, the page's
 * CSP), what one document's simulation reports, and the marker
 * verification ask. Values are the simulation vocabulary
 * (`lib/wp-rocket-simulation/spec`), re-validated here — never re-declared.
 *
 * Guards follow `./exclusion-session`'s rules: they return the freshly
 * rebuilt value or `null` (never throw), read own properties only, refuse
 * unknown keys under `'reject'` (messages) and drop them under `'ignore'`
 * (storage). Every field is additive: a value without them parses exactly
 * as before.
 *
 * Page-derived optional inputs degrade, never fail: an unfit served
 * version string is omitted (a non-string is type drift and fails), an unfit CSP becomes `cspUnavailable` (truncating a
 * policy would change its meaning). Failing the engine request on them
 * would leave the document unsimulated and misreported. The extension's
 * own inputs (runtime, fallback, list rows, versions it selects) keep
 * strict caps.
 */
import { EXCLUSION_FEATURES, type ExclusionSet } from '../exclusion-builder/set';
import {
  LATEST_LIST_MISSES,
  SIMULATED_FEATURES,
  SIMULATION_CAVEATS,
  SIMULATION_CSP_BROWSERS,
  SIMULATION_CSP_LIMITS,
  SIMULATION_CSP_UNAVAILABLE_REASONS,
  SIMULATION_LIST_LIMITS,
  SIMULATION_LIST_SOURCES,
  SIMULATION_MARKER_ID_PATTERN,
  SIMULATION_RUNTIME_UNAVAILABLE_CAUSES,
  SIMULATION_REPORT_VOCABULARY,
  type LatestListMiss,
  type SimulateSpec,
  type SimulatedFeatureId,
  type SimulationCaveat,
  type SimulationCspBrowser,
  type SimulationCspLimit,
  type SimulationCspUnavailableReason,
  type SimulationListSource,
  type SimulationReportVocabulary,
  type SimulationNotApplicableReason,
  type SimulationRuntimeUnavailableCause,
  type SimulationState,
  type UnreproducedRegex
} from '../wp-rocket-simulation/spec';
import { WPR_VERSION_NUMBER_SOURCE } from '../wp-rocket/constants';
import { supportedWprVersion } from '../wp-rocket/versions';
import { isRecord, ownValue } from '../../utils/is-record';
import { isPrintable } from './error-words';
import { isCount, keysAllowed, type UnknownKeyPolicy } from './guard-policy';

/**
 * Size caps of the simulation fields (sanity caps, far above real values).
 * Over a page-derived cap the value degrades (see the module doc); over
 * one of the extension's own, the request fails.
 */
export const SIMULATION_WIRE_LIMITS = {
  /** Characters of a version string (`3.23.5.1`; a served meta's may be anything). */
  versionChars: 64,
  /** Characters of the runtime text (WP Rocket's is ~14.5 KB). */
  runtimeChars: 256 * 1024,
  /** Characters of the IE fallback text (WP Rocket's is 476 B). */
  fallbackChars: 16 * 1024,
  /** CSP header lines, and CSP metas, carried per document. */
  cspEntries: 32,
  /** Characters of a CSP header name. */
  cspNameChars: 64,
  /** Characters of one CSP header value or meta content. */
  cspValueChars: 32 * 1024
} as const;

/**
 * Each list source's one companion fact: the fetch time of a `latest` list
 * (epoch ms), or why no latest copy was usable for a `bundled` one. Keyed
 * by the vocabulary, so a new source fails to compile until it has one.
 */
interface ListSourceFacts {
  readonly latest: { readonly listFetchedAt: number };
  readonly bundled: { readonly listMiss: LatestListMiss };
}

/** Where a simulation's exclusion list came from, with its companion fact. */
export type SimulationListProvenance = {
  [Source in SimulationListSource]: { readonly listSource: Source } & ListSourceFacts[Source];
}[SimulationListSource];

/** What every simulated feature's report carries. */
type SimulationReportBase = SimulationListProvenance & {
  readonly state: SimulationState;
  /** With `not-applicable` only (required there). */
  readonly reason?: SimulationNotApplicableReason;
  /** With `beyond-exact-reproduction` only (required there): the regex that could stop. */
  readonly unreproducedRegex?: UnreproducedRegex;
  /** The WP Rocket version simulated. */
  readonly wpRocketVersion: string;
  /** The version the page's generator meta serves, when it has one. */
  readonly siteVersion?: string;
  /** The simulation marker's id written into the page (`simulated` only). */
  readonly markerId?: string;
};

/** One document's Delay JS simulation (its feature's values: {@link SIMULATION_REPORT_VOCABULARY}). */
export type DelaySimulationReport = SimulationReportBase & {
  readonly feature: 'delay_js';
  /** Scripts the step delayed (0 unless `simulated`). */
  readonly delayed: number;
  /** Scripts left as served because their verdict depends on WP Rocket's random ids (positive; `simulated` only). */
  readonly undetermined?: number;
  /** WP Rocket's Delay JS regex hits PCRE's backtrack limit here: nothing delayed (`simulated` only). */
  readonly regexLimitHit?: true;
  /** Whether the runtime and IE fallback were injected (false unless `simulated`). */
  readonly runtimeInjected: boolean;
  /** Runtime work the page's CSP blocks, each once (non-empty; `simulated` only). */
  readonly cspLimits?: readonly SimulationCspLimit[];
  /** Why the page's CSP was not evaluated (`simulated` only; never with `cspLimits`). */
  readonly cspUnavailable?: SimulationCspUnavailableReason;
  /** What the simulation cannot reproduce here, each once (non-empty; `simulated` only). */
  readonly caveats?: readonly SimulationCaveat[];
};

/**
 * One document's Defer JS simulation: no runtime, so no CSP facts (its
 * feature's values: {@link SIMULATION_REPORT_VOCABULARY}).
 */
export type DeferSimulationReport = SimulationReportBase & {
  readonly feature: 'defer_all_js';
  /** External scripts it deferred (0 unless `simulated`). */
  readonly deferred: number;
  /** Inline jQuery scripts it wrapped (0 unless `simulated`). */
  readonly wrapped: number;
};

/** One document's simulation of one feature, as the `rewritten` outcome reports it. */
export type DocumentSimulationReport = DelaySimulationReport | DeferSimulationReport;

/** One CSP response header line as received (Firefox may join repeated lines with `, `). */
export interface SimulationCspHeader {
  readonly name: string;
  readonly value: string;
}

/** One `<meta http-equiv>` CSP policy and its offset in the document text. */
export interface SimulationCspMeta {
  readonly content: string;
  readonly offset: number;
}

/** The page's Content Security Policy inputs, for the browser engine that renders it. */
export interface SimulationCspInput {
  readonly browser: SimulationCspBrowser;
  readonly headers: readonly SimulationCspHeader[];
  readonly metas: readonly SimulationCspMeta[];
  /** An applied `<meta>` CSP could not be read (its policy is unknown, never dropped). */
  readonly metasUnreadable?: true;
}

/**
 * The Defer JS lists a run uses — both from one source, so one provenance
 * (echoed into the Defer JS report).
 */
export type SimulationDeferLists = SimulationListProvenance & {
  /** `defer_js_external_exclusions`: script URL parts Defer JS never defers. */
  readonly external: readonly string[];
  /** `defer_js_inline_exclusions`: inline texts Defer JS never wraps. */
  readonly inline: readonly string[];
};

/**
 * What one engine run needs to simulate: the session's features, the
 * selected WP Rocket version's packaged runtime and IE fallback texts,
 * the exclusion list rows in use with their provenance (echoed into the
 * report), and the optional marker id and CSP inputs.
 */
export type DocumentSimulationInput = SimulationListProvenance & {
  readonly features: readonly SimulatedFeatureId[];
  /** The WP Rocket version simulated (its runtime, fallback and bundled list). */
  readonly wpRocketVersion: string;
  /** The version the page's generator meta serves, when it has one. */
  readonly siteVersion?: string;
  /** The runtime file's text. */
  readonly runtime: string;
  /** The IE fallback script's text. */
  readonly fallback: string;
  /** The exclusion list's rows. */
  readonly listRows: readonly string[];
  /** The Defer JS lists — present exactly when the run simulates Defer JS. */
  readonly deferLists?: SimulationDeferLists;
  /** The id the marker carries when the step simulates. */
  readonly markerId?: string;
  /** Absent (and no `cspUnavailable`): no policy is known (the runtime is taken as allowed). */
  readonly csp?: SimulationCspInput;
  /** The page's CSP could not be evaluated (never with `csp`): reported, never read as "no CSP". */
  readonly cspUnavailable?: SimulationCspUnavailableReason;
};

/** Content script → background: is this marker one the tab's session wrote? */
export interface SimulationMarkerQuery {
  readonly markerId: string;
}

/** The background's verdict: the features the marker vouches for (empty = unverified). */
export interface SimulationMarkerVerdict {
  readonly features: readonly SimulatedFeatureId[];
}

/**
 * The value of a closed list, or `undefined` (own lookup by identity, so a
 * non-string never matches).
 */
function oneOf<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return list.find((entry) => entry === value);
}

/** Whether a value is a simulated feature id (registry-derived). */
export function isSimulatedFeatureId(value: unknown): value is SimulatedFeatureId {
  return SIMULATED_FEATURES.some((feature) => feature.id === value);
}

/** Whether a value is a well-formed marker id (32 lowercase hex). */
export function isSimulationMarkerId(value: unknown): value is string {
  return typeof value === 'string' && SIMULATION_MARKER_ID_PATTERN.test(value);
}

/** A whole WP Rocket version number (the detection's own grammar, anchored). */
const WIRE_VERSION_PATTERN = new RegExp(`^${WPR_VERSION_NUMBER_SOURCE}$`);

/** A version string as the registry writes it: 1–4 dot-separated numbers, within the cap. */
function isWireVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= SIMULATION_WIRE_LIMITS.versionChars &&
    WIRE_VERSION_PATTERN.test(value)
  );
}

/**
 * A served meta's version as carried: printable text within the cap — the
 * site writes it, so an unfit one is omitted, never a failure.
 *
 * @param value The raw value (absent or not).
 * @returns The version, or `undefined` when absent or unfit.
 */
export function fitSiteVersion(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= SIMULATION_WIRE_LIMITS.versionChars &&
    isPrintable(value)
    ? value
    : undefined;
}

/**
 * A message's `siteVersion` field: the page-derived text degrades (an unfit
 * string is omitted, see {@link fitSiteVersion}), but a non-string is our
 * own type drift and fails the message.
 *
 * @param value The raw field (absent or not).
 * @returns The field to spread (empty when absent or unfit), or null when
 *   present and not a string.
 */
function siteVersionField(value: unknown): { readonly siteVersion?: string } | null {
  if (value === undefined) return {};
  if (typeof value !== 'string') return null;
  const siteVersion = fitSiteVersion(value);
  return siteVersion === undefined ? {} : { siteVersion };
}

/**
 * A non-empty list of distinct values of a closed vocabulary.
 *
 * @param value The raw list.
 * @param vocabulary The allowed values.
 * @returns The list rebuilt, or null when not an array, empty, holding an
 *   unknown or repeated value, or longer than the vocabulary.
 */
function distinctList<T extends string>(value: unknown, vocabulary: readonly T[]): T[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > vocabulary.length) return null;
  const list: T[] = [];
  for (const entry of value) {
    const known = oneOf(vocabulary, entry);
    if (known === undefined || list.includes(known)) return null;
    list.push(known);
  }
  return list;
}

/** The simulated feature ids, in registry order (registry-derived, never re-typed). */
const SIMULATED_FEATURE_IDS: readonly SimulatedFeatureId[] = SIMULATED_FEATURES.map(
  (feature) => feature.id
);

/**
 * Parse a simulate spec: `{ features }`, at least one registry feature,
 * each once.
 *
 * @param input The untrusted value.
 * @param policy Unknown-key policy.
 * @returns A fresh spec, or null on any violation.
 */
export function parseSimulateSpec(input: unknown, policy: UnknownKeyPolicy): SimulateSpec | null {
  if (!isRecord(input) || !keysAllowed(input, ['features'], policy)) return null;
  const features = distinctList(ownValue(input, 'features'), SIMULATED_FEATURE_IDS);
  return features === null ? null : { features };
}

/**
 * Whether a set disables a feature the spec simulates — a contradictory
 * pair no surface produces (a disabled feature cannot also be simulated):
 * request guards refuse it, a stored set drops the simulation.
 *
 * @param set The exclusion set.
 * @param simulate The simulate spec.
 */
export function simulateContradictsSet(set: ExclusionSet, simulate: SimulateSpec): boolean {
  return simulate.features.some((id) => {
    const toggle = EXCLUSION_FEATURES.find((feature) => feature.id === id)?.toggleKey ?? null;
    return toggle !== null && set.disable[toggle];
  });
}

/**
 * Read an optional simulate spec beside a set: absent stays absent, a
 * malformed or contradictory one fails.
 *
 * @param raw The raw `simulate` value.
 * @param set The set it rides with.
 * @param policy Unknown-key policy.
 * @returns The spec, `undefined` when absent, or `null` when invalid.
 */
export function optionalSimulateFor(
  raw: unknown,
  set: ExclusionSet,
  policy: UnknownKeyPolicy
): SimulateSpec | undefined | null {
  if (raw === undefined) return undefined;
  const simulate = parseSimulateSpec(raw, policy);
  return simulate === null || simulateContradictsSet(set, simulate) ? null : simulate;
}

/**
 * Parse a list provenance from a record's flat fields: `latest` with its
 * fetch time and no miss, or `bundled` with its miss and no fetch time.
 *
 * @param input The record holding `listSource`, `listFetchedAt`, `listMiss`.
 * @returns The provenance, or null on any violation.
 */
function parseListProvenance(input: Record<string, unknown>): SimulationListProvenance | null {
  const fetchedAt = ownValue(input, 'listFetchedAt');
  const miss = ownValue(input, 'listMiss');
  switch (oneOf(SIMULATION_LIST_SOURCES, ownValue(input, 'listSource'))) {
    case 'latest':
      return isCount(fetchedAt) && miss === undefined
        ? { listSource: 'latest', listFetchedAt: fetchedAt }
        : null;
    case 'bundled': {
      const known = oneOf(LATEST_LIST_MISSES, miss);
      return known !== undefined && fetchedAt === undefined
        ? { listSource: 'bundled', listMiss: known }
        : null;
    }
    default:
      return null;
  }
}

/** The keys every simulated feature's report may carry. */
const REPORT_BASE_KEYS = [
  'feature',
  'state',
  'reason',
  'unreproducedRegex',
  'wpRocketVersion',
  'siteVersion',
  'listSource',
  'listFetchedAt',
  'listMiss',
  'markerId'
] as const;

/** Per feature, the keys only its report carries (another feature's report naming one is malformed). */
const REPORT_FEATURE_KEYS = {
  defer_all_js: ['deferred', 'wrapped'],
  delay_js: [
    'delayed',
    'undetermined',
    'regexLimitHit',
    'runtimeInjected',
    'cspLimits',
    'cspUnavailable',
    'caveats'
  ]
} as const satisfies Record<SimulatedFeatureId, readonly string[]>;

/** Every key some report carries. */
const REPORT_KEYS: readonly string[] = [
  ...REPORT_BASE_KEYS,
  ...Object.values(REPORT_FEATURE_KEYS).flat()
];

/**
 * Whether a record names a key only another feature's report carries.
 *
 * @param input The report record.
 * @param feature The report's feature.
 */
function namesOtherFeatureKey(
  input: Record<string, unknown>,
  feature: SimulatedFeatureId
): boolean {
  return SIMULATED_FEATURES.some(
    ({ id }) =>
      id !== feature &&
      REPORT_FEATURE_KEYS[id].some((key: string) => ownValue(input, key) !== undefined)
  );
}

/** A report's identity-state why: the reason and regex pairing. */
type ReportWhy = Pick<DocumentSimulationReport, 'reason' | 'unreproducedRegex'>;

/**
 * A report's `reason` + `unreproducedRegex`, each from its feature's
 * vocabulary: a reason with `not-applicable` only (required there), a
 * regex with `beyond-exact-reproduction` only (required there).
 *
 * @returns The pair present, or null when invalid.
 */
function parseReportWhy(
  input: Record<string, unknown>,
  state: SimulationState,
  vocabulary: SimulationReportVocabulary
): ReportWhy | null {
  const rawReason = ownValue(input, 'reason');
  const rawRegex = ownValue(input, 'unreproducedRegex');
  if (state !== 'not-applicable') {
    return rawReason === undefined && rawRegex === undefined ? {} : null;
  }
  const reason = oneOf(vocabulary.reasons, rawReason);
  if (reason === undefined) return null;
  if (reason !== 'beyond-exact-reproduction') return rawRegex === undefined ? { reason } : null;
  const regex = oneOf(vocabulary.regexes, rawRegex);
  return regex === undefined ? null : { reason, unreproducedRegex: regex };
}

/** A Delay JS report's `simulated`-only facts, parsed (see {@link parseDelayFacts}). */
type DelayFacts = Pick<
  DelaySimulationReport,
  'undetermined' | 'regexLimitHit' | 'cspLimits' | 'cspUnavailable' | 'caveats'
>;

/**
 * A Delay JS report's optional facts that only a step that ran can carry:
 * each absent or valid (a positive `undetermined`, `regexLimitHit` exactly
 * `true` — and then nothing delayed nor undetermined —, non-empty distinct
 * CSP limits or a CSP-unavailable reason (not both: an unevaluated policy
 * names no limit), non-empty distinct caveats); on an identity state, none.
 *
 * @returns The facts present, or null when invalid.
 */
function parseDelayFacts(
  input: Record<string, unknown>,
  state: SimulationState,
  delayed: number
): DelayFacts | null {
  const undetermined = ownValue(input, 'undetermined');
  const limitHit = ownValue(input, 'regexLimitHit');
  const rawLimits = ownValue(input, 'cspLimits');
  const rawUnavailable = ownValue(input, 'cspUnavailable');
  const rawCaveats = ownValue(input, 'caveats');
  const present = [undetermined, limitHit, rawLimits, rawUnavailable, rawCaveats];
  if (state !== 'simulated') return present.every((fact) => fact === undefined) ? {} : null;
  if (undetermined !== undefined && (!isCount(undetermined) || undetermined < 1)) return null;
  if (limitHit !== undefined && limitHit !== true) return null;
  if (limitHit === true && (delayed > 0 || undetermined !== undefined)) return null;
  const cspLimits =
    rawLimits === undefined ? undefined : distinctList(rawLimits, SIMULATION_CSP_LIMITS);
  const caveats =
    rawCaveats === undefined ? undefined : distinctList(rawCaveats, SIMULATION_CAVEATS);
  if (cspLimits === null || caveats === null) return null;
  const cspUnavailable =
    rawUnavailable === undefined
      ? undefined
      : oneOf(SIMULATION_CSP_UNAVAILABLE_REASONS, rawUnavailable);
  if (rawUnavailable !== undefined && (cspUnavailable === undefined || cspLimits !== undefined)) {
    return null;
  }
  return {
    ...(undetermined === undefined ? {} : { undetermined }),
    ...(limitHit === undefined ? {} : { regexLimitHit: true as const }),
    ...(cspLimits === undefined ? {} : { cspLimits }),
    ...(cspUnavailable === undefined ? {} : { cspUnavailable }),
    ...(caveats === undefined ? {} : { caveats })
  };
}

/**
 * A Delay JS report's own fields: the counts (nothing delayed and no
 * runtime on an identity state) and its `simulated`-only facts.
 *
 * @returns The fields, or null on any violation.
 */
function parseDelayFields(
  input: Record<string, unknown>,
  state: SimulationState
): Omit<DelaySimulationReport, keyof SimulationReportBase | 'feature'> | null {
  const delayed = ownValue(input, 'delayed');
  const runtimeInjected = ownValue(input, 'runtimeInjected');
  if (!isCount(delayed) || typeof runtimeInjected !== 'boolean') return null;
  if (state !== 'simulated' && (delayed > 0 || runtimeInjected)) return null;
  const facts = parseDelayFacts(input, state, delayed);
  return facts === null ? null : { delayed, runtimeInjected, ...facts };
}

/**
 * A Defer JS report's own fields: both counts (0 unless `simulated`).
 *
 * @returns The counts, or null when invalid.
 */
function parseDeferFields(
  input: Record<string, unknown>,
  state: SimulationState
): Pick<DeferSimulationReport, 'deferred' | 'wrapped'> | null {
  const deferred = ownValue(input, 'deferred');
  const wrapped = ownValue(input, 'wrapped');
  if (!isCount(deferred) || !isCount(wrapped)) return null;
  if (state !== 'simulated' && (deferred > 0 || wrapped > 0)) return null;
  return { deferred, wrapped };
}

/**
 * Parse one document's simulation report against the session's spec: a
 * feature the session simulates, a state, reason and regex of that
 * feature's vocabulary, no field of another feature's report, the
 * feature's own fields, the versions, the list provenance pairing and the
 * marker id (`simulated` only). The served version is page-derived: an
 * unfit string is omitted, never failing the report (and with it the
 * document's outcome); a non-string fails it.
 *
 * @param input The untrusted value.
 * @param simulate The session's simulate spec (absent: no report can be valid).
 * @param policy Unknown-key policy.
 * @returns A fresh report, or null on any violation.
 */
export function parseDocumentSimulationReport(
  input: unknown,
  simulate: SimulateSpec | undefined,
  policy: UnknownKeyPolicy
): DocumentSimulationReport | null {
  if (simulate === undefined || !isRecord(input) || !keysAllowed(input, REPORT_KEYS, policy)) {
    return null;
  }
  const feature = ownValue(input, 'feature');
  if (!isSimulatedFeatureId(feature) || !simulate.features.includes(feature)) return null;
  if (namesOtherFeatureKey(input, feature)) return null;
  const vocabulary: SimulationReportVocabulary = SIMULATION_REPORT_VOCABULARY[feature];
  const state = oneOf(vocabulary.states, ownValue(input, 'state'));
  const wpRocketVersion = ownValue(input, 'wpRocketVersion');
  const siteVersion = siteVersionField(ownValue(input, 'siteVersion'));
  const markerId = ownValue(input, 'markerId');
  if (state === undefined || siteVersion === null || !isWireVersion(wpRocketVersion)) return null;
  if (markerId !== undefined && (state !== 'simulated' || !isSimulationMarkerId(markerId))) {
    return null;
  }
  const why = parseReportWhy(input, state, vocabulary);
  const list = parseListProvenance(input);
  if (why === null || list === null) return null;
  const base = {
    state,
    ...why,
    wpRocketVersion,
    ...siteVersion,
    ...list,
    ...(markerId === undefined ? {} : { markerId })
  };
  if (feature === 'defer_all_js') {
    const fields = parseDeferFields(input, state);
    return fields === null ? null : { feature, ...base, ...fields };
  }
  const fields = parseDelayFields(input, state);
  return fields === null ? null : { feature, ...base, ...fields };
}

/** Whether a value is a runtime-unavailable cause. */
export function isSimulationRuntimeUnavailableCause(
  value: unknown
): value is SimulationRuntimeUnavailableCause {
  return oneOf(SIMULATION_RUNTIME_UNAVAILABLE_CAUSES, value) !== undefined;
}

/** A bounded text: a string of at most `max` characters (and at least `min`). */
function isBoundedText(value: unknown, max: number, min = 0): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

/** A CSP part rebuilt, or why the policy cannot be evaluated. */
type CspPart<T> = T | SimulationCspUnavailableReason;

/** Whether a CSP part is a reason it cannot be evaluated (the parts are records otherwise). */
function isCspUnavailable<T extends object>(
  part: CspPart<T>
): part is SimulationCspUnavailableReason {
  return typeof part === 'string';
}

/**
 * A bounded CSP text: `oversized` past `max`, `unreadable` when not a
 * string or shorter than `min`.
 */
function cspText(value: unknown, max: number, min = 0): CspPart<{ readonly text: string }> {
  if (typeof value !== 'string' || value.length < min) return 'unreadable';
  return value.length > max ? 'oversized' : { text: value };
}

/**
 * A bounded list of CSP records, each rebuilt by `parse`.
 *
 * @returns The rebuilt list; `oversized` past the entry cap or when an
 *   entry is; `unreadable` when not an array or an entry is not readable.
 */
function cspRecords<T extends object>(
  value: unknown,
  parse: (entry: Record<string, unknown>) => CspPart<T>
): CspPart<{ readonly list: T[] }> {
  if (!Array.isArray(value)) return 'unreadable';
  if (value.length > SIMULATION_WIRE_LIMITS.cspEntries) return 'oversized';
  const list: T[] = [];
  for (const entry of value) {
    const parsed = isRecord(entry) ? parse(entry) : 'unreadable';
    if (isCspUnavailable(parsed)) return parsed;
    list.push(parsed);
  }
  return { list };
}

/** Parse one CSP header line (exact keys). */
function cspHeader(entry: Record<string, unknown>): CspPart<SimulationCspHeader> {
  if (!keysAllowed(entry, ['name', 'value'], 'reject')) return 'unreadable';
  const name = cspText(ownValue(entry, 'name'), SIMULATION_WIRE_LIMITS.cspNameChars, 1);
  if (isCspUnavailable(name)) return name;
  const value = cspText(ownValue(entry, 'value'), SIMULATION_WIRE_LIMITS.cspValueChars);
  return isCspUnavailable(value) ? value : { name: name.text, value: value.text };
}

/** Parse one CSP meta (exact keys), its offset inside the document. */
function cspMeta(entry: Record<string, unknown>, htmlLength: number): CspPart<SimulationCspMeta> {
  if (!keysAllowed(entry, ['content', 'offset'], 'reject')) return 'unreadable';
  const offset = ownValue(entry, 'offset');
  if (!isCount(offset) || offset > htmlLength) return 'unreadable';
  const content = cspText(ownValue(entry, 'content'), SIMULATION_WIRE_LIMITS.cspValueChars);
  return isCspUnavailable(content) ? content : { content: content.text, offset };
}

/**
 * Fit a page's CSP inputs to the engine contract — the one rule both
 * engines' hosts apply before a run, and the engine re-applies on receipt
 * (exact keys): a known browser, bounded header lines and metas, each meta
 * at an offset inside the document, `metasUnreadable` absent or exactly
 * `true`. A policy past a bound is `oversized`
 * (truncating it would change its meaning) and one that cannot be read is
 * `unreadable` — then carried as `cspUnavailable`, never dropped as "no CSP".
 *
 * @param input The untrusted value.
 * @param htmlLength The document text's length (meta offsets lie within it).
 * @returns `{ csp }` rebuilt, or `{ cspUnavailable }` with the reason.
 */
export function fitSimulationCsp(
  input: unknown,
  htmlLength: number
):
  | { readonly csp: SimulationCspInput }
  | { readonly cspUnavailable: SimulationCspUnavailableReason } {
  const keys = ['browser', 'headers', 'metas', 'metasUnreadable'];
  if (!isRecord(input) || !keysAllowed(input, keys, 'reject')) {
    return { cspUnavailable: 'unreadable' };
  }
  const browser = oneOf(SIMULATION_CSP_BROWSERS, ownValue(input, 'browser'));
  const metasUnreadable = ownValue(input, 'metasUnreadable');
  if (browser === undefined || (metasUnreadable !== undefined && metasUnreadable !== true)) {
    return { cspUnavailable: 'unreadable' };
  }
  const headers = cspRecords(ownValue(input, 'headers'), cspHeader);
  if (isCspUnavailable(headers)) return { cspUnavailable: headers };
  const metas = cspRecords(ownValue(input, 'metas'), (entry) => cspMeta(entry, htmlLength));
  if (isCspUnavailable(metas)) return { cspUnavailable: metas };
  return {
    csp: {
      browser,
      headers: headers.list,
      metas: metas.list,
      ...(metasUnreadable === true ? { metasUnreadable } : {})
    }
  };
}

/**
 * Read an input's CSP pair: a host-given `cspUnavailable` (a known reason)
 * or a `csp`, fitted (see {@link fitSimulationCsp}). Both at once is
 * contradictory — the host fits one into the other, so it is our own
 * contract bug and fails the request, like every other contradictory pair
 * in this module.
 *
 * @returns The pair present (empty when neither), or null when both are
 *   given or the host-given reason is not a known one.
 */
function inputCsp(
  input: Record<string, unknown>,
  htmlLength: number
): Pick<DocumentSimulationInput, 'csp' | 'cspUnavailable'> | null {
  const rawUnavailable = ownValue(input, 'cspUnavailable');
  const rawCsp = ownValue(input, 'csp');
  if (rawUnavailable !== undefined) {
    const reason = oneOf(SIMULATION_CSP_UNAVAILABLE_REASONS, rawUnavailable);
    return reason === undefined || rawCsp !== undefined ? null : { cspUnavailable: reason };
  }
  return rawCsp === undefined ? {} : fitSimulationCsp(rawCsp, htmlLength);
}

/**
 * Parse an exclusion list's rows as the engine contract takes them: at
 * most the list cap, each a string of 1 to the row cap characters.
 *
 * @param value The candidate rows.
 * @returns The rows rebuilt, or null on any violation.
 */
export function parseSimulationListRows(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > SIMULATION_LIST_LIMITS.rows) return null;
  const rows: string[] = [];
  for (const row of value) {
    if (!isBoundedText(row, SIMULATION_LIST_LIMITS.rowChars, 1)) return null;
    rows.push(row);
  }
  return rows;
}

/** The keys a simulation input carries. */
const INPUT_KEYS = [
  'features',
  'wpRocketVersion',
  'siteVersion',
  'runtime',
  'fallback',
  'listRows',
  'deferLists',
  'listSource',
  'listFetchedAt',
  'listMiss',
  'markerId',
  'csp',
  'cspUnavailable'
] as const;

/** The keys the Defer JS lists carry. */
const DEFER_LISTS_KEYS = ['external', 'inline', 'listSource', 'listFetchedAt', 'listMiss'] as const;

/**
 * Parse the Defer JS lists (exact keys): both lists within the list caps,
 * and their provenance.
 *
 * @param input The untrusted value.
 * @returns The lists rebuilt, or null on any violation.
 */
export function parseSimulationDeferLists(input: unknown): SimulationDeferLists | null {
  if (!isRecord(input) || !keysAllowed(input, DEFER_LISTS_KEYS, 'reject')) return null;
  const external = parseSimulationListRows(ownValue(input, 'external'));
  const inline = parseSimulationListRows(ownValue(input, 'inline'));
  const list = parseListProvenance(input);
  return external === null || inline === null || list === null
    ? null
    : { ...list, external, inline };
}

/**
 * The input's Defer JS lists: present exactly when the run simulates Defer
 * JS, and then only for a supported WP Rocket version (its inline-list
 * quoting is version-keyed).
 *
 * @returns The field to spread (empty when absent), or null when invalid.
 */
function inputDeferLists(
  input: Record<string, unknown>,
  features: readonly SimulatedFeatureId[],
  wpRocketVersion: string
): Pick<DocumentSimulationInput, 'deferLists'> | null {
  const raw = ownValue(input, 'deferLists');
  if (!features.includes('defer_all_js')) return raw === undefined ? {} : null;
  if (supportedWprVersion(wpRocketVersion) === undefined) return null;
  const deferLists = parseSimulationDeferLists(raw);
  return deferLists === null ? null : { deferLists };
}

/**
 * Parse an engine request's simulation input (exact keys — host and
 * engine ship in one build; Defer JS lists exactly with Defer JS, for a
 * supported version). Page-derived parts degrade instead of failing
 * the request: an unfit `siteVersion` string is omitted, an unfit `csp`
 * becomes `cspUnavailable`; a non-string `siteVersion` or a `csp` beside a
 * `cspUnavailable` is our own bug and fails it.
 *
 * @param input The untrusted value.
 * @param htmlLength The document text's length (CSP meta offsets lie within it).
 * @returns A fresh input, or null on any violation.
 */
export function parseDocumentSimulationInput(
  input: unknown,
  htmlLength: number
): DocumentSimulationInput | null {
  if (!isRecord(input) || !keysAllowed(input, INPUT_KEYS, 'reject')) return null;
  const spec = parseSimulateSpec({ features: ownValue(input, 'features') }, 'reject');
  const wpRocketVersion = ownValue(input, 'wpRocketVersion');
  const siteVersion = siteVersionField(ownValue(input, 'siteVersion'));
  const runtime = ownValue(input, 'runtime');
  const fallback = ownValue(input, 'fallback');
  const markerId = ownValue(input, 'markerId');
  if (spec === null || siteVersion === null || !isWireVersion(wpRocketVersion)) return null;
  if (!isBoundedText(runtime, SIMULATION_WIRE_LIMITS.runtimeChars, 1)) return null;
  if (!isBoundedText(fallback, SIMULATION_WIRE_LIMITS.fallbackChars, 1)) return null;
  if (markerId !== undefined && !isSimulationMarkerId(markerId)) return null;
  const listRows = parseSimulationListRows(ownValue(input, 'listRows'));
  const list = parseListProvenance(input);
  const csp = inputCsp(input, htmlLength);
  const defer = inputDeferLists(input, spec.features, wpRocketVersion);
  if (listRows === null || list === null || csp === null || defer === null) return null;
  return {
    features: spec.features,
    wpRocketVersion,
    ...siteVersion,
    runtime,
    fallback,
    listRows,
    ...defer,
    ...list,
    ...(markerId === undefined ? {} : { markerId }),
    ...csp
  };
}

/**
 * Parse the marker verification ask (exact keys).
 *
 * @param input The untrusted payload.
 * @returns The query, or null on any violation.
 */
export function parseSimulationMarkerQuery(input: unknown): SimulationMarkerQuery | null {
  if (!isRecord(input) || !keysAllowed(input, ['markerId'], 'reject')) return null;
  const markerId = ownValue(input, 'markerId');
  return isSimulationMarkerId(markerId) ? { markerId } : null;
}

/**
 * Parse the marker verdict (exact keys): distinct registry features, empty
 * meaning unverified.
 *
 * @param input The untrusted value.
 * @returns The verdict, or null on any violation.
 */
export function parseSimulationMarkerVerdict(input: unknown): SimulationMarkerVerdict | null {
  if (!isRecord(input) || !keysAllowed(input, ['features'], 'reject')) return null;
  const raw = ownValue(input, 'features');
  if (Array.isArray(raw) && raw.length === 0) return { features: [] };
  const features = distinctList(raw, SIMULATED_FEATURE_IDS);
  return features === null ? null : { features };
}
