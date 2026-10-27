import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../../lib/logger';
import { selectTabPushConnect } from '../../../lib/messaging/tab-push-client';
import { portDouble } from '../../../lib/messaging/tab-push-port.fixtures';
import type { MessagingEdges, PanelReceivers } from './edges';
import { makeFdtData, makeHardReloadBudget } from './fixtures';
import { dispatchTabPush, withRelayedPushes } from './relayed-pushes';
import { createSearchStore } from './search';
import { createFdtDataStore } from './use-fdt-data';

const TAB = 6;

/** A logger double (no console noise; calls assertable). */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

/** Receivers recording every call. */
function receiversDouble() {
  return {
    onPanelSearch: vi.fn(),
    onAllScriptsLoaded: vi.fn(),
    onUndefinedReferences: vi.fn(),
    onPanelReload: vi.fn()
  } satisfies PanelReceivers;
}

/** Direct edges recording registration and stop. */
function directEdges() {
  const stop = vi.fn();
  const edges = {
    receive: vi.fn<(receivers: PanelReceivers) => () => void>(() => stop)
  } satisfies MessagingEdges;
  return { edges, stop };
}

describe('dispatchTabPush', () => {
  it('reaches the receiver each push’s direct channel reaches, with the relayed tab', () => {
    const receivers = receiversDouble();
    dispatchTabPush({ tabId: TAB, push: 'notifyPanelReload' }, receivers);
    dispatchTabPush({ tabId: TAB, push: 'allScriptsLoaded', data: true }, receivers);
    dispatchTabPush({ tabId: TAB, push: 'undefinedReferencesUpdated', data: ['wp'] }, receivers);
    expect(receivers.onPanelReload).toHaveBeenCalledWith(TAB);
    expect(receivers.onAllScriptsLoaded).toHaveBeenCalledWith(true, TAB);
    expect(receivers.onUndefinedReferences).toHaveBeenCalledWith(['wp'], TAB);
    expect(receivers.onPanelSearch).not.toHaveBeenCalled();
  });
});

describe('withRelayedPushes', () => {
  it('returns the direct edges themselves when no relay is needed (Chromium)', () => {
    const { edges } = directEdges();
    const connect = selectTabPushConnect({
      tabs: { sendMessage: () => undefined },
      runtime: { connect: () => portDouble() }
    });
    expect(withRelayedPushes(edges, { connect, inspectedTabId: () => TAB })).toBe(edges);
  });

  it('registers the direct receivers and subscribes the inspected tab', () => {
    const { edges } = directEdges();
    const port = portDouble();
    const receivers = receiversDouble();
    withRelayedPushes(edges, { connect: () => port, inspectedTabId: () => TAB }).receive(receivers);
    expect(edges.receive).toHaveBeenCalledWith(receivers);
    expect(port.posted).toEqual([{ tabId: TAB }]);
    port.deliver({ tabId: TAB, push: 'allScriptsLoaded', data: false });
    expect(receivers.onAllScriptsLoaded).toHaveBeenCalledWith(false, TAB);
  });

  it('stops both the relayed and the direct receivers', () => {
    const { edges, stop } = directEdges();
    const port = portDouble();
    const off = withRelayedPushes(edges, {
      connect: () => port,
      inspectedTabId: () => TAB
    }).receive(receiversDouble());
    off();
    expect(stop).toHaveBeenCalledOnce();
    expect(port.disconnects).toBe(1);
    expect(port.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
  });

  it('subscribes nothing without an inspected tab (the direct receivers still register)', () => {
    const { edges, stop } = directEdges();
    const connect = vi.fn(() => portDouble());
    const log = logDouble();
    const off = withRelayedPushes(edges, { connect, inspectedTabId: () => null, log }).receive(
      receiversDouble()
    );
    expect(connect).not.toHaveBeenCalled();
    expect(edges.receive).toHaveBeenCalledOnce();
    off();
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe('the data store fed by relayed pushes', () => {
  /** A store over relayed edges whose request answers fresh data each time. */
  function relayedStore(inspected = TAB) {
    const port = portDouble();
    const { edges } = directEdges();
    const request = vi.fn(() => Promise.resolve(makeFdtData()));
    const store = createFdtDataStore({
      inspectedTabId: () => inspected,
      canRequest: () => true,
      request,
      receive: (receivers) =>
        withRelayedPushes(edges, {
          connect: () => port,
          inspectedTabId: () => inspected
        }).receive(receivers),
      search: createSearchStore(),
      reload: vi.fn(),
      hardReloadBudget: makeHardReloadBudget(),
      now: () => 1727000000000
    });
    return { store, port, request };
  }

  /** Let the store's flights settle. */
  async function flush(): Promise<void> {
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
  }

  it('soft-refreshes on a relayed reload notice and patches the live pushes in', async () => {
    const { store, port, request } = relayedStore();
    store.start();
    await flush();
    expect(store.state().status).toBe('ready');
    port.deliver({ tabId: TAB, push: 'notifyPanelReload' });
    expect(store.state().status).toBe('refreshing');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    port.deliver({ tabId: TAB, push: 'allScriptsLoaded', data: true });
    port.deliver({ tabId: TAB, push: 'undefinedReferencesUpdated', data: ['jQuery'] });
    const state = store.state();
    expect(state.status === 'ready' ? state.data.allScriptsLoaded : null).toBe(true);
    expect(state.status === 'ready' ? state.data.undefinedReferencesOnPage : null).toEqual([
      'jQuery'
    ]);
  });

  it('keeps the tab scoping: a relayed push for another tab changes nothing', async () => {
    const { store, port, request } = relayedStore();
    store.start();
    await flush();
    port.deliver({ tabId: TAB + 1, push: 'notifyPanelReload' });
    await flush();
    expect(request).toHaveBeenCalledOnce();
    expect(store.state().status).toBe('ready');
  });

  it('releases the port when the store stops (the panel unloads)', async () => {
    const { store, port } = relayedStore();
    store.start();
    await flush();
    store.stop();
    expect(port.disconnects).toBe(1);
    expect(port.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
  });
});
