/**
 * Test-only harness for the resource-list pages: renders a page body inside
 * the shell's two contexts with a signal-backed data store (so a test can
 * push a refresh) and the real search store, plus layout-free virtualizer
 * doubles (happy-dom has no layout engine) that render a bounded window, as
 * the real virtualizer does — so a list at its 5,000-row cap still mounts
 * only a viewport's worth of rows. No shipped module imports this file.
 */
import { render } from '@solidjs/testing-library';
import { createSignal, untrack, type Component, type JSX } from 'solid-js';
import { vi } from 'vitest';
import type {
  VirtualItem,
  VirtualizerFactory,
  VirtualListOptions
} from '../../../../components/ui/virtual-list';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import type { DataState } from '../../state/fdt-state-machine';
import { createSearchStore, type SearchStore } from '../../state/search';
import { FdtDataContext, SearchContext, type FdtDataStore } from '../../state/use-fdt-data';

/** Fixed row height the double lays rows out with (px). */
const DOUBLE_ROW_PX = 40;

/**
 * Rows the doubles mount at most: well above every small fixture (so those
 * render whole) and far below the 5,000-row cap (which a happy-dom render
 * of every row turns into seconds of DOM work).
 */
export const DOUBLE_WINDOW_ROWS = 50;

/**
 * The window's items: the first `min(count, DOUBLE_WINDOW_ROWS)` rows, laid
 * out at {@link DOUBLE_ROW_PX}.
 *
 * @param options The list's live virtualizer options (`count`, `getItemKey`).
 * @returns The windowed items.
 */
function windowItems(options: VirtualListOptions): VirtualItem[] {
  return Array.from({ length: Math.min(options.count, DOUBLE_WINDOW_ROWS) }, (_, index) => ({
    // Honors the list's keys, as the real virtualizer does: pages look rows
    // up by key, so an index-keyed double would hide key bugs.
    key: options.getItemKey?.(index) ?? index,
    index,
    start: index * DOUBLE_ROW_PX,
    end: (index + 1) * DOUBLE_ROW_PX,
    size: DOUBLE_ROW_PX,
    lane: 0
  }));
}

/**
 * A virtualizer double that mounts the top window of rows in step with the
 * list (it reads the live `count` and `getItemKey` on every pass) and sizes
 * the scroller for all `count` rows, like the real one at scroll top.
 */
export const renderWindowedRows: VirtualizerFactory = (options) => ({
  getVirtualItems: () => windowItems(options),
  getTotalSize: () => options.count * DOUBLE_ROW_PX,
  measureElement: () => undefined
});

/** A rendered page plus the handles a test drives it through. */
export interface PageHarness {
  /** The real search store the page reads. */
  readonly search: SearchStore;
  /** Replace the store's data (a soft refresh: the page stays mounted). */
  refresh(data: FdtData): void;
  /** The page section element. */
  readonly root: HTMLElement;
}

/**
 * Render a page body with the given data in the `ready` state.
 *
 * @param Page The page component (receives the virtualizer double).
 * @param data The payload to serve.
 * @param virtualizer The virtualizer double (default: the top window, in step).
 * @returns The harness handles.
 */
export function renderPage(
  Page: Component<{ createVirtualizer?: VirtualizerFactory }>,
  data: FdtData,
  virtualizer: VirtualizerFactory = renderWindowedRows
): PageHarness {
  const [state, setState] = createSignal<DataState>({ status: 'ready', data, fetchedAt: 0 });
  const store: FdtDataStore = {
    state,
    start: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    reload: vi.fn()
  };
  const search = createSearchStore();
  const view = render((): JSX.Element => (
    <FdtDataContext.Provider value={store}>
      <SearchContext.Provider value={search}>
        <Page createVirtualizer={virtualizer} />
      </SearchContext.Provider>
    </FdtDataContext.Provider>
  ));
  const root = view.container.querySelector<HTMLElement>('[data-fdt-page]');
  if (root === null) throw new Error('renderPage: the page rendered no [data-fdt-page] root');
  return {
    search,
    root,
    refresh(next) {
      setState({ status: 'refreshing', data: next, requestedAt: 1 });
      setState({ status: 'ready', data: next, fetchedAt: 2 });
    }
  };
}

/** A virtualizer double whose window only moves when the test says so. */
export interface LaggedVirtualizer {
  /** Pass as the page's `createVirtualizer`. */
  readonly factory: VirtualizerFactory;
  /** Catch the window up with the list's current count and keys. */
  flush(): void;
}

/**
 * A double that lags like the real virtualizer: after a filter change the
 * page's data moves at once while the window still lists the previous
 * indices/keys until {@link LaggedVirtualizer.flush} — the moment an
 * index-based row lookup would name the wrong row and remount it.
 *
 * @returns The factory and its flush handle.
 */
export function laggedVirtualizer(): LaggedVirtualizer {
  const handle = { flush: (): void => undefined };
  const factory: VirtualizerFactory = (options) => {
    // Items and count lag together: both move only on flush.
    const snapshot = (): { items: VirtualItem[]; count: number } => ({
      items: windowItems(options),
      count: options.count
    });
    const [view, setView] = createSignal(untrack(snapshot));
    handle.flush = () => {
      setView(untrack(snapshot));
    };
    return {
      getVirtualItems: () => view().items,
      getTotalSize: () => view().count * DOUBLE_ROW_PX,
      measureElement: () => undefined
    };
  };
  return {
    factory,
    flush: () => {
      handle.flush();
    }
  };
}
