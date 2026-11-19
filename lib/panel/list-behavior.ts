/** Pure list rules shared by panel inventories; identity stays with each caller. */
import { countLabel, formatCount, type CountNoun } from '../../utils/format-count';

/**
 * Ignore surrounding whitespace without changing the echoed search text.
 * @param raw Committed search text.
 * @returns The query used for filtering.
 */
export function normalizeQuery(raw: string): string {
  return raw.trim();
}

/**
 * A list row's key for an index the filtered rows no longer name — the
 * transient window read while a filter/query swap is landing. Stable and
 * unique per list instance; one declared spelling, so the list pages'
 * `getItemKey` fallbacks can never spell the same fallback two ways.
 *
 * @param index A virtual row index.
 * @returns The index's fallback key.
 */
export function fallbackRowKey(index: number): string {
  return `index-${String(index)}`;
}

/**
 * Distinguish list truncation from the same payload mark's string clipping.
 * At exactly the cap, string-only clipping is indistinguishable from omitted
 * entries: this is a conservative boundary signal, not proof of additional rows.
 * @param truncated Capture truncation mark.
 * @param length Received entry count.
 * @param cap Capture entry limit.
 * @returns Whether the marked inventory reached its list limit.
 */
export function listCapped(truncated: true | undefined, length: number, cap: number): boolean {
  return truncated === true && length >= cap;
}

/**
 * Reuse unchanged objects across refreshes without imposing an identity model.
 * Keys must be unique within each input; callers own occurrence disambiguation.
 * @param previous Previously rendered objects.
 * @param next Fresh input rows.
 * @param previousKey Identity of a rendered object.
 * @param nextKey Identity of a fresh row, including any occurrence suffix.
 * @param same Whether a same-key object still represents the fresh row.
 * @param create Derive a rendered object only for changed or new rows.
 * @returns The previous array when unchanged, otherwise reconciled objects in new order.
 */
export function reconcileList<Previous, Next, Key>(
  previous: readonly Previous[],
  next: readonly Next[],
  previousKey: (row: Previous) => Key,
  nextKey: (row: Next, index: number) => Key,
  same: (prior: Previous, row: Next, index: number) => boolean,
  create: (row: Next, index: number) => Previous
): readonly Previous[] {
  const byKey = new Map(previous.map((row) => [previousKey(row), row]));
  let changed = previous.length !== next.length;
  const merged = next.map((row, index) => {
    const prior = byKey.get(nextKey(row, index));
    const result = prior !== undefined && same(prior, row, index) ? prior : create(row, index);
    if (result !== previous[index]) changed = true;
    return result;
  });
  return changed ? merged : previous;
}

/** Re-exported: the count phrasing every surface shares lives in `utils/format-count`. */
export { countLabel, type CountNoun } from '../../utils/format-count';

/**
 * The polite result-count announcement after a committed filter or query
 * change: how many rows the list now shows out of how many exist (one line
 * per commit, so a screen reader hears the result without a per-keystroke
 * stream). An empty inventory announces nothing here — the page's own empty
 * state speaks for it; `No … match` is reserved for a filter that hides rows
 * that exist.
 *
 * @param shown Rows the list renders after the filters + query.
 * @param total Rows on the page.
 * @param noun The rows' noun.
 * @returns One short sentence for the page's `role="status"` line.
 */
export function resultsAnnouncement(shown: number, total: number, noun: CountNoun): string {
  if (total === 0) return '';
  if (shown === 0) return `No ${noun.other} match`;
  if (shown === total) return `Showing all ${countLabel(total, noun)}`;
  return `Showing ${formatCount(shown)} of ${countLabel(total, noun)}`;
}
