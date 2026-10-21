/**
 * The streaming-filter row's wiring over the fake browser: feature
 * detection, the four top-level hooks (filter, extra info), their
 * hand-off to the backend and their isolation. The backend itself is pinned
 * in `lib/exclusion-session/stream-backend.test.ts`. The fake browser cannot
 * fire `webRequest` events, so the registered listeners are captured.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InterceptionHost } from '../../lib/exclusion-session/backend';
import type { StreamInterceptionBackend } from '../../lib/exclusion-session/stream-backend';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import { STREAM_FILTER_BACKEND } from './stream-filter-backend';

type Hook = (details: unknown) => unknown;

const HOST: InterceptionHost = {
  shouldIntercept: () => Promise.resolve(true),
  rewriteDocument: () => Promise.resolve(null),
  documentBodyUnavailable: () => Promise.resolve(),
  documentNotServed: () => Promise.resolve(),
  interceptionEnded: () => Promise.resolve()
};

/** Capture the four hooks the row registers; stub the filter API. */
function wire(filterResponseData: (id: string) => unknown) {
  const registered: { hook: Hook; filter: unknown; extra: unknown }[] = [];
  const capture = (hook: Hook, filter: unknown, extra: unknown): void => {
    registered.push({ hook, filter, extra });
  };
  vi.spyOn(browser.webRequest.onBeforeRequest, 'addListener').mockImplementation(capture as never);
  vi.spyOn(browser.webRequest.onHeadersReceived, 'addListener').mockImplementation(
    capture as never
  );
  vi.spyOn(browser.webRequest.onErrorOccurred, 'addListener').mockImplementation(capture as never);
  vi.spyOn(browser.webRequest.onCompleted, 'addListener').mockImplementation(capture as never);
  Object.assign(browser.webRequest, { filterResponseData });
  // The row's backend is the streaming one (its hooks' target).
  const backend = STREAM_FILTER_BACKEND.create(HOST) as StreamInterceptionBackend;
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

  it('registers the request and headers hooks blocking, the error and completion hooks not, over top-level documents', () => {
    const { registered } = wire(() => null);
    const filter = { urls: [...URL_PATTERNS], types: ['main_frame'] };
    expect(registered.map(({ filter: f, extra }) => [f, extra])).toEqual([
      [filter, ['blocking']],
      [filter, ['blocking', 'responseHeaders']],
      [filter, undefined],
      [filter, undefined]
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
    expect(backend.inFlight()).toEqual(['r']);
    registered[3]?.hook({ requestId: 'r', tabId: 3 });
    expect(backend.inFlight()).toEqual(['r']);
    registered[2]?.hook({ requestId: 'r', tabId: 3, error: 'NS_BINDING_ABORTED' });
    expect(backend.inFlight()).toEqual([]);
  });

  it('isolates a failing hook (logged, never thrown into the request)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { backend, registered } = wire(() => null);
    await backend.arm(3, 1);
    const [request, headers, failure, completion] = registered;
    // A null "filter" makes wiring the callbacks throw inside the hook.
    expect(() => request?.hook({ requestId: 'r', tabId: 3, url: 'https://a.test/' })).not.toThrow();
    expect(() => headers?.hook(null)).not.toThrow();
    expect(() => failure?.hook(null)).not.toThrow();
    expect(() => completion?.hook(null)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(4);
  });

  it('runs the engine through the worker runner where a Worker exists', () => {
    const { backend } = wire(() => null);
    expect(typeof Worker === 'function' ? typeof backend.runner : 'undefined').toBe(
      typeof Worker === 'function' ? 'function' : 'undefined'
    );
  });
});
