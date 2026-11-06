/**
 * The beacon test's message contract (`runBeaconTest`, DevTools panel → the
 * tab's top frame) and its boundary guards.
 *
 * The panel validates the form into a configuration and sends it; the page
 * runs one beacon pass with it (the runner re-validates it against the
 * page's own selector parser) and answers how the run ended — the beacon's
 * raw results included, count-bounded only. The panel's reply guard is the
 * results' validator: only it turns raw results into
 * {@link BeaconTestResults}.
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import {
  readFeatures,
  readThreshold,
  SELECTOR_COUNT_MAX,
  SELECTOR_LENGTH_MAX,
  type BeaconTestConfig,
  type ThresholdField
} from '../beacon-test/config';
import { readBeaconResults, type BeaconTestResults } from '../beacon-test/results';
import type { BeaconBailReason, BeaconFeatureKey } from '../beacon-test/runner-bridge';

/** Panel → tab: run one beacon test with this configuration. */
export interface BeaconTestRequest {
  readonly config: BeaconTestConfig;
}

/** A failure message's character cap (the runner caps its own at 300 code points). */
const MESSAGE_CHARS = 1024;

/**
 * How the page answers a run (raw results, validated by the panel):
 * - `completed` — the beacon ran; `scriptErrors` names a feature whose scan threw;
 * - `timed-out` — no end within the run's time bound: what it collected so far;
 * - `bailed` — the beacon refused to measure (viewport size, scrolled page);
 * - `failed` — the run could not start or broke (a refused configuration included);
 * - `runner-unavailable` — the runner could not be loaded into the page;
 * - `busy` — another test is still running on this page.
 */
export type BeaconTestReply =
  | {
      readonly kind: 'completed';
      readonly results: unknown;
      readonly scriptErrors: readonly BeaconFeatureKey[];
    }
  | { readonly kind: 'timed-out'; readonly partial: unknown }
  | { readonly kind: 'bailed'; readonly reason: BeaconBailReason }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'runner-unavailable' }
  | { readonly kind: 'busy' };

/** A reply past the panel's guard: raw results replaced by validated ones. */
export type BeaconTestAnswer =
  | {
      readonly kind: 'completed';
      readonly results: BeaconTestResults;
      readonly scriptErrors: readonly BeaconFeatureKey[];
    }
  /** `partial` is null when nothing was collected yet. */
  | { readonly kind: 'timed-out'; readonly partial: BeaconTestResults | null }
  | Exclude<BeaconTestReply, { kind: 'completed' } | { kind: 'timed-out' }>;

/** The configuration's keys (exact shape). */
const CONFIG_KEYS = [
  'features',
  'mobile',
  'widthThreshold',
  'heightThreshold',
  'lazyRenderThreshold',
  'selectors'
] as const;

/** The threshold fields, in key order. */
const THRESHOLD_FIELDS: readonly ThresholdField[] = [
  'widthThreshold',
  'heightThreshold',
  'lazyRenderThreshold'
];

/**
 * Guard a selector list's shape: strings within the count and length caps
 * (the runner parses them with the page's selector parser).
 *
 * @param value The boundary value.
 * @returns A frozen copy, or null.
 */
function readSelectorShape(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > SELECTOR_COUNT_MAX) return null;
  const entries: unknown[] = value;
  return entries.every(
    (entry): entry is string => typeof entry === 'string' && entry.length <= SELECTOR_LENGTH_MAX
  )
    ? Object.freeze([...entries])
    : null;
}

/**
 * Guard a configuration's shape (received by the page, or the relay). The
 * selectors are not parsed here — that needs the page's own parser, and the
 * runner re-validates the whole configuration with it before a run.
 *
 * @param input The boundary value.
 * @returns A fresh frozen configuration, or null on any violation.
 */
export function readBeaconConfigShape(input: unknown): BeaconTestConfig | null {
  if (!isRecord(input) || !hasOnlyKeys(input, CONFIG_KEYS)) return null;
  const features = readFeatures(ownValue(input, 'features'));
  const mobile = ownValue(input, 'mobile');
  const selectors = readSelectorShape(ownValue(input, 'selectors'));
  if (features === null || typeof mobile !== 'boolean' || selectors === null) return null;
  const thresholds: Partial<Record<ThresholdField, number>> = {};
  for (const field of THRESHOLD_FIELDS) {
    const threshold = readThreshold(ownValue(input, field));
    if (threshold === null) return null;
    thresholds[field] = threshold;
  }
  return Object.freeze({
    features,
    mobile,
    ...(thresholds as Record<ThresholdField, number>),
    selectors
  });
}

/**
 * Guard a run request.
 *
 * @param input The boundary value.
 * @returns The request, rebuilt, or null.
 */
export function parseBeaconTestRequest(input: unknown): BeaconTestRequest | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['config'])) return null;
  const config = readBeaconConfigShape(ownValue(input, 'config'));
  return config === null ? null : { config };
}

/** The features a script error may name, in report order. */
const FEATURE_KEYS: readonly BeaconFeatureKey[] = ['aboveTheFold', 'lazyRender'];

/**
 * Guard a run's script-error list: distinct known feature keys.
 *
 * @param value The boundary value.
 * @returns A frozen copy, or null.
 */
function readScriptErrors(value: unknown): readonly BeaconFeatureKey[] | null {
  if (!Array.isArray(value) || value.length > FEATURE_KEYS.length) return null;
  const errors: BeaconFeatureKey[] = [];
  for (const entry of value as unknown[]) {
    const key = FEATURE_KEYS.find((name) => name === entry);
    if (key === undefined || errors.includes(key)) return null;
    errors.push(key);
  }
  return Object.freeze(errors);
}

/** Reply kinds that carry no field. */
const BARE_KINDS = ['runner-unavailable', 'busy'] as const;

/** The bail reasons. */
const BAIL_REASONS: readonly BeaconBailReason[] = ['screen-size', 'page-scrolled'];

/**
 * Guard a run's answer (received by the panel) and validate its results.
 *
 * @param input The boundary value.
 * @returns The answer, or null on any violation (results that are not a
 *   results record included; a timed-out run's `partial` may be null).
 */
export function parseBeaconTestReply(input: unknown): BeaconTestAnswer | null {
  if (!isRecord(input)) return null;
  const kind = ownValue(input, 'kind');
  const bare = BARE_KINDS.find((name) => name === kind);
  if (bare !== undefined) return hasOnlyKeys(input, ['kind']) ? { kind: bare } : null;
  switch (kind) {
    case 'completed': {
      if (!hasOnlyKeys(input, ['kind', 'results', 'scriptErrors'])) return null;
      const results = readBeaconResults(ownValue(input, 'results'));
      const scriptErrors = readScriptErrors(ownValue(input, 'scriptErrors'));
      return results === null || scriptErrors === null ? null : { kind, results, scriptErrors };
    }
    case 'timed-out': {
      if (!hasOnlyKeys(input, ['kind', 'partial'])) return null;
      const raw = ownValue(input, 'partial');
      const partial = raw === null ? null : readBeaconResults(raw);
      return raw !== null && partial === null ? null : { kind, partial };
    }
    case 'bailed': {
      const reason = BAIL_REASONS.find((name) => name === ownValue(input, 'reason'));
      return reason !== undefined && hasOnlyKeys(input, ['kind', 'reason'])
        ? { kind, reason }
        : null;
    }
    case 'failed': {
      const message = ownValue(input, 'message');
      return typeof message === 'string' &&
        message.length <= MESSAGE_CHARS &&
        hasOnlyKeys(input, ['kind', 'message'])
        ? { kind, message }
        : null;
    }
    default:
      return null;
  }
}
