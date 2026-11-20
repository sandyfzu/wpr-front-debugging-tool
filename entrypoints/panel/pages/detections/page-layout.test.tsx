/**
 * The Detections layout modes: the control (Grouped / List / Cards, icons,
 * Grouped checked), Grouped's sections (HUD order, headers, page facts left
 * to the tiles), List's bounded full set in view-model order, Cards' grid,
 * and a switch that keeps the filter, the overview and the report — List ↔
 * Cards only swaps classes (row nodes and focus stay); below the regular
 * tier the page renders Grouped and keeps the choice for a wider panel.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { placementOf } from '../../../../lib/panel/detections-groups';
import { summarizeFdtData } from '../../../../lib/panel/detections-summary';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import type { DataState } from '../../state/fdt-state-machine';
import { makeFdtData } from '../../state/fixtures';
import {
  createDetectionsLayout,
  DetectionsLayoutContext,
  type DetectionsLayoutStore
} from '../../state/detections-layout';
import { createSearchStore } from '../../state/search';
import { FdtDataContext, SearchContext, type FdtDataStore } from '../../state/use-fdt-data';
import {
  CARDS_BODY,
  DETECTIONS_CONTROLS,
  DETECTIONS_LIST_COLUMN,
  flatBodyClass,
  GROUPED_BODY
} from './entry-layout';
import { installFakeResizeObserver } from '../resource-list/fake-resize-observer';
import { DetectionsPage, DetectionsView, LAYOUT_CONTROL_LABEL } from './page';

afterEach(() => {
  cleanup();
});

/** A payload with a link row (delay_js), a cached plugin and a captured server. */
function data(overrides?: Partial<FdtData>): FdtData {
  const base = makeFdtData();
  return makeFdtData({
    pageHeaders: [{ name: 'Server', value: 'nginx' }],
    wprDetections: {
      ...base.wprDetections,
      wpr: { present: true, cacheMarkerFound: true, cached: true, version: '3.20.1', timeStamp: 1 },
      delay_js: { present: true, scripts: [], version: '2.0', delayedScripts: 0 }
    },
    ...overrides
  });
}

/** One element by selector, or a failure naming it. */
function el(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
}

/** One entry root by id. */
const card = (id: string): HTMLElement => el(`[data-fdt-card-id="${id}"]`);

/** The rendered entry ids, in DOM order. */
function cardIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="status-card"]')].map(
    (node) => node.dataset.fdtCardId ?? ''
  );
}

/** Pick a status filter segment. */
function pickFilter(id: string): void {
  fireEvent.click(el(`[data-fdt="detections-filter"] [data-fdt-choice-value="${id}"] label`));
}

/** The status filter's checked value. */
function checkedFilter(): string | undefined {
  return el('[data-fdt="detections-filter"]').querySelector<HTMLInputElement>('input:checked')
    ?.value;
}

/** The layout group. */
const layoutGroup = (): HTMLElement =>
  screen.getByRole('radiogroup', { name: LAYOUT_CONTROL_LABEL });

/** The layout group's checked radio value. */
function checkedLayout(): string | undefined {
  return layoutGroup().querySelector<HTMLInputElement>('input:checked')?.value;
}

/** The view model's row ids for a payload, in its order. */
const modelIds = (payload: FdtData): string[] =>
  summarizeFdtData(payload).items.map((item) => item.id);

describe('DetectionsView layout control', () => {
  it('offers Grouped / List / Cards with icons, Grouped checked, hidden below regular', () => {
    render(() => <DetectionsView data={data()} now={0} />);
    const group = layoutGroup();
    // The filter first, the layout choice last (right-aligned by the row).
    expect(el('[data-fdt="detections-controls"]').lastElementChild).toBe(group);
    expect(group.className).toContain('@max-regular:hidden');
    expect(
      [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((i) => i.value)
    ).toEqual(['grouped', 'list', 'cards']);
    expect(group.querySelectorAll('[data-fdt-choice-icon]')).toHaveLength(3);
    expect(screen.getByText('Grouped').tagName).toBe('LABEL');
    expect(checkedLayout()).toBe('grouped');
  });
});

describe('DetectionsView Grouped', () => {
  it('renders the groups in HUD order, each row once, tile facts left to the tiles', () => {
    const payload = data();
    render(() => <DetectionsView data={payload} now={0} />);
    const body = el('[data-fdt="detections-grid"]');
    expect(body.dataset.fdtLayout).toBe('grouped');
    expect(body.className).toBe(GROUPED_BODY);
    const groups = [...body.querySelectorAll<HTMLElement>('[data-fdt="detections-group"]')];
    expect(groups.map((group) => group.dataset.fdtGroup)).toEqual([
      'file-optimization',
      'media',
      'preload',
      'cdn',
      'features'
    ]);
    expect(groups.map((group) => group.querySelector('h2')?.textContent)).toEqual([
      'JavaScript & CSS',
      'Image & Media',
      'Preload',
      'Content Delivery',
      'Features'
    ]);
    // Each section is named by its heading.
    for (const group of groups)
      expect(group.getAttribute('aria-labelledby')).toBe(group.querySelector('h2')?.id);
    const expected = modelIds(payload).filter((id) => placementOf(id as never) !== 'tile');
    expect([...cardIds()].sort()).toEqual([...expected].sort());
    for (const id of ['wpr', 'cached', 'server']) expect(cardIds()).not.toContain(id);
  });

  it('heads each optimization group with its count and the source every row shares', () => {
    const base = data();
    const sourced = data({
      wprDetections: {
        ...base.wprDetections,
        delay_js: { ...base.wprDetections.delay_js, source: 'meta' },
        defer_all_js: { ...base.wprDetections.defer_all_js, present: false, source: 'meta' },
        minify_css: { ...base.wprDetections.minify_css, present: false, source: 'meta' },
        minify_js: { ...base.wprDetections.minify_js, present: true, source: 'meta' },
        minify_concatenate_js: {
          ...base.wprDetections.minify_concatenate_js,
          present: true,
          source: 'footprint'
        },
        preload_links: { ...base.wprDetections.preload_links, present: true, source: 'meta' },
        dns_prefetch: { ...base.wprDetections.dns_prefetch, present: true, source: 'meta' }
      }
    });
    render(() => <DetectionsView data={sourced} now={0} />);
    const files = el('[data-fdt-group="file-optimization"]');
    expect(files.querySelector('[data-fdt-group-summary]')?.textContent).toBe(
      '3 of 6 optimizations active'
    );
    // Mixed sources: no header chip, each row with a source shows its own.
    expect(files.dataset.fdtGroupNorm).toBeUndefined();
    expect(files.querySelector('[data-fdt-group-source]')).toBeNull();
    expect(card('minify_concatenate_js').querySelector('[data-fdt-card-source]')).not.toBeNull();
    expect(card('minify_js').querySelector('[data-fdt-card-source]')).not.toBeNull();
    // Every row Meta: the header says it once, no row repeats it.
    const preload = el('[data-fdt-group="preload"]');
    expect(preload.dataset.fdtGroupNorm).toBe('meta');
    expect(preload.querySelector('[data-fdt-group-source]')?.textContent).toContain('Meta');
    expect(preload.querySelectorAll('[data-fdt-card-source]')).toHaveLength(0);
    // Every row's source is stated exactly once, and a header chip is true of every row.
    for (const group of document.querySelectorAll<HTMLElement>('[data-fdt="detections-group"]')) {
      const norm = group.dataset.fdtGroupNorm;
      expect(group.querySelector('[data-fdt-group-source]') !== null).toBe(norm !== undefined);
      for (const row of group.querySelectorAll<HTMLElement>('[data-fdt="status-card"]')) {
        const kind = row.dataset.fdtCardSourceKind;
        const own = row.querySelector('[data-fdt-card-source]') !== null;
        expect(own, row.dataset.fdtCardId).toBe(kind !== undefined && kind !== norm);
        if (norm !== undefined) expect(kind, row.dataset.fdtCardId).toBe(norm);
      }
    }
    // Features counts its optimizations (the beacon and Mobile cache sit there uncounted).
    expect(
      el('[data-fdt-group="features"]').querySelector('[data-fdt-group-summary]')
    ).not.toBeNull();
  });

  it('narrows rows under a filter, keeps the counts and keeps page-context rows', () => {
    render(() => <DetectionsView data={data()} now={0} />);
    const before = el('[data-fdt-group="file-optimization"] [data-fdt-group-summary]').textContent;
    pickFilter('active');
    expect(cardIds()).toContain('delay_js');
    expect(cardIds()).not.toContain('minify_css');
    // The beacon (no optimization) stays under every filter.
    pickFilter('off');
    expect(cardIds()).toContain('priority_elements_beacon');
    expect(cardIds()).not.toContain('delay_js');
    pickFilter('active');
    expect(el('[data-fdt-group="file-optimization"] [data-fdt-group-summary]').textContent).toBe(
      before
    );
  });
});

describe('DetectionsView List and Cards', () => {
  it('switches to List: every row (page facts included) in model order, bounded', () => {
    const payload = data();
    render(() => <DetectionsView data={payload} now={0} />);
    fireEvent.click(screen.getByText('List'));
    expect(checkedLayout()).toBe('list');
    const grid = el('[data-fdt="detections-grid"]');
    expect(grid.dataset.fdtLayout).toBe('list');
    expect(grid.tagName).toBe('UL');
    expect(grid.className).toBe(flatBodyClass('list'));
    expect(cardIds()).toEqual(modelIds(payload));
    expect(el('[data-fdt="detections-controls"]').className).toBe(
      `${DETECTIONS_CONTROLS} ${DETECTIONS_LIST_COLUMN}`
    );
    // The overview keeps the page canvas.
    expect(el('[data-fdt="detections-summary"]').className).not.toContain('max-w-4xl');
    // A row is no control: its page link is.
    expect(card('delay_js').tagName).toBe('DIV');
    expect(card('delay_js').querySelector('a[data-fdt-card-link]')?.getAttribute('href')).toBe(
      '#/javascript'
    );
  });

  it('switches to Cards: the width-driven grid, entries with card chrome from regular', () => {
    const payload = data();
    render(() => <DetectionsView data={payload} now={0} />);
    fireEvent.click(screen.getByText('Cards'));
    const grid = el('[data-fdt="detections-grid"]');
    expect(grid.dataset.fdtLayout).toBe('cards');
    expect(grid.className).toBe(CARDS_BODY);
    expect(cardIds()).toEqual(modelIds(payload));
    expect(card('wpr').className).toContain('@regular:border');
    expect(el('[data-fdt="detections-controls"]').className).toBe(DETECTIONS_CONTROLS);
  });

  it('keeps row nodes and focus between List and Cards (classes only)', () => {
    const store = createDetectionsLayout();
    store.setLayout('list');
    render(() => <DetectionsView data={data()} now={0} layoutStore={store} />);
    const ids = cardIds();
    const nodes = ids.map(card);
    const link = el('[data-fdt-card-id="delay_js"] a[data-fdt-card-link]');
    link.focus();
    for (const layout of ['cards', 'list', 'cards'] as const) {
      store.setLayout(layout);
      expect(el('[data-fdt="detections-grid"]').dataset.fdtLayout).toBe(layout);
      expect(cardIds()).toEqual(ids);
      expect(ids.map(card)).toEqual(nodes);
      expect(document.activeElement).toBe(link);
    }
  });

  it('keeps the filter, the overview and the row set (less tiles) across every switch', () => {
    const payload = data();
    const store = createDetectionsLayout();
    render(() => <DetectionsView data={payload} now={0} layoutStore={store} />);
    pickFilter('active');
    const flat = (): string[] => cardIds().filter((id) => placementOf(id as never) !== 'tile');
    const grouped = [...cardIds()].sort();
    const strip = el('[data-fdt="detections-summary"]').outerHTML;
    for (const layout of ['list', 'cards', 'grouped', 'list'] as const) {
      store.setLayout(layout);
      expect(el('[data-fdt="detections-grid"]').dataset.fdtLayout).toBe(layout);
      expect(checkedFilter()).toBe('active');
      expect([...flat()].sort()).toEqual(grouped);
      expect(el('[data-fdt="detections-summary"]').outerHTML).toBe(strip);
    }
  });

  it('bounds the filtered-empty line in List and leaves it bare elsewhere', () => {
    const [payload, setPayload] = createSignal(data());
    const store = createDetectionsLayout();
    render(() => <DetectionsView data={payload()} now={0} layoutStore={store} />);
    pickFilter('active');
    const base = makeFdtData();
    setPayload(makeFdtData({ wprDetections: { ...base.wprDetections } }));
    const empty = el('[data-fdt="detections-filtered-empty"]');
    expect(empty.hasAttribute('class')).toBe(false);
    store.setLayout('list');
    expect(empty.className).toBe(DETECTIONS_LIST_COLUMN);
    expect(el('[data-fdt="detections-filtered-empty"]')).toBe(empty);
    expect(empty.textContent).toContain('"Active"');
  });

  it('copies the same report in every layout', async () => {
    const writeText = vi.fn((): Promise<void> => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const store = createDetectionsLayout();
      for (const [index, layout] of (['grouped', 'list', 'cards'] as const).entries()) {
        store.setLayout(layout);
        cleanup();
        // A fresh mount per layout, so the button is idle again.
        render(() => <DetectionsView data={data()} now={0} layoutStore={store} />);
        expect(el('[data-fdt="detections-grid"]').dataset.fdtLayout).toBe(layout);
        fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
        await waitFor(() => {
          expect(writeText).toHaveBeenCalledTimes(index + 1);
        });
      }
      expect(writeText.mock.calls[1]).toEqual(writeText.mock.calls[0]);
      expect(writeText.mock.calls[2]).toEqual(writeText.mock.calls[0]);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});

describe('DetectionsView width', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Grouped below regular, keeping the List choice for a wider page', () => {
    const observers = installFakeResizeObserver();
    const store = createDetectionsLayout();
    render(() => <DetectionsView data={data()} now={0} layoutStore={store} />);
    // One observer, on the page's container root (the box the tier variants read).
    expect(observers.live()).toBe(1);
    observers.resize(1231);
    fireEvent.click(screen.getByText('List'));
    const layoutOf = (): string | undefined => el('[data-fdt="detections-grid"]').dataset.fdtLayout;
    expect(layoutOf()).toBe('list');
    observers.resize(320);
    expect(layoutOf()).toBe('grouped');
    expect(store.layout()).toBe('list');
    expect(checkedLayout()).toBe('list');
    // Unbounded below regular: the control row follows the rendered layout.
    expect(el('[data-fdt="detections-controls"]').className).toBe(DETECTIONS_CONTROLS);
    observers.resize(480);
    expect(layoutOf()).toBe('list');
    observers.resize(479);
    store.setLayout('cards');
    expect(layoutOf()).toBe('grouped');
    observers.resize(760);
    expect(layoutOf()).toBe('cards');
  });

  it('measures the page container itself', () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        /** @param target The observed element. */
        observe(target: Element): void {
          observed.push(target);
        }
        /** Unused. */
        disconnect(): void {}
      }
    );
    render(() => <DetectionsView data={data()} now={0} />);
    expect(observed).toEqual([el('[data-fdt-page="detections"]')]);
  });
});

describe('DetectionsPage layout session', () => {
  /** A ready store over the fixture payload. */
  function readyStore(): FdtDataStore {
    const [state] = createSignal<DataState>({ status: 'ready', data: data(), fetchedAt: 0 });
    return { state, start: vi.fn(), stop: vi.fn(), retry: vi.fn(), reload: vi.fn() };
  }

  it('keeps the shell store choice across a page remount (a route round-trip)', () => {
    const layout: DetectionsLayoutStore = createDetectionsLayout();
    const [mounted, setMounted] = createSignal(true);
    render(() => (
      <FdtDataContext.Provider value={readyStore()}>
        <DetectionsLayoutContext.Provider value={layout}>
          <SearchContext.Provider value={createSearchStore()}>
            <Show when={mounted()}>
              <DetectionsPage />
            </Show>
          </SearchContext.Provider>
        </DetectionsLayoutContext.Provider>
      </FdtDataContext.Provider>
    ));
    fireEvent.click(screen.getByText('List'));
    expect(layout.layout()).toBe('list');
    setMounted(false);
    expect(document.querySelector('[data-fdt="detections-grid"]')).toBeNull();
    setMounted(true);
    expect(checkedLayout()).toBe('list');
    expect(el('[data-fdt="detections-grid"]').dataset.fdtLayout).toBe('list');
  });

  it('throws outside the shell layout provider (a wiring bug, never a silent reset)', () => {
    expect(() =>
      render(() => (
        <FdtDataContext.Provider value={readyStore()}>
          <DetectionsPage />
        </FdtDataContext.Provider>
      ))
    ).toThrow('useDetectionsLayout() ran outside the panel shell.');
  });
});
