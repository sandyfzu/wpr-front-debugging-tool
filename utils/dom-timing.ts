/**
 * A DOM timing as message contracts carry it: a finite, positive number
 * passes; anything else (negative, NaN, infinite, absent, non-number) is 0 —
 * entries from untyped observer lists and hidden cross-origin timings read
 * as "unknown" without failing the read.
 *
 * @param value The raw value.
 * @returns The value, or 0.
 */
export function domTiming(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
