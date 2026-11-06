/**
 * The LCP analysis's message contract (`runLcpAnalysis`, DevTools panel →
 * the tab's top frame) and its boundary guards.
 *
 * The page answers plain timing facts — the navigation's first byte and
 * prerender activation offset, the
 * deduplicated LCP candidates (the last is the page's LCP), the LCP
 * resource's timing — and the panel computes the breakdown from them. An
 * element is described by its tag, id and first classes only: never its
 * markup.
 */
import { cappedUnits } from '../../utils/cap-text';
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import type { NavigationTiming, ResourceTiming } from '../lcp-analysis/breakdown';
import { boundedString, isTiming } from './guard-policy';

/** Bounds of the answer (the page caps strings with `capText` before sending). */
export const LCP_ANALYSIS_LIMITS = {
  /** Candidates kept (the latest ones; the page's LCP is the last). */
  candidates: 100,
  /** A URL's code points (an ellipsis marks a cut). */
  urlPoints: 4096,
  /** A tag name's, an id's or a class name's code points. */
  namePoints: 256,
  /** Class names kept per element. */
  classes: 10
} as const;

/** Panel → tab: analyse the page's LCP; optionally highlight its element. */
export interface LcpAnalysisRequest {
  readonly highlight: boolean;
}

/** A candidate's element, described without its markup. */
export interface LcpElementFacts {
  /** The local name (`img`, `h1`, …). */
  readonly tag: string;
  /** `''` when absent. */
  readonly id: string;
  /** The first {@link LCP_ANALYSIS_LIMITS}`.classes` class names. */
  readonly classes: readonly string[];
}

/** One LCP candidate's facts. */
export interface LcpCandidateFacts {
  /** Render time, else load time (ms). */
  readonly startTime: number;
  /** ms; 0 when the browser withholds it (cross-origin image without timing consent). */
  readonly renderTime: number;
  /** ms; 0 for a text element. */
  readonly loadTime: number;
  /** The painted area (px²). */
  readonly size: number;
  /** The image URL (the element's source); `''` for a text element. */
  readonly url: string;
  /** Null when the element left the page (the browser drops the reference). */
  readonly element: LcpElementFacts | null;
}

/** What became of an asked highlight. */
export type LcpHighlight =
  /** Not asked. */
  | 'off'
  /** The page's LCP element is framed for a few seconds. */
  | 'shown'
  /** Asked, but there is no element on the page to frame (or framing failed). */
  | 'unavailable';

/** The page's answer. */
export type LcpAnalysisReply =
  /** The browser reports no LCP entries at all. */
  | { readonly kind: 'unsupported' }
  | {
      readonly kind: 'measured';
      /** Null when the page has no navigation timing. */
      readonly navigation: NavigationTiming | null;
      /** Deduplicated by start time, in order; empty when nothing was painted yet. */
      readonly candidates: readonly LcpCandidateFacts[];
      /** The LCP URL's first resource entry; null for text or when none was found. */
      readonly resource: ResourceTiming | null;
      readonly highlight: LcpHighlight;
    };

/**
 * Guard a request (received by the page, or the relay).
 *
 * @param input The boundary value.
 * @returns The request, rebuilt, or null.
 */
export function parseLcpAnalysisRequest(input: unknown): LcpAnalysisRequest | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['highlight'])) return null;
  const highlight = ownValue(input, 'highlight');
  return typeof highlight === 'boolean' ? { highlight } : null;
}

/**
 * Guard an element description.
 *
 * @param input The boundary value.
 * @returns The facts, rebuilt, or null.
 */
function parseElement(input: unknown): LcpElementFacts | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['tag', 'id', 'classes'])) return null;
  const tag = ownValue(input, 'tag');
  const id = ownValue(input, 'id');
  const classes = ownValue(input, 'classes');
  const max = cappedUnits(LCP_ANALYSIS_LIMITS.namePoints);
  if (!boundedString(tag, max) || tag === '' || !boundedString(id, max)) return null;
  if (!Array.isArray(classes) || classes.length > LCP_ANALYSIS_LIMITS.classes) return null;
  const names: unknown[] = classes;
  if (!names.every((name): name is string => boundedString(name, max) && name !== '')) {
    return null;
  }
  return { tag, id, classes: Object.freeze([...names]) };
}

/** A candidate's numeric fields. */
const CANDIDATE_TIMINGS = ['startTime', 'renderTime', 'loadTime', 'size'] as const;

/**
 * Guard one candidate.
 *
 * @param input The boundary value.
 * @returns The facts, rebuilt, or null.
 */
function parseCandidate(input: unknown): LcpCandidateFacts | null {
  if (!isRecord(input) || !hasOnlyKeys(input, [...CANDIDATE_TIMINGS, 'url', 'element'])) {
    return null;
  }
  const timings: Partial<Record<(typeof CANDIDATE_TIMINGS)[number], number>> = {};
  for (const key of CANDIDATE_TIMINGS) {
    const value = ownValue(input, key);
    if (!isTiming(value)) return null;
    timings[key] = value;
  }
  const url = ownValue(input, 'url');
  const rawElement = ownValue(input, 'element');
  const element = rawElement === null ? null : parseElement(rawElement);
  if (!boundedString(url, cappedUnits(LCP_ANALYSIS_LIMITS.urlPoints))) return null;
  if (rawElement !== null && element === null) return null;
  return { ...(timings as Record<(typeof CANDIDATE_TIMINGS)[number], number>), url, element };
}

/**
 * Guard the navigation timing.
 *
 * @param input The boundary value.
 * @returns The timing, rebuilt, or null.
 */
function parseNavigation(input: unknown): NavigationTiming | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['responseStart', 'activationStart'])) return null;
  const responseStart = ownValue(input, 'responseStart');
  if (!isTiming(responseStart)) return null;
  // Optional (additive): absent means unknown, present must be a timing.
  if (!Object.hasOwn(input, 'activationStart')) return { responseStart };
  const activationStart = ownValue(input, 'activationStart');
  return isTiming(activationStart) ? { responseStart, activationStart } : null;
}

/** A resource timing's numeric fields. */
const RESOURCE_TIMINGS = ['startTime', 'requestStart', 'responseEnd'] as const;

/**
 * Guard the LCP resource's timing.
 *
 * @param input The boundary value.
 * @returns The timing, rebuilt, or null.
 */
function parseResource(input: unknown): ResourceTiming | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['name', ...RESOURCE_TIMINGS])) return null;
  const name = ownValue(input, 'name');
  if (!boundedString(name, cappedUnits(LCP_ANALYSIS_LIMITS.urlPoints))) return null;
  const timings: Partial<Record<(typeof RESOURCE_TIMINGS)[number], number>> = {};
  for (const key of RESOURCE_TIMINGS) {
    const value = ownValue(input, key);
    if (!isTiming(value)) return null;
    timings[key] = value;
  }
  return { name, ...(timings as Record<(typeof RESOURCE_TIMINGS)[number], number>) };
}

/** The highlight states. */
const HIGHLIGHTS: readonly LcpHighlight[] = ['off', 'shown', 'unavailable'];

/** The measured answer's keys. */
const MEASURED_KEYS = ['kind', 'navigation', 'candidates', 'resource', 'highlight'] as const;

/**
 * Guard nullable sub-facts: null stays null, anything else must pass.
 *
 * @param value The boundary value.
 * @param parse The sub-guard.
 * @returns `{ value }`, or null when a non-null value failed its guard.
 */
function nullable<T>(
  value: unknown,
  parse: (input: unknown) => T | null
): { value: T | null } | null {
  if (value === null) return { value: null };
  const parsed = parse(value);
  return parsed === null ? null : { value: parsed };
}

/**
 * Guard the page's answer (received by the panel).
 *
 * @param input The boundary value.
 * @returns The reply, rebuilt, or null on any violation.
 */
export function parseLcpAnalysisReply(input: unknown): LcpAnalysisReply | null {
  if (!isRecord(input)) return null;
  const kind = ownValue(input, 'kind');
  if (kind === 'unsupported') return hasOnlyKeys(input, ['kind']) ? { kind } : null;
  if (kind !== 'measured' || !hasOnlyKeys(input, MEASURED_KEYS)) return null;
  const highlight = HIGHLIGHTS.find((state) => state === ownValue(input, 'highlight'));
  const navigation = nullable(ownValue(input, 'navigation'), parseNavigation);
  const resource = nullable(ownValue(input, 'resource'), parseResource);
  const rawCandidates = ownValue(input, 'candidates');
  if (highlight === undefined || navigation === null || resource === null) return null;
  if (!Array.isArray(rawCandidates)) return null;
  if (rawCandidates.length > LCP_ANALYSIS_LIMITS.candidates) return null;
  const candidates: LcpCandidateFacts[] = [];
  for (const raw of rawCandidates as unknown[]) {
    const candidate = parseCandidate(raw);
    if (candidate === null) return null;
    candidates.push(candidate);
  }
  return {
    kind,
    navigation: navigation.value,
    candidates: Object.freeze(candidates),
    resource: resource.value,
    highlight
  };
}
