/**
 * Core Web Vitals of the current visit only: LCP, CLS and INP reduced from
 * the performance entries this one page load reported, by the metrics'
 * published definitions (web.dev, as implemented by Google's `web-vitals`
 * library). One visit's numbers are a lab-like sample — never field data:
 * field values (CrUX) are the 75th percentile over many real visits.
 *
 * - LCP: the last candidate painted before the page was first hidden, its
 *   `startTime` minus the prerender activation start (floored at 0). A
 *   candidate painted while hidden (a tab opened in the background) is no
 *   LCP: nobody saw it.
 * - CLS: reported only once the first contentful paint happened before the
 *   page was first hidden (as the field data does); then layout shifts
 *   without recent input grouped into session windows (a shift joins the
 *   open window when it is < 1 s after the previous shift and < 5 s after
 *   the window's first); the largest window's sum. Shifts after hiding count.
 * - INP: each interaction's latency is its longest event entry; the value is
 *   the highest latency after skipping one per 50 interactions (a p98
 *   approximation, among the 10 longest), so few interactions give the worst
 *   one. Visibility does not gate it.
 */

/** A metric's rating band, by the published thresholds. */
export type VitalRating = 'good' | 'needs-improvement' | 'poor';

/** One metric's outcome for this visit. */
export type VitalOutcome =
  /** The browser does not report the entry type. */
  | { readonly state: 'unsupported' }
  /** Supported, nothing reportable (no candidate or first paint seen while visible, no interaction). */
  | { readonly state: 'no-data' }
  | { readonly state: 'measured'; readonly value: number; readonly rating: VitalRating };

/** The plain entry values the reducer reads (copied out by the executor). */
export interface VitalsInput {
  /** Which entry types the browser reports. */
  readonly supported: { readonly lcp: boolean; readonly cls: boolean; readonly inp: boolean };
  /** The navigation's `activationStart` (0 when not prerendered or unknown). */
  readonly activationStart: number;
  /**
   * When the page was first hidden (performance-timeline ms): the first
   * `hidden` `visibility-state` entry at or after activation, else 0 when the
   * page is hidden at read time with no such entry (assumed hidden since
   * navigation), else null (never hidden).
   */
  readonly firstHiddenTime: number | null;
  /** The `first-contentful-paint` entry's `startTime`, or null before (or without) one. */
  readonly fcpTime: number | null;
  /** `largest-contentful-paint` entries, in report order. */
  readonly lcpEntries: readonly { readonly startTime: number }[];
  /** `layout-shift` entries, in report order. */
  readonly layoutShifts: readonly {
    readonly startTime: number;
    readonly value: number;
    readonly hadRecentInput: boolean;
  }[];
  /** `event` and `first-input` entries (only those with an interaction id count). */
  readonly events: readonly { readonly interactionId: number; readonly duration: number }[];
  /** `performance.interactionCount` where the browser has it, else null. */
  readonly interactionCount: number | null;
}

/** The current visit's three metrics. */
export interface CurrentVisitVitals {
  readonly lcp: VitalOutcome;
  readonly cls: VitalOutcome;
  /** INP, plus how many interactions it was chosen from. */
  readonly inp: VitalOutcome & { readonly interactions?: number };
}

/** Rating thresholds `[good ≤, needs-improvement ≤]` (above the second is poor). */
export const VITAL_THRESHOLDS = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500]
} as const satisfies Record<string, readonly [number, number]>;

/** Max gap between consecutive shifts of one CLS session window, ms. */
export const CLS_GAP_MS = 1000;

/** Max span of one CLS session window, ms. */
export const CLS_WINDOW_MS = 5000;

/** Interactions per skipped worst one in the INP estimate. */
export const INP_SKIP_EVERY = 50;

/** Longest interactions the INP estimate picks from (so it never skips past the 10th worst). */
export const INP_CANDIDATES_MAX = 10;

/**
 * Rate a value.
 *
 * @param value The metric value.
 * @param thresholds `[good, needs-improvement]` upper bounds.
 * @returns The band.
 */
export function rate(value: number, thresholds: readonly [number, number]): VitalRating {
  if (value > thresholds[1]) return 'poor';
  if (value > thresholds[0]) return 'needs-improvement';
  return 'good';
}

/**
 * A measured outcome.
 *
 * @param value The value.
 * @param thresholds The metric's thresholds.
 * @returns The value with its rating.
 */
function measured(value: number, thresholds: readonly [number, number]): VitalOutcome {
  return { state: 'measured', value, rating: rate(value, thresholds) };
}

/**
 * Whether a time (performance-timeline ms) falls before the page was first hidden.
 *
 * @param time The entry time.
 * @param firstHiddenTime When the page was first hidden, or null (never).
 * @returns `true` while the page was still visible at `time`.
 */
export function beforeHidden(time: number, firstHiddenTime: number | null): boolean {
  return firstHiddenTime === null || time < firstHiddenTime;
}

/**
 * The current visit's LCP.
 *
 * @param entries LCP entries, in report order.
 * @param activationStart The prerender activation start (0 when none).
 * @param firstHiddenTime When the page was first hidden, or null (never).
 * @returns The last candidate painted before the page was first hidden, its
 *   time from activation; null without one.
 */
export function reduceLcp(
  entries: readonly { readonly startTime: number }[],
  activationStart: number,
  firstHiddenTime: number | null
): number | null {
  const last = entries.findLast((entry) => beforeHidden(entry.startTime, firstHiddenTime));
  if (last === undefined) return null;
  return Math.max(last.startTime - activationStart, 0);
}

/**
 * The current visit's CLS (session windows, largest wins).
 *
 * @param shifts Layout-shift entries, in report order.
 * @returns The largest session window's sum (0 without unexpected shifts).
 */
export function reduceCls(shifts: VitalsInput['layoutShifts']): number {
  let largest = 0;
  let windowSum = 0;
  let windowFirst = 0;
  let previous = 0;
  for (const shift of shifts) {
    if (shift.hadRecentInput) continue;
    const joins =
      windowSum > 0 &&
      shift.startTime - previous < CLS_GAP_MS &&
      shift.startTime - windowFirst < CLS_WINDOW_MS;
    if (joins) {
      windowSum += shift.value;
    } else {
      windowSum = shift.value;
      windowFirst = shift.startTime;
    }
    previous = shift.startTime;
    largest = Math.max(largest, windowSum);
  }
  return largest;
}

/**
 * The current visit's INP.
 *
 * @param events Event entries (those without an interaction id are ignored).
 * @param interactionCount The browser's interaction count, when known
 *   (it also counts interactions too fast to be reported as entries).
 * @returns The value and the interaction count, or null without interactions.
 */
export function reduceInp(
  events: VitalsInput['events'],
  interactionCount: number | null
): { readonly value: number; readonly interactions: number } | null {
  const latencies = new Map<number, number>();
  for (const event of events) {
    if (!(event.interactionId > 0)) continue;
    latencies.set(
      event.interactionId,
      Math.max(latencies.get(event.interactionId) ?? 0, event.duration)
    );
  }
  if (latencies.size === 0) return null;
  const interactions = Math.max(latencies.size, interactionCount ?? 0);
  const sorted = [...latencies.values()].sort((a, b) => b - a).slice(0, INP_CANDIDATES_MAX);
  const index = Math.min(sorted.length - 1, Math.floor(interactions / INP_SKIP_EVERY));
  return { value: sorted[index] ?? 0, interactions };
}

/**
 * Reduce the current visit's entries to its three metrics.
 *
 * @param input The copied entry values.
 * @returns Each metric's outcome.
 */
export function reduceCurrentVisit(input: VitalsInput): CurrentVisitVitals {
  const lcp = reduceLcp(input.lcpEntries, input.activationStart, input.firstHiddenTime);
  const inp = reduceInp(input.events, input.interactionCount);
  // CLS waits for a first contentful paint the visitor saw.
  const clsReportable =
    input.fcpTime !== null && beforeHidden(input.fcpTime, input.firstHiddenTime);
  return {
    lcp: !input.supported.lcp
      ? { state: 'unsupported' }
      : lcp === null
        ? { state: 'no-data' }
        : measured(lcp, VITAL_THRESHOLDS.lcp),
    cls: !input.supported.cls
      ? { state: 'unsupported' }
      : !clsReportable
        ? { state: 'no-data' }
        : measured(reduceCls(input.layoutShifts), VITAL_THRESHOLDS.cls),
    inp: !input.supported.inp
      ? { state: 'unsupported' }
      : inp === null
        ? { state: 'no-data' }
        : { ...measured(inp.value, VITAL_THRESHOLDS.inp), interactions: inp.interactions }
  };
}
