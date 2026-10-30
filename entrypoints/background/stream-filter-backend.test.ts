/**
 * The streaming-filter row's wiring over the fake browser: feature
 * detection, the four top-level hooks (filter, extra info), their
 * hand-off to the backend and their isolation, and the simulated-runtime
 * hook (held per tab only while its session simulates LazyLoad; filter,
 * extra info, its hand-off to the host). The backend itself is pinned
 * in `lib/exclusion-session/stream-backend.test.ts`. The fake browser cannot
 * fire `webRequest` events, so the registered listeners are captured.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InterceptionHost } from '../../lib/exclusion-session/backend';
import type { StreamInterceptionBackend } from '../../lib/exclusion-session/stream-backend';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import { STREAM_FILTER_BACKEND } from './stream-filter-backend';

type Hook = (details: unknown) => unknown;

/** The packaged runtime the host names for {@link RUNTIME_URL} in tab 3. */
const PACKAGED = 'moz-extension://id/wp-rocket-simulation/lazyload/17.8.3/lazyload.min.js';
const RUNTIME_URL =
  'https://a.test/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js';
/** The simulated page requesting {@link RUNTIME_URL}. */
const PAGE_URL = 'https://a.test/post';
/** The runtime hook's URL filter. */
const RUNTIME_URLS = ['https://*/*/lazyload.min.js', 'http://*/*/lazyload.min.js'];

const HOST: InterceptionHost = {
  shouldIntercept: () => Promise.resolve({ rewriteBoundMs: 1 }),
  rewriteDocument: () => Promise.resolve(null),
  documentBodyUnavailable: () => Promise.resolve(),
  documentNotServed: () => Promise.resolve(),
  interceptionEnded: () => Promise.resolve(),
  simulatedRuntime: (tabId, url, documentUrl) =>
    Promise.resolve(
      tabId === 3 && url === RUNTIME_URL && documentUrl === PAGE_URL
        ? { url: PACKAGED, bytes: new Uint8Array([1]) }
        : null
    )
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
  const removed: Hook[] = [];
  vi.spyOn(browser.webRequest.onBeforeRequest, 'removeListener').mockImplementation(((
    hook: Hook
  ) => {
    removed.push(hook);
  }) as never);
  Object.assign(browser.webRequest, { filterResponseData });
  // The row's backend is the streaming one (its hooks' target).
  const backend = STREAM_FILTER_BACKEND.create(HOST) as StreamInterceptionBackend;
  return { backend, registered, removed };
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

  it('holds the runtime hook only on a tab armed for a LazyLoad simulation, filtered to it', async () => {
    const { backend, registered, removed } = wire(() => null);
    await backend.arm(4, 1, 'https://a.test');
    await backend.arm(5, 1, 'https://a.test', { features: ['delay_js'] });
    expect(registered).toHaveLength(4);
    await backend.arm(3, 1, 'https://a.test', { features: ['lazyload'] });
    expect(registered.slice(4).map(({ filter, extra }) => [filter, extra])).toEqual([
      [{ urls: RUNTIME_URLS, types: ['script'], tabId: 3 }, ['blocking']]
    ]);
    // Re-arming keeps the one hook; disarming drops it.
    await backend.arm(3, 2, 'https://a.test', { features: ['lazyload'] });
    expect(registered).toHaveLength(5);
    await backend.disarm(3);
    expect(removed).toEqual([registered[4]?.hook]);
  });

  it('drops the hook when a re-apply no longer simulates LazyLoad, and holds none on a stale resume', async () => {
    const { backend, registered, removed } = wire(() => null);
    await backend.arm(3, 1, 'https://a.test', { features: ['lazyload'] });
    await backend.arm(3, 2, 'https://a.test', { features: ['defer_all_js'] });
    expect(removed).toEqual([registered[4]?.hook]);
    // A restarted background resumes nothing: no hook comes back.
    await expect(backend.resume(6, 1, 'https://a.test', { features: ['lazyload'] })).resolves.toBe(
      false
    );
    expect(registered).toHaveLength(5);
  });

  it('redirects a top-frame request of the simulated page the host names, leaves the rest', async () => {
    const { backend, registered } = wire(() => null);
    await backend.arm(3, 1, 'https://a.test', { features: ['lazyload'] });
    const runtime = registered[4]?.hook;
    const request = { tabId: 3, frameId: 0, url: RUNTIME_URL, documentUrl: PAGE_URL };
    expect(await runtime?.(request)).toEqual({ redirectUrl: PACKAGED });
    expect(await runtime?.({ ...request, url: `${RUNTIME_URL}x` })).toEqual({});
    expect(await runtime?.({ ...request, documentUrl: 'https://b.test/post' })).toEqual({});
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
