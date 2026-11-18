/**
 * The facet engine: declaration checks, selection validation (unknown ids
 * throw naming them), AND-combined facets + toggles, the shared search rule,
 * standard faceting counts (checked against a brute-force reference over
 * every selection), the one-pass cost bound via call counts at 5 000 rows,
 * lifting over a wrapping row, and the shared parity checks themselves.
 */
import { describe, expect, it, vi } from 'vitest';
import { chipParityMismatches, exclusivityViolations } from './facet-parity.fixtures';
import {
  ANY_VALUE,
  TOGGLE_VALUE,
  applyFacets,
  choiceFacet,
  defineFacets,
  facetCounts,
  liftFacets,
  selectedFacets,
  toggleFacet,
  type Facet,
  type FacetSearch,
  type FacetSelection,
  type FacetSet
} from './resource-facets';
import type { ResourcePageDefinition } from './resources-view-model';

/** A toy row: three dimensions and a searched name. */
interface Toy {
  readonly name: string;
  readonly color: 'red' | 'blue' | 'green';
  readonly size: 's' | 'm' | 'l';
  readonly shiny: boolean;
}

type ToyFacetId = 'color' | 'size' | 'shiny';

/** Color leaves green under Any only (a value the facet does not offer). */
const TOY_FACETS: FacetSet<Toy, ToyFacetId> = defineFacets<Toy, ToyFacetId>([
  choiceFacet('color', 'Color', [
    { id: 'red', label: 'Red', predicate: (row) => row.color === 'red' },
    { id: 'blue', label: 'Blue', predicate: (row) => row.color === 'blue' }
  ]),
  choiceFacet('size', 'Size', [
    { id: 's', label: 'S', predicate: (row) => row.size === 's' },
    { id: 'm', label: 'M', predicate: (row) => row.size === 'm' },
    { id: 'l', label: 'L', predicate: (row) => row.size === 'l' }
  ]),
  toggleFacet('shiny', 'Shiny', (row) => row.shiny)
]);

const COLORS = ['red', 'blue', 'green'] as const;
const SIZES = ['s', 'm', 'l'] as const;

/**
 * Deterministic rows covering every dimension combination (and more).
 *
 * @param count How many rows.
 * @returns The rows, in index order.
 */
function toys(count: number): Toy[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `Toy-${String(index)}${index % 4 === 0 ? '-alpha' : ''}`,
    color: COLORS[index % 3] ?? 'red',
    size: SIZES[Math.floor(index / 3) % 3] ?? 's',
    shiny: Math.floor(index / 9) % 2 === 0
  }));
}

/**
 * The search phase over the toy name.
 *
 * @param query The query.
 * @returns The search phase.
 */
function byName(query = ''): FacetSearch<Toy> {
  return { field: (row) => row.name, query };
}

/** Every selection of the toy facets (Any included). */
function everySelection(): FacetSelection<ToyFacetId>[] {
  const selections: FacetSelection<ToyFacetId>[] = [];
  for (const color of [ANY_VALUE, 'red', 'blue']) {
    for (const size of [ANY_VALUE, 's', 'm', 'l']) {
      for (const shiny of [ANY_VALUE, TOGGLE_VALUE]) selections.push({ color, size, shiny });
    }
  }
  return selections;
}

describe('facet declarations', () => {
  it('builds a choice facet and a toggle facet (one "yes" value labeled like the chip)', () => {
    expect(TOY_FACETS.facets.map((facet) => [facet.id, facet.kind])).toEqual([
      ['color', 'choice'],
      ['size', 'choice'],
      ['shiny', 'toggle']
    ]);
    expect(TOY_FACETS.byId.get('shiny')?.values.map((value) => [value.id, value.label])).toEqual([
      [TOGGLE_VALUE, 'Shiny']
    ]);
  });

  it('accepts an empty set (a search-only list)', () => {
    const empty = defineFacets<Toy, never>([]);
    expect(empty.facets).toEqual([]);
    expect(applyFacets(toys(3), empty, {}, byName())).toHaveLength(3);
    expect(facetCounts(toys(3), empty, {}, byName())).toEqual({ matched: 3, byFacet: {} });
  });

  it('throws naming a duplicate facet id', () => {
    const color = TOY_FACETS.facets[0] as Facet<Toy, ToyFacetId>;
    expect(() => defineFacets([color, color])).toThrow('Facet id "color" is declared twice.');
  });

  it('throws naming a facet without values', () => {
    expect(() => defineFacets([choiceFacet<Toy, 'x'>('x', 'X', [])])).toThrow(
      'Facet "x" declares no values.'
    );
  });

  it('throws on the reserved "any" value id and on a duplicate value id', () => {
    const yes = (): boolean => true;
    expect(() =>
      defineFacets([
        choiceFacet<Toy, 'x'>('x', 'X', [{ id: ANY_VALUE, label: 'A', predicate: yes }])
      ])
    ).toThrow('Facet "x" declares the reserved value id "any".');
    expect(() =>
      defineFacets([
        choiceFacet<Toy, 'x'>('x', 'X', [
          { id: 'v', label: 'V', predicate: yes },
          { id: 'v', label: 'W', predicate: yes }
        ])
      ])
    ).toThrow('Facet "x" declares the value id "v" twice.');
  });

  it('throws on a toggle that is not exactly one "yes" value', () => {
    const yes = (): boolean => true;
    const malformed: Facet<Toy, 't'>[] = [
      { id: 't', label: 'T', kind: 'toggle', values: [{ id: 'on', label: 'T', predicate: yes }] },
      {
        id: 't',
        label: 'T',
        kind: 'toggle',
        values: [
          { id: TOGGLE_VALUE, label: 'T', predicate: yes },
          { id: 'no', label: 'N', predicate: yes }
        ]
      }
    ];
    for (const facet of malformed) {
      expect(() => defineFacets([facet])).toThrow(
        'Toggle facet "t" must declare exactly one "yes" value.'
      );
    }
  });
});

describe('selectedFacets', () => {
  it('lists the narrowing selections in facet order, skipping Any and missing entries', () => {
    const picked = selectedFacets(TOY_FACETS, { shiny: TOGGLE_VALUE, color: 'blue', size: 'any' });
    expect(picked.map(({ facet, value }) => [facet.id, value.id])).toEqual([
      ['color', 'blue'],
      ['shiny', TOGGLE_VALUE]
    ]);
    expect(selectedFacets(TOY_FACETS, {})).toEqual([]);
    expect(selectedFacets(TOY_FACETS, { color: undefined })).toEqual([]);
  });

  it('throws naming an unknown facet id', () => {
    const selection = { colour: 'red' } as FacetSelection<ToyFacetId>;
    expect(() => selectedFacets(TOY_FACETS, selection)).toThrow(
      'Unknown facet id: this page has no facet "colour".'
    );
  });

  it('throws on an unknown facet id even when its value is Any or undefined (no narrowing hides it)', () => {
    const rows = toys(9);
    for (const valueId of [ANY_VALUE, undefined]) {
      const selection = { colour: valueId } as FacetSelection<ToyFacetId>;
      const message = 'Unknown facet id: this page has no facet "colour".';
      expect(() => selectedFacets(TOY_FACETS, selection)).toThrow(message);
      expect(() => applyFacets(rows, TOY_FACETS, selection, byName())).toThrow(message);
      expect(() => facetCounts(rows, TOY_FACETS, selection, byName())).toThrow(message);
    }
  });

  it('throws naming an unknown value, even on a toggle ("no" is not a toggle value)', () => {
    expect(() => selectedFacets(TOY_FACETS, { color: 'green' })).toThrow(
      'Unknown facet value: facet "color" has no value "green".'
    );
    expect(() => selectedFacets(TOY_FACETS, { shiny: 'no' })).toThrow(
      'Unknown facet value: facet "shiny" has no value "no".'
    );
  });
});

describe('applyFacets', () => {
  const rows = toys(36);

  it('keeps every row, in order, with no selection and no query', () => {
    expect(applyFacets(rows, TOY_FACETS, {}, byName())).toEqual(rows);
  });

  it('ANDs the selected values of every facet, toggles included', () => {
    const kept = applyFacets(rows, TOY_FACETS, { color: 'red', size: 'm', shiny: 'yes' }, byName());
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((row) => row.color === 'red' && row.size === 'm' && row.shiny)).toBe(true);
    expect(kept).toEqual(
      rows.filter((row) => row.color === 'red' && row.size === 'm' && row.shiny)
    );
  });

  it('a toggle left at Any applies no narrowing (off ≠ "not shiny")', () => {
    expect(applyFacets(rows, TOY_FACETS, { shiny: ANY_VALUE }, byName())).toEqual(rows);
  });

  it('composes the search: case-insensitive substring on the searched field, on the narrowed rows', () => {
    const kept = applyFacets(rows, TOY_FACETS, { color: 'blue' }, byName('ALPHA'));
    expect(kept).toEqual(rows.filter((row) => row.color === 'blue' && row.name.includes('alpha')));
    expect(kept.length).toBeGreaterThan(0);
    expect(applyFacets(rows, TOY_FACETS, {}, byName('no-such-toy'))).toEqual([]);
  });

  it('answers [] on empty rows, and still rejects unknown ids there (wiring bugs never hide)', () => {
    expect(applyFacets([], TOY_FACETS, { color: 'red' }, byName('a'))).toEqual([]);
    expect(() => applyFacets([], TOY_FACETS, { color: 'pink' }, byName())).toThrow(
      'Unknown facet value: facet "color" has no value "pink".'
    );
  });
});

/**
 * Brute-force reference counts: each value's count is the row total with
 * that value selected and the others unchanged.
 *
 * @param rows The rows.
 * @param selection The selection.
 * @param search The search phase.
 * @returns What `facetCounts` must answer (`matched` + facet id → value id → count).
 */
function referenceCounts(
  rows: readonly Toy[],
  selection: FacetSelection<ToyFacetId>,
  search: FacetSearch<Toy>
): ReturnType<typeof facetCounts<Toy, ToyFacetId>> {
  const byFacet = {} as Record<ToyFacetId, Record<string, number>>;
  for (const facet of TOY_FACETS.facets) {
    const counts: Record<string, number> = {};
    for (const valueId of [ANY_VALUE, ...facet.values.map((value) => value.id)]) {
      counts[valueId] = applyFacets(
        rows,
        TOY_FACETS,
        { ...selection, [facet.id]: valueId },
        search
      ).length;
    }
    byFacet[facet.id] = counts;
  }
  return { matched: applyFacets(rows, TOY_FACETS, selection, search).length, byFacet };
}

describe('facetCounts', () => {
  const rows = toys(40);

  it('with no selection: per-value totals, Any = every row, matched = every row', () => {
    expect(facetCounts(rows, TOY_FACETS, {}, byName())).toEqual({
      matched: 40,
      byFacet: {
        color: { any: 40, red: 14, blue: 13 },
        size: { any: 40, s: 15, m: 13, l: 12 },
        shiny: { any: 40, yes: 22 }
      }
    });
  });

  it("counts a facet's values over the rows the other facets let through, ignoring its own selection", () => {
    const counts = facetCounts(rows, TOY_FACETS, { color: 'red' }, byName());
    // Color's own counts ignore the red selection; Size and Shiny narrow to red rows.
    expect(counts.byFacet.color).toEqual({ any: 40, red: 14, blue: 13 });
    expect(counts.byFacet.size.any).toBe(14);
    expect(counts.matched).toBe(14);
  });

  it('matches the brute-force reference for every selection, with and without a query', () => {
    for (const query of ['', 'alpha', 'TOY-1', 'nothing']) {
      for (const selection of everySelection()) {
        expect(facetCounts(rows, TOY_FACETS, selection, byName(query))).toEqual(
          referenceCounts(rows, selection, byName(query))
        );
      }
    }
  });

  it('matched always equals the rendered rows', () => {
    for (const selection of everySelection()) {
      expect(facetCounts(rows, TOY_FACETS, selection, byName('a')).matched).toBe(
        applyFacets(rows, TOY_FACETS, selection, byName('a')).length
      );
    }
  });

  it('answers zeros with every key on empty rows', () => {
    expect(facetCounts([], TOY_FACETS, { size: 'l' }, byName('x'))).toEqual({
      matched: 0,
      byFacet: {
        color: { any: 0, red: 0, blue: 0 },
        size: { any: 0, s: 0, m: 0, l: 0 },
        shiny: { any: 0, yes: 0 }
      }
    });
  });

  it('throws naming an unknown facet or value id', () => {
    expect(() =>
      facetCounts(rows, TOY_FACETS, { hue: 'red' } as FacetSelection<ToyFacetId>, byName())
    ).toThrow('Unknown facet id: this page has no facet "hue".');
    expect(() => facetCounts(rows, TOY_FACETS, { size: 'xl' }, byName())).toThrow(
      'Unknown facet value: facet "size" has no value "xl".'
    );
  });
});

describe('cost at 5 000 rows (call counts, not timing)', () => {
  /** The toy facets with every predicate counted, plus the counter. */
  function countedFacets(): { set: FacetSet<Toy, ToyFacetId>; calls: () => number } {
    let calls = 0;
    const set = defineFacets(
      TOY_FACETS.facets.map((facet): Facet<Toy, ToyFacetId> => ({
        ...facet,
        values: facet.values.map((value) => ({
          ...value,
          predicate: (row: Toy) => {
            calls += 1;
            return value.predicate(row);
          }
        }))
      }))
    );
    return { set, calls: () => calls };
  }

  const rows = toys(5000);
  /** Values across the toy facets (2 + 3 + 1). */
  const VALUE_COUNT = 6;

  it('applyFacets: each selected predicate and the field at most once per row', () => {
    const { set, calls } = countedFacets();
    const field = vi.fn((row: Toy) => row.name);
    const kept = applyFacets(rows, set, { color: 'red', size: 'm' }, { field, query: 'alpha' });
    expect(kept.length).toBeGreaterThan(0);
    expect(calls()).toBeLessThanOrEqual(rows.length * 2);
    expect(field.mock.calls.length).toBeLessThanOrEqual(rows.length);
  });

  it('facetCounts: one pass — O(rows × (selections + values)) predicate calls, the field once per row', () => {
    const { set, calls } = countedFacets();
    const field = vi.fn((row: Toy) => row.name);
    const selection = { color: 'blue', size: 's', shiny: TOGGLE_VALUE };
    const counts = facetCounts(rows, set, selection, { field, query: 'toy' });
    expect(calls()).toBeLessThanOrEqual(rows.length * (3 + VALUE_COUNT));
    expect(field).toHaveBeenCalledTimes(rows.length);
    // The counted run still answers what the plain facets answer.
    expect(counts).toEqual(facetCounts(rows, TOY_FACETS, selection, byName('toy')));
  });
});

describe('liftFacets', () => {
  it('keeps ids, labels and kinds; predicates read the projected row', () => {
    const rows = toys(18);
    const views = rows.map((row) => ({ row }));
    const lifted = liftFacets(TOY_FACETS, (view: { row: Toy }) => view.row);
    expect(lifted.facets.map((facet) => [facet.id, facet.label, facet.kind])).toEqual(
      TOY_FACETS.facets.map((facet) => [facet.id, facet.label, facet.kind])
    );
    const selection = { color: 'red', shiny: TOGGLE_VALUE };
    const kept = applyFacets(views, lifted, selection, {
      field: (view) => view.row.name,
      query: ''
    });
    expect(kept.map((view) => view.row)).toEqual(
      applyFacets(rows, TOY_FACETS, selection, byName())
    );
  });
});

describe('the parity checks (they must be able to fail)', () => {
  const rows = toys(18);
  const CHIPS: ResourcePageDefinition<Toy, 'all' | 'red' | 'shiny'> = {
    filters: [
      { id: 'all', label: 'All', predicate: () => true },
      { id: 'red', label: 'Red', predicate: (row) => row.color === 'red' },
      { id: 'shiny', label: 'Shiny', predicate: (row) => row.shiny }
    ],
    searchField: (row) => row.name
  };

  it('passes a faithful mapping, with and without a query', () => {
    const mapping = { all: {}, red: { color: 'red' }, shiny: { shiny: TOGGLE_VALUE } } as const;
    expect(chipParityMismatches(rows, CHIPS, TOY_FACETS, mapping)).toEqual([]);
    expect(chipParityMismatches(rows, CHIPS, TOY_FACETS, mapping, 'alpha')).toEqual([]);
  });

  it('reports a wrong mapping and a chip selecting no fixture row', () => {
    const mapping = { all: {}, red: { color: 'blue' }, shiny: { shiny: TOGGLE_VALUE } } as const;
    expect(chipParityMismatches(rows, CHIPS, TOY_FACETS, mapping)).toEqual([
      'chip "red" (query ""): the facets select other rows (chip 6, facets 6)'
    ]);
    const unshiny = rows.map((row) => ({ ...row, shiny: false }));
    expect(chipParityMismatches(unshiny, CHIPS, TOY_FACETS, mapping)).toContain(
      'chip "shiny" selects no fixture row'
    );
  });

  it('reports rows matching two values of a choice facet', () => {
    const loose = defineFacets<Toy, 'size'>([
      choiceFacet('size', 'Size', [
        { id: 'small', label: 'Small', predicate: (row) => row.size === 's' },
        { id: 'not-large', label: 'Not large', predicate: (row) => row.size !== 'l' }
      ])
    ]);
    expect(exclusivityViolations(rows.slice(0, 1), loose)).toEqual([
      'facet "size" row 0: small + not-large'
    ]);
    expect(exclusivityViolations(rows, TOY_FACETS)).toEqual([]);
  });
});
