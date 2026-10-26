/**
 * The data-layer store's tests, over fake edges: receiver registration
 * happens at mount, strictly *before* the first fetch request (order pinned),
 * and never inside the fetch promise — early searches land, cancel clears
 * for real; the flight lifecycle across the machine (boot fetch, retry, soft
 * refresh); the push channels' granular updates, their tab scoping and the
 * unloaded-window buffer that carries them to the next loaded settle; the
 * search relay's own tab scoping (same window in, foreign/malformed out);
 * the payload contract branches (null response, foreign payload → the
 * reload fallback fires exactly once per failure streak — never for a
 * declined event, never again across the reloaded document, re-armed only by
 * a validated payload); and the idempotent start/stop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelReceivers } from './edges';
import type { DataState } from './fdt-state-machine';
import type { PanelSearchAction } from '../../../lib/wp-rocket/types';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { SEARCH_DEBOUNCE_MS, createSearchStore, type SearchStore } from './search';
import { NO_PAGE_TRANSPORT_REASON, createFdtDataStore, type FdtDataStore } from './use-fdt-data';
import { makeFdtData, makeHardReloadBudget, makeLazyImage, makeMemoryStorage } from './fixtures';
import { createHardReloadBudget, type HardReloadBudget } from './hard-reload-budget';

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

/**
 * A request promise the test settles by hand — for a flight that is *in the
 * air*: a swapped `world.pending` never rewires a running flight, since each
 * flight holds the promise its request returned.
 */
function handover(): {
  /** The promise to hand to the world's pending slot. */
  promise: Promise<unknown>;
  /** Settle the flight with a payload (success). */
  release: (payload: unknown) => void;
  /** Settle the flight with a failure. */
  reject: (cause: unknown) => void;
} {
  let release!: (payload: unknown) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<unknown>((resolve, fails) => {
    release = resolve;
    reject = fails;
  });
  return { promise, release, reject };
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
  search: SearchStore = createSearchStore(),
  hardReloadBudget: HardReloadBudget = makeHardReloadBudget(),
  canRequest = true
): FdtDataStore {
  return createFdtDataStore({
    inspectedTabId: () => world.inspectedTabId,
    canRequest: () => canRequest,
    request: world.request,
    receive: world.receive,
    search,
    reload: world.reload,
    hardReloadBudget,
    now: () => 1727000000000
  });
}

describe('a context with no tab transport (neither tabs nor the relay)', () => {
  it('enters the terminal unavailable state with its reason, never requesting', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world, undefined, undefined, false);
    store.start();
    await drained();
    expect(store.state()).toEqual({ status: 'unavailable', reason: NO_PAGE_TRANSPORT_REASON });
    expect(world.request).not.toHaveBeenCalled();
    // The receivers still register (search relay and pushes stay wired).
    expect(world.receiversArmed).toBe(true);
  });

  it('stays unavailable through retry, reload and a panel-reload push', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world, undefined, undefined, false);
    store.start();
    store.retry();
    store.reload();
    world.deliverPanelReload();
    await drained();
    expect(store.state().status).toBe('unavailable');
    expect(world.request).not.toHaveBeenCalled();
  });

  it('names what still works, without offering a retry', () => {
    expect(NO_PAGE_TRANSPORT_REASON).toContain('on-page widget');
    expect(NO_PAGE_TRANSPORT_REASON.toLowerCase()).not.toContain('retry');
  });

  it('blames the missing transports (direct and relay), never a "not yet" or the page', () => {
    // Shown only when neither the tabs API nor the relay's runtime send
    // exists — the Exclusions entry rides on that same runtime send, so the
    // copy must not promise it.
    expect(NO_PAGE_TRANSPORT_REASON).toContain('tab messaging');
    expect(NO_PAGE_TRANSPORT_REASON).toContain('background relay');
    expect(NO_PAGE_TRANSPORT_REASON).not.toMatch(/\byet\b/);
    expect(NO_PAGE_TRANSPORT_REASON).not.toContain('Exclusions entry');
  });
});

describe('registration + boot flight', () => {
  it('registers the receivers at mount, then runs the first fetch', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    expect(world.receive).not.toHaveBeenCalled();
    expect(world.request).not.toHaveBeenCalled();
    store.start();
    expect(world.receiversArmed).toBe(true);
    expect(world.request).toHaveBeenCalledWith(42);
    // Order pinned: the fetch fires only after the receivers are registered
    // — a refactor that swaps the two would regress the early-delivery
    // guarantees and is caught here rather than in behavior.
    expect(world.receive.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(
      world.request.mock.invocationCallOrder[0] ?? 0
    );
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
    world.deliverPanelSearch({ action: 'performSearch', query: 'wp roc', tabId: 42 });
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(search.query()).toBe('wp roc');
  });

  it('maps cancel to the immediate clear and next/prev to the cursor steps', () => {
    const search = createSearchStore();
    search.perform('wp');
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world, search);
    store.start();
    world.deliverPanelSearch({ action: 'cancelSearch', tabId: 42 });
    expect(search.query()).toBe('');
    world.deliverPanelSearch({ action: 'performSearch', query: 'three', tabId: 42 });
    world.deliverPanelSearch({ action: 'nextSearchResult', tabId: 42 });
    world.deliverPanelSearch({ action: 'previousSearchResult', tabId: 42 });
    // Zero match count: the cursor steps change nothing here; the pages
    // report real counts in later phases and drive real movement.
    expect(search.cursor()).toBe(0);
  });

  it('drops relayed search actions from another devtools window', () => {
    const search = createSearchStore();
    const world = fakeWorld({ request: new Promise<unknown>(() => {}) });
    const store = makeStore(world, search);
    store.start();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The relay attaches ITS page's inspected tab; another devtools window's
    // relay (a different id) must not drive this panel's search store.
    world.deliverPanelSearch({ action: 'performSearch', query: 'foreign', tabId: 43 });
    world.deliverPanelSearch({ action: 'cancelSearch', tabId: 43 });
    world.deliverPanelSearch({ action: 'nextSearchResult', tabId: 43 });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(search.query()).toBe('');
    expect(search.matchCount()).toBe(0);
  });

  it('drops relayed search actions with a malformed relay tab id at warn', () => {
    const world = fakeWorld({ request: new Promise<unknown>(() => {}) });
    const store = makeStore(world);
    store.start();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The boundary validator re-checks every arrival, so a junk id reaching
    // the store is defense in depth — dropped with its own named warn line.
    world.deliverPanelSearch({ action: 'performSearch', query: 'junk', tabId: Number.NaN });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('malformed');
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
  it('logs where a rejected payload broke its contract (path only, never the value)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const secret = 'SECRET-VALUE-NOT-FOR-LOGS';
      const payload = makeFdtData();
      const images = [0, 1, 2, 3].map((i) => makeLazyImage({ src: `/${String(i)}.jpg` }));
      const broken = {
        ...payload,
        wprDetections: {
          ...payload.wprDetections,
          lazyload: {
            present: true,
            images: images.map((image, i) =>
              i === 3 ? { ...image, src: 42, extra: secret } : image
            )
          }
        }
      };
      const world = fakeWorld({ request: Promise.resolve(broken) });
      makeStore(world).start();
      await drained();
      expect(errors).toHaveBeenCalledWith(
        '[WPR FDT] [panel] Panel data failed its contract validation — falling back to a full reload.',
        { path: 'wprDetections.lazyload.images[3].keys' }
      );
      expect(JSON.stringify(errors.mock.calls)).not.toContain(secret);
    } finally {
      errors.mockRestore();
    }
  });

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
    const flight = handover();
    const world = fakeWorld({ request: flight.promise });
    const store = makeStore(world);
    store.start();
    flight.release({ not: 'engine output' });
    await drained();
    expect(store.state()).toMatchObject({ status: 'error', hardReload: true });
    expect(errorCauseOf(store.state())).toContain('integrity');
    expect(world.reload).toHaveBeenCalledTimes(1);

    // The fallback is per real contract failure, never per dropped event.
    // Recovery first: the notification is accepted (the error state ends),
    // one flight launches, and the standing error has not re-fired anything.
    const recovery = handover();
    world.pending = recovery.promise;
    world.deliverPanelReload(42);
    expect(world.request).toHaveBeenCalledTimes(2);
    expect(world.reload).toHaveBeenCalledTimes(1);

    // Further notifications while the flight is in the air are identity
    // no-ops (the machine declines them): no repetition — no extra request,
    // no extra reload — from the guard's no-op arm.
    world.deliverPanelReload(42);
    expect(world.request).toHaveBeenCalledTimes(2);
    expect(world.reload).toHaveBeenCalledTimes(1);

    // That in-air flight failing its contract again lands the error state,
    // but the streak's one reload is spent: no second reload (a reloaded
    // panel would receive the same payload — reloading again is the loop).
    recovery.release({ still: 'not engine output' });
    await drained();
    expect(store.state()).toMatchObject({ status: 'error', hardReload: true });
    expect(world.reload).toHaveBeenCalledTimes(1);
  });

  it('never loops: a payload that keeps failing reloads the panel document at most once', async () => {
    // Each "document" is a fresh store over the SAME session storage — what
    // `location.reload()` produces — and every reload boots the next one.
    const storage = makeMemoryStorage();
    const world = fakeWorld({ request: Promise.resolve({ not: 'engine output' }) });
    let documents = 0;
    let current: FdtDataStore | null = null;
    const bootDocument = (): void => {
      documents += 1;
      current?.stop();
      current = makeStore(world, createSearchStore(), makeHardReloadBudget(storage));
      current.start();
    };
    world.reload.mockImplementation(() => {
      // Bounded for the test itself: a regression must fail, not hang.
      if (documents < 50) bootDocument();
    });
    bootDocument();
    for (let tick = 0; tick < 60; tick += 1) await drained();

    expect(world.reload).toHaveBeenCalledTimes(1);
    expect(documents).toBe(2);
    const last = (current as FdtDataStore | null)?.state();
    expect(last).toMatchObject({ status: 'error', hardReload: true });
    expect(last?.status === 'error' ? last.cause : '').toContain('Reload the inspected page');

    // The retry control stays bounded by the user: one click, one flight,
    // no reload.
    (current as FdtDataStore | null)?.retry();
    await drained();
    expect(world.request).toHaveBeenCalledTimes(3);
    expect(world.reload).toHaveBeenCalledTimes(1);
  });

  it('re-arms the reload budget once a payload validates', async () => {
    const storage = makeMemoryStorage();
    const world = fakeWorld({ request: Promise.resolve({ not: 'engine output' }) });
    const first = makeStore(world, createSearchStore(), makeHardReloadBudget(storage));
    first.start();
    await drained();
    expect(world.reload).toHaveBeenCalledTimes(1);

    // The reloaded document receives valid data: the streak ends.
    world.pending = Promise.resolve(makeFdtData());
    const second = makeStore(world, createSearchStore(), makeHardReloadBudget(storage));
    second.start();
    await drained();
    expect(second.state()).toMatchObject({ status: 'ready' });

    // A later, new contract failure may fall back once again.
    world.pending = Promise.resolve({ not: 'engine output' });
    world.deliverPanelReload(42);
    await drained();
    expect(second.state()).toMatchObject({ status: 'error', hardReload: true });
    expect(world.reload).toHaveBeenCalledTimes(2);
  });

  it('stays on the error state without reloading when the budget cannot be remembered', async () => {
    const world = fakeWorld({ request: Promise.resolve({ not: 'engine output' }) });
    const onStorageError = vi.fn();
    const blocked = createHardReloadBudget(() => {
      throw new Error('SecurityError: storage is disabled');
    }, onStorageError);
    const store = makeStore(world, createSearchStore(), blocked);
    store.start();
    await drained();
    expect(store.state()).toMatchObject({ status: 'error', hardReload: true });
    expect(world.reload).not.toHaveBeenCalled();
    expect(onStorageError).toHaveBeenCalledWith('claim', expect.any(Error));
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

describe('the reload control (the user-driven refresh trigger)', () => {
  it('soft-refreshes loaded data: the current view stays up until the swap lands', async () => {
    const first = makeFdtData({ allScriptsLoaded: false });
    const world = fakeWorld({ request: Promise.resolve(first) });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(store.state()).toEqual({ status: 'ready', data: first, fetchedAt: 1727000000000 });

    const second = makeFdtData({ allScriptsLoaded: true });
    world.pending = Promise.resolve(second);
    store.reload();
    // Same machine path as the in-tab notification: data carried, no rebuild.
    expect(store.state()).toEqual({
      status: 'refreshing',
      data: first,
      requestedAt: 1727000000000
    });
    await drained();
    expect(store.state()).toEqual({ status: 'ready', data: second, fetchedAt: 1727000000000 });
  });

  it('recovers an errored panel by asking fresh (auto-recovery, like the notification)', async () => {
    const world = fakeWorld({ request: Promise.reject(new Error('early')) });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(store.state()).toMatchObject({ status: 'error' });

    world.pending = Promise.resolve(makeFdtData());
    store.reload();
    expect(store.state()).toEqual({ status: 'fetching' });
    await drained();
    expect(store.state()).toMatchObject({ status: 'ready' });
  });

  it('declines while a flight is already running (no second request)', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(world.request).toHaveBeenCalledTimes(1);

    world.pending = new Promise<unknown>(() => undefined); // a flight stuck in the air
    store.reload();
    expect(store.state()).toMatchObject({ status: 'refreshing' });
    store.reload();
    expect(world.request).toHaveBeenCalledTimes(2);
  });

  it('fetches when asked before any data exists (idle → fetching)', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData()) });
    const store = makeStore(world);
    expect(store.state()).toEqual({ status: 'idle' });
    store.reload();
    expect(store.state()).toEqual({ status: 'fetching' });
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

describe('unloaded-window push buffer', () => {
  it('ignores pushes while nothing is loaded yet (the flight will carry it)', () => {
    const world = fakeWorld({ request: new Promise<unknown>(() => {}) });
    const store = makeStore(world);
    store.start();
    world.deliverAllScriptsLoaded(true, 42);
    expect(store.state()).toEqual({ status: 'fetching' });
  });

  it('buffers a push landing during the boot fetch and applies it at the settle', async () => {
    // Push delivery vs the reply is unordered (one-shot page events): a
    // push before or during the fetch must not be lost for that page load.
    const flight = handover();
    const world = fakeWorld({ request: flight.promise });
    const store = makeStore(world);
    store.start();
    expect(store.state()).toEqual({ status: 'fetching' });
    world.deliverAllScriptsLoaded(true, 42);
    flight.release(makeFdtData({ allScriptsLoaded: false }));
    await drained();
    // The flight's reply lands first, the buffered push on top.
    expect(loadedData(store.state()).allScriptsLoaded).toBe(true);
  });

  it('keeps the last delivery per channel (each push carries full state)', async () => {
    const flight = handover();
    const world = fakeWorld({ request: flight.promise });
    const store = makeStore(world);
    store.start();
    world.deliverAllScriptsLoaded(true, 42);
    world.deliverAllScriptsLoaded(false, 42);
    world.deliverUndefinedReferences(['jQuery'], 42);
    world.deliverUndefinedReferences(['jQuery', '$'], 42);
    flight.release(makeFdtData());
    await drained();
    const data = loadedData(store.state());
    expect(data.allScriptsLoaded).toBe(false);
    expect(data.undefinedReferencesOnPage).toEqual(['jQuery', '$']);
  });

  it('drains a buffer built up while unloaded when the refresh completes', async () => {
    // An error window collects pushes; the notification's auto-recovery
    // refetches and the buffered payloads drain onto the fresh data.
    const world = fakeWorld({ request: Promise.reject(new Error('early')) });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(store.state()).toMatchObject({ status: 'error' });
    world.deliverUndefinedReferences(['wp-rocket'], 42);
    world.deliverAllScriptsLoaded(true, 42);
    expect(store.state()).toMatchObject({ status: 'error' });
    world.pending = Promise.resolve(makeFdtData());
    world.deliverPanelReload(42);
    await drained();
    const data = loadedData(store.state());
    expect(data.undefinedReferencesOnPage).toEqual(['wp-rocket']);
    expect(data.allScriptsLoaded).toBe(true);
  });

  it('drains only once per settle — an acknowledged push is never re-applied', async () => {
    const world = fakeWorld({ request: Promise.resolve(makeFdtData({ allScriptsLoaded: false })) });
    const store = makeStore(world);
    store.start();
    world.deliverAllScriptsLoaded(true, 42);
    await drained();
    // Drained: the buffered value is on the store, then a live push moves it.
    expect(loadedData(store.state()).allScriptsLoaded).toBe(true);
    world.deliverAllScriptsLoaded(false, 42);
    expect(loadedData(store.state()).allScriptsLoaded).toBe(false);

    // A later settle (the soft refresh) must not resurrect the drained
    // value: the buffer was emptied at the first drain, so only the flight's
    // own payload applies.
    world.pending = Promise.resolve(makeFdtData({ allScriptsLoaded: true }));
    world.deliverPanelReload(42);
    await drained();
    expect(loadedData(store.state()).allScriptsLoaded).toBe(true);
  });

  it('holds the buffer for a loaded state when a settle errors instead', async () => {
    const flight = handover();
    const world = fakeWorld({ request: flight.promise });
    const store = makeStore(world);
    store.start();
    world.deliverAllScriptsLoaded(true, 42);
    flight.reject(new Error('did not happen'));
    await drained();
    // The settle errored: nothing loaded to drain onto — the buffer stands.
    expect(store.state()).toMatchObject({ status: 'error' });
    world.pending = Promise.resolve(makeFdtData());
    store.retry();
    await drained();
    expect(loadedData(store.state()).allScriptsLoaded).toBe(true);
  });

  it('clears the buffer on stop — a restarted store buffers only its own deliveries', async () => {
    const world = fakeWorld({ request: Promise.reject(new Error('early')) });
    const store = makeStore(world);
    store.start();
    await drained();
    expect(store.state()).toMatchObject({ status: 'error' });
    world.deliverAllScriptsLoaded(true, 42);
    store.stop();
    // A restart from the error state launches a real fetch; the buffer was
    // emptied at stop, so only the flight's own payload may apply.
    world.pending = Promise.resolve(makeFdtData({ allScriptsLoaded: false }));
    store.start();
    await drained();
    expect(loadedData(store.state()).allScriptsLoaded).toBe(false);
  });
});
