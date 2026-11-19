/** The calm row: its grid table, estimates, surface classes, content and head. */
import { cleanup, render } from '@solidjs/testing-library';
import ImageIcon from 'lucide-solid/icons/image';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_MATCH_ROW } from '../current-match';
import {
  CALM_ROW_ESTIMATES,
  CalmListContext,
  calmRowClass,
  calmRowEstimate,
  ListRow,
  ListRowContext,
  ListRowHead,
  rowGrid,
  type ListRowColumns
} from './list-row';
import { splitStateChips } from './state-chips';

afterEach(() => {
  cleanup();
});

const BOTH: ListRowColumns = { size: true, states: true };
const NONE: ListRowColumns = { size: false, states: false };

describe('rowGrid', () => {
  it.each([
    [
      'two',
      BOTH,
      '"name_size"_"preview_preview"_"states_states"',
      '"name_size_states"_"preview_size_states"'
    ],
    [
      'two',
      { size: true, states: false },
      '"name_size"_"preview_preview"',
      '"name_size"_"preview_size"'
    ],
    [
      'two',
      { size: false, states: true },
      '"name"_"preview"_"states"',
      '"name_states"_"preview_states"'
    ],
    ['one', BOTH, '"name_size"_"preview_preview"_"states_states"', '"name_preview_size_states"'],
    ['one', NONE, '"name"_"preview"', '"name_preview"']
  ] as const)(
    '%s lines %o: stacks compact, columns from @regular',
    (lines, columns, compact, regular) => {
      const grid = rowGrid(lines, columns);
      expect(grid).toContain(`[grid-template-areas:${compact}]`);
      expect(grid).toContain(`@regular:[grid-template-areas:${regular}]`);
    }
  );

  it('keeps two-line rows without optional columns stacked at every tier', () => {
    expect(rowGrid('two', NONE)).toBe(
      'grid-cols-[minmax(0,1fr)] [grid-template-areas:"name"_"preview"]'
    );
  });

  it('spells the size and states tracks the head shares (4rem, 10rem)', () => {
    expect(rowGrid('two', BOTH)).toContain('@regular:grid-cols-[minmax(0,1fr)_4rem_10rem]');
  });
});

describe('calmRowEstimate', () => {
  it('seeds the T-3 floors, a stacked third line on compact rows with chips', () => {
    expect(calmRowEstimate('two', false, true)).toBe(CALM_ROW_ESTIMATES.twoLine);
    expect(calmRowEstimate('one', false, true)).toBe(CALM_ROW_ESTIMATES.oneLine);
    expect(calmRowEstimate('one', true, false)).toBe(CALM_ROW_ESTIMATES.twoLine);
    expect(calmRowEstimate('two', true, true)).toBe(CALM_ROW_ESTIMATES.stacked);
    expect(CALM_ROW_ESTIMATES).toEqual({ twoLine: 58, oneLine: 36, stacked: 84 });
  });
});

describe('calmRowClass', () => {
  const base = { lines: 'two', interactive: true, selected: false, current: false } as const;

  it('draws no borders; 58 / 36 px floors and 14 px inline padding', () => {
    expect(calmRowClass(base)).not.toMatch(/border/u);
    expect(calmRowClass(base)).toContain('min-h-14.5');
    expect(calmRowClass({ ...base, lines: 'one' })).toContain('min-h-9');
    expect(calmRowClass(base)).toContain('px-3.5');
  });

  it('tints on hover only while interactive and unselected; selection wins the background', () => {
    expect(calmRowClass(base)).toContain('hover:bg-surface-3');
    expect(calmRowClass({ ...base, interactive: false })).not.toContain('hover:');
    const selected = calmRowClass({ ...base, selected: true, current: true });
    expect(selected).toContain('bg-accent-soft');
    expect(selected).not.toContain('hover:bg-surface-3');
    // The find's rail survives; its wash yields to the selection.
    expect(selected).toContain('before:bg-accent');
    expect(selected.split(' ')).not.toContain('bg-surface-3');
    expect(calmRowClass({ ...base, current: true })).toContain(CURRENT_MATCH_ROW.split(' ')[1]);
  });

  it('rings the whole row for keyboard focus on its open button', () => {
    expect(calmRowClass(base)).toContain('has-[[data-fdt-row-open]:focus-visible]:outline-2');
    expect(calmRowClass({ ...base, interactive: false })).not.toContain('outline');
  });
});

describe('ListRow', () => {
  it('renders a static row without its list: name, preview, size, chips, actions — no button', () => {
    const { container } = render(() => (
      <ListRow
        columns={BOTH}
        icon={ImageIcon}
        name="logo.png"
        mono
        preview="https://cdn.example/logo.png"
        size="12 KB"
        chips={splitStateChips([{ id: 'a', label: 'Lazyloaded', source: 'wp-rocket' }], 2)}
        actions={<button type="button">Copy</button>}
      />
    ));
    expect(container.querySelector('[data-fdt-row-open]')).toBeNull();
    const name = container.querySelector('[data-fdt="list-row-name"]') as HTMLElement;
    expect(name.textContent).toBe('logo.png');
    expect(name.className).toContain('font-semibold');
    expect(name.className).toContain('font-mono');
    expect(name.title).toBe('logo.png');
    expect(container.querySelector('[data-fdt="list-row-preview"]')?.className).toContain(
      'text-fg-muted'
    );
    expect(container.querySelector('[data-fdt="list-row-size"]')?.className).toContain(
      'tabular-nums'
    );
    expect(container.querySelectorAll('[data-fdt="state-chip"]')).toHaveLength(1);
    expect(container.querySelector('[data-fdt="list-row-icon"] svg')).not.toBeNull();
    expect(container.querySelector('svg.lucide-chevron-right')).toBeNull();
  });

  it('leaves the size cell empty when the row has no size, and the dash marks no chips', () => {
    const { container } = render(() => <ListRow columns={BOTH} name="a.js" preview="x" />);
    expect(container.querySelector('[data-fdt="list-row-size"]')).toBeNull();
    const dash = [...container.querySelectorAll('span[aria-hidden="true"]')].find(
      (s) => s.textContent === '—'
    );
    expect(dash?.className).toContain('@regular:inline');
  });

  it('flags a clipped value with a Clipped badge before the preview', () => {
    const { container } = render(() => (
      <ListRow columns={NONE} name="a" preview="https://x" clipped />
    ));
    expect(container.textContent).toContain('Clipped');
  });

  it('omits the icon on one-line rows', () => {
    const { container } = render(() => (
      <ListRow
        lines="one"
        columns={NONE}
        icon={ImageIcon}
        name="cache-control"
        preview="max-age=0"
      />
    ));
    expect(container.querySelector('[data-fdt="list-row-icon"]')).toBeNull();
  });

  it('inside an interactive list: one open button holding the main block, actions outside, chevron in drill', () => {
    const [drill, setDrill] = createSignal(false);
    const register = vi.fn(() => () => undefined);
    const { container } = render(() => (
      <CalmListContext.Provider value={{ interactive: true, drill }}>
        <ListRowContext.Provider
          value={{ key: 'k', selected: () => true, registerFocus: register }}
        >
          <ListRow
            columns={NONE}
            name="a.js"
            preview="x"
            actions={<button type="button">Copy</button>}
          />
        </ListRowContext.Provider>
      </CalmListContext.Provider>
    ));
    const open = container.querySelector('[data-fdt-row-open]') as HTMLButtonElement;
    expect(open.contains(container.querySelector('[data-fdt="list-row-name"]'))).toBe(true);
    expect(open.textContent).not.toContain('Copy');
    expect(open.getAttribute('aria-current')).toBe('true');
    expect(register).toHaveBeenCalledWith(open);
    expect(container.querySelector('svg.lucide-chevron-right')).toBeNull();
    setDrill(true);
    expect(container.querySelector('svg.lucide-chevron-right')).not.toBeNull();
  });

  it('stays static in a list without details', () => {
    const { container } = render(() => (
      <CalmListContext.Provider value={{ interactive: false, drill: () => true }}>
        <ListRowContext.Provider
          value={{ key: 'k', selected: () => false, registerFocus: () => () => undefined }}
        >
          <ListRow columns={NONE} name="a.js" />
        </ListRowContext.Provider>
      </CalmListContext.Provider>
    ));
    expect(container.querySelector('[data-fdt-row-open]')).toBeNull();
    expect(container.querySelector('svg.lucide-chevron-right')).toBeNull();
  });
});

describe('ListRowHead', () => {
  it('captions the columns on the rows’ grid, reserving the icon, actions and chevron widths', () => {
    const { container } = render(() => (
      <CalmListContext.Provider value={{ interactive: true, drill: () => true }}>
        <ListRowHead columns={BOTH} icon actions name="Script" size="Size" states="WP Rocket" />
      </CalmListContext.Provider>
    ));
    const head = container.querySelector('[data-fdt="list-head"]') as HTMLElement;
    expect(head.className).toContain('uppercase');
    expect(head.className).toContain('text-2xs');
    expect(head.textContent).toBe('ScriptSizeWP Rocket');
    expect(head.querySelector('.w-8')).not.toBeNull();
    expect(head.querySelector('.w-6')).not.toBeNull();
    expect(head.querySelector('.w-3\\.5')).not.toBeNull();
    expect(head.querySelector('div')?.className).toContain(rowGrid('two', BOTH));
  });

  it('shows a one-line preview caption from @regular, and no spacers outside a list', () => {
    const { container } = render(() => (
      <ListRowHead lines="one" columns={NONE} icon name="Header" preview="Value" />
    ));
    const head = container.querySelector('[data-fdt="list-head"]') as HTMLElement;
    expect(head.querySelector('.w-8')).toBeNull();
    expect(head.querySelector('.w-3\\.5')).toBeNull();
    const preview = [...head.querySelectorAll('span')].find((s) => s.textContent === 'Value');
    expect(preview?.className).toContain('@regular:block');
  });
});
