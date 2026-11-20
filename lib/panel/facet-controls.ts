/**
 * The facet bar's view model, pure: what each facet control shows (segments
 * with counts, a toggle's pressed state) and how a pick rewrites the
 * selection. The bar renders these shapes; the facet engine
 * (`./resource-facets`) owns matching and counting.
 */
import {
  ANY_VALUE,
  TOGGLE_VALUE,
  selectedFacets,
  type Facet,
  type FacetSelection,
  type FacetSet,
  type FacetValueCounts
} from './resource-facets';

/** The implicit "no narrowing" segment's label on every choice facet. */
export const ANY_LABEL = 'Any';

/** One segment of a choice facet (the shape the segmented group takes). */
export interface FacetSegment {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  /** A value no row would match given the other facets — refused unless it is the current pick. */
  readonly disabled: boolean;
}

/** A toggle facet's chip state. */
export interface FacetToggle {
  readonly pressed: boolean;
  readonly count: number;
  /** Off and matching nothing given the other facets (a pressed chip always stays releasable). */
  readonly disabled: boolean;
}

/**
 * A count from a facet's table; a value the table lacks counts zero (the
 * engine always fills every value, so this only guards a stale table).
 *
 * @param counts The facet's counts per value id.
 * @param valueId The value.
 * @returns The count.
 */
function countOf(counts: FacetValueCounts, valueId: string): number {
  return counts[valueId] ?? 0;
}

/**
 * The facet's current value id: the selection's entry, or "Any".
 *
 * @param selection The page's selection.
 * @param facetId The facet.
 * @returns The selected value id.
 */
export function facetValueOf<Id extends string>(
  selection: FacetSelection<Id>,
  facetId: Id
): string {
  return selection[facetId] ?? ANY_VALUE;
}

/**
 * A choice facet's segments: "Any" first, then its values, each with its
 * count. A zero-count value is disabled unless it is the current pick (so a
 * selection the data no longer supports stays visible and releasable).
 *
 * @param facet The choice facet.
 * @param counts Its counts (from `facetCounts(...).byFacet[facet.id]`).
 * @param selected Its current value id.
 * @returns The segments in render order.
 * @throws {@link Error} When the facet is a toggle (a wiring bug).
 */
export function choiceSegments<Row, Id extends string>(
  facet: Facet<Row, Id>,
  counts: FacetValueCounts,
  selected: string
): FacetSegment[] {
  if (facet.kind !== 'choice') {
    throw new Error(`Facet "${facet.id}" is a toggle, not a choice.`);
  }
  return [
    { value: ANY_VALUE, label: ANY_LABEL, count: countOf(counts, ANY_VALUE), disabled: false },
    ...facet.values.map((value) => {
      const count = countOf(counts, value.id);
      return {
        value: value.id,
        label: value.label,
        count,
        disabled: count === 0 && selected !== value.id
      };
    })
  ];
}

/**
 * A toggle facet's chip state.
 *
 * @param facet The toggle facet.
 * @param counts Its counts.
 * @param selected Its current value id (`TOGGLE_VALUE` when on).
 * @returns Pressed, count and availability.
 * @throws {@link Error} When the facet is a choice (a wiring bug).
 */
export function toggleState<Row, Id extends string>(
  facet: Facet<Row, Id>,
  counts: FacetValueCounts,
  selected: string
): FacetToggle {
  if (facet.kind !== 'toggle') {
    throw new Error(`Facet "${facet.id}" is a choice, not a toggle.`);
  }
  const pressed = selected === TOGGLE_VALUE;
  const count = countOf(counts, TOGGLE_VALUE);
  return { pressed, count, disabled: !pressed && count === 0 };
}

/**
 * The selection with one facet set to a value; "Any" removes the entry, so
 * an all-Any selection is `{}` (the Clear filters state). Never mutates.
 *
 * @param selection The current selection.
 * @param facetId The facet picked.
 * @param valueId The value picked (`ANY_VALUE` to release the facet).
 * @returns A new selection object.
 */
export function withFacetValue<Id extends string>(
  selection: FacetSelection<Id>,
  facetId: Id,
  valueId: string
): FacetSelection<Id> {
  // Rebuilt without the facet's entry (no `delete` on a computed key), then set.
  const next = Object.fromEntries(
    Object.entries(selection).filter(([id]) => id !== facetId)
  ) as Partial<Record<Id, string>>;
  if (valueId !== ANY_VALUE) next[facetId] = valueId;
  return next;
}

/**
 * The empty selection (every facet on Any — the Clear filters state), typed
 * for a page's facet ids.
 *
 * @returns A fresh `{}`.
 */
export function noFacetSelection<Id extends string>(): FacetSelection<Id> {
  // `{}` has no key, so it satisfies every `Partial<Record<Id, …>>`; the
  // compiler cannot see that through a generic `Id`.
  return {} as FacetSelection<Id>;
}

/** One narrowing pick as a removable chip. */
export interface ActiveFacetChip<Id extends string> {
  readonly facetId: Id;
  /** The chip's words: the picked value's label (a toggle's is the facet's own). */
  readonly label: string;
}

/**
 * The narrowing picks as removable chips, in facet order (the compact bar's
 * chip row; its length is the Filters button's count).
 *
 * @param set The page's facets.
 * @param selection The current selection.
 * @returns One chip per narrowing facet.
 * @throws {@link Error} On an unknown facet or value id (from the engine).
 */
export function activeFacetChips<Row, Id extends string>(
  set: FacetSet<Row, Id>,
  selection: FacetSelection<Id>
): ActiveFacetChip<Id>[] {
  return selectedFacets(set, selection).map(({ facet, value }) => ({
    facetId: facet.id,
    label: value.label
  }));
}
