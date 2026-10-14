/**
 * Test-only harness for the resource-list pages: renders a page body inside
 * the shell's two contexts with a signal-backed data store (so a test can
 * push a refresh) and the real search store, plus a layout-free virtualizer
 * double that renders every row (happy-dom has no layout engine). No shipped
 * module imports this file.
 */
import { render } from '@solidjs/testing-library';
import { createSignal, type Component, type JSX } from 'solid-js';
import { vi } from 'vitest';
import type { VirtualItem, VirtualizerFactory } from '../../../../components/ui/virtual-list';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import type { DataState } from '../../state/fdt-state-machine';
import { createSearchStore, type SearchStore } from '../../state/search';
import { FdtDataContext, SearchContext, type FdtDataStore } from '../../state/use-fdt-data';

/** Fixed row height the double lays rows out with (px). */
const DOUBLE_ROW_PX = 40;

/**
 * A virtualizer double that renders all `count` rows (reactively — it reads
 * the list's live `count` and `getItemKey` on every pass).
 */
export const renderAllRows: VirtualizerFactory = (options) => ({
  getVirtualItems: (): VirtualItem[] =>
    Array.from({ length: options.count }, (_, index) => ({
      // Honors the list's keys, as the real virtualizer does: pages look rows
      // up by key, so an index-keyed double would hide key bugs.
      key: options.getItemKey?.(index) ?? index,
      index,
      start: index * DOUBLE_ROW_PX,
      end: (index + 1) * DOUBLE_ROW_PX,
      size: DOUBLE_ROW_PX,
      lane: 0
    })),
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
 * @returns The harness handles.
 */
export function renderPage(
  Page: Component<{ createVirtualizer?: VirtualizerFactory }>,
  data: FdtData
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
        <Page createVirtualizer={renderAllRows} />
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
