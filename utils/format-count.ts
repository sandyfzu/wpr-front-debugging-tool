/** Shared English number formatter so visible and accessible counts agree. */
const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/**
 * Format a non-negative count with English thousands separators.
 *
 * @param count The count supplied by its owning domain.
 * @returns Grouped digits, without a noun or a capture-floor marker.
 */
export function formatCount(count: number): string {
  return COUNT_FORMAT.format(count);
}
