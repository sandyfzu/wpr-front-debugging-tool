/**
 * Render tests for the filter bar: single-select chips with `aria-pressed` +
 * `data-fdt-selected` state carrying, counts exposed per chip, the keyboard
 * path and the embedded shared search field.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterBar, indexChips, type FilterChip } from './filter-bar';

const CHIPS: FilterChip[] = [
  { value: 'all', label: 'All', count: 87 },
  { value: 'delayed', label: 'Delayed', count: 12 },
  { value: 'exclude', label: 'Exclude', count: 4 },
  { value: 'rcss', label: 'Pending RUCSS', count: 0, disabled: true }
];

afterEach(() => {
  cleanup();
});

/** The chip buttons of the currently rendered bar, in registry order. */
function getChips(): HTMLElement[] {
  const group = screen.getByRole('group');
  return Array.from(group.querySelectorAll<HTMLElement>('[data-fdt-filter-chip]'));
}

/** Guard for indexed reads (noUncheckedIndexedAccess): branch, never crash. */
function throwAt(index: number): never {
  throw new Error(`Element at index ${String(index)} missing from the rendered bar`);
}

describe('FilterBar', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [1000, '1,000'],
    [5000, '5,000']
  ])('uses the same grouped count for visible text and accessible name: %i', (count, shown) => {
    render(() => <FilterBar chips={[{ value: 'all', label: 'All', count }]} selected="all" />);
    const chip = screen.getByRole('button', { name: `All ${shown} matching` });
    expect(chip.querySelector('[data-fdt-filter-count]')?.textContent).toBe(shown);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('retains focus and the same button across a thousands boundary', () => {
    const [count, setCount] = createSignal(999);
    render(() => <FilterBar chips={[{ value: 'all', label: 'All', count: count() }]} />);
    const chip = screen.getByRole('button', { name: 'All 999 matching' });
    chip.focus();
    setCount(1000);
    expect(screen.getByRole('button', { name: 'All 1,000 matching' })).toBe(chip);
    expect(document.activeElement).toBe(chip);
  });

  it('renders chips with registry order, counts and the search field', () => {
    render(() => <FilterBar chips={CHIPS} />);
    const chips = getChips();
    expect(chips.map((chip) => chip.getAttribute('data-fdt-filter-chip'))).toEqual([
      'all',
      'delayed',
      'exclude',
      'rcss'
    ]);
    // Counts are rendered inside each chip (the count hook exposes them).
    const delayed = chips[1] ?? throwAt(1);
    const pending = chips[3] ?? throwAt(3);
    expect(delayed.querySelector('[data-fdt-filter-count]')?.textContent).toBe('12');
    expect(pending.querySelector('[data-fdt-filter-count]')?.textContent).toBe('0');
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeTruthy();
  });

  it('selects through click, exposing state in aria-pressed AND data-fdt-selected', () => {
    const onSelect = vi.fn();
    render(() => <FilterBar chips={CHIPS} selected="all" onSelect={onSelect} />);
    const chips = getChips();
    const first = chips[0] ?? throwAt(0);
    const second = chips[1] ?? throwAt(1);
    // Preselected chip carries BOTH carriers; unselected chips carry neither.
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(first.hasAttribute('data-fdt-selected')).toBe(true);
    expect(second.getAttribute('aria-pressed')).toBe('false');
    expect(second.hasAttribute('data-fdt-selected')).toBe(false);
    fireEvent.click(second);
    expect(onSelect).toHaveBeenCalledWith('delayed');
  });

  it('follows the controlled selection loop', async () => {
    // The page owns the selection signal; the callback payload is recorded in
    // a plain local so the assertion reads a settled value.
    const [selected, setSelected] = createSignal<string | undefined>(undefined);
    render(() => <FilterBar chips={CHIPS} selected={selected()} onSelect={setSelected} />);
    const chips = getChips();
    const exclude = chips[2] ?? throwAt(2);
    fireEvent.click(exclude);
    await expect
      .poll(() => screen.getByRole('button', { name: /Exclude/ }).getAttribute('aria-pressed'), {
        timeout: 300
      })
      .toBe('true');
  });

  it('is keyboard-operable: chips are reachable buttons (native Enter/Space activation)', () => {
    const onSelect = vi.fn();
    render(() => <FilterBar chips={CHIPS} onSelect={onSelect} />);
    const chip = getChips()[1] ?? throwAt(1);
    chip.focus();
    // Element-level keyboard affordance: the chip is a focused, activatable button.
    expect(document.activeElement).toBe(chip);
    chip.click();
    expect(onSelect).toHaveBeenCalledWith('delayed');
  });

  it('renders the disabled chip inert and dimmed', () => {
    render(() => <FilterBar chips={CHIPS} />);
    const disabled = getChips().find((chip) => (chip as HTMLButtonElement).disabled) ?? throwAt(0);
    expect(disabled.className).toContain('disabled:opacity-50');
    fireEvent.click(disabled);
    for (const chip of getChips()) {
      expect(chip.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('wires the embedded search field through the controlled loop', () => {
    // The page owns the query signal; changes are recorded through a plain local.
    const [query] = createSignal('delay');
    let typed: string | undefined;
    render(() => (
      <FilterBar
        chips={CHIPS}
        searchQuery={query()}
        onSearchChange={(value) => {
          typed = value;
        }}
      />
    ));
    const field = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search' });
    expect(field.value).toBe('delay');
    fireEvent.input(field, { target: { value: 'exclud' } });
    expect(typed).toBe('exclud');
  });

  it('hides the search field when asked', () => {
    render(() => <FilterBar chips={CHIPS} showSearch={false} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('names the chip group "Filters" (renamable) so the group is announced', () => {
    render(() => <FilterBar chips={CHIPS} />);
    expect(screen.getByRole('group', { name: 'Filters' })).toBeTruthy();
    cleanup();
    render(() => <FilterBar chips={CHIPS} filterLabel="Resource state" />);
    expect(screen.getByRole('group', { name: 'Resource state' })).toBeTruthy();
  });

  it('exposes every chip count inside its accessible name', () => {
    render(() => <FilterBar chips={CHIPS} />);
    // The name carries label AND count ("how many this chip selects") — the
    // count is announced, not only painted in the badge.
    expect(screen.getByRole('button', { name: 'All 87 matching' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delayed 12 matching' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pending RUCSS 0 matching' })).toBeTruthy();
  });

  it('names each chip from its own content: the name starts with and contains the visible text', () => {
    render(() => <FilterBar chips={CHIPS} selected="delayed" />);
    for (const chip of getChips()) {
      // No aria-label: an override would replace the content and could drift
      // from it (WCAG 2.5.3 label-in-name).
      expect(chip.hasAttribute('aria-label')).toBe(false);
    }
    const delayed = screen.getByRole('button', { name: 'Delayed 12 matching' });
    // The visible parts (everything outside the sr-only spans) appear in the
    // name in reading order: the label first, then the count.
    const visible = Array.from(delayed.childNodes)
      .filter((node) => !(node instanceof HTMLElement && node.classList.contains('sr-only')))
      .map((node) => node.textContent)
      .join(' ');
    expect(visible).toBe('Delayed 12');
  });

  it('keys chips by value: rebuilt chip objects keep the buttons and keyboard focus', () => {
    const [chips, setChips] = createSignal<FilterChip[]>(CHIPS.map((chip) => ({ ...chip })));
    render(() => <FilterBar chips={chips()} />);
    const before = getChips();
    const delayed = before[1] ?? throwAt(1);
    delayed.focus();
    // A refresh: every chip object is new, counts move.
    setChips(CHIPS.map((chip) => ({ ...chip, count: chip.count + 1 })));
    const after = getChips();
    expect(after).toEqual(before); // the very same DOM nodes, in order
    expect(document.activeElement).toBe(delayed);
    expect(delayed.querySelector('[data-fdt-filter-count]')?.textContent).toBe('13');
    expect(screen.getByRole('button', { name: 'Delayed 13 matching' })).toBe(delayed);
  });

  it('adds, removes and reorders chips by value without disturbing the survivors', () => {
    const [chips, setChips] = createSignal<FilterChip[]>(CHIPS.slice(0, 3));
    render(() => <FilterBar chips={chips()} />);
    const exclude = getChips()[2] ?? throwAt(2);
    setChips([
      { value: 'exclude', label: 'Exclude', count: 5 },
      { value: 'new', label: 'New', count: 1 }
    ]);
    const now = getChips();
    expect(now.map((chip) => chip.getAttribute('data-fdt-filter-chip'))).toEqual([
      'exclude',
      'new'
    ]);
    expect(now[0]).toBe(exclude);
  });

  it('paints the selected count with the inverted accent token pair (no alpha fill)', () => {
    render(() => <FilterBar chips={CHIPS} selected="all" />);
    const [selected, unselected] = getChips();
    const selectedCount = selected?.querySelector('[data-fdt-filter-count]') ?? throwAt(0);
    const unselectedCount = unselected?.querySelector('[data-fdt-filter-count]') ?? throwAt(1);
    // `on-accent` on `accent-strong` is a contrast-gated pair; inverting it
    // keeps the same ratio. An alpha wash over the fill is not gated.
    expect(selectedCount.className).toContain('bg-on-accent');
    expect(selectedCount.className).toContain('text-accent-strong');
    expect(selectedCount.className).not.toMatch(/\/\d+/);
    expect(unselectedCount.className).toContain('bg-surface-3');
  });

  it('throws on a duplicate chip value (two chips cannot share one identity)', () => {
    const duplicate: FilterChip[] = [
      { value: 'all', label: 'All', count: 1 },
      { value: 'all', label: 'Everything', count: 2 }
    ];
    expect(() => indexChips(duplicate)).toThrow('FilterBar: duplicate chip value "all".');
    expect(() => render(() => <FilterBar chips={duplicate} />)).toThrow(/duplicate chip value/);
  });

  it('indexes chips in registry order', () => {
    expect(Array.from(indexChips(CHIPS).keys())).toEqual(['all', 'delayed', 'exclude', 'rcss']);
    expect(indexChips([]).size).toBe(0);
  });
});
