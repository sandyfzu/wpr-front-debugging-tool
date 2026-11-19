/**
 * The once-per-document chunk loader: one fetch reused, a failed fetch
 * forgotten (the next use fetches again), the early fetch's failure kept
 * quiet, and the idle-time early fetch where the browser has idle callbacks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChunkLoader, PREFETCH_IDLE_TIMEOUT_MS, prefetchWhenIdle } from './chunk-loader';

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createChunkLoader', () => {
  it('fetches once and reuses the pick', async () => {
    const load = vi.fn(() => Promise.resolve('pick'));
    const chunk = createChunkLoader(load, null);
    expect(chunk.loaded()).toBeNull();
    await Promise.all([chunk.fetch(), chunk.fetch()]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(chunk.loaded()).toBe('pick');
  });

  it('forgets a failed fetch, and a failed early fetch stays quiet', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('pick');
    let early: () => void = () => undefined;
    const chunk = createChunkLoader(load, (fetch) => (early = fetch));
    early();
    await settle();
    expect(chunk.loaded()).toBeNull();
    await expect(chunk.fetch()).resolves.toBe('pick');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('prefetchWhenIdle', () => {
  it('schedules the fetch at the first idle moment, bounded by the timeout', () => {
    const requestIdle = vi.fn();
    vi.stubGlobal('requestIdleCallback', requestIdle);
    const fetch = vi.fn();
    prefetchWhenIdle(fetch);
    expect(requestIdle).toHaveBeenCalledWith(fetch, { timeout: PREFETCH_IDLE_TIMEOUT_MS });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('schedules nothing without idle callbacks (the first use fetches)', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const fetch = vi.fn();
    expect(() => {
      prefetchWhenIdle(fetch);
    }).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
