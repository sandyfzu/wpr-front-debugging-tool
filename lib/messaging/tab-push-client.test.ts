import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger';
import { selectTabPushConnect, subscribeTabPushes } from './tab-push-client';
import { portDouble, type PortDouble } from './tab-push-port.fixtures';
import type { TabPushEnvelope } from './tab-pushes';

/** A logger double (no console noise; calls assertable). */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

/** Subscribe over a fresh port double, recording the deliveries. */
function subscribed(tabId = 7, onPush = vi.fn<(envelope: TabPushEnvelope) => void>()) {
  const port = portDouble();
  const log = logDouble();
  const connect = vi.fn((): PortDouble => port);
  const stop = subscribeTabPushes({ connect, tabId, onPush, log });
  return { port, log, connect, stop, onPush };
}

describe('selectTabPushConnect — who connects', () => {
  const connect = vi.fn(() => portDouble());

  it('never connects where the tabs API exists (Chromium: pushes arrive directly)', () => {
    expect(
      selectTabPushConnect({ tabs: { sendMessage: () => undefined }, runtime: { connect } })
    ).toBeNull();
  });

  it('connects through runtime.connect with the contract’s port name otherwise', () => {
    const runtime = { connect };
    const open = selectTabPushConnect({ runtime, devtools: {} });
    expect(open).not.toBeNull();
    open?.();
    expect(connect).toHaveBeenCalledWith({ name: 'tab-pushes' });
    // Called on its namespace (a detached call loses `this` on real bindings).
    expect(connect.mock.contexts[0]).toBe(runtime);
  });

  it('is null without a callable runtime.connect, or without an API object', () => {
    for (const api of [
      {},
      { runtime: {} },
      { runtime: null },
      { runtime: { connect: 1 } },
      null,
      'x'
    ]) {
      expect(selectTabPushConnect(api), JSON.stringify(api)).toBeNull();
    }
  });
});

describe('subscribeTabPushes — subscription', () => {
  it('subscribes the port to the inspected tab, exactly once', () => {
    const { port, connect } = subscribed(12);
    expect(connect).toHaveBeenCalledOnce();
    expect(port.posted).toEqual([{ tabId: 12 }]);
  });

  it('hands every valid envelope to the receiver, rebuilt by the contract', () => {
    const { port, onPush } = subscribed();
    port.deliver({ tabId: 7, push: 'notifyPanelReload' });
    port.deliver({ tabId: 7, push: 'allScriptsLoaded', data: true });
    port.deliver({ tabId: 7, push: 'undefinedReferencesUpdated', data: ['jQuery'] });
    expect(onPush.mock.calls.map(([envelope]) => envelope)).toEqual([
      { tabId: 7, push: 'notifyPanelReload' },
      { tabId: 7, push: 'allScriptsLoaded', data: true },
      { tabId: 7, push: 'undefinedReferencesUpdated', data: ['jQuery'] }
    ]);
  });

  it('drops (and warns about) an envelope that breaks the contract', () => {
    const { port, onPush, log } = subscribed();
    for (const message of [
      null,
      { tabId: 7, push: 'panelSearch', data: {} },
      { tabId: 7, push: 'allScriptsLoaded', data: 'yes' },
      { tabId: 7, push: 'notifyPanelReload', extra: 1 }
    ]) {
      port.deliver(message);
    }
    expect(onPush).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(4);
  });

  it('keeps listening after a receiver throws', () => {
    const onPush = vi.fn((): void => {
      throw new Error('receiver broke');
    });
    const { port, log } = subscribed(7, onPush);
    port.deliver({ tabId: 7, push: 'notifyPanelReload' });
    port.deliver({ tabId: 7, push: 'notifyPanelReload' });
    expect(onPush).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(port.listenerCounts()).toEqual({ message: 1, disconnect: 1 });
  });
});

describe('subscribeTabPushes — lifetime', () => {
  it('stop releases the listeners and closes the port, once', () => {
    const { port, stop, onPush } = subscribed();
    stop();
    stop();
    expect(port.disconnects).toBe(1);
    expect(port.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    port.deliver({ tabId: 7, push: 'notifyPanelReload' });
    expect(onPush).not.toHaveBeenCalled();
  });

  it('a far-side close releases the listeners, warns, and is not retried', () => {
    const { port, stop, connect, log } = subscribed();
    port.closeFromFarSide();
    expect(port.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    expect(log.warn).toHaveBeenCalledOnce();
    stop();
    expect(port.disconnects).toBe(0);
    expect(connect).toHaveBeenCalledOnce();
  });

  it('degrades to no live updates when the port cannot open', () => {
    const log = logDouble();
    const stop = subscribeTabPushes({
      connect: () => {
        throw new Error('Extension context invalidated.');
      },
      tabId: 7,
      onPush: vi.fn(),
      log
    });
    expect(log.warn).toHaveBeenCalledOnce();
    expect(() => {
      stop();
    }).not.toThrow();
  });

  it('closes the port when the subscription cannot be sent', () => {
    const port = portDouble();
    port.failPosts();
    const log = logDouble();
    const stop = subscribeTabPushes({ connect: () => port, tabId: 7, onPush: vi.fn(), log });
    expect(port.disconnects).toBe(1);
    expect(port.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    expect(log.warn).toHaveBeenCalledOnce();
    stop();
    expect(port.disconnects).toBe(1);
  });

  it('survives a port that throws on disconnect (the context is unloading)', () => {
    const { port, stop, log } = subscribed();
    port.disconnect = () => {
      throw new Error('gone');
    };
    expect(() => {
      stop();
    }).not.toThrow();
    expect(log.debug).toHaveBeenCalledOnce();
  });
});
