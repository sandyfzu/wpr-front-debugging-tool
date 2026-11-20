/** The facet bar's pure view model. */
import { describe, expect, it } from 'vitest';
import {
  ANY_LABEL,
  activeFacetChips,
  choiceSegments,
  facetValueOf,
  noFacetSelection,
  toggleState,
  withFacetValue
} from './facet-controls';
import { ANY_VALUE, choiceFacet, defineFacets, TOGGLE_VALUE, toggleFacet } from './resource-facets';

interface Row {
  readonly delayed: boolean;
  readonly excluded: boolean;
}

type Id = 'delay' | 'excluded';

const SET = defineFacets<Row, Id>([
  choiceFacet('delay', 'Delay', [
    { id: 'delayed', label: 'Delayed', predicate: (row) => row.delayed },
    { id: 'non-delayed', label: 'Non-delayed', predicate: (row) => !row.delayed }
  ]),
  toggleFacet('excluded', 'Excluded', (row) => row.excluded)
]);

/** The fixture's facets by id (asserting they exist). */
function facet(id: Id) {
  const found = SET.byId.get(id);
  if (found === undefined) throw new Error(`no facet ${id}`);
  return found;
}

describe('facetValueOf', () => {
  it('reads the pick, a missing entry as Any', () => {
    expect(facetValueOf<Id>({ delay: 'delayed' }, 'delay')).toBe('delayed');
    expect(facetValueOf<Id>({}, 'delay')).toBe(ANY_VALUE);
    expect(facetValueOf<Id>({ delay: undefined }, 'delay')).toBe(ANY_VALUE);
  });
});

describe('choiceSegments', () => {
  it('leads with Any, then the values in order, each with its count', () => {
    const segments = choiceSegments(
      facet('delay'),
      { any: 5, delayed: 3, 'non-delayed': 2 },
      'any'
    );
    expect(segments).toEqual([
      { value: ANY_VALUE, label: ANY_LABEL, count: 5, disabled: false },
      { value: 'delayed', label: 'Delayed', count: 3, disabled: false },
      { value: 'non-delayed', label: 'Non-delayed', count: 2, disabled: false }
    ]);
  });

  it('disables a zero-count value unless it is the current pick; Any never disables', () => {
    const idle = choiceSegments(facet('delay'), { any: 0, delayed: 0, 'non-delayed': 0 }, 'any');
    expect(idle.map((s) => s.disabled)).toEqual([false, true, true]);
    const picked = choiceSegments(facet('delay'), { any: 0, delayed: 0 }, 'delayed');
    expect(picked.map((s) => s.disabled)).toEqual([false, false, true]);
  });

  it('counts a value missing from the table as zero', () => {
    expect(choiceSegments(facet('delay'), {}, 'any').map((s) => s.count)).toEqual([0, 0, 0]);
  });

  it('refuses a toggle facet, naming it', () => {
    expect(() => choiceSegments(facet('excluded'), {}, 'any')).toThrow(/"excluded" is a toggle/u);
  });
});

describe('toggleState', () => {
  it('is pressed on the toggle value, with its count', () => {
    expect(toggleState(facet('excluded'), { yes: 2 }, TOGGLE_VALUE)).toEqual({
      pressed: true,
      count: 2,
      disabled: false
    });
    expect(toggleState(facet('excluded'), { yes: 2 }, ANY_VALUE)).toEqual({
      pressed: false,
      count: 2,
      disabled: false
    });
  });

  it('disables an off chip matching nothing, never a pressed one', () => {
    expect(toggleState(facet('excluded'), { yes: 0 }, ANY_VALUE).disabled).toBe(true);
    expect(toggleState(facet('excluded'), {}, TOGGLE_VALUE).disabled).toBe(false);
  });

  it('refuses a choice facet, naming it', () => {
    expect(() => toggleState(facet('delay'), {}, 'any')).toThrow(/"delay" is a choice/u);
  });
});

describe('withFacetValue', () => {
  it('sets a value without mutating the input', () => {
    const before = { excluded: TOGGLE_VALUE } as const;
    const next = withFacetValue<Id>(before, 'delay', 'delayed');
    expect(next).toEqual({ excluded: TOGGLE_VALUE, delay: 'delayed' });
    expect(before).toEqual({ excluded: TOGGLE_VALUE });
    expect(next).not.toBe(before);
  });

  it('removes the entry on Any, so all-Any is {} (Clear filters)', () => {
    expect(withFacetValue<Id>({ delay: 'delayed' }, 'delay', ANY_VALUE)).toEqual({});
    expect(Object.keys(withFacetValue<Id>({}, 'delay', ANY_VALUE))).toEqual([]);
  });
});

describe('activeFacetChips', () => {
  it('lists each narrowing pick in facet order, toggles by their facet label', () => {
    expect(activeFacetChips(SET, { excluded: TOGGLE_VALUE, delay: 'non-delayed' })).toEqual([
      { facetId: 'delay', label: 'Non-delayed' },
      { facetId: 'excluded', label: 'Excluded' }
    ]);
  });

  it('is empty for {} and for explicit Any picks', () => {
    expect(activeFacetChips(SET, {})).toEqual([]);
    expect(activeFacetChips(SET, { delay: ANY_VALUE })).toEqual([]);
  });

  it('throws on an unknown value (the engine names it)', () => {
    expect(() => activeFacetChips(SET, { delay: 'nope' })).toThrow(/nope/u);
  });
});

describe('noFacetSelection', () => {
  it('is a fresh empty selection each call', () => {
    const a = noFacetSelection<Id>();
    expect(a).toEqual({});
    expect(noFacetSelection<Id>()).not.toBe(a);
  });
});
