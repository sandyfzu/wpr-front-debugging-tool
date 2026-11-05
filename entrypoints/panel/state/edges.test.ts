/**
 * The store's request seams over the tab transport: the derived
 * `canRequest`/`request` pair, and the data store end to end on the relay
 * path — every relay outcome lands on the same state the direct path's
 * matching outcome produces.
 */
import { describe, expect, it, vi } from 'vitest';
import type { TabAsks } from '../../../lib/messaging/tab-asks';
import type { TabRelayRequest } from '../../../lib/messaging/tab-relay';
import { relayTabAsks } from '../../../lib/messaging/tab-relay-client';
import { fdtRequestEdges, type FdtRequestEdges } from './edges';
import { makeFdtData, makeHardReloadBudget } from './fixtures';
import { createSearchStore } from './search';
import {
  createFdtDataStore,
  NO_PAGE_TRANSPORT_REASON,
  RELAY_UNAVAILABLE_REASON
} from './use-fdt-data';
import type { DataState } from './fdt-state-machine';

const TAB = 31;

/** Asks double whose `getFdtData` answers `answer`. */
function asksAnswering(answer: Promise<unknown>): TabAsks {
  return {
    processPageData: vi.fn(() => Promise.resolve(true)),
    getFdtData: vi.fn(() => answer),
    getScriptSourceChunk: vi.fn(() => Promise.resolve(null)),
    startRucssTest: vi.fn(() => Promise.resolve(null)),
    applyRucssTest: vi.fn(() => Promise.resolve(null))
  };
}

/** Let the store's flight settle. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

/** Boot a store over the given request seams and return its settled state. */
async function settledState(edges: FdtRequestEdges): Promise<DataState> {
  const store = createFdtDataStore({
    inspectedTabId: () => TAB,
    ...edges,
    receive: () => () => undefined,
    search: createSearchStore(),
    reload: vi.fn(),
    hardReloadBudget: makeHardReloadBudget(),
    now: () => 1727000000000
  });
  store.start();
  await flush();
  return store.state();
}

/** A relay round trip answering `reply`, recording each request. */
function relayAnswering(reply: unknown): {
  edges: FdtRequestEdges;
  requests: TabRelayRequest[];
} {
  const requests: TabRelayRequest[] = [];
  const edges = fdtRequestEdges(
    relayTabAsks((request) => {
      requests.push(request);
      return Promise.resolve(reply);
    })
  );
  return { edges, requests };
}

describe('fdtRequestEdges', () => {
  it('requests the page data over the given asks, for the given tab', async () => {
    const asks = asksAnswering(Promise.resolve('raw'));
    const edges = fdtRequestEdges(asks);
    expect(edges.canRequest()).toBe(true);
    await expect(edges.request(TAB)).resolves.toBe('raw');
    expect(asks.getFdtData).toHaveBeenCalledWith(TAB);
  });

  it('cannot request without a transport (and rejects if asked anyway)', async () => {
    const edges = fdtRequestEdges(null);
    expect(edges.canRequest()).toBe(false);
    await expect(edges.request(TAB)).rejects.toThrow(/no transport/);
  });
});

describe('the data store on the relay path', () => {
  it('loads the page data the relay hands back, asking for the inspected tab', async () => {
    const data = makeFdtData();
    const relay = relayAnswering({ ok: true, answer: data });
    const state = await settledState(relay.edges);
    expect(state.status).toBe('ready');
    expect(state.status === 'ready' ? state.data : null).toEqual(data);
    expect(relay.requests).toEqual([{ tabId: TAB, ask: 'getFdtData' }]);
  });

  it('lands no-receiver (a closed tab included) on the direct path’s no-receiver state', async () => {
    const direct = await settledState(
      fdtRequestEdges(asksAnswering(Promise.reject(new Error('No response'))))
    );
    expect(direct.status).toBe('error');
    for (const failure of ['no-receiver']) {
      expect(await settledState(relayAnswering({ ok: false, failure }).edges), failure).toEqual(
        direct
      );
    }
  });

  it('lands a failed forward on the direct path’s (retryable) failure state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const direct = await settledState(
      fdtRequestEdges(asksAnswering(Promise.reject(new Error('boom'))))
    );
    expect(direct.status).toBe('error');
    expect(await settledState(relayAnswering({ ok: false, failure: 'failed' }).edges)).toEqual(
      direct
    );
  });

  it('lands the relay’s own failures on the named unavailable state, never blaming the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unavailable = { status: 'unavailable', reason: RELAY_UNAVAILABLE_REASON };
    for (const reply of [
      { ok: false, failure: 'refused' },
      { ok: false, failure: 'invalid-request' },
      'junk'
    ]) {
      expect(await settledState(relayAnswering(reply).edges), JSON.stringify(reply)).toEqual(
        unavailable
      );
    }
    // No relay listener in the background: the round trip itself rejects.
    const unreachable = fdtRequestEdges(
      relayTabAsks(() =>
        Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))
      )
    );
    expect(await settledState(unreachable)).toEqual(unavailable);
    expect(warn).toHaveBeenCalled();
  });

  it('turns a soft refresh the relay refuses into the terminal unavailable state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const replies: unknown[] = [
      { ok: true, answer: makeFdtData() },
      { ok: false, failure: 'refused' }
    ];
    const send = vi.fn(() => Promise.resolve(replies.shift() ?? { ok: true, answer: null }));
    const store = createFdtDataStore({
      inspectedTabId: () => TAB,
      ...fdtRequestEdges(relayTabAsks(send)),
      receive: () => () => undefined,
      search: createSearchStore(),
      reload: vi.fn(),
      hardReloadBudget: makeHardReloadBudget(),
      now: () => 1727000000000
    });
    store.start();
    await flush();
    expect(store.state().status).toBe('ready');
    store.reload();
    await flush();
    expect(store.state()).toEqual({ status: 'unavailable', reason: RELAY_UNAVAILABLE_REASON });
    store.retry();
    store.reload();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps the relay-unavailable copy honest: the extension’s fault, no retry, what still works', () => {
    expect(RELAY_UNAVAILABLE_REASON).toContain('The extension couldn’t');
    expect(RELAY_UNAVAILABLE_REASON).toContain('reopen DevTools');
    expect(RELAY_UNAVAILABLE_REASON).toContain('on-page widget still works');
    expect(RELAY_UNAVAILABLE_REASON.toLowerCase()).not.toMatch(/\bretry\b|reload the page/);
  });

  it('lands the content script’s null answer on the direct path’s empty-response state', async () => {
    const direct = await settledState(fdtRequestEdges(asksAnswering(Promise.resolve(null))));
    expect(await settledState(relayAnswering({ ok: true, answer: null }).edges)).toEqual(direct);
  });

  it('is unavailable only without any transport', async () => {
    expect(await settledState(fdtRequestEdges(null))).toEqual({
      status: 'unavailable',
      reason: NO_PAGE_TRANSPORT_REASON
    });
  });
});
