/**
 * A metric's threshold meter: where a value sits on a bar split into its
 * three rating bands (good / needs improvement / poor, by the published
 * thresholds), and the legend naming those thresholds. Pure — the panel draws
 * what this decides.
 *
 * Each band takes an equal third of the bar, whatever its width in metric
 * units, so the three metrics' bars read alike and a value's band is always
 * visible. Inside a band the position is linear; the poor band ends at
 * {@link POOR_BAND_END} × the poor threshold (anything above sits at the end).
 */
import { rate, VITAL_THRESHOLDS, type VitalOutcome, type VitalRating } from './current-visit';
import { formatVital, RATING_LABELS, type VitalKey } from './vitals-view';

/** The bar's bands, left to right. */
export const METER_BANDS = [
  'good',
  'needs-improvement',
  'poor'
] as const satisfies readonly VitalRating[];

/** Each band's share of the bar. */
export const METER_BAND_SPAN = 1 / METER_BANDS.length;

/** Where the poor band ends, in multiples of the poor threshold (twice it: the scale stays readable). */
export const POOR_BAND_END = 2;

/** A value placed on the bar. */
export interface VitalMeter {
  /** The value's band — always {@link rate}'s rating, so the bar never disagrees with the badge. */
  readonly band: VitalRating;
  /** The marker's position along the bar, 0 (start) to 1 (end). */
  readonly position: number;
}

/**
 * Check a metric's thresholds (a bad pair is a caller bug: fail fast, naming it).
 *
 * @param thresholds `[good ≤, needs-improvement ≤]`.
 * @throws {@link RangeError} Unless both are finite and `0 < good < poor`.
 */
function assertThresholds(thresholds: readonly [number, number]): void {
  const [good, poor] = thresholds;
  if (!Number.isFinite(good) || !Number.isFinite(poor) || good <= 0 || poor <= good) {
    throw new RangeError(
      `Meter thresholds must be finite with 0 < good < poor; got [${String(good)}, ${String(poor)}].`
    );
  }
}

/**
 * The share of `[from, to]` a value covers, clamped to 0–1.
 *
 * @param value The value.
 * @param from The span's start.
 * @param to The span's end (> `from`).
 */
function shareOf(value: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

/**
 * Place a value on its metric's bar.
 *
 * @param value The raw metric value; `null`/`undefined` (not measured, still
 *   pending) and `NaN` give no meter. Negatives sit at the start, `Infinity`
 *   at the end.
 * @param thresholds The metric's `[good ≤, needs-improvement ≤]` pair.
 * @returns The band and marker position, or `null` when there is no value.
 * @throws {@link RangeError} When the thresholds are not finite, positive and ascending.
 */
export function vitalMeter(
  value: number | null | undefined,
  thresholds: readonly [number, number]
): VitalMeter | null {
  assertThresholds(thresholds);
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const [good, poor] = thresholds;
  const band = rate(value, thresholds);
  const within =
    band === 'good'
      ? shareOf(value, 0, good)
      : band === 'needs-improvement'
        ? shareOf(value, good, poor)
        : shareOf(value, poor, poor * POOR_BAND_END);
  return { band, position: (METER_BANDS.indexOf(band) + within) * METER_BAND_SPAN };
}

/**
 * A metric outcome's meter: only a measured value has one.
 *
 * @param key The metric (picks its thresholds).
 * @param outcome Its outcome.
 * @returns The meter, or `null` when unsupported or without data.
 */
export function outcomeMeter(key: VitalKey, outcome: VitalOutcome): VitalMeter | null {
  return outcome.state === 'measured' ? vitalMeter(outcome.value, VITAL_THRESHOLDS[key]) : null;
}

/**
 * The line under a bar naming its thresholds, in the metric's own units
 * (e.g. `Good ≤ 2,500 ms · Poor > 4,000 ms`).
 *
 * @param key The metric.
 */
export function meterLegend(key: VitalKey): string {
  const [good, poor] = VITAL_THRESHOLDS[key];
  return `${RATING_LABELS.good} ≤ ${formatVital(key, good)} · ${RATING_LABELS.poor} > ${formatVital(key, poor)}`;
}
