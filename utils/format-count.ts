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

/** A noun in its two English count forms ("script" / "scripts"). */
export interface CountNoun {
  /** The singular form, used for exactly one. */
  readonly one: string;
  /** The plural form, used for zero and many. */
  readonly other: string;
}

/**
 * Phrase a count with its noun: `1 image`, `0 images`, `5,000 scripts` —
 * digits rather than words, so counts scan and compare at a glance.
 *
 * @param count A non-negative row count.
 * @param noun The noun's count forms.
 * @param partial Mark the count as a capture floor: `+` after the figures
 *   (`5,000+ scripts`) and always plural, since entries beyond the shown
 *   list may exist. A cut list can never hold exactly one row in truth, so
 *   the singular form is reserved for full lists.
 * @returns The counted phrase.
 */
export function countLabel(count: number, noun: CountNoun, partial = false): string {
  return `${formatCount(count)}${partial ? '+' : ''} ${partial ? noun.other : countNoun(count, noun)}`;
}

/**
 * The noun form a count takes: singular for exactly one, plural for zero
 * and many — for surfaces that render the figure and the noun apart.
 *
 * @param count A non-negative count.
 * @param noun The noun's count forms.
 */
export function countNoun(count: number, noun: CountNoun): string {
  return count === 1 ? noun.one : noun.other;
}
