/**
 * Combinable facet filters for the list pages: each facet narrows the rows
 * by one dimension (a script's Delay state, its type…), the selected values
 * of every facet AND together, and the search query composes on top with
 * the list search's one rule (`./row-search`).
 *
 * Two facet kinds share one shape:
 * - `choice`: mutually exclusive values (a row matches at most one), plus
 *   the implicit "Any" (`ANY_VALUE`) that applies no narrowing;
 * - `toggle`: a boolean filter chip — a single `TOGGLE_VALUE` value, "on"
 *   narrows to the rows its predicate holds on, "Any" (off) does not.
 *
 * Counts follow standard faceting: a facet's per-value counts are taken
 * over the rows every *other* facet's selection (and the search) lets
 * through, so a count always answers "how many rows would I see if I
 * picked this value now". Pure and data-driven: a page declares its facets
 * once (`defineFacets`), the UI maps over them.
 */
import { searchPredicate } from './row-search';

/** The implicit value of every facet that applies no narrowing (a toggle's "off"). */
export const ANY_VALUE = 'any';

/** A toggle facet's single value id ("on"). */
export const TOGGLE_VALUE = 'yes';

/** One selectable value of a facet: its id, label and the rows it keeps. */
export interface FacetValue<Row> {
  readonly id: string;
  readonly label: string;
  readonly predicate: (row: Row) => boolean;
}

/** How a facet renders and selects: exclusive values, or one on/off chip. */
export type FacetKind = 'choice' | 'toggle';

/** One filter dimension of a page. */
export interface Facet<Row, Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly kind: FacetKind;
  /** The values in render order (never `ANY_VALUE`, which every facet has implicitly). */
  readonly values: readonly FacetValue<Row>[];
}

/** A page's validated facets, in render order, indexed by id. Built by {@link defineFacets} only. */
export interface FacetSet<Row, Id extends string = string> {
  readonly facets: readonly Facet<Row, Id>[];
  readonly byId: ReadonlyMap<string, Facet<Row, Id>>;
}

/**
 * The selected value per facet id. A missing (or `undefined`) entry reads
 * as `ANY_VALUE`, so `{}` is "no filter" — the Clear filters state.
 */
export type FacetSelection<Id extends string = string> = Readonly<Partial<Record<Id, string>>>;

/** The search phase: the page's searched field and the normalized query (`''` = none). */
export interface FacetSearch<Row> {
  readonly field: (row: Row) => string;
  readonly query: string;
}

/** One facet's counts per value id, `ANY_VALUE` included (the rows the other facets let through). */
export type FacetValueCounts = Readonly<Record<string, number>>;

/** Every facet's counts plus the rows the whole selection and search keep. */
export interface FacetCounts<Id extends string = string> {
  /** Rows passing the search and every facet's selection (equals `applyFacets(...).length`). */
  readonly matched: number;
  readonly byFacet: Readonly<Record<Id, FacetValueCounts>>;
}

/** One facet whose selection narrows (not "Any"), with its selected value. */
export interface SelectedFacet<Row, Id extends string = string> {
  readonly facet: Facet<Row, Id>;
  readonly value: FacetValue<Row>;
}

/**
 * A choice facet (mutually exclusive values + the implicit "Any").
 *
 * @param id The facet id (unique within its page).
 * @param label The facet's visible name.
 * @param values The values, in render order.
 * @returns The facet (validated later, by {@link defineFacets}).
 */
export function choiceFacet<Row, Id extends string>(
  id: Id,
  label: string,
  values: readonly FacetValue<Row>[]
): Facet<Row, Id> {
  return { id, label, kind: 'choice', values };
}

/**
 * A toggle facet: one boolean filter chip (its label is also its value's).
 *
 * @param id The facet id (unique within its page).
 * @param label The chip label.
 * @param predicate The rows the chip keeps when on.
 * @returns The facet, its one value labeled like the chip.
 */
export function toggleFacet<Row, Id extends string>(
  id: Id,
  label: string,
  predicate: (row: Row) => boolean
): Facet<Row, Id> {
  return { id, label, kind: 'toggle', values: [{ id: TOGGLE_VALUE, label, predicate }] };
}

/**
 * Check one facet's own shape: values present, unique, never the reserved
 * "Any", and a toggle exactly its one `TOGGLE_VALUE`.
 *
 * @param facet The facet to check.
 * @throws {@link Error} Naming the facet and the offending value id.
 */
function assertFacetShape<Row, Id extends string>(facet: Facet<Row, Id>): void {
  if (facet.values.length === 0) throw new Error(`Facet "${facet.id}" declares no values.`);
  if (
    facet.kind === 'toggle' &&
    (facet.values.length !== 1 || facet.values[0]?.id !== TOGGLE_VALUE)
  ) {
    throw new Error(`Toggle facet "${facet.id}" must declare exactly one "${TOGGLE_VALUE}" value.`);
  }
  const seen = new Set<string>();
  for (const value of facet.values) {
    if (value.id === ANY_VALUE) {
      throw new Error(`Facet "${facet.id}" declares the reserved value id "${ANY_VALUE}".`);
    }
    if (seen.has(value.id)) {
      throw new Error(`Facet "${facet.id}" declares the value id "${value.id}" twice.`);
    }
    seen.add(value.id);
  }
}

/**
 * Validate a page's facets once (at declaration) and index them.
 *
 * @param facets The facets, in render order.
 * @returns The validated set.
 * @throws {@link Error} On a duplicate facet id or a malformed facet — a
 *   declaration bug, surfaced when the page's module loads.
 */
export function defineFacets<Row, Id extends string>(
  facets: readonly Facet<Row, Id>[]
): FacetSet<Row, Id> {
  const byId = new Map<string, Facet<Row, Id>>();
  for (const facet of facets) {
    if (byId.has(facet.id)) throw new Error(`Facet id "${facet.id}" is declared twice.`);
    assertFacetShape(facet);
    byId.set(facet.id, facet);
  }
  return { facets, byId };
}

/**
 * Re-declare a facet set over a wrapping row shape (e.g. a view object
 * holding the classified row): the same ids, labels and kinds, each
 * predicate reading the projected row.
 *
 * @param set The facets over the inner row.
 * @param project The wrapping row → the inner row.
 * @returns The equivalent facets over the wrapping row.
 */
export function liftFacets<From, To, Id extends string>(
  set: FacetSet<From, Id>,
  project: (row: To) => From
): FacetSet<To, Id> {
  return defineFacets(
    set.facets.map((facet): Facet<To, Id> => ({
      ...facet,
      values: facet.values.map((value) => ({
        ...value,
        predicate: (row: To) => value.predicate(project(row))
      }))
    }))
  );
}

/**
 * The narrowing selections, in facet (render) order — the active-filter
 * chips and the Filters button's count. "Any" and missing entries are left out.
 *
 * @param set The page's facets.
 * @param selection The selection to read.
 * @returns One entry per facet whose selection narrows.
 * @throws {@link Error} When the selection names a facet the set does not
 *   declare, or a value its facet does not — a page-side wiring bug.
 */
export function selectedFacets<Row, Id extends string>(
  set: FacetSet<Row, Id>,
  selection: FacetSelection<Id>
): SelectedFacet<Row, Id>[] {
  const picked = new Map<string, FacetValue<Row>>();
  for (const [facetId, valueId] of Object.entries<string | undefined>(selection)) {
    const facet = set.byId.get(facetId);
    if (facet === undefined)
      throw new Error(`Unknown facet id: this page has no facet "${facetId}".`);
    if (valueId === undefined || valueId === ANY_VALUE) continue;
    const value = facet.values.find((candidate) => candidate.id === valueId);
    if (value === undefined) {
      throw new Error(`Unknown facet value: facet "${facetId}" has no value "${valueId}".`);
    }
    picked.set(facetId, value);
  }
  return set.facets.flatMap((facet) => {
    const value = picked.get(facet.id);
    return value === undefined ? [] : [{ facet, value }];
  });
}

/**
 * The rows the selection and the search keep: every narrowing facet's
 * selected predicate holds and the searched field matches the query. Facet
 * predicates run first (cheap flags), the search last (it lower-cases
 * possibly long fields), each at most once per row.
 *
 * @param rows The page's full row list.
 * @param set The page's facets.
 * @param selection The selected value per facet.
 * @param search The searched field + normalized query.
 * @returns The rows to render, in the input's order.
 * @throws {@link Error} On an unknown facet or value id (see {@link selectedFacets}).
 */
export function applyFacets<Row, Id extends string>(
  rows: readonly Row[],
  set: FacetSet<Row, Id>,
  selection: FacetSelection<Id>,
  search: FacetSearch<Row>
): readonly Row[] {
  const predicates = selectedFacets(set, selection).map(({ value }) => value.predicate);
  const matches = searchPredicate(search.field, search.query);
  return rows.filter(
    (row) => predicates.every((holds) => holds(row)) && (matches === null || matches(row))
  );
}

/** One facet's running counts during a {@link facetCounts} pass. */
interface FacetTally<Row> {
  readonly facet: Facet<Row>;
  any: number;
  /** One running count per value, in `facet.values` order. */
  readonly slots: { readonly value: FacetValue<Row>; count: number }[];
}

/** {@link failedSelection}'s answer for a row failing two or more selections. */
const MANY_FAILED = Symbol('many-failed');

/**
 * Which narrowing selection a row fails, stopping at the second failure.
 *
 * @param active The narrowing selections.
 * @param row The row.
 * @returns `null` (fails none), the one failed facet, or `MANY_FAILED`.
 */
function failedSelection<Row, Id extends string>(
  active: readonly SelectedFacet<Row, Id>[],
  row: Row
): Facet<Row, Id> | null | typeof MANY_FAILED {
  let failed: Facet<Row, Id> | null = null;
  for (const { facet, value } of active) {
    if (value.predicate(row)) continue;
    if (failed !== null) return MANY_FAILED;
    failed = facet;
  }
  return failed;
}

/**
 * Standard facet counts in one pass over the rows. Per row: the search runs
 * once, each narrowing selection's predicate at most once; a row failing
 * none counts for every facet (and toward `matched`), a row failing exactly
 * one selection counts only for that facet (it would show if that facet
 * changed), a row failing two or more counts nowhere. Each counted facet
 * then evaluates its values once — O(rows × (selections + values)).
 *
 * @param rows The page's full row list.
 * @param set The page's facets.
 * @param selection The selected value per facet.
 * @param search The searched field + normalized query (rows it rejects count nowhere).
 * @returns The counts per facet and value, plus `matched`.
 * @throws {@link Error} On an unknown facet or value id (see {@link selectedFacets}).
 */
export function facetCounts<Row, Id extends string>(
  rows: readonly Row[],
  set: FacetSet<Row, Id>,
  selection: FacetSelection<Id>,
  search: FacetSearch<Row>
): FacetCounts<Id> {
  const active = selectedFacets(set, selection);
  const matches = searchPredicate(search.field, search.query);
  const tallies: FacetTally<Row>[] = set.facets.map((facet) => ({
    facet,
    any: 0,
    slots: facet.values.map((value) => ({ value, count: 0 }))
  }));
  let matched = 0;
  for (const row of rows) {
    if (matches !== null && !matches(row)) continue;
    const failed = failedSelection(active, row);
    if (failed === MANY_FAILED) continue;
    if (failed === null) matched += 1;
    for (const tally of tallies) {
      if (failed !== null && tally.facet !== failed) continue;
      tally.any += 1;
      for (const slot of tally.slots) if (slot.value.predicate(row)) slot.count += 1;
    }
  }
  return { matched, byFacet: countTable(tallies) as Record<Id, FacetValueCounts> };
}

/**
 * The tallies as the public count table (facet id → value id → count).
 *
 * @param tallies The finished tallies.
 * @returns Facet id → value id (`ANY_VALUE` included) → count.
 */
function countTable<Row>(tallies: readonly FacetTally<Row>[]): Record<string, FacetValueCounts> {
  const table: Record<string, FacetValueCounts> = {};
  for (const { facet, any, slots } of tallies) {
    const counts: Record<string, number> = { [ANY_VALUE]: any };
    for (const { value, count } of slots) counts[value.id] = count;
    table[facet.id] = counts;
  }
  return table;
}
