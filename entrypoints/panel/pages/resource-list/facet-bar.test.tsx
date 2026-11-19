/** The facet bar on its own: inline tier, compact tier, sheet, chips and focus. */
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  choiceFacet,
  defineFacets,
  facetCounts,
  toggleFacet,
  type FacetSelection
} from '../../../../lib/panel/resource-facets';
import { FacetBar, filtersRestoreTarget } from './facet-bar';

interface Row {
  readonly delayed: boolean;
  readonly inline: boolean;
  readonly excluded: boolean;
}

type Id = 'delay' | 'type' | 'excluded';

const SET = defineFacets<Row, Id>([
  choiceFacet('delay', 'Delay', [
    { id: 'delayed', label: 'Delayed', predicate: (row) => row.delayed },
    { id: 'non-delayed', label: 'Non-delayed', predicate: (row) => !row.delayed }
  ]),
  choiceFacet('type', 'Type', [
    { id: 'inline', label: 'Inline', predicate: (row) => row.inline },
    { id: 'external', label: 'External', predicate: (row) => !row.inline }
  ]),
  toggleFacet('excluded', 'Excluded', (row) => row.excluded)
]);

const ROWS: readonly Row[] = [
  { delayed: true, inline: true, excluded: false },
  { delayed: true, inline: false, excluded: true },
  { delayed: false, inline: false, excluded: false }
];

/** Render the bar over the fixture with a live selection and tier. */
function renderBar(compact = false) {
  const [selection, setSelection] = createSignal<FacetSelection<Id>>({});
  const [isCompact, setCompact] = createSignal(compact);
  const onChange = vi.fn((next: FacetSelection<Id>) => setSelection(() => next));
  render(() => (
    <FacetBar
      facets={SET}
      selection={selection()}
      counts={facetCounts(ROWS, SET, selection(), { field: () => '', query: '' })}
      onChange={onChange}
      compact={isCompact()}
      search={<input type="search" aria-label="Search scripts" />}
      filterLabel="Filter scripts"
      shownLabel="3 scripts"
    />
  ));
  return { selection, onChange, setCompact };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FacetBar inline', () => {
  it('groups the facets under one name, choices as captioned segments, toggles as chips, search last', () => {
    renderBar();
    const group = screen.getByRole('group', { name: 'Filter scripts' });
    expect(within(group).getByRole('radiogroup', { name: 'Delay' })).toBeTruthy();
    expect(within(group).getByRole('radiogroup', { name: 'Type' })).toBeTruthy();
    expect(
      within(group)
        .getByRole('button', { name: /Excluded/u })
        .getAttribute('aria-pressed')
    ).toBe('false');
    const search = screen.getByRole('searchbox', { name: 'Search scripts' });
    expect(group.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Filters/u })).toBeNull();
  });

  it('a pick and a release rewrite the selection (Any removes the entry)', () => {
    const { selection } = renderBar();
    fireEvent.click(
      document.querySelector('[data-fdt-choice-value="external"] input') as HTMLInputElement
    );
    expect(selection()).toEqual({ type: 'external' });
    fireEvent.click(screen.getByRole('button', { name: /Excluded/u }));
    expect(selection()).toEqual({ type: 'external', excluded: 'yes' });
    fireEvent.click(
      document.querySelector(
        '[data-fdt="choice-group"] [data-fdt-choice-value="any"] input'
      ) as HTMLInputElement
    );
    fireEvent.click(screen.getByRole('button', { name: /Excluded/u }));
    expect(selection()).toEqual({ type: 'external' });
  });
});

describe('FacetBar compact', () => {
  it('shows the Filters button with the pick count and one removable chip per pick', () => {
    const { selection } = renderBar(true);
    expect(screen.queryByRole('group', { name: 'Filter scripts' })).toBeNull();
    const button = screen.getByRole('button', { name: /Filters/u });
    fireEvent.click(button);
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    fireEvent.click(
      sheet.querySelector('[data-fdt-choice-value="delayed"] input') as HTMLInputElement
    );
    fireEvent.click(within(sheet).getByRole('button', { name: /Excluded/u }));
    expect(selection()).toEqual({ delay: 'delayed', excluded: 'yes' });
    expect(button.querySelector('[data-fdt="facet-filters-count"]')?.textContent).toBe('2');
    const chips = document.querySelectorAll('[data-fdt="facet-chip"]');
    expect([...chips].map((chip) => chip.textContent)).toEqual(['Delayed', 'Excluded']);
  });

  it('removing a chip releases its facet and keeps focus on the Filters button', () => {
    const { selection } = renderBar(true);
    fireEvent.click(screen.getByRole('button', { name: /Filters/u }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    fireEvent.click(
      sheet.querySelector('[data-fdt-choice-value="inline"] input') as HTMLInputElement
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Show 3 scripts' }));
    vi.runAllTimers();
    const chip = screen.getByRole('button', { name: 'Remove filter Inline' });
    chip.focus();
    fireEvent.click(chip);
    expect(selection()).toEqual({});
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Filters/u }));
  });

  it('names each sheet segment group by its visible caption and stretches it', () => {
    renderBar(true);
    fireEvent.click(screen.getByRole('button', { name: /Filters/u }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    const delay = within(sheet).getByRole('radiogroup', { name: 'Delay' });
    expect(delay.className).toContain('w-full');
    const caption = sheet.querySelector(`#${delay.getAttribute('aria-labelledby') ?? ''}`);
    expect(caption?.textContent).toBe('Delay');
  });

  it('disables a value matching nothing given the other picks, never the current one', () => {
    renderBar(true);
    fireEvent.click(screen.getByRole('button', { name: /Filters/u }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Excluded/u }));
    // Only the delayed external row is excluded: Inline and Non-delayed match nothing now.
    const input = (value: string): HTMLInputElement =>
      sheet.querySelector(`[data-fdt-choice-value="${value}"] input`) as HTMLInputElement;
    expect(input('inline').disabled).toBe(true);
    expect(input('non-delayed').disabled).toBe(true);
    expect(input('external').disabled).toBe(false);
  });

  it('widening with focus in the open sheet hands focus to the search field, never the body', async () => {
    const { setCompact } = renderBar(true);
    fireEvent.click(screen.getByRole('button', { name: /Filters/u }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    within(sheet).getByRole('button', { name: 'Reset' }).focus();
    setCompact(false);
    // The Filters button left with the tier; the sheet finishes closing.
    expect(screen.queryByRole('button', { name: /Filters/u })).toBeNull();
    await vi.runAllTimersAsync();
    expect(document.querySelector('[data-fdt="sheet"]')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search scripts' }));
  });
});

describe('FacetBar without facets (search only)', () => {
  it('shows only the search field in both tiers: no empty group, no Filters button', () => {
    const none = defineFacets<Row, never>([]);
    const [compact, setCompact] = createSignal(false);
    render(() => (
      <FacetBar
        facets={none}
        selection={{}}
        counts={facetCounts(ROWS, none, {}, { field: () => '', query: '' })}
        onChange={() => undefined}
        compact={compact()}
        search={<input type="search" aria-label="Search hashes" />}
        filterLabel="Filter hashes"
        shownLabel="3 hashes"
      />
    ));
    expect(screen.queryByRole('group', { name: 'Filter hashes' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search hashes' })).toBeTruthy();
    setCompact(true);
    expect(screen.queryByRole('button', { name: /Filters/u })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search hashes' })).toBeTruthy();
  });
});

describe('filtersRestoreTarget', () => {
  /** A bar root holding the given markup. */
  function barWith(html: string): HTMLElement {
    const bar = document.createElement('div');
    bar.innerHTML = html;
    document.body.append(bar);
    return bar;
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('prefers the connected Filters button', () => {
    const bar = barWith('<button type="button">Filters</button><input type="search" />');
    const button = bar.querySelector('button') as HTMLElement;
    expect(filtersRestoreTarget(bar, button)).toBe(button);
  });

  it('falls back to the search field (priority, not document order) once the button is gone', () => {
    const bar = barWith('<input type="radio" /><input type="search" />');
    const detached = document.createElement('button');
    expect(filtersRestoreTarget(bar, detached)).toBe(bar.querySelector('input[type="search"]'));
    expect(filtersRestoreTarget(bar, undefined)).toBe(bar.querySelector('input[type="search"]'));
  });

  it('else the first enabled control; nothing focusable → undefined', () => {
    const bar = barWith(
      '<button type="button" disabled>A</button><input type="radio" id="b" /><button type="button">C</button>'
    );
    expect(filtersRestoreTarget(bar, undefined)).toBe(bar.querySelector('#b'));
    expect(filtersRestoreTarget(barWith('<span></span>'), undefined)).toBeUndefined();
    expect(filtersRestoreTarget(undefined, undefined)).toBeUndefined();
  });
});
