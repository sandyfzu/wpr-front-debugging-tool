/**
 * The detail share store: the boot read (stored, missing, failed), the
 * default, preview vs commit (only commits persist), reset, the guard on bad
 * shares, a failed write kept for the session, and the shell-only hook.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../../../lib/logger';
import { DETAIL_PANE_DEFAULT_SHARE } from '../../../lib/panel/detail-layout';
import {
  bootDetailShare,
  createDetailShare,
  DetailShareContext,
  useDetailShare,
  type DetailShareStore
} from './detail-share';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A logger whose methods are traced mocks. */
function tracedLog(): {
  [level in keyof Logger]: Mock<(message: string, ...details: unknown[]) => void>;
} {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Let the writer's promise chain run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/**
 * A store in its own root.
 *
 * @param initial The boot share.
 * @param write The persistence double.
 */
function storeOf(
  initial: number | null,
  write: (share: number | null) => Promise<void>
): DetailShareStore {
  return createRoot(() => createDetailShare(initial, write));
}

describe('bootDetailShare', () => {
  it('resolves the stored share, or null when none is stored', async () => {
    const log = tracedLog();
    await expect(bootDetailShare(log, () => Promise.resolve(0.6))).resolves.toBe(0.6);
    await expect(bootDetailShare(log, () => Promise.resolve(null))).resolves.toBeNull();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('degrades a failed read to null with a warning naming the cause', async () => {
    const log = tracedLog();
    await expect(
      bootDetailShare(log, () => Promise.reject(new Error('Extension context invalidated')))
    ).resolves.toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('default width'), {
      cause: { message: 'Extension context invalidated' }
    });
  });
});

describe('createDetailShare', () => {
  it('starts on the stored share, else the default', () => {
    expect(storeOf(0.3, vi.fn()).share()).toBe(0.3);
    expect(storeOf(null, vi.fn()).share()).toBe(DETAIL_PANE_DEFAULT_SHARE);
  });

  it('previews without writing and persists only on commit', async () => {
    const write = vi.fn(() => Promise.resolve());
    const store = storeOf(null, write);
    store.preview(0.42);
    expect(store.share()).toBe(0.42);
    await flush();
    expect(write).not.toHaveBeenCalled();
    store.commit(0.44);
    expect(store.share()).toBe(0.44);
    await flush();
    expect(write).toHaveBeenCalledExactlyOnceWith(0.44);
  });

  it('collapses a burst of commits into the latest write', async () => {
    let release: () => void = () => undefined;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const store = storeOf(null, write);
    store.commit(0.4);
    await flush();
    store.commit(0.41);
    store.commit(0.42);
    release();
    await flush();
    expect(write.mock.calls).toEqual([[0.4], [0.42]]);
  });

  it('resets to the default and removes the stored share', async () => {
    const write = vi.fn(() => Promise.resolve());
    const store = storeOf(0.7, write);
    store.reset();
    expect(store.share()).toBe(DETAIL_PANE_DEFAULT_SHARE);
    await flush();
    expect(write).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('keeps a committed share for the session when the write fails (logged)', async () => {
    const write = vi.fn(() => Promise.reject(new Error('quota')));
    const store = storeOf(null, write);
    store.commit(0.65);
    await flush();
    expect(store.share()).toBe(0.65);
  });

  it('refuses shares outside (0, 1) naming the method', () => {
    const store = storeOf(null, vi.fn());
    expect(() => {
      store.preview(0);
    }).toThrow(/preview.*got 0/);
    expect(() => {
      store.commit(1.2);
    }).toThrow(/commit.*got 1.2/);
    expect(() => storeOf(Number.NaN, vi.fn())).toThrow(/initial/);
    expect(store.share()).toBe(DETAIL_PANE_DEFAULT_SHARE);
  });
});

describe('useDetailShare', () => {
  it('returns the provided store', () => {
    const store = storeOf(0.55, vi.fn());
    let seen: DetailShareStore | undefined;
    function Probe() {
      seen = useDetailShare();
      return null;
    }
    render(() => (
      <DetailShareContext.Provider value={store}>
        <Probe />
      </DetailShareContext.Provider>
    ));
    expect(seen).toBe(store);
  });

  it('throws outside the shell (a wiring bug)', () => {
    function Probe() {
      useDetailShare();
      return null;
    }
    expect(() => render(() => <Probe />)).toThrow('outside the panel shell');
  });
});
