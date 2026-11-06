/**
 * The current-visit Core Web Vitals read's message contract
 * (`getCurrentVisitVitals`, DevTools panel → the tab's top frame) and its
 * boundary guard.
 *
 * The page answers the reducer's input — plain numbers copied out of this
 * visit's performance entries — and the panel reduces it. One visit's
 * entries, never field (population) data.
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import type { ClsSessions, VitalsInput } from '../web-vitals/current-visit';
import { isCount, isTiming } from './guard-policy';

/** Bounds of the listed entries (past one, the page keeps what each metric needs). */
export const CURRENT_VISIT_LIMITS = {
  /** LCP candidates listed (the latest ones). */
  lcpEntries: 500,
  /** Unexpected layout shifts listed (the latest; older ones are folded into `clsCarry`). */
  layoutShifts: 10_000,
  /** Distinct interactions listed (the slowest; the others are counted in `interactionsDropped`). */
  interactions: 10_000
} as const;

/** The page's answer: the reducer's input, and whether a bound dropped entries. */
export interface CurrentVisitVitalsReply {
  readonly input: VitalsInput;
  /**
   * A list reached its {@link CURRENT_VISIT_LIMITS} bound: older LCP
   * candidates or the least slow interactions were dropped (LCP and INP stay
   * right unless the dropped ones mattered; CLS is folded, never capped).
   */
  readonly capped: boolean;
}

/**
 * A timing, or null.
 *
 * @param value The boundary value.
 */
function isNullableTiming(value: unknown): value is number | null {
  return value === null || isTiming(value);
}

/**
 * Guard a bounded list, entry by entry.
 *
 * @param value The boundary value.
 * @param max The entry cap.
 * @param parse The entry guard.
 * @returns A frozen copy, or null.
 */
function parseList<T>(
  value: unknown,
  max: number,
  parse: (entry: unknown) => T | null
): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const list: T[] = [];
  for (const raw of value as unknown[]) {
    const entry = parse(raw);
    if (entry === null) return null;
    list.push(entry);
  }
  return Object.freeze(list) as T[];
}

/**
 * Guard an LCP entry.
 *
 * @param input The boundary value.
 */
function parseLcpEntry(input: unknown): { readonly startTime: number } | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['startTime'])) return null;
  const startTime = ownValue(input, 'startTime');
  return isTiming(startTime) ? { startTime } : null;
}

/**
 * Guard a layout shift.
 *
 * @param input The boundary value.
 */
function parseLayoutShift(input: unknown): VitalsInput['layoutShifts'][number] | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['startTime', 'value', 'hadRecentInput'])) {
    return null;
  }
  const startTime = ownValue(input, 'startTime');
  const value = ownValue(input, 'value');
  const hadRecentInput = ownValue(input, 'hadRecentInput');
  return isTiming(startTime) && isTiming(value) && typeof hadRecentInput === 'boolean'
    ? { startTime, value, hadRecentInput }
    : null;
}

/**
 * Guard an interaction's longest event.
 *
 * @param input The boundary value.
 */
function parseEvent(input: unknown): VitalsInput['events'][number] | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['interactionId', 'duration'])) return null;
  const interactionId = ownValue(input, 'interactionId');
  const duration = ownValue(input, 'duration');
  return typeof interactionId === 'number' &&
    Number.isSafeInteger(interactionId) &&
    interactionId > 0 &&
    isTiming(duration)
    ? { interactionId, duration }
    : null;
}

/**
 * Guard the per-metric support flags.
 *
 * @param input The boundary value.
 */
function parseSupported(input: unknown): VitalsInput['supported'] | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['lcp', 'cls', 'inp'])) return null;
  const lcp = ownValue(input, 'lcp');
  const cls = ownValue(input, 'cls');
  const inp = ownValue(input, 'inp');
  return typeof lcp === 'boolean' && typeof cls === 'boolean' && typeof inp === 'boolean'
    ? { lcp, cls, inp }
    : null;
}

/** The CLS carry's fields (all timings or scores). */
const CLS_CARRY_KEYS = ['largest', 'windowSum', 'windowFirst', 'previous'] as const;

/**
 * Guard the folded CLS session state.
 *
 * @param input The boundary value.
 */
function parseClsCarry(input: unknown): ClsSessions | null {
  if (!isRecord(input) || !hasOnlyKeys(input, CLS_CARRY_KEYS)) return null;
  const values = CLS_CARRY_KEYS.map((key) => ownValue(input, key));
  if (!values.every(isTiming)) return null;
  const [largest, windowSum, windowFirst, previous] = values as [number, number, number, number];
  return { largest, windowSum, windowFirst, previous };
}

/**
 * Guard the input's optional fields: absent stays absent, present must pass.
 *
 * @param input The input record.
 * @returns Those present, rebuilt, or null on any violation.
 */
function parseOptionalFields(
  input: Record<string, unknown>
): Pick<VitalsInput, 'clsCarry' | 'interactionsDropped' | 'restoredAt'> | null {
  const fields: {
    -readonly [K in 'clsCarry' | 'interactionsDropped' | 'restoredAt']?: VitalsInput[K];
  } = {};
  if (Object.hasOwn(input, 'clsCarry')) {
    const carry = parseClsCarry(ownValue(input, 'clsCarry'));
    if (carry === null) return null;
    fields.clsCarry = carry;
  }
  if (Object.hasOwn(input, 'interactionsDropped')) {
    const dropped = ownValue(input, 'interactionsDropped');
    if (!isCount(dropped)) return null;
    fields.interactionsDropped = dropped;
  }
  if (Object.hasOwn(input, 'restoredAt')) {
    const restoredAt = ownValue(input, 'restoredAt');
    if (!isTiming(restoredAt)) return null;
    fields.restoredAt = restoredAt;
  }
  return fields;
}

/** The input's keys (exact shape; the last three optional). */
const INPUT_KEYS = [
  'supported',
  'activationStart',
  'firstHiddenTime',
  'fcpTime',
  'lcpEntries',
  'layoutShifts',
  'events',
  'interactionCount',
  'clsCarry',
  'interactionsDropped',
  'restoredAt'
] as const;

/**
 * Guard the reducer's input.
 *
 * @param input The boundary value.
 * @returns The input, rebuilt, or null.
 */
function parseVitalsInput(input: unknown): VitalsInput | null {
  if (!isRecord(input) || !hasOnlyKeys(input, INPUT_KEYS)) return null;
  const supported = parseSupported(ownValue(input, 'supported'));
  const activationStart = ownValue(input, 'activationStart');
  const firstHiddenTime = ownValue(input, 'firstHiddenTime');
  const fcpTime = ownValue(input, 'fcpTime');
  const interactionCount = ownValue(input, 'interactionCount');
  if (supported === null || !isTiming(activationStart)) return null;
  if (!isNullableTiming(firstHiddenTime) || !isNullableTiming(fcpTime)) return null;
  if (
    interactionCount !== null &&
    !(typeof interactionCount === 'number' && Number.isSafeInteger(interactionCount))
  ) {
    return null;
  }
  if (interactionCount !== null && interactionCount < 0) return null;
  const lcpEntries = parseList(
    ownValue(input, 'lcpEntries'),
    CURRENT_VISIT_LIMITS.lcpEntries,
    parseLcpEntry
  );
  const layoutShifts = parseList(
    ownValue(input, 'layoutShifts'),
    CURRENT_VISIT_LIMITS.layoutShifts,
    parseLayoutShift
  );
  const events = parseList(
    ownValue(input, 'events'),
    CURRENT_VISIT_LIMITS.interactions,
    parseEvent
  );
  const optional = parseOptionalFields(input);
  if (lcpEntries === null || layoutShifts === null || events === null || optional === null) {
    return null;
  }
  return {
    ...optional,
    supported,
    activationStart,
    firstHiddenTime,
    fcpTime,
    lcpEntries,
    layoutShifts,
    events,
    interactionCount
  };
}

/**
 * Guard the page's answer (received by the panel).
 *
 * @param input The boundary value.
 * @returns The reply, rebuilt, or null on any violation.
 */
export function parseCurrentVisitVitalsReply(input: unknown): CurrentVisitVitalsReply | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['input', 'capped'])) return null;
  const vitals = parseVitalsInput(ownValue(input, 'input'));
  const capped = ownValue(input, 'capped');
  return vitals !== null && typeof capped === 'boolean' ? { input: vitals, capped } : null;
}
