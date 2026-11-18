/**
 * The list pages' one search rule, shared by the single-chip filter
 * (`./resources-view-model`) and the facet filter (`./resource-facets`) so
 * both answer a query identically: the query matches a page's searched
 * field case-insensitively, as a substring. Callers pass the query already
 * normalized (`normalizeQuery`, `./list-behavior`); this rule adds no
 * trimming of its own.
 */

/**
 * The search predicate for one query over one searched field.
 *
 * @param field The page's searched field (row → text).
 * @param query The search query (`''` = no search phase).
 * @returns The row predicate, or `null` when the query is empty (every row
 *   passes, so callers skip the search pass and the field reads entirely).
 */
export function searchPredicate<Row>(
  field: (row: Row) => string,
  query: string
): ((row: Row) => boolean) | null {
  const needle = query.toLowerCase();
  if (needle === '') return null;
  return (row) => field(row).toLowerCase().includes(needle);
}
