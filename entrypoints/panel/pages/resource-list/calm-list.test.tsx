/**
 * Render suite of the list kit (`CalmFilteredList`) on the page harness:
 * the facet input and the search-only one, the facet bar in both tiers + its
 * sheet, filtered-empty, the master–detail in both layouts (keys, focus,
 * scroll restore, presence), refresh with a selection, the gone / unlisted
 * states, find in a drill and compact stacking. Search wiring, find, refresh
 * reuse and the empty state: `calm-list-search.test.tsx`.
 */
import { cleanup, fireEvent, screen, within } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, mergeProps, Show, untrack } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VirtualItem, VirtualizerFactory } from '../../../../components/ui/virtual-list';
import {
  buildLazyloadRows,
  LAZYLOAD_PAGE_FACETS,
  type LazyloadImageResource
} from '../../../../lib/panel/resources-view-model';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { makeFdtData, makeLazyImage } from '../../state/fixtures';
import { SEARCH_DEBOUNCE_MS } from '../../state/search';
import { useFdtData } from '../../state/use-fdt-data';
import { PageFrame } from '../page-frame';
import { CalmFilteredList, type CalmFilteredListProps } from './calm-list';
import { installFakeResizeObserver, type FakeResizeObservers } from './fake-resize-observer';
import { ListRow, ListRowHead, type ListRowColumns } from './list-row';
import type { ListDetail } from './master-detail';
import { renderPage, renderWindowedRows, type PageHarness } from './page-harness';
import { resourceName } from './resource-list-view';
import { CALM_VISIBLE_STATE_CHIPS, splitStateChips, type StateChip } from './state-chips';

type Row = LazyloadImageResource;

/** The fixture's columns: no size, a states column. */
const COLUMNS: ListRowColumns = { size: false, states: true };

/** The standard images: two lazyloaded, three not (one excluded). */
const IMAGES = [
  makeLazyImage({ src: 'https://cdn.example/up/hero.webp', lazyloadDetected: true }),
  makeLazyImage({ src: 'https://cdn.example/up/logo.png', lazyloadDetected: false }),
  makeLazyImage({
    src: 'https://cdn.example/up/excluded.jpg',
    lazyloadDetected: false,
    excludedReasonsFound: ['data-src', FDT_EXCLUDED_RESOURCE]
  }),
  makeLazyImage({ src: 'https://cdn.example/up/plain.jpg', lazyloadDetected: false }),
  makeLazyImage({ src: 'https://cdn.example/up/gallery.jpg', lazyloadDetected: true })
];

/** A payload with the given images. */
function withImages(images: FdtData['wprDetections']['lazyload']['images']): FdtData {
  const base = makeFdtData();
  return { ...base, wprDetections: { ...base.wprDetections, lazyload: { present: true, images } } };
}

/** A row's chips: Lazyloaded (WP Rocket), Excluded and a third to overflow the calm cap. */
function chipsOf(row: Row): StateChip[] {
  const chips: StateChip[] = [];
  if (row.lazyloaded) chips.push({ id: 'lazyloaded', label: 'Lazyloaded', source: 'wp-rocket' });
  if (row.excludedReasons.length > 0) {
    chips.push({ id: 'excluded', label: 'Excluded', source: 'excluded' });
    chips.push({ id: 'reason', label: 'Reason', source: 'page' });
  }
  return chips;
}

/** The fixture's detail spec. */
const DETAIL: ListDetail<Row> = {
  kind: () => 'Image',
  title: (row) => resourceName(row.src),
  copy: (row) => ({ text: row.src, label: 'Image URL' }),
  body: (row) => <p data-fdt="test-detail-body">{row().src}</p>,
  actions: () => <button type="button">Copy as exclusion</button>,
  backLabel: 'Images'
};

/** Options of the fixture page. */
interface PageOptions {
  readonly input?: 'facets' | 'search';
  readonly detail?: boolean;
}

/** A recording virtualizer: the windowed double plus a `scrollToIndex` spy. */
function recordingVirtualizer(): { factory: VirtualizerFactory; scrolls: number[] } {
  const scrolls: number[] = [];
  return {
    scrolls,
    factory: (options) => ({
      ...renderWindowedRows(options),
      scrollToIndex: (index) => {
        scrolls.push(index);
      }
    })
  };
}

/** The harness data's images as rows (inside a page body). */
function useImageRows(): () => Row[] {
  const store = useFdtData();
  return createMemo((): Row[] => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing'
      ? buildLazyloadRows(state.data.wprDetections.lazyload)
      : [];
  });
}

/**
 * The fixture list's props over the image rows.
 *
 * @param rows The rows.
 * @param props The page's props (the virtualizer double).
 * @param options Filter input and detail.
 * @returns The calm list props.
 */
function calmListProps(
  rows: () => Row[],
  props: { createVirtualizer?: VirtualizerFactory },
  options: PageOptions
): CalmFilteredListProps<Row, string> {
  const base = {
    get rows() {
      return rows();
    },
    rowKey: (row: Row) => row.src,
    sameRow: (a: Row, b: Row) => a.src === b.src && a.lazyloaded === b.lazyloaded,
    empty: <p data-fdt="test-empty">No images</p>,
    noun: { one: 'image', other: 'images' },
    listLabel: 'Images',
    searchLabel: 'Search image URLs',
    searchPlaceholder: 'Search…',
    head: <ListRowHead columns={COLUMNS} name="Image" states="States" actions />,
    renderRow: (row: Row) => (
      <ListRow
        columns={COLUMNS}
        name={resourceName(row.src)}
        preview={row.src}
        chips={splitStateChips(chipsOf(row), CALM_VISIBLE_STATE_CHIPS)}
        actions={<button type="button">Copy</button>}
      />
    ),
    detail: options.detail === false ? undefined : DETAIL,
    searchField: (row: Row) => row.src,
    get createVirtualizer() {
      return props.createVirtualizer;
    }
  };
  // mergeProps keeps the getters live (an object spread would snapshot `rows`).
  const faceted = mergeProps(base, { facets: LAZYLOAD_PAGE_FACETS });
  return options.input === 'search' ? base : faceted;
}

/**
 * The fixture page: the harness data's images in a calm list.
 *
 * @param options Filter input and detail.
 * @returns The page component.
 */
function calmPage(options: PageOptions = {}) {
  return function CalmImages(props: { createVirtualizer?: VirtualizerFactory }): JSX.Element {
    const list = calmListProps(useImageRows(), props, options);
    return (
      <PageFrame id="lazyload" title="Images" fill>
        <CalmFilteredList {...list} />
      </PageFrame>
    );
  };
}

/**
 * A virtualizer double whose window holds `size` rows from a start index
 * that only `scrollToIndex` moves (nearest edge) — so a row below the window
 * mounts only after the list asks to scroll to it, as with the real one.
 */
function slidingVirtualizer(size: number): VirtualizerFactory {
  return (options) => {
    const [start, setStart] = createSignal(0);
    const items = (): VirtualItem[] => {
      const first = start();
      const last = Math.min(options.count, first + size);
      return Array.from({ length: Math.max(0, last - first) }, (_, offset) => {
        const index = first + offset;
        return {
          key: options.getItemKey?.(index) ?? index,
          index,
          start: index * 40,
          end: (index + 1) * 40,
          size: 40,
          lane: 0
        };
      });
    };
    return {
      getVirtualItems: items,
      getTotalSize: () => options.count * 40,
      measureElement: () => undefined,
      scrollToIndex: (index) => {
        const first = untrack(start);
        if (index < first) setStart(index);
        else if (index >= first + size) setStart(index - size + 1);
      }
    };
  };
}

let observers: FakeResizeObservers;

beforeEach(() => {
  vi.useFakeTimers();
  observers = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Render the fixture page at a content width. */
function mount(
  width: number,
  options: PageOptions = {},
  virtualizer: VirtualizerFactory = renderWindowedRows
): PageHarness {
  const harness = renderPage(calmPage(options), withImages(IMAGES), virtualizer);
  observers.resize(width);
  return harness;
}

/** The rendered rows' names, in order. */
function names(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-fdt="list-row-name"]')].map((n) => n.textContent);
}

/** A row surface by name. */
function rowNamed(root: HTMLElement, name: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('[data-fdt="resource-row"]')].find(
    (row) => row.querySelector('[data-fdt="list-row-name"]')?.textContent === name
  );
  if (found === undefined) throw new Error(`no row ${name}`);
  return found;
}

/** A row's open button by name. */
function openOf(root: HTMLElement, name: string): HTMLButtonElement {
  const found = rowNamed(root, name).querySelector<HTMLButtonElement>('[data-fdt-row-open]');
  if (found === null) throw new Error(`no open button on ${name}`);
  return found;
}

/** Let queued focus hand-offs run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** A radio segment of a facet group by value (inline bar). */
function segment(root: HTMLElement, value: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(
    `[data-fdt="facet-bar"] [data-fdt-choice-value="${value}"] input`
  );
  if (input === null) throw new Error(`no segment ${value}`);
  return input;
}

/**
 * A page with two calm lists over the same images (a page with two tabs of
 * rows); the first one can be unmounted while the page stays.
 *
 * @returns The page component and the first list's mount switch.
 */
function twoListPage() {
  const [firstShown, setFirstShown] = createSignal(true);
  function TwoLists(props: { createVirtualizer?: VirtualizerFactory }): JSX.Element {
    const rows = useImageRows();
    const first = calmListProps(rows, props, {});
    const second = calmListProps(rows, props, {});
    return (
      <PageFrame id="lazyload" title="Images" fill>
        <Show when={firstShown()}>
          <div data-fdt-test="first">
            <CalmFilteredList {...first} />
          </div>
        </Show>
        <div data-fdt-test="second">
          <CalmFilteredList {...second} />
        </div>
      </PageFrame>
    );
  }
  return { Page: TwoLists, setFirstShown };
}

describe('calm rows', () => {
  it('lists every row on a calm frame: no hairlines, 4 px virtual gap, the caps head above the scroller', () => {
    const { root } = mount(600);
    expect(names(root)).toEqual([
      'hero.webp',
      'logo.png',
      'excluded.jpg',
      'plain.jpg',
      'gallery.jpg'
    ]);
    const scroller = root.querySelector('[data-fdt="virtual-list"]') as HTMLElement;
    expect(scroller.className).not.toMatch(/border|rounded-md/u);
    // Opaque in the shell's canvas color: it backs its overscan rows' text.
    expect(scroller.className).toContain('bg-surface-0');
    for (const row of root.querySelectorAll<HTMLElement>('[data-fdt="resource-row"]')) {
      expect(row.className).not.toContain('border-t');
      expect(row.className).toContain('min-h-14.5');
      expect(row.className).toContain('hover:bg-surface-3');
    }
    const head = root.querySelector('[data-fdt="list-head"]') as HTMLElement;
    expect(head.className).toContain('uppercase');
    expect(head.nextElementSibling).toBe(scroller);
  });

  it('caps chips at two + "+N" and keeps the row copy button a separate control', () => {
    const { root } = mount(600);
    const excluded = rowNamed(root, 'excluded.jpg');
    expect(excluded.querySelectorAll('[data-fdt="state-chip"]')).toHaveLength(2);
    expect(excluded.querySelector('[data-fdt="state-chip-overflow"]')).toBeNull();
    const open = openOf(root, 'excluded.jpg');
    const copy = within(excluded).getByRole('button', { name: 'Copy' });
    expect(open.contains(copy)).toBe(false);
  });

  it('stacks rows on a compact list (name / preview / chips) and drops the head’s states caption', () => {
    const { root } = mount(400);
    const grid = rowNamed(root, 'hero.webp').querySelector('[data-fdt="list-row-name"]')
      ?.parentElement as HTMLElement;
    expect(grid.className).toContain('[grid-template-areas:"name"_"preview"_"states"]');
    expect(grid.className).toContain(
      '@regular:[grid-template-areas:"name_states"_"preview_states"]'
    );
    const states = [...root.querySelectorAll<HTMLElement>('[data-fdt="list-head"] span')].find(
      (span) => span.textContent === 'States'
    );
    expect(states?.className).toContain('hidden');
    expect(states?.className).toContain('@regular:block');
    expect(root.querySelector('[data-fdt="calm-list"]')?.className).toContain('@container');
  });

  it('renders static rows (no detail): no open button, no chevron, no hover affordance', () => {
    const { root, presence } = mount(600, { detail: false });
    expect(root.querySelector('[data-fdt-row-open]')).toBeNull();
    const row = rowNamed(root, 'hero.webp');
    expect(row.className).not.toContain('hover:bg-surface-3');
    fireEvent.click(row);
    expect(root.querySelector('[data-fdt="drill-detail"]')).toBeNull();
    expect(presence.detailOpen()).toBe(false);
  });

  it('shows the caller’s empty view when there are no rows', () => {
    const harness = renderPage(calmPage(), withImages([]));
    expect(harness.root.querySelector('[data-fdt="test-empty"]')).not.toBeNull();
    expect(harness.root.querySelector('[data-fdt="facet-bar"]')).toBeNull();
  });
});

describe('facets inline (regular list)', () => {
  it('shows each facet with Any + counts and narrows on a pick', () => {
    const { root } = mount(600);
    const bar = root.querySelector('[data-fdt="facet-bar"]') as HTMLElement;
    expect(bar.dataset.fdtCompact).toBeUndefined();
    const counts = [...bar.querySelectorAll('[data-fdt-choice-count]')].map((n) => n.textContent);
    expect(counts).toEqual(['5', '2', '3']);
    fireEvent.click(segment(root, 'lazyloaded'));
    expect(names(root)).toEqual(['hero.webp', 'gallery.jpg']);
  });

  it('combines a choice with a toggle, counts following the other facets', () => {
    const { root } = mount(600);
    fireEvent.click(segment(root, 'non-lazyloaded'));
    const toggle = root.querySelector<HTMLButtonElement>('[data-fdt-toggle-chip="excluded"]');
    expect(toggle?.textContent).toContain('1');
    if (toggle === null) throw new Error('no toggle');
    fireEvent.click(toggle);
    expect(names(root)).toEqual(['excluded.jpg']);
    // Lazyloaded under Excluded keeps nothing: disabled, but Any stays available.
    const lazy = root.querySelector(
      '[data-fdt-choice-value="lazyloaded"] input'
    ) as HTMLInputElement;
    expect(lazy.disabled).toBe(true);
  });

  it('narrows the counts with the search (standard faceting)', () => {
    const { root } = mount(600);
    fireEvent.input(screen.getByRole('searchbox', { name: 'Search image URLs' }), {
      target: { value: 'jpg' }
    });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    const counts = [...root.querySelectorAll('[data-fdt="facet-bar"] [data-fdt-choice-count]')].map(
      (n) => n.textContent
    );
    expect(counts).toEqual(['3', '1', '2']);
  });

  it('names the facets in filtered-empty and Clear filters clears facets and search', () => {
    const { root } = mount(600);
    // Pick first: under the query the value would count 0 and be disabled.
    fireEvent.click(segment(root, 'non-lazyloaded'));
    fireEvent.input(screen.getByRole('searchbox', { name: 'Search image URLs' }), {
      target: { value: 'hero' }
    });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(screen.getByText('Nothing in "Non-lazyloaded" matches "hero".')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    clear.focus();
    fireEvent.click(clear);
    expect(names(root)).toHaveLength(5);
    expect(
      screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search image URLs' }).value
    ).toBe('');
    expect(document.activeElement).toBe(
      screen.getByRole('searchbox', { name: 'Search image URLs' })
    );
  });
});

describe('facets compact (Filters button + sheet)', () => {
  it('folds the facets into a Filters button with the active count and removable chips', () => {
    const { root } = mount(400);
    const bar = root.querySelector('[data-fdt="facet-bar"]') as HTMLElement;
    expect(bar.dataset.fdtCompact).toBe('');
    expect(bar.querySelector('[data-fdt="choice-group"]')).toBeNull();
    const button = screen.getByRole('button', { name: /Filters/u });
    expect(button.querySelector('[data-fdt="facet-filters-count"]')).toBeNull();
    fireEvent.click(button);
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    // The sheet's segments stretch across it.
    expect(sheet.querySelector('[data-fdt="choice-group"]')?.className).toContain('w-full');
    const lazy = sheet.querySelector(
      '[data-fdt-choice-value="lazyloaded"] input'
    ) as HTMLInputElement;
    fireEvent.click(lazy);
    expect(names(root)).toEqual(['hero.webp', 'gallery.jpg']);
    expect(within(sheet).getByRole('button', { name: 'Show 2 images' })).toBeTruthy();
    expect(button.querySelector('[data-fdt="facet-filters-count"]')?.textContent).toBe('1');
    const chip = screen.getByRole('button', { name: 'Remove filter Lazyloaded' });
    fireEvent.click(chip);
    expect(names(root)).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Remove filter Lazyloaded' })).toBeNull();
  });

  it('Reset clears the picks; Show N closes the sheet', () => {
    const { root } = mount(400);
    fireEvent.click(screen.getByRole('button', { name: /Filters/u }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });
    fireEvent.click(sheet.querySelector('[data-fdt-toggle-chip="excluded"]') as HTMLElement);
    expect(names(root)).toEqual(['excluded.jpg']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' }));
    expect(names(root)).toHaveLength(5);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Show 5 images' }));
    expect(sheet.querySelector('[data-fdt="sheet"]')?.getAttribute('data-state')).toBe('closing');
  });

  it('hands focus left in the sheet to the search field once growing out of compact unmounts Filters', async () => {
    mount(400);
    fireEvent.click(screen.getByRole('button', { name: /Filters/u }));
    within(screen.getByRole('dialog', { name: 'Filters' }))
      .getByRole('button', { name: 'Reset' })
      .focus();
    observers.resize(600);
    await vi.runAllTimersAsync();
    expect(document.querySelector('[data-fdt="sheet"]')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('searchbox', { name: 'Search image URLs' })
    );
  });

  it('closes the sheet and shows the facets inline once the list grows out of compact', () => {
    const { root } = mount(400);
    fireEvent.click(screen.getByRole('button', { name: /Filters/u }));
    expect(document.querySelector('[data-fdt="sheet"]')?.getAttribute('data-state')).toBe('open');
    observers.resize(600);
    expect(document.querySelector('[data-fdt="sheet"]')?.getAttribute('data-state')).toBe(
      'closing'
    );
    expect(root.querySelector('[data-fdt="facet-bar"] [data-fdt="choice-group"]')).not.toBeNull();
  });

  it('keeps the search field’s element across a tier change', () => {
    mount(400);
    const before = screen.getByRole('searchbox', { name: 'Search image URLs' });
    observers.resize(600);
    expect(screen.getByRole('searchbox', { name: 'Search image URLs' })).toBe(before);
  });
});

describe('search-only input (no facets)', () => {
  it('shows the search field alone and narrows by the query, Clear search the way back', () => {
    const { root } = mount(600, { input: 'search' });
    expect(root.querySelector('[data-fdt="facet-bar"]')).toBeNull();
    expect(root.querySelector('[role="group"]')).toBeNull();
    expect(root.querySelector('[data-fdt="facet-filters-button"]')).toBeNull();
    const field = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search image URLs' });
    expect(field.closest('[data-fdt="search-field"]')).not.toBeNull();
    fireEvent.input(field, { target: { value: 'hero' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(names(root)).toEqual(['hero.webp']);
    fireEvent.input(field, { target: { value: 'zzz' } });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(screen.getByText('Nothing matches "zzz".')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    const clear = screen.getByRole('button', { name: 'Clear search' });
    clear.focus();
    fireEvent.click(clear);
    expect(names(root)).toHaveLength(5);
    expect(document.activeElement).toBe(field);
  });

  it('keeps the field alone on a compact list: no Filters button', () => {
    const { root } = mount(400, { input: 'search' });
    expect(root.querySelector('[data-fdt="facet-filters-button"]')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search image URLs' })).toBeTruthy();
    expect(names(root)).toHaveLength(5);
  });
});

describe('side pane (content ≥ the split width)', () => {
  it('opens on a row press: kind, title, copy, close, body, actions; the row is selected; presence on', () => {
    const { root, presence } = mount(1000);
    expect(root.querySelector('[data-fdt="calm-list"]')?.getAttribute('data-fdt-layout')).toBe(
      'pane'
    );
    fireEvent.click(openOf(root, 'logo.png'));
    const pane = root.querySelector('[data-fdt="detail-pane"]') as HTMLElement;
    expect(pane.querySelector('[data-fdt="detail-kind"]')?.textContent).toBe('Image');
    expect(pane.querySelector('h2')?.textContent).toBe('logo.png');
    expect(pane.querySelector('[data-fdt="test-detail-body"]')?.textContent).toBe(
      'https://cdn.example/up/logo.png'
    );
    expect(within(pane).getByRole('button', { name: 'Copy as exclusion' })).toBeTruthy();
    expect(pane.className).toContain('w-87.5');
    expect(pane.className).toContain('starting:translate-x-2');
    const row = rowNamed(root, 'logo.png');
    expect(row.className).toContain('bg-accent-soft');
    expect(row.dataset.selected).toBe('');
    expect(presence.detailOpen()).toBe(true);
    // No chevrons beside a pane.
    expect(row.querySelector('svg.lucide-chevron-right')).toBeNull();
  });

  it('opens from a press on the row surface, never from a nested control', () => {
    const { root } = mount(1000);
    const row = rowNamed(root, 'plain.jpg');
    fireEvent.click(within(row).getByRole('button', { name: 'Copy' }));
    expect(root.querySelector('[data-fdt="detail-pane"]')).toBeNull();
    fireEvent.click(row);
    expect(root.querySelector('[data-fdt="detail-pane"] h2')?.textContent).toBe('plain.jpg');
    expect(document.activeElement).toBe(openOf(root, 'plain.jpg'));
  });

  it('closes by its button, handing focus back to the row; presence off', async () => {
    const { root, presence } = mount(1000);
    fireEvent.click(openOf(root, 'logo.png'));
    const close = screen.getByRole('button', { name: 'Close details' });
    close.focus();
    fireEvent.click(close);
    expect(root.querySelector('[data-fdt="detail-pane"]')).toBeNull();
    expect(presence.detailOpen()).toBe(false);
    await settle();
    expect(document.activeElement).toBe(openOf(root, 'logo.png'));
  });

  it('↑/↓ on a focused row select and focus the neighbor (scrolled in); Esc closes; ends stay', () => {
    const recording = recordingVirtualizer();
    const { root } = mount(1000, {}, recording.factory);
    const first = openOf(root, 'hero.webp');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(root.querySelector('[data-fdt="detail-pane"] h2')?.textContent).toBe('logo.png');
    expect(document.activeElement).toBe(openOf(root, 'logo.png'));
    expect(recording.scrolls.at(-1)).toBe(1);
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(root.querySelector('[data-fdt="detail-pane"] h2')?.textContent).toBe('hero.webp');
    // At the top end nothing moves.
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(root.querySelector('[data-fdt="detail-pane"] h2')?.textContent).toBe('hero.webp');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(root.querySelector('[data-fdt="detail-pane"]')).toBeNull();
    expect(document.activeElement).toBe(openOf(root, 'hero.webp'));
  });

  it('moves to a row outside the virtual window: scrolls it in, then focuses it once mounted', () => {
    const { root } = mount(1000, {}, slidingVirtualizer(2));
    expect(names(root)).toEqual(['hero.webp', 'logo.png']);
    const second = openOf(root, 'logo.png');
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(names(root)).toEqual(['logo.png', 'excluded.jpg']);
    expect(document.activeElement).toBe(openOf(root, 'excluded.jpg'));
    expect(root.querySelector('[data-fdt="detail-pane"] h2')?.textContent).toBe('excluded.jpg');
  });

  it('Esc on a row with no pane open is not taken', () => {
    const { root } = mount(1000);
    const row = openOf(root, 'logo.png');
    row.focus();
    expect(fireEvent.keyDown(row, { key: 'Escape' })).toBe(true);
    expect(root.querySelector('[data-fdt="detail-pane"]')).toBeNull();
  });

  it('Esc inside the pane closes it; keys typed in the search field are never taken', async () => {
    const { root } = mount(1000);
    fireEvent.click(openOf(root, 'logo.png'));
    const field = screen.getByRole('searchbox', { name: 'Search image URLs' });
    field.focus();
    const down = fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(down).toBe(true);
    expect(root.querySelector('[data-fdt="detail-pane"] h2')?.textContent).toBe('logo.png');
    const copy = within(root.querySelector('[data-fdt="detail-pane"]') as HTMLElement).getByRole(
      'button',
      { name: 'Copy as exclusion' }
    );
    copy.focus();
    fireEvent.keyDown(copy, { key: 'Escape' });
    expect(root.querySelector('[data-fdt="detail-pane"]')).toBeNull();
    await settle();
    expect(document.activeElement).toBe(openOf(root, 'logo.png'));
  });

  it('a filter hiding the selected row clears the pane', () => {
    const { root, presence } = mount(1000);
    fireEvent.click(openOf(root, 'logo.png'));
    fireEvent.click(segment(root, 'lazyloaded'));
    expect(root.querySelector('[data-fdt="detail-pane"]')).toBeNull();
    expect(presence.detailOpen()).toBe(false);
  });
});

describe('refresh with a selection', () => {
  it('keeps the selection and the detail across a refresh (same key)', () => {
    const harness = mount(1000);
    fireEvent.click(openOf(harness.root, 'logo.png'));
    const body = harness.root.querySelector('[data-fdt="test-detail-body"]');
    harness.refresh(withImages([makeLazyImage({ src: 'https://cdn.example/new.png' }), ...IMAGES]));
    expect(harness.root.querySelector('[data-fdt="detail-pane"] h2')?.textContent).toBe('logo.png');
    // Unchanged row → the same body element (state survives).
    expect(harness.root.querySelector('[data-fdt="test-detail-body"]')).toBe(body);
    expect(rowNamed(harness.root, 'logo.png').dataset.selected).toBe('');
  });

  it('shows "no longer on the page" by name when a refresh drops the row, and recovers', () => {
    const harness = mount(1000);
    fireEvent.click(openOf(harness.root, 'logo.png'));
    harness.refresh(withImages(IMAGES.filter((image) => !image.src.endsWith('logo.png'))));
    const pane = harness.root.querySelector('[data-fdt="detail-pane"]') as HTMLElement;
    expect(pane.querySelector('h2')?.textContent).toBe('logo.png');
    expect(pane.querySelector('[data-fdt="detail-gone"]')?.textContent).toContain(
      'No longer on the page'
    );
    expect(pane.querySelector('[data-fdt="detail-actions"]')).toBeNull();
    expect(harness.presence.detailOpen()).toBe(true);
    harness.refresh(withImages(IMAGES));
    expect(pane.querySelector('[data-fdt="detail-gone"]')).toBeNull();
    expect(pane.querySelector('[data-fdt="test-detail-body"]')).not.toBeNull();
  });
});

describe('drill-in (content < the split width)', () => {
  it('replaces the list: Back focused, n of m, steps, actions; the list stays laid out but inert', () => {
    const { root, presence } = mount(600);
    expect(rowNamed(root, 'hero.webp').querySelector('svg')).not.toBeNull();
    fireEvent.click(openOf(root, 'logo.png'));
    const drill = root.querySelector('[data-fdt="drill-detail"]') as HTMLElement;
    expect(drill.hasAttribute('data-fdt-view-enter')).toBe(true);
    const view = root.querySelector('[data-fdt="calm-list-view"]') as HTMLElement;
    // Covered by the opaque drill, never `visibility`-hidden (a reduced-motion
    // transition would keep the row unfocusable when Back restores focus).
    expect(drill.className).toContain('bg-surface-0');
    expect(view.className).not.toContain('invisible');
    expect(view.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(within(drill).getByRole('button', { name: 'Images' }));
    expect(drill.querySelector('[data-fdt="drill-position"]')?.textContent).toBe('2 of 5');
    // A long Back label elides (whole in its title); "n of m" never gives.
    const back = drill.querySelector<HTMLElement>('[data-fdt="drill-back"]');
    expect(back?.title).toBe('Images');
    expect(back?.className).toContain('min-w-0');
    expect(back?.querySelector('span.truncate')?.textContent).toBe('Images');
    expect(drill.querySelector('[data-fdt="drill-position"]')?.className).toContain('shrink-0');
    expect(presence.detailOpen()).toBe(true);
    fireEvent.click(within(drill).getByRole('button', { name: 'Next image' }));
    expect(drill.querySelector('h2')?.textContent).toBe('excluded.jpg');
    expect(drill.querySelector('[data-fdt="drill-position"]')?.textContent).toBe('3 of 5');
    expect(within(drill).getByRole('button', { name: 'Copy as exclusion' })).toBeTruthy();
  });

  it('holds the arrows at the ends (aria-disabled, focus kept)', () => {
    const { root } = mount(600);
    fireEvent.click(openOf(root, 'hero.webp'));
    const drill = root.querySelector('[data-fdt="drill-detail"]') as HTMLElement;
    const previous = within(drill).getByRole('button', { name: 'Previous image' });
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(previous);
    expect(drill.querySelector('h2')?.textContent).toBe('hero.webp');
    expect(
      within(drill).getByRole('button', { name: 'Next image' }).getAttribute('aria-disabled')
    ).toBeNull();
  });

  it('Back (and Esc) restores the list: row selected, scrolled in, focused, view keyframe', async () => {
    const recording = recordingVirtualizer();
    const { root, presence } = mount(600, {}, recording.factory);
    fireEvent.click(openOf(root, 'plain.jpg'));
    const drill = root.querySelector('[data-fdt="drill-detail"]') as HTMLElement;
    fireEvent.keyDown(within(drill).getByRole('button', { name: 'Images' }), { key: 'Escape' });
    expect(root.querySelector('[data-fdt="drill-detail"]')).toBeNull();
    const view = root.querySelector('[data-fdt="calm-list-view"]') as HTMLElement;
    expect(view.className).not.toContain('invisible');
    expect(view.hasAttribute('inert')).toBe(false);
    expect(view.hasAttribute('data-fdt-view-enter')).toBe(true);
    expect(recording.scrolls.at(-1)).toBe(3);
    expect(rowNamed(root, 'plain.jpg').dataset.selected).toBe('');
    expect(presence.detailOpen()).toBe(false);
    await settle();
    expect(document.activeElement).toBe(openOf(root, 'plain.jpg'));
  });

  it('Esc on a drill-list row holding the selection leaves it (and the key) alone', async () => {
    const { root } = mount(600);
    fireEvent.click(openOf(root, 'plain.jpg'));
    fireEvent.click(screen.getByRole('button', { name: 'Images' }));
    await settle();
    const row = openOf(root, 'plain.jpg');
    expect(document.activeElement).toBe(row);
    // Not taken: the key stays the host's (fireEvent returns false when prevented).
    expect(fireEvent.keyDown(row, { key: 'Escape' })).toBe(true);
    expect(rowNamed(root, 'plain.jpg').dataset.selected).toBe('');
  });

  it('↑/↓ in the drill list move focus only', () => {
    const { root } = mount(600);
    const first = openOf(root, 'hero.webp');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(openOf(root, 'logo.png'));
    expect(root.querySelector('[data-fdt="drill-detail"]')).toBeNull();
    expect(root.querySelector('[data-selected]')).toBeNull();
  });

  it('marks a row the search hides as "no longer listed", with Clear filters back', () => {
    const harness = mount(600);
    fireEvent.click(openOf(harness.root, 'logo.png'));
    // A query with no match: no find scroll event, the rows narrow under the detail.
    harness.search.perform('nothing-matches');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    const drill = harness.root.querySelector('[data-fdt="drill-detail"]') as HTMLElement;
    expect(drill.querySelector('[data-fdt="detail-unlisted"]')?.textContent).toContain(
      'No longer listed'
    );
    expect(drill.querySelector('[data-fdt="drill-position"]')).toBeNull();
    fireEvent.click(within(drill).getByRole('button', { name: 'Clear filters' }));
    expect(drill.querySelector('[data-fdt="detail-unlisted"]')).toBeNull();
    expect(drill.querySelector('[data-fdt="drill-position"]')?.textContent).toBe('2 of 5');
  });

  it('a find event returns to the list first; the find’s scroll wins', () => {
    const recording = recordingVirtualizer();
    const harness = mount(600, {}, recording.factory);
    fireEvent.click(openOf(harness.root, 'hero.webp'));
    harness.search.perform('gallery');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(harness.root.querySelector('[data-fdt="drill-detail"]')).toBeNull();
    expect(names(harness.root)).toEqual(['gallery.jpg']);
    expect(recording.scrolls.at(-1)).toBe(0);
    expect(rowNamed(harness.root, 'gallery.jpg').getAttribute('aria-current')).toBe('true');
  });

  it('puts the actions in a bottom bar on a compact list (grid areas)', () => {
    const { root } = mount(400);
    fireEvent.click(openOf(root, 'logo.png'));
    const drill = root.querySelector('[data-fdt="drill-detail"]') as HTMLElement;
    expect(drill.className).toContain("[grid-template-areas:'bar'_'body'_'actions']");
    expect(drill.className).toContain("@regular:[grid-template-areas:'bar_actions'_'body_body']");
    expect(drill.querySelector('[data-fdt="detail-actions"]')?.className).toContain(
      '[grid-area:actions]'
    );
  });
});

describe('layout flips keep the selection', () => {
  it('pane → drill keeps the row selected in the list; widening restores the pane', () => {
    const { root } = mount(1000);
    fireEvent.click(openOf(root, 'logo.png'));
    observers.resize(600);
    expect(root.querySelector('[data-fdt="detail-pane"]')).toBeNull();
    expect(root.querySelector('[data-fdt="drill-detail"]')).toBeNull();
    expect(rowNamed(root, 'logo.png').dataset.selected).toBe('');
    observers.resize(1000);
    expect(root.querySelector('[data-fdt="detail-pane"] h2')?.textContent).toBe('logo.png');
  });

  it('drill detail → pane on widening', () => {
    const { root } = mount(600);
    fireEvent.click(openOf(root, 'logo.png'));
    observers.resize(1000);
    expect(root.querySelector('[data-fdt="drill-detail"]')).toBeNull();
    expect(root.querySelector('[data-fdt="detail-pane"] h2')?.textContent).toBe('logo.png');
  });

  it('drill detail → pane moves the focus Back held to the selected row, scrolled in', async () => {
    const recording = recordingVirtualizer();
    const { root } = mount(600, {}, recording.factory);
    fireEvent.click(openOf(root, 'plain.jpg'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Images' }));
    observers.resize(1000);
    await settle();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(openOf(root, 'plain.jpg'));
    expect(recording.scrolls.at(-1)).toBe(3);
  });

  it('drill detail → pane of a row gone from the page focuses the pane’s close button', async () => {
    const harness = mount(600);
    fireEvent.click(openOf(harness.root, 'logo.png'));
    harness.refresh(withImages(IMAGES.filter((image) => !image.src.endsWith('logo.png'))));
    expect(
      harness.root.querySelector('[data-fdt="drill-detail"] [data-fdt="detail-gone"]')
    ).not.toBeNull();
    observers.resize(1000);
    await settle();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close details' }));
  });

  it('drill detail → pane leaves focus the user already moved elsewhere', async () => {
    const { root } = mount(600);
    fireEvent.click(openOf(root, 'logo.png'));
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    observers.resize(1000);
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe('presence lifecycle', () => {
  it('writes false when a refresh empties the list with a detail open', () => {
    const harness = mount(1000);
    fireEvent.click(openOf(harness.root, 'logo.png'));
    expect(harness.presence.detailOpen()).toBe(true);
    harness.refresh(withImages([]));
    expect(harness.presence.detailOpen()).toBe(false);
  });

  it('releases its claim when the list unmounts with a detail open', () => {
    const { Page, setFirstShown } = twoListPage();
    const harness = renderPage(Page, withImages(IMAGES));
    observers.resize(1000);
    const first = harness.root.querySelector('[data-fdt-test="first"]') as HTMLElement;
    fireEvent.click(openOf(first, 'logo.png'));
    expect(harness.presence.detailOpen()).toBe(true);
    setFirstShown(false);
    expect(harness.root.querySelector('[data-fdt-test="first"]')).toBeNull();
    expect(harness.presence.detailOpen()).toBe(false);
  });

  it('two lists on one page: open while either shows a detail; an unmount takes only its own', () => {
    const { Page, setFirstShown } = twoListPage();
    const harness = renderPage(Page, withImages(IMAGES));
    observers.resize(1000);
    const first = harness.root.querySelector('[data-fdt-test="first"]') as HTMLElement;
    const second = harness.root.querySelector('[data-fdt-test="second"]') as HTMLElement;
    const closeIn = (list: HTMLElement): void => {
      fireEvent.click(within(list).getByRole('button', { name: 'Close details' }));
    };
    fireEvent.click(openOf(first, 'logo.png'));
    fireEvent.click(openOf(second, 'hero.webp'));
    closeIn(first);
    expect(harness.presence.detailOpen()).toBe(true);
    closeIn(second);
    expect(harness.presence.detailOpen()).toBe(false);
    fireEvent.click(openOf(second, 'plain.jpg'));
    fireEvent.click(openOf(first, 'logo.png'));
    // A step inside one list keeps the answer (nothing flickers to false).
    fireEvent.click(openOf(first, 'excluded.jpg'));
    expect(harness.presence.detailOpen()).toBe(true);
    setFirstShown(false);
    expect(harness.presence.detailOpen()).toBe(true);
    closeIn(second);
    expect(harness.presence.detailOpen()).toBe(false);
  });
});
