/** Pure list rules shared by panel inventories; identity stays with each caller. */
import { countLabel, formatCount, type CountNoun } from '../../utils/format-count';

/** Ordered chip metadata; predicates and searched fields belong to the page definition. */
interface ChipDefinition<Id extends string> {
  readonly filters: readonly { readonly id: Id; readonly label: string }[];
}

/**
 * Return the first (identity) chip used for reset and empty-list recovery.
 * @param definition The ordered page definition.
 * @returns The default chip id.
 * @throws {@link Error} When no chip is declared.
 */
export function defaultChipId<Id extends string>(definition: ChipDefinition<Id>): Id {
  const first = definition.filters[0];
  if (first === undefined)
    throw new Error('List definition has no filter chips: declare an identity chip first.');
  return first.id;
}

/**
 * Keep default and selected chips reachable even when their count becomes zero.
 * @param definition The ordered page definition.
 * @param counts Counts over the unfiltered inventory.
 * @param selected The current chip.
 * @returns Filter-bar data in declaration order.
 */
export function buildFilterChips<Id extends string>(
  definition: ChipDefinition<Id>,
  counts: Readonly<Record<Id, number>>,
  selected: Id
): { value: Id; label: string; count: number; disabled: boolean }[] {
  const fallback = defaultChipId(definition);
  return definition.filters.map((filter) => ({
    value: filter.id,
    label: filter.label,
    count: counts[filter.id],
    disabled: counts[filter.id] === 0 && filter.id !== fallback && filter.id !== selected
  }));
}

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
 * transient window read while a chip/query swap is landing. Stable and
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
 * @param shown Rows the list renders after chip + query.
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

/**
 * Keep only the row keys whose row is still there **unchanged** in a
 * list's per-row keyed state (expanded, wrapped): a refresh that removed a
 * row — or changed it under the same key — forgets its flags (a different
 * row must not open expanded or wrapped). "Unchanged" is object identity:
 * the rows were reconciled, so an unchanged row keeps its object.
 *
 * @param states The flags to prune.
 * @param previous The rows the flags were set on.
 * @param next The refreshed rows.
 * @param keyOf A row's key.
 * @returns `states` itself when nothing was dropped, else the kept keys.
 */
export function pruneKeyedFlags<K, R>(
  states: ReadonlySet<K>,
  previous: readonly R[],
  next: readonly R[],
  keyOf: (row: R) => K
): ReadonlySet<K> {
  if (states.size === 0) return states;
  const before = new Map(previous.map((row) => [keyOf(row), row]));
  const after = new Map(next.map((row) => [keyOf(row), row]));
  const kept = [...states].filter((key) => {
    const row = after.get(key);
    return row !== undefined && row === before.get(key);
  });
  return kept.length === states.size ? states : new Set(kept);
}

/**
 * Flip one key's membership in a list's per-row keyed state (the expanded
 * and wrapped sets).
 *
 * @param states The flags.
 * @param key The row to flip.
 * @returns A new set (sets in signals must change identity to notify).
 */
export function toggleRowFlag<K>(states: ReadonlySet<K>, key: K): ReadonlySet<K> {
  const next = new Set(states);
  if (!next.delete(key)) next.add(key);
  return next;
}
