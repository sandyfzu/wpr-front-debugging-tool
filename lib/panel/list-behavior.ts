/** Pure list rules shared by panel inventories; identity stays with each caller. */

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
