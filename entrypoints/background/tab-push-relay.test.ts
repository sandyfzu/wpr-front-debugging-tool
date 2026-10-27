import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import type { LooseMessageSender } from '../../lib/messaging/sender';
import { portDouble, type PortDouble } from '../../lib/messaging/tab-push-port.fixtures';

const { onMessage } = vi.hoisted(() => ({ onMessage: vi.fn() }));
vi.mock('../../lib/messaging', () => ({ onMessage }));

const { createTabPushRelay, registerTabPushRelay } = await import('./tab-push-relay');
type Forward = Parameters<Parameters<typeof createTabPushRelay>[0]['listen']>[0];

const ID = 'own-extension-id';
const ROOT = 'moz-extension://5f1d2c3b-aaaa-bbbb-cccc-123456789abc/';
/** The observed Firefox 158 panel port sender (no tab, our id, our page). */
const PANEL: LooseMessageSender = { id: ID, url: `${ROOT}panel.html` };
/** A top-frame content-script sender in tab `tabId`. */
const page = (tabId: number, frameId = 0): LooseMessageSender => ({
  id: ID,
  tab: { id: tabId },
  frameId,
  url: 'https://site.test/post/'
});

/** A logger double (no console noise; calls assertable). */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

/** A relay over a recording `listen` double. */
function relayWorld() {
  let forward: Forward | null = null;
  const stop = vi.fn(() => {
    forward = null;
  });
  const listen = vi.fn((given: Forward) => {
    forward = given;
    return stop;
  });
  const log = logDouble();
  const relay = createTabPushRelay({ extensionId: ID, extensionRootUrl: ROOT, listen, log });
  /** A push arriving from `sender` (no-op while nothing listens — as the runtime). */
  const push = (
    name: Parameters<Forward>[0],
    sender: LooseMessageSender | undefined,
    data?: unknown
  ): void => {
    forward?.(name, sender, data);
  };
  /** Connect and subscribe one panel port to `tabId`. */
  const panel = (tabId: number, sender: LooseMessageSender = PANEL): PortDouble => {
    const port = portDouble({ sender });
    relay.accept(port);
    port.deliver({ tabId });
    return port;
  };
  return { relay, listen, stop, log, push, panel };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the port gate', () => {
  it('admits our own tab-less panel page and subscribes it', () => {
    const w = relayWorld();
    const port = w.panel(4);
    expect(port.disconnects).toBe(0);
    expect(w.relay.subscriberCount()).toBe(1);
  });

  it('refuses (and closes) a content-script sender, a foreign extension and a foreign page', () => {
    for (const sender of [
      page(4),
      { ...PANEL, tab: { id: 4 } },
      { ...PANEL, id: 'other-extension' },
      { id: ID, url: 'moz-extension://00000000-0000-0000-0000-000000000000/panel.html' },
      { id: ID, url: 'https://site.test/panel.html' },
      { id: ID },
      undefined
    ]) {
      const w = relayWorld();
      const port = portDouble(sender === undefined ? {} : { sender });
      w.relay.accept(port);
      port.deliver({ tabId: 4 });
      expect(port.disconnects, JSON.stringify(sender)).toBe(1);
      expect(port.listenerCounts(), JSON.stringify(sender)).toEqual({ message: 0, disconnect: 0 });
      expect(w.relay.subscriberCount()).toBe(0);
      expect(w.listen).not.toHaveBeenCalled();
      expect(w.log.warn).toHaveBeenCalledOnce();
    }
  });

  it('leaves ports of any other name alone', () => {
    const w = relayWorld();
    const port = portDouble({ name: 'something-else', sender: PANEL });
    w.relay.accept(port);
    expect(port.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    expect(port.disconnects).toBe(0);
    expect(w.log.warn).not.toHaveBeenCalled();
  });

  it('closes a port on a malformed subscription', () => {
    for (const message of [null, { tabId: -1 }, { tabId: '4' }, { tabId: 4, extra: 1 }]) {
      const w = relayWorld();
      const port = portDouble({ sender: PANEL });
      w.relay.accept(port);
      port.deliver(message);
      expect(port.disconnects, JSON.stringify(message)).toBe(1);
      expect(w.relay.subscriberCount()).toBe(0);
      expect(w.listen).not.toHaveBeenCalled();
    }
  });

  it('closes (and unsubscribes) a port that subscribes twice', () => {
    const w = relayWorld();
    const port = w.panel(4);
    port.deliver({ tabId: 5 });
    expect(port.disconnects).toBe(1);
    expect(port.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    expect(w.relay.subscriberCount()).toBe(0);
    expect(w.relay.isListening()).toBe(false);
  });
});

describe('forwarding', () => {
  it('re-sends each of the three pushes to the tab’s subscribers, as envelopes', () => {
    const w = relayWorld();
    const port = w.panel(4);
    w.push('notifyPanelReload', page(4));
    w.push('allScriptsLoaded', page(4), true);
    w.push('undefinedReferencesUpdated', page(4), ['jQuery']);
    expect(port.posted).toEqual([
      { tabId: 4, push: 'notifyPanelReload' },
      { tabId: 4, push: 'allScriptsLoaded', data: true },
      { tabId: 4, push: 'undefinedReferencesUpdated', data: ['jQuery'] }
    ]);
  });

  it('reaches only the pushing tab’s subscribers (every one of them)', () => {
    const w = relayWorld();
    const first = w.panel(4);
    const second = w.panel(4);
    const other = w.panel(9);
    w.push('notifyPanelReload', page(4));
    expect(first.posted).toHaveLength(1);
    expect(second.posted).toHaveLength(1);
    expect(other.posted).toHaveLength(0);
  });

  it('relays only a top-frame content script (never a subframe, a page-less or tab-less sender)', () => {
    const w = relayWorld();
    const port = w.panel(4);
    for (const sender of [
      page(4, 3),
      { ...page(4), frameId: undefined },
      { ...page(4), url: 'moz-extension://x/panel.html' },
      PANEL,
      { tab: { id: '4' }, frameId: 0, url: 'https://site.test/' },
      undefined
    ]) {
      w.push('notifyPanelReload', sender);
    }
    expect(port.posted).toHaveLength(0);
    // The same push from the top frame does pass (the gate, not the plumbing, refused).
    w.push('notifyPanelReload', page(4));
    expect(port.posted).toHaveLength(1);
  });

  it('refuses a payload the contract refuses (warned, never forwarded)', () => {
    const w = relayWorld();
    const port = w.panel(4);
    w.push('allScriptsLoaded', page(4), 'yes');
    w.push('undefinedReferencesUpdated', page(4), [1]);
    w.push('notifyPanelReload', page(4), { forged: true });
    expect(port.posted).toHaveLength(0);
    expect(w.log.warn).toHaveBeenCalledTimes(3);
  });

  it('drops a port whose send throws, keeping its siblings', () => {
    const w = relayWorld();
    const dead = w.panel(4);
    const live = w.panel(4);
    dead.failPosts();
    w.push('notifyPanelReload', page(4));
    expect(live.posted).toHaveLength(1);
    expect(w.relay.subscriberCount()).toBe(1);
  });
});

describe('lifetime — lazy listeners, no leaks', () => {
  it('registers the push listeners on the first subscription only, once', () => {
    const w = relayWorld();
    expect(w.relay.isListening()).toBe(false);
    const port = portDouble({ sender: PANEL });
    w.relay.accept(port);
    // Connected but not yet subscribed: still nothing registered.
    expect(w.listen).not.toHaveBeenCalled();
    port.deliver({ tabId: 4 });
    w.panel(4);
    w.panel(9);
    expect(w.listen).toHaveBeenCalledOnce();
    expect(w.relay.isListening()).toBe(true);
  });

  it('unregisters when the last subscriber disconnects (DevTools closed), and re-registers on reopen', () => {
    const w = relayWorld();
    const first = w.panel(4);
    const second = w.panel(9);
    first.closeFromFarSide();
    expect(w.relay.subscriberCount()).toBe(1);
    expect(w.stop).not.toHaveBeenCalled();
    second.closeFromFarSide();
    expect(w.relay.subscriberCount()).toBe(0);
    expect(w.stop).toHaveBeenCalledOnce();
    expect(w.relay.isListening()).toBe(false);
    for (const port of [first, second]) {
      expect(port.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    }
    const reopened = w.panel(4);
    expect(w.listen).toHaveBeenCalledTimes(2);
    w.push('notifyPanelReload', page(4));
    expect(reopened.posted).toEqual([{ tabId: 4, push: 'notifyPanelReload' }]);
    expect(first.posted).toHaveLength(0);
  });

  it('a connected-then-closed port that never subscribed leaves nothing behind', () => {
    const w = relayWorld();
    const port = portDouble({ sender: PANEL });
    w.relay.accept(port);
    port.closeFromFarSide();
    expect(port.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    expect(w.listen).not.toHaveBeenCalled();
  });

  it('keeps a subscription across the inspected page’s navigations (same tab, same port)', () => {
    const w = relayWorld();
    const port = w.panel(4);
    w.push('notifyPanelReload', page(4));
    w.push('notifyPanelReload', { ...page(4), url: 'https://site.test/other/' });
    expect(port.posted).toHaveLength(2);
  });
});

describe('registerTabPushRelay — production wiring', () => {
  /** The background's `onConnect` registration, captured. */
  function stubRuntime() {
    vi.spyOn(browser.runtime, 'getURL').mockImplementation(
      (path: string) => `${ROOT}${path.replace(/^\//, '')}`
    );
    vi.spyOn(browser.runtime, 'id', 'get').mockReturnValue(ID);
    return {
      addListener: vi
        .spyOn(browser.runtime.onConnect, 'addListener')
        .mockImplementation(() => undefined)
    };
  }

  it('registers no push listener at boot — Chromium (never subscribing) keeps its no-receiver pushes', () => {
    onMessage.mockClear();
    const onConnect = stubRuntime();
    registerTabPushRelay();
    expect(onConnect.addListener).toHaveBeenCalledOnce();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('registers the three push channels on the first subscription, answering true, and drops them after', () => {
    onMessage.mockClear();
    const removers = [vi.fn(), vi.fn(), vi.fn()];
    let next = 0;
    onMessage.mockImplementation(() => removers[next++]);
    const onConnect = stubRuntime();
    registerTabPushRelay();
    const accept = onConnect.addListener.mock.calls[0]?.[0] as unknown as (
      port: PortDouble
    ) => void;
    const port = portDouble({ sender: PANEL });
    accept(port);
    port.deliver({ tabId: 4 });
    expect(onMessage.mock.calls.map(([channel]) => channel as string)).toEqual([
      'notifyPanelReload',
      'allScriptsLoaded',
      'undefinedReferencesUpdated'
    ]);
    const handlers = onMessage.mock.calls.map(
      ([, handler]) => handler as (message: { sender: unknown; data: unknown }) => unknown
    );
    expect(handlers[0]?.({ sender: page(4), data: undefined })).toBe(true);
    expect(handlers[1]?.({ sender: page(4), data: true })).toBe(true);
    expect(handlers[2]?.({ sender: page(4), data: ['w'] })).toBe(true);
    expect(port.posted).toEqual([
      { tabId: 4, push: 'notifyPanelReload' },
      { tabId: 4, push: 'allScriptsLoaded', data: true },
      { tabId: 4, push: 'undefinedReferencesUpdated', data: ['w'] }
    ]);
    port.closeFromFarSide();
    for (const remove of removers) expect(remove).toHaveBeenCalledOnce();
  });

  it('keeps the port listener alive when one port’s handling throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onConnect = stubRuntime();
    registerTabPushRelay();
    const accept = onConnect.addListener.mock.calls[0]?.[0] as (port: unknown) => void;
    expect(() => {
      accept({
        name: 'tab-pushes',
        sender: PANEL,
        get onMessage(): never {
          throw new Error('broken port');
        }
      });
    }).not.toThrow();
  });
});
