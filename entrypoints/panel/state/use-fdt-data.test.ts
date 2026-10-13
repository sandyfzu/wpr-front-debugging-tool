/**
 * The data-layer store's tests, over fake edges: receiver registration
 * happens at mount (never inside the fetch promise — early searches land,
 * cancel clears for real), the flight lifecycle across the machine (boot
 * fetch, retry, soft refresh), the push channels' granular updates and their
 * tab scoping, the payload contract branches (null response, foreign
 * payload → the reload fallback fires exactly once), and the idempotent
 * start/stop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelReceivers } from './edges';
import type { DataState } from './fdt-state-machine';
import type { PanelSearchAction } from '../../../lib/wp-rocket/types';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { SEARCH_DEBOUNCE_MS, createSearchStore, type SearchStore } from './search';
import { createFdtDataStore, type FdtDataStore } from './use-fdt-data';
import { makeFdtData } from './fixtures';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The whole fake edge world: registered receivers (tests deliver exactly
 * like the transport), one controllable request promise, and spies for the
 * store's controls.
 */
function fakeWorld(initial: { request: Promise<unknown>; inspectedTabId?: number }) {
  let receivers: PanelReceivers | null = null;
  const request = vi.fn(() => world.pending);
  const receive = vi.fn((registered: PanelReceivers) => {
    receivers = registered;
    return vi.fn(() => {
      receivers = null;
    });
  });
  const reload = vi.fn();
  const world = {
    request,
    receive,
    reload,
    /** The promise request-awaits resolve or reject with (swappable). */
    pending: initial.request,
    inspectedTabId: initial.inspectedTabId ?? 42,
    deliverPanelSearch(action: PanelSearchAction): void {
      receivers?.onPanelSearch(action);
    },
    deliverAllScriptsLoaded(loaded: boolean, senderTabId: number | null = 42): void {
      receivers?.onAllScriptsLoaded(loaded, senderTabId);
    },
    deliverUndefinedReferences(words: string[], senderTabId: number | null = 42): void {
      receivers?.onUndefinedReferences(words, senderTabId);
    },
    deliverPanelReload(senderTabId: number | null = 42): void {
      receivers?.onPanelReload(senderTabId);
    },
    /** Whether the receivers are registered and armed. */
    get receiversArmed(): boolean {
      return receivers !== null;
    }
  };
  return world;
}

/** Drain the microtask queue: a settled request chain is fully applied. */
async function drained(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) {
    await Promise.resolve();
  }
}

/** The error state's cause, typed out of the discriminated union. */
function errorCauseOf(state: DataState): string {
  if (state.status !== 'error') throw new Error(`Not an error state: ${state.status}`);
  return state.cause;
}

/** The loaded data behind a ready/refreshing state (typed read for tests). */
function loadedData(state: DataState): FdtData {
  if (state.status === 'ready' || state.status === 'refreshing') return state.data;
  throw new Error(`No data while ${state.status}`);
}

/** Build the store over the fake world, with the test's own search store. */
function makeStore(
  world: ReturnType<typeof fakeWorld>,
  search: SearchStore = createSearchStore()
): FdtDataStore {
  return createFdtDataStore({
    inspectedTabId: () => world.inspectedTabId,
    request: world.request,
    receive: world.receive,
    search,
    reload: world.reload,
    now: () => 1727000000000
  });
}

describe('registration + boot flight', () => {
  it('registers the receivers at mount, then runs the first fetch', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    expect(world.receive).not.toHaveBeenCalled();
    expect(world.request).not.toHaveBeenCalled();
    store.start();
    expect(world.receiversArmed).toBe(true);
    expect(world.request).toHaveBeenCalledWith(42);
    await drained();
    expect(store.state()).toEqual({
      status: 'ready',
      data: makeFdtData(),
      fetchedAt: 1727000000000
    });
  });

  it('handles a search action arriving before any data settles', async () => {
    const search = createSearchStore();
    const world = fakeWorld({ request: new Promise<unknown>(() => {}) });
    const store = makeStore(world, search);
    store.start();
    // The fetch is still pending — the action must already be handled.
    world.deliverPanelSearch({ action: 'performSearch', query: 'wp roc' });
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(search.query()).toBe('wp roc');
  });

  it('maps cancel to the immediate clear and next/prev to the cursor steps', () => {
    const search = createSearchStore();
    search.perform('wp');
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world, search);
    store.start();
    world.deliverPanelSearch({ action: 'cancelSearch' });
    expect(search.query()).toBe('');
    world.deliverPanelSearch({ action: 'performSearch', query: 'three' });
    world.deliverPanelSearch({ action: 'nextSearchResult' });
    world.deliverPanelSearch({ action: 'previousSearchResult' });
    // Zero match count: the cursor steps change nothing here; the pages
    // report real counts in later phases and drive real movement.
    expect(search.cursor()).toBe(0);
  });

  it('start is idempotent — one receiver set, one request', () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    store.start();
    store.start();
    expect(world.receive).toHaveBeenCalledTimes(1);
    expect(world.request).toHaveBeenCalledTimes(1);
  });

  it('stop() unregisters the receivers; a re-start re-arms them', () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    store.start();
    store.stop();
    expect(world.receiversArmed).toBe(false);
    store.start();
    expect(world.receiversArmed).toBe(true);
  });
});

describe('request flight lifecycle', () => {
  it('retries from the error state successfully', async () => {
    const world = fakeWorld({ request: Promise.reject(new Error('did not happen')) });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(store.state()).toEqual({
      status: 'error',
      cause: 'The page could not be reached for its data.',
      hardReload: false
    });
    world.pending = Promise.resolve(makeFdtData());
    store.retry();
    await drained();
    expect(store.state()).toMatchObject({ status: 'ready' });
  });

  it('names the no-receiver case with its actionable cause', async () => {
    const world = fakeWorld({
      request: Promise.reject(
        new Error('Could not establish connection. Receiving end does not exist.')
      )
    });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(errorCauseOf(store.state())).toContain('no data source reachable');
  });

  it('treats a null payload (processing failed) as a plain error, never a reload', async () => {
    const world = fakeWorld({ request: Promise.resolve(null) });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(store.state()).toMatchObject({ status: 'error', hardReload: false });
    expect(errorCauseOf(store.state())).toContain('no data');
    expect(world.reload).not.toHaveBeenCalled();
  });

  it('drives the hard-reload fallback exactly once for a foreign payload', async () => {
    const world = fakeWorld({ request: Promise.resolve({ not: 'engine output' }) });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(store.state()).toMatchObject({ status: 'error', hardReload: true });
    expect(errorCauseOf(store.state())).toContain('integrity');
    expect(world.reload).toHaveBeenCalledTimes(1);
  });

  it('soft-refreshes on the in-tab notification and swaps the data wholesale', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    store.start();
    await drained();
    const second = makeFdtData({ allScriptsLoaded: true });
    world.pending = Promise.resolve(second);
    world.deliverPanelReload(42);
    // Live data stays on screen while the refresh flies.
    expect(store.state()).toMatchObject({ status: 'refreshing' });
    await drained();
    expect(store.state()).toEqual({ status: 'ready', data: second, fetchedAt: 1727000000000 });
  });

  it('auto-recovers an error state when the notification returns', async () => {
    const world = fakeWorld({ request: Promise.reject(new Error('early')) });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(store.state()).toMatchObject({ status: 'error' });
    world.pending = Promise.resolve(makeFdtData());
    world.deliverPanelReload(42);
    await drained();
    expect(store.state()).toMatchObject({ status: 'ready' });
  });
});

describe('push channels (granular + tab-scoped)', () => {
  it('patches allScriptsLoaded into the ready data without a refetch', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData({ allScriptsLoaded: false })) });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(world.request).toHaveBeenCalledTimes(1);
    world.deliverAllScriptsLoaded(true, 42);
    expect(loadedData(store.state()).allScriptsLoaded).toBe(true);
    expect(world.request).toHaveBeenCalledTimes(1);
  });

  it('replaces the word list wholesale (each push carries the full list)', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    store.start();
    await drained();
    world.deliverUndefinedReferences(['jQuery', '$'], 42);
    expect(loadedData(store.state()).undefinedReferencesOnPage).toEqual(['jQuery', '$']);
  });

  it('drops pushes from a foreign tab — two devtools windows stay independent', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    store.start();
    await drained();
    world.deliverAllScriptsLoaded(true, 43);
    world.deliverPanelReload(43);
    await drained();
    expect(loadedData(store.state()).allScriptsLoaded).toBe(false);
    expect(world.request).toHaveBeenCalledTimes(1);
  });

  it('drops pushes without a usable sender tab id', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    store.start();
    await drained();
    world.deliverUndefinedReferences(['junk'], null);
    expect(loadedData(store.state()).undefinedReferencesOnPage).toEqual([]);
  });

  it('ignores pushes while nothing is loaded yet (the flight will carry it)', () => {
    const world = fakeWorld({ request: new Promise<unknown>(() => {}) });
    const store = makeStore(world);
    store.start();
    world.deliverAllScriptsLoaded(true, 42);
    expect(store.state()).toEqual({ status: 'fetching' });
  });

  it('applies patches to the refreshing state too — the carried view stays live', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    store.start();
    await drained();
    world.pending = new Promise<unknown>(() => {});
    world.deliverPanelReload(42);
    expect(store.state()).toMatchObject({ status: 'refreshing' });
    world.deliverAllScriptsLoaded(true, 42);
    expect(store.state()).toEqual({
      status: 'refreshing',
      data: makeFdtData({ allScriptsLoaded: true }),
      requestedAt: 1727000000000
    });
  });
});
