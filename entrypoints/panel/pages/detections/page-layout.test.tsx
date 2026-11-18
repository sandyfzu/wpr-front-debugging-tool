/**
 * The Detections layout modes: the pure class selectors (Adaptive pinned to
 * today's grid and card classes, List bounded with no card chrome or lift),
 * the control, and a switch that only swaps classes — filter selection, card
 * nodes, focus, page facts, the strip and the report all stay.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOTION_LIFT } from '../../../../components/ui/classes';
import { isOptimizationCard } from '../../../../lib/panel/detections-summary';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import type { DataState } from '../../state/fdt-state-machine';
import { makeFdtData } from '../../state/fixtures';
import {
  createDetectionsLayout,
  DetectionsLayoutContext,
  type DetectionsLayoutStore
} from '../../state/detections-layout';
import { FdtDataContext, type FdtDataStore } from '../../state/use-fdt-data';
import {
  DETECTIONS_CONTROLS,
  DETECTIONS_GRID,
  DETECTIONS_LIST_COLUMN,
  DETECTIONS_LIST_GRID,
  detectionsBlockClass,
  detectionsGridClass,
  DetectionsPage,
  DetectionsView,
  LAYOUT_CONTROL_LABEL
} from './page';
import {
  STATUS_CARD_SURFACE,
  STATUS_LIST_ROW_SURFACE,
  statusCardSurface,
  statusLinkInteraction
} from './status-card';

afterEach(() => {
  cleanup();
});

/** The grid's class list before layout modes existed (the Adaptive pin). */
const ADAPTIVE_GRID =
  'flex flex-col divide-y divide-line-1 overflow-hidden rounded-md border border-line-1 bg-surface-1 @regular:grid @regular:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] @regular:gap-2 @regular:divide-y-0 @regular:overflow-visible @regular:rounded-none @regular:border-0 @regular:bg-transparent';

/** The card surface before layout modes existed (the Adaptive pin). */
const ADAPTIVE_CARD =
  'flex h-full w-full flex-col gap-1 px-2.5 py-2 text-xs text-fg-primary @regular:rounded-md @regular:border @regular:border-line-1 @regular:bg-surface-1 @regular:p-2.5';

/** A payload with an active link card (delay_js), a quiet link card and static cards. */
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

/** One card root by id. */
const card = (id: string): HTMLElement => el(`[data-fdt-card-id="${id}"]`);

/** The rendered card ids, in DOM order. */
function cardIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="status-card"]')].map(
    (node) => node.dataset.fdtCardId ?? ''
  );
}

/** A filter chip. */
const chip = (id: string): HTMLElement => el(`[data-fdt-filter-chip="${id}"]`);

/** The layout group's checked radio value. */
function checkedLayout(): string | undefined {
  return screen
    .getByRole('radiogroup', { name: LAYOUT_CONTROL_LABEL })
    .querySelector<HTMLInputElement>('input:checked')?.value;
}

describe('layout class selectors', () => {
  it('keeps Adaptive byte-equal to the pre-mode grid and card', () => {
    expect(DETECTIONS_GRID).toBe(ADAPTIVE_GRID);
    expect(detectionsGridClass('adaptive')).toBe(ADAPTIVE_GRID);
    expect(STATUS_CARD_SURFACE).toBe(ADAPTIVE_CARD);
    expect(statusCardSurface('adaptive')).toBe(ADAPTIVE_CARD);
    // The adaptive grid is the list grid plus its regular-tier grid.
    expect(DETECTIONS_GRID.startsWith(`${DETECTIONS_LIST_GRID} @regular:grid `)).toBe(true);
  });

  it('builds List as one bounded grouped surface with no grid track', () => {
    const list = detectionsGridClass('list');
    expect(list).toBe(`${DETECTIONS_LIST_GRID} ${DETECTIONS_LIST_COLUMN}`);
    expect(list).toContain('max-w-4xl');
    expect(list).toContain('divide-y');
    expect(list).not.toContain('@regular:');
  });

  it('gives List rows roomier regular-tier padding and no card chrome', () => {
    const row = statusCardSurface('list');
    expect(row).toBe(STATUS_LIST_ROW_SURFACE);
    expect(row).toContain('@regular:px-3 @regular:py-2.5');
    expect(row).not.toMatch(/@regular:(rounded|border|bg-|shadow)/);
  });

  it('lifts only an active Adaptive link; List links wash with an inset ring', () => {
    expect(statusLinkInteraction('adaptive', 'active')).toContain(MOTION_LIFT);
    expect(statusLinkInteraction('adaptive', 'not-active')).not.toContain('shadow');
    for (const status of ['active', 'not-active', 'collecting', 'unknown'] as const) {
      const row = statusLinkInteraction('list', status);
      expect(row).toBe('hover:bg-surface-2 focus-visible:-outline-offset-2');
    }
  });

  it('bounds the blocks above the list only in List mode', () => {
    expect(detectionsBlockClass(DETECTIONS_CONTROLS, 'adaptive')).toBe(DETECTIONS_CONTROLS);
    expect(detectionsBlockClass(undefined, 'adaptive')).toBeUndefined();
    expect(detectionsBlockClass(DETECTIONS_CONTROLS, 'list')).toBe(
      `${DETECTIONS_CONTROLS} ${DETECTIONS_LIST_COLUMN}`
    );
    expect(detectionsBlockClass(undefined, 'list')).toBe(DETECTIONS_LIST_COLUMN);
  });
});

describe('DetectionsView layout', () => {
  it('offers Adaptive / List in the control row, Adaptive checked, hidden below regular', () => {
    render(() => <DetectionsView data={data()} now={0} />);
    const group = screen.getByRole('radiogroup', { name: LAYOUT_CONTROL_LABEL });
    expect(group.closest('[data-fdt="detections-controls"]')).not.toBeNull();
    // The filter first, the layout choice last (right-aligned by the row).
    expect(el('[data-fdt="detections-controls"]').lastElementChild).toBe(group);
    expect(group.className).toContain('@max-regular:hidden');
    expect(
      [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((i) => i.value)
    ).toEqual(['adaptive', 'list']);
    expect(screen.getByText('Adaptive').tagName).toBe('LABEL');
    expect(checkedLayout()).toBe('adaptive');
  });

  it('renders Adaptive with exactly the pre-mode classes', () => {
    render(() => <DetectionsView data={data()} now={0} />);
    expect(el('[data-fdt="detections-grid"]').className).toBe(ADAPTIVE_GRID);
    expect(el('[data-fdt="detections-controls"]').className).toBe(DETECTIONS_CONTROLS);
    expect(card('wpr').className).toBe(ADAPTIVE_CARD);
    expect(card('delay_js').className).toContain('hover:shadow-elev-2');
  });

  it('switches to List from the control: bounded column, rows, no lift', () => {
    render(() => <DetectionsView data={data()} now={0} />);
    fireEvent.click(screen.getByText('List'));
    expect(checkedLayout()).toBe('list');
    const grid = el('[data-fdt="detections-grid"]');
    expect(grid.dataset.fdtLayout).toBe('list');
    expect(grid.className).toBe(detectionsGridClass('list'));
    expect(el('[data-fdt="detections-controls"]').className).toContain(DETECTIONS_LIST_COLUMN);
    // The strip keeps the page canvas.
    expect(el('[data-fdt="detections-summary"]').className).not.toContain('max-w-4xl');
    expect(card('wpr').className).toBe(STATUS_LIST_ROW_SURFACE);
    const link = card('delay_js');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('#/javascript');
    expect(link.className).not.toContain('shadow');
    expect(link.className).toContain('hover:bg-surface-2');
    // The inset ring replaces the shared outset offset (never both).
    expect(link.className).toContain('focus-visible:-outline-offset-2');
    expect(link.className).not.toMatch(/(^| )focus-visible:outline-offset-1/);
    expect(card('wpr').tagName).toBe('DIV');
  });

  it('keeps the filter, card nodes, focus, page facts and strip across a switch', () => {
    const store = createDetectionsLayout();
    render(() => <DetectionsView data={data()} now={0} layoutStore={store} />);
    fireEvent.click(chip('active'));
    const ids = cardIds();
    const facts = ids.filter((id) => !isOptimizationCard(id as never));
    const nodes = ids.map(card);
    const strip = el('[data-fdt="detections-summary"]').outerHTML;
    const link = card('delay_js');
    link.focus();
    for (const layout of ['list', 'adaptive', 'list'] as const) {
      store.setLayout(layout);
      expect(el('[data-fdt="detections-grid"]').dataset.fdtLayout).toBe(layout);
      expect(chip('active').getAttribute('aria-pressed')).toBe('true');
      expect(cardIds()).toEqual(ids);
      expect(cardIds().filter((id) => !isOptimizationCard(id as never))).toEqual(facts);
      expect(ids.map(card)).toEqual(nodes);
      expect(document.activeElement).toBe(link);
      expect(el('[data-fdt="detections-summary"]').outerHTML).toBe(strip);
    }
  });

  it('bounds the filtered-empty line in List and leaves it bare in Adaptive', () => {
    const [payload, setPayload] = createSignal(data());
    const store = createDetectionsLayout();
    render(() => <DetectionsView data={payload()} now={0} layoutStore={store} />);
    fireEvent.click(chip('active'));
    const base = makeFdtData();
    setPayload(makeFdtData({ wprDetections: { ...base.wprDetections } }));
    const empty = el('[data-fdt="detections-filtered-empty"]');
    expect(empty.hasAttribute('class')).toBe(false);
    store.setLayout('list');
    expect(empty.className).toBe(DETECTIONS_LIST_COLUMN);
    expect(el('[data-fdt="detections-filtered-empty"]')).toBe(empty);
    expect(empty.textContent).toContain('"Active"');
  });

  it('copies the same report in either layout', async () => {
    const writeText = vi.fn((): Promise<void> => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const store = createDetectionsLayout();
      render(() => <DetectionsView data={data()} now={0} layoutStore={store} />);
      fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
      // A fresh mount over the same store (List), so the button is idle again.
      store.setLayout('list');
      cleanup();
      render(() => <DetectionsView data={data()} now={0} layoutStore={store} />);
      expect(el('[data-fdt="detections-grid"]').dataset.fdtLayout).toBe('list');
      fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(2);
      });
      expect(writeText.mock.calls[1]).toEqual(writeText.mock.calls[0]);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
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
          <Show when={mounted()}>
            <DetectionsPage />
          </Show>
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
