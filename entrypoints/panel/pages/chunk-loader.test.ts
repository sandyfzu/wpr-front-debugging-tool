/**
 * The panel's chunk mount: shows a loaded pick at once, a landed fetch
 * (around the caller's hook) or a logged failure.
 */
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createChunkLoader } from '../../../utils/chunk-loader';
import { mountChunk } from './chunk-loader';

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

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
