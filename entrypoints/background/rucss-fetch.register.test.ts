/**
 * The production wiring of the RUCSS service requests: the registered
 * channel answers with the production deps (the global `fetch`, the real
 * clock and timeout signal), and a tab closing mid-request cancels it. The
 * messenger is a double that captures the handler; `fetch` is stubbed.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUCSS_ENDPOINT } from '../../lib/rucss-tester/endpoint';

const messenger = vi.hoisted(() => ({
  handlers: new Map<string, (message: { sender: unknown; data: unknown }) => unknown>()
}));

vi.mock('../../lib/messaging', () => ({
  onMessage: (
    type: string,
    handler: (message: { sender: unknown; data: unknown }) => unknown
  ): (() => void) => {
    messenger.handlers.set(type, handler);
    return vi.fn();
  }
}));

const { registerRucssFetch } = await import('./rucss-fetch');

const SENDER = { tab: { id: 7 }, frameId: 0, url: 'https://site.test/p' };
const REQUEST = { pageUrl: 'https://site.test/p', safelist: [], mobile: false, home: false };

/** The registered handler, asked as the messenger would. */
function ask(sender: unknown = SENDER): Promise<unknown> {
  const handler = messenger.handlers.get('fetchRucssShakenCss');
  if (handler === undefined) throw new Error('fetchRucssShakenCss is not registered');
  return Promise.resolve(handler({ sender, data: REQUEST }));
}

beforeEach(() => {
  fakeBrowser.reset();
  messenger.handlers.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerRucssFetch', () => {
  it('answers the channel through the global fetch, budgeted by a live signal', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response('{"code":200,"contents":{"shakedCSS":"a{}"}}'))
    );
    vi.stubGlobal('fetch', fetch);
    registerRucssFetch();
    await expect(ask()).resolves.toMatchObject({
      kind: 'answered',
      outcome: { ok: true, shakenCss: 'a{}' }
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url?.startsWith(`${RUCSS_ENDPOINT}?url=https://site.test/p?`)).toBe(true);
    // The real clock: the seconds are now's, not a fixed value.
    const seconds = Number(/\?(\d+)$/.exec(url ?? '')?.[1]);
    expect(Math.abs(seconds - Date.now() / 1000)).toBeLessThan(5);
    expect(init?.signal?.aborted).toBe(false);
  });

  it('cancels a request when its tab closes (`cancelled`), leaving other tabs’ alone', async () => {
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        })
    );
    vi.stubGlobal('fetch', fetch);
    registerRucssFetch();
    const closing = ask();
    const other = ask({ ...SENDER, tab: { id: 8 } });
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    await fakeBrowser.tabs.onRemoved.trigger(7, { windowId: 1, isWindowClosing: false });
    await expect(closing).resolves.toMatchObject({
      kind: 'answered',
      outcome: { ok: false, failure: { kind: 'cancelled' } }
    });
    const otherInit = fetch.mock.calls[1]?.[1];
    expect(otherInit?.signal?.aborted).toBe(false);
    await fakeBrowser.tabs.onRemoved.trigger(8, { windowId: 1, isWindowClosing: true });
    await expect(other).resolves.toMatchObject({
      outcome: { ok: false, failure: { kind: 'cancelled' } }
    });
  });
});
