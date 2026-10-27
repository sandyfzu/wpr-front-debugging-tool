/**
 * The relay over the real `@webext-core/messaging` (4.0.0) and a runtime
 * double that dispatches like the platform: a send no listener answers
 * asynchronously fails with "Could not establish connection". Pins the
 * lazy-registration claim end to end — while no panel is subscribed (every
 * Chromium session), the background does not answer the pushes, even with
 * its messenger's root listener installed for its other channels.
 */
import { defineExtensionMessaging } from '@webext-core/messaging';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProtocolMap } from '../../lib/messaging/protocol';
import { portDouble } from '../../lib/messaging/tab-push-port.fixtures';

vi.mock('../../lib/messaging', async () => {
  const { defineExtensionMessaging: define } = await import('@webext-core/messaging');
  const messenger = define<ProtocolMap>();
  return { onMessage: messenger.onMessage, sendMessage: messenger.sendMessage };
});

const { onMessage: backgroundOnMessage } = await import('../../lib/messaging');
const { registerTabPushRelay } = await import('./tab-push-relay');

const ID = 'own-extension-id';
const ROOT = 'moz-extension://5f1d2c3b-aaaa-bbbb-cccc-123456789abc/';
/** The content script's sender as the runtime reports it to the background. */
const CONTENT_SCRIPT = { id: ID, tab: { id: 4 }, frameId: 0, url: 'https://site.test/' };

type Listener = (message: unknown, sender: unknown, respond: (r: unknown) => void) => unknown;

/** A runtime double dispatching `sendMessage` to its `onMessage` listeners. */
function runtimeDouble() {
  const listeners = new Set<Listener>();
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    onMessage: {
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener)
    },
    sendMessage(message: unknown, callback: (response: unknown) => void): void {
      let pending = false;
      const state = { answered: false };
      const respond = (response: unknown): void => {
        if (state.answered) return;
        state.answered = true;
        queueMicrotask(() => {
          callback(response);
        });
      };
      for (const listener of listeners) {
        if (listener(message, CONTENT_SCRIPT, respond) === true) pending = true;
      }
      if (pending || state.answered) return;
      runtime.lastError = {
        message: 'Could not establish connection. Receiving end does not exist.'
      };
      callback(undefined);
      runtime.lastError = undefined;
    }
  };
  return runtime;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lazy push listeners over the real messenger', () => {
  it('leaves the pushes unanswered until a panel subscribes, and again after it leaves', async () => {
    vi.stubGlobal('chrome', { runtime: runtimeDouble() });
    vi.spyOn(browser.runtime, 'id', 'get').mockReturnValue(ID);
    vi.spyOn(browser.runtime, 'getURL').mockReturnValue(ROOT);
    const connect = vi
      .spyOn(browser.runtime.onConnect, 'addListener')
      .mockImplementation(() => undefined);
    // The background's other channels: its messenger's root listener is live.
    const removeOther = backgroundOnMessage('getKnownConflictsDb', () => []);
    registerTabPushRelay();
    const page = defineExtensionMessaging<ProtocolMap>();
    const miss = /Could not establish connection/;

    await expect(page.sendMessage('notifyPanelReload')).rejects.toThrow(miss);
    await expect(page.sendMessage('allScriptsLoaded', true)).rejects.toThrow(miss);

    const accept = connect.mock.calls[0]?.[0] as (port: unknown) => void;
    const port = portDouble({ sender: { id: ID, url: `${ROOT}panel.html` } });
    accept(port);
    port.deliver({ tabId: 4 });
    await expect(page.sendMessage('notifyPanelReload')).resolves.toBe(true);
    await expect(page.sendMessage('undefinedReferencesUpdated', ['w'])).resolves.toBe(true);
    expect(port.posted).toEqual([
      { tabId: 4, push: 'notifyPanelReload' },
      { tabId: 4, push: 'undefinedReferencesUpdated', data: ['w'] }
    ]);

    port.closeFromFarSide();
    await expect(page.sendMessage('notifyPanelReload')).rejects.toThrow(miss);
    await expect(page.sendMessage('getKnownConflictsDb')).resolves.toEqual([]);
    removeOther();
  });
});
