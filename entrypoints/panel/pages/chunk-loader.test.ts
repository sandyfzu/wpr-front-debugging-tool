/**
 * The chunk loader and its mount: one fetch reused, a failed fetch
 * forgotten (the next use fetches again), the early fetch's failure kept
 * quiet, and a mount that shows a loaded pick at once, a landed fetch
 * (around the caller's hook) or a logged failure.
 */
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createChunkLoader, mountChunk } from './chunk-loader';

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

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

describe('mountChunk', () => {
  it('shows an already loaded pick at once, without fetching again', async () => {
    const load = vi.fn(() => Promise.resolve('pick'));
    const chunk = createChunkLoader(load, null);
    await chunk.fetch();
    createRoot((dispose) => {
      const mount = mountChunk(chunk, { failureMessage: 'x' });
      expect(mount.body()).toBe('pick');
      expect(mount.failed()).toBe(false);
      dispose();
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows the landed pick through the caller’s hook', async () => {
    const chunk = createChunkLoader(() => Promise.resolve('pick'), null);
    const seen: (string | null)[] = [];
    const mount = createRoot(() =>
      mountChunk(chunk, {
        failureMessage: 'x',
        onLoad: (pick, show) => {
          seen.push(mount.body());
          show();
          seen.push(mount.body(), pick);
        }
      })
    );
    expect(mount.body()).toBeNull();
    await settle();
    expect(seen).toEqual([null, 'pick', 'pick']);
  });

  it('shows a failed fetch as failed and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const chunk = createChunkLoader(() => Promise.reject(new Error('offline')), null);
    const mount = createRoot(() => mountChunk(chunk, { failureMessage: 'Loading X failed' }));
    await settle();
    expect(mount.failed()).toBe(true);
    expect(mount.body()).toBeNull();
    expect(error.mock.calls.flat().join(' ')).toContain('Loading X failed');
    error.mockRestore();
  });
});
