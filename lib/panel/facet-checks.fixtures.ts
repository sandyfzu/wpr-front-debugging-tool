/**
 * Test-only checks shared by the pages' facet suites: each facet selection
 * keeps exactly the fixture rows a suite names for it (with and without a
 * search query), and a choice facet's values are mutually exclusive. Each
 * check returns readable mismatch lines, so a suite asserts `toEqual([])`
 * and a failure names the selection or row. Imported by tests only — never
 * by shipped code.
 */
import { applyFacets, type FacetSelection, type FacetSet } from './resource-facets';

/** One facet selection and the fixture rows it keeps (positions in the fixture, in order). */
export interface SelectionCase<FacetId extends string> {
  readonly selection: FacetSelection<FacetId>;
  readonly rows: readonly number[];
}

/**
 * Compare named facet selections with the rows each must keep. With a
 * query, the expected rows are the named ones whose searched field holds
 * it — the search rule (case-insensitive substring) restated here, so the
 * check never trusts the code it checks. A case keeping no fixture row
 * without a query is reported too: a check over an empty answer proves
 * nothing.
 *
 * @param rows Representative rows (edge rows included).
 * @param facets The page's facets.
 * @param field The page's searched field.
 * @param cases The selections by name, each with the rows it keeps.
 * @param query A query composed with every selection (`''` = none).
 * @returns One line per mismatch (`[]` = every selection keeps its rows).
 */
export function selectionMismatches<Row, FacetId extends string>(
  rows: readonly Row[],
  facets: FacetSet<Row, FacetId>,
  field: (row: Row) => string,
  cases: Readonly<Record<string, SelectionCase<FacetId>>>,
  query = ''
): string[] {
  const mismatches: string[] = [];
  const needle = query.toLowerCase();
  for (const [name, { selection, rows: kept }] of Object.entries(cases)) {
    if (query === '' && kept.length === 0) mismatches.push(`"${name}" keeps no fixture row`);
    const expected = kept.filter((index) => {
      const row = rows[index];
      return row !== undefined && field(row).toLowerCase().includes(needle);
    });
    const actual = applyFacets(rows, facets, selection, { field, query }).map((row) =>
      rows.indexOf(row)
    );
    if (expected.join() !== actual.join()) {
      mismatches.push(
        `"${name}" (query "${query}"): kept [${actual.join(', ')}], expected [${expected.join(', ')}]`
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
