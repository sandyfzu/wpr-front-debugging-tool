/**
 * Test-only checks shared by the pages' facet suites: every single-select
 * chip must stay reachable as one facet selection selecting the same rows
 * (with and without a search query), and a choice facet's values must be
 * mutually exclusive. Each check returns readable mismatch lines, so a suite
 * asserts `toEqual([])` and a failure names the chip or row. Imported by
 * tests only — never by shipped code.
 */
import { applyFacets, type FacetSelection, type FacetSet } from './resource-facets';
import { filterAndSearch, type ResourcePageDefinition } from './resources-view-model';

/**
 * Compare every chip of a page with its facet selection over fixture rows.
 * A chip that selects no fixture row is reported too: parity over an empty
 * answer would prove nothing.
 *
 * @param rows Representative rows (edge rows included).
 * @param definition The page's single-select chips.
 * @param facets The page's facets.
 * @param mapping The facet selection standing for each chip (typed per chip id: exhaustive).
 * @param query A query composed with both sides (`''` = none).
 * @returns One line per mismatch (`[]` = parity).
 */
export function chipParityMismatches<Row, ChipId extends string, FacetId extends string>(
  rows: readonly Row[],
  definition: ResourcePageDefinition<Row, ChipId>,
  facets: FacetSet<Row, FacetId>,
  mapping: Readonly<Record<ChipId, FacetSelection<FacetId>>>,
  query = ''
): string[] {
  const mismatches: string[] = [];
  for (const chip of definition.filters) {
    const expected = filterAndSearch(rows, definition, chip.id, query);
    const actual = applyFacets(rows, facets, mapping[chip.id], {
      field: definition.searchField,
      query
    });
    if (query === '' && expected.length === 0) {
      mismatches.push(`chip "${chip.id}" selects no fixture row`);
    }
    const same =
      expected.length === actual.length && expected.every((row, index) => row === actual[index]);
    if (!same) {
      mismatches.push(
        `chip "${chip.id}" (query "${query}"): the facets select other rows (chip ${String(expected.length)}, facets ${String(actual.length)})`
      );
    }
  }
  return mismatches;
}

/**
 * Rows matching two or more values of one choice facet.
 *
 * @param rows Representative rows.
 * @param facets The page's facets (toggles are skipped: one value each).
 * @returns One line per violation (`[]` = every choice facet is exclusive).
 */
export function exclusivityViolations<Row, FacetId extends string>(
  rows: readonly Row[],
  facets: FacetSet<Row, FacetId>
): string[] {
  const violations: string[] = [];
  for (const facet of facets.facets) {
    if (facet.kind !== 'choice') continue;
    rows.forEach((row, index) => {
      const held = facet.values.filter((value) => value.predicate(row)).map((value) => value.id);
      if (held.length > 1) {
        violations.push(`facet "${facet.id}" row ${String(index)}: ${held.join(' + ')}`);
      }
    });
  }
  return violations;
}
