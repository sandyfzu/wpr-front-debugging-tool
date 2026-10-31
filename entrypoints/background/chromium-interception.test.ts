/**
 * The debugger port binding over stub APIs: each port method reaches the
 * right browser call, page-target lookup, tab presence (web / elsewhere /
 * gone), guarded listeners; and the registry row's detection + creation.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import type { InterceptionHost } from '../../lib/exclusion-session/backend';
import {
  CHROMIUM_INTERCEPTION_ROW,
  createBrowserDebuggerPort,
  hasDebuggerApi,
  type DebuggerApi,
  type TabsApi
} from './chromium-interception';

/** A logger recording its lines. */
function fakeLog(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const at = (level: string) => (message: string) => {
    lines.push(`${level}: ${message}`);
  };
  return { lines, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

/** A stub event: records its listener. */
function stubEvent<L>() {
  const listeners: L[] = [];
  return { listeners, addListener: (listener: L) => listeners.push(listener) };
}

/** Stub debugger + tabs APIs. */
function stubs(tab: { url?: string; pendingUrl?: string } | Error = { url: 'https://site.test/' }) {
  const onEvent = stubEvent<(source: unknown, method: string, params?: object) => void>();
  const onDetach = stubEvent<(source: unknown, reason: string) => void>();
  const api = {
    attach: vi.fn(() => Promise.resolve()),
    detach: vi.fn(() => Promise.resolve()),
    sendCommand: vi.fn(() => Promise.resolve({ ok: true })),
    onEvent,
    onDetach
  };
  const tabs = {
    get: vi.fn(() => (tab instanceof Error ? Promise.reject(tab) : Promise.resolve(tab)))
  };
  return { api, tabs, onEvent, onDetach };
}

/** Bind a port over stubs. */
function bind(tab?: { url?: string; pendingUrl?: string } | Error) {
  const s = stubs(tab);
  const log = fakeLog();
  const port = createBrowserDebuggerPort(
    log,
    s.api as unknown as DebuggerApi,
    s.tabs as unknown as TabsApi
  );
  return { ...s, log, port };
}

describe('createBrowserDebuggerPort', () => {
  it('attaches at protocol 1.3, detaches and sends by target', async () => {
    const { api, port } = bind();
    await port.attach(1);
    await port.detach(1);
    await expect(
      port.send({ tabId: 1, sessionId: 's' }, 'Fetch.enable', { a: 1 })
    ).resolves.toEqual({ ok: true });
    expect(api.attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
    expect(api.detach).toHaveBeenCalledWith({ tabId: 1 });
    expect(api.sendCommand).toHaveBeenCalledWith({ tabId: 1, sessionId: 's' }, 'Fetch.enable', {
      a: 1
    });
  });

  it('reads a tab as web, elsewhere, or gone', async () => {
    await expect(bind({ url: 'http://site.test/x' }).port.tabPresence(1)).resolves.toBe('web');
    await expect(bind({}).port.tabPresence(1)).resolves.toBe('elsewhere');
    await expect(bind({ url: 'about:blank' }).port.tabPresence(1)).resolves.toBe('elsewhere');
    await expect(
      bind({ url: 'https://chromewebstore.google.com/detail/x' }).port.tabPresence(1)
    ).resolves.toBe('elsewhere');
    // A navigation not committed yet: the page it is going to decides.
    await expect(
      bind({
        url: 'https://site.test/',
        pendingUrl: 'https://chromewebstore.google.com/'
      }).port.tabPresence(1)
    ).resolves.toBe('elsewhere');
    await expect(
      bind({ url: 'https://site.test/', pendingUrl: 'https://other.test/' }).port.tabPresence(1)
    ).resolves.toBe('web');
    await expect(bind(new Error('No tab with id: 1')).port.tabPresence(1)).resolves.toBe('gone');
  });

  it('registers guarded listeners that forward to the handlers', () => {
    const { port, onEvent, onDetach, log } = bind();
    const event = vi.fn(() => {
      throw new Error('handler broke');
    });
    const detach = vi.fn(() => {
      throw new Error('handler broke');
    });
    port.listen({ event, detach });
    expect(() =>
      onEvent.listeners[0]?.({ tabId: 1 }, 'Fetch.requestPaused', { a: 1 })
    ).not.toThrow();
    expect(() => onDetach.listeners[0]?.({ tabId: 1 }, 'target_closed')).not.toThrow();
    expect(event).toHaveBeenCalledWith({ tabId: 1 }, 'Fetch.requestPaused', { a: 1 });
    expect(detach).toHaveBeenCalledWith({ tabId: 1 }, 'target_closed');
    expect(log.lines).toEqual([
      'error: Debugger event handler failed',
      'error: Debugger detach handler failed'
    ]);
  });
});

describe('CHROMIUM_INTERCEPTION_ROW', () => {
  it('detects the debugger API by feature', () => {
    expect(CHROMIUM_INTERCEPTION_ROW.id).toBe('chromium-debugger');
    expect(CHROMIUM_INTERCEPTION_ROW.isSupported()).toBe(true);
    expect(hasDebuggerApi()).toBe('debugger' in browser);
  });

  it('creates a backend wired to the browser debugger API', () => {
    // The fake browser leaves the debugger events unimplemented.
    const onEvent = vi.spyOn(browser.debugger.onEvent, 'addListener').mockImplementation(() => {});
    const onDetach = vi
      .spyOn(browser.debugger.onDetach, 'addListener')
      .mockImplementation(() => {});
    const host = {} as InterceptionHost;
    const backend = CHROMIUM_INTERCEPTION_ROW.create(host);
    expect(typeof backend.arm).toBe('function');
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onDetach).toHaveBeenCalledTimes(1);
  });
});
