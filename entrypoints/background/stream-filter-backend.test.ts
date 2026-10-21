/**
 * The streaming-filter row's wiring over the fake browser: feature
 * detection, the two blocking top-level hooks (filter, extra info), their
 * hand-off to the backend and their isolation. The backend itself is pinned
 * in `lib/exclusion-session/stream-backend.test.ts`. The fake browser cannot
 * fire `webRequest` events, so the registered listeners are captured.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InterceptionHost } from '../../lib/exclusion-session/backend';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import { STREAM_FILTER_BACKEND } from './stream-filter-backend';

type Hook = (details: unknown) => unknown;

const HOST: InterceptionHost = {
  shouldIntercept: () => Promise.resolve(true),
  rewriteDocument: () => Promise.resolve(null),
  documentBodyUnavailable: () => Promise.resolve(),
  interceptionEnded: () => Promise.resolve()
};

/** Capture the two hooks the row registers; stub the filter API. */
function wire(filterResponseData: (id: string) => unknown) {
  const registered: { hook: Hook; filter: unknown; extra: unknown }[] = [];
  const capture = (hook: Hook, filter: unknown, extra: unknown): void => {
    registered.push({ hook, filter, extra });
  };
  vi.spyOn(browser.webRequest.onBeforeRequest, 'addListener').mockImplementation(capture as never);
  vi.spyOn(browser.webRequest.onHeadersReceived, 'addListener').mockImplementation(
    capture as never
  );
  Object.assign(browser.webRequest, { filterResponseData });
  const backend = STREAM_FILTER_BACKEND.create(HOST);
  return { backend, registered };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (browser.webRequest as { filterResponseData?: unknown }).filterResponseData;
});

describe('stream-filter row', () => {
  it('is selected only where webRequest exposes filterResponseData', () => {
    expect(STREAM_FILTER_BACKEND.isSupported()).toBe(false);
    Object.assign(browser.webRequest, { filterResponseData: () => null });
    expect(STREAM_FILTER_BACKEND.isSupported()).toBe(true);
  });

  it('registers both hooks blocking over top-level documents of every web host', () => {
    const { registered } = wire(() => null);
    const filter = { urls: [...URL_PATTERNS], types: ['main_frame'] };
    expect(registered.map(({ filter: f, extra }) => [f, extra])).toEqual([
      [filter, ['blocking']],
      [filter, ['blocking', 'responseHeaders']]
    ]);
  });

  it('hands armed requests to the filter API and returns no blocking response', async () => {
    const opened: string[] = [];
    const { backend, registered } = wire((id) => {
      opened.push(id);
      return {};
    });
    await backend.arm(3, 1);
    const [request, headers] = registered;
    expect(request?.hook({ requestId: 'r', tabId: 3, url: 'https://a.test/' })).toBeUndefined();
    expect(opened).toEqual(['r']);
    expect(
      headers?.hook({ requestId: 'r', tabId: 3, statusCode: 200, method: 'GET' })
    ).toBeUndefined();
  });

  it('isolates a failing hook (logged, never thrown into the request)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { backend, registered } = wire(() => null);
    await backend.arm(3, 1);
    const [request, headers] = registered;
    // A null "filter" makes wiring the callbacks throw inside the hook.
    expect(() => request?.hook({ requestId: 'r', tabId: 3, url: 'https://a.test/' })).not.toThrow();
    expect(() => headers?.hook(null)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('runs the engine through the worker runner where a Worker exists', () => {
    const { backend } = wire(() => null);
    expect(typeof Worker === 'function' ? typeof backend.runner : 'undefined').toBe(
      typeof Worker === 'function' ? 'function' : 'undefined'
    );
  });
});
