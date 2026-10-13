/**
 * The page appearance leg's tests: the three-way choice's page declaration
 * (system → no attribute, explicit → pinned), live follow of options writes
 * (only real changes touch the tree; corrupt writes degrade to the
 * documented defaults), the arm-first race (a write during the read window
 * wins), the read-failure unwind (no subscription left behind), and the
 * document's paint lock (hidden until the appearance resolves; released
 * exactly once, in both boot arms).
 */
import { describe, expect, it, vi } from 'vitest';
import { FALLBACK, type StoredOptions } from '../../lib/storage/options';
import {
  applyStoredAppearance,
  pageTheme,
  releaseThemeLock,
  type AppearanceSource
} from './appearance';

/** Whole-shape options with one choice (the document defaults elsewhere). */
function optionsWith(appearance: StoredOptions['appearance']): StoredOptions {
  return {
    improvements: { ...FALLBACK.improvements },
    appearance,
    features: { ...FALLBACK.features }
  };
}

/**
 * In-memory source keeping its value; `write` fans out to the armed
 * watchers like storage does, and the armed count is observable.
 */
function fakeSource(
  initial: unknown
): AppearanceSource & { write(next: unknown): void; armed(): number } {
  let value = initial;
  const watchers = new Set<(raw: unknown) => void>();
  return {
    // The real item's read is async; the leg awaits it regardless.
    // eslint-disable-next-line @typescript-eslint/require-await -- shape parity, not I/O
    getValue: async () => value as StoredOptions,
    watch(onWrite) {
      watchers.add(onWrite);
      return () => {
        watchers.delete(onWrite);
      };
    },
    write(next) {
      value = next;
      for (const watcher of [...watchers]) watcher(next);
    },
    armed: () => watchers.size
  };
}

describe('pageTheme', () => {
  it('maps the stored choice to the page declaration (system = unset)', () => {
    expect(pageTheme('system')).toBeNull();
    expect(pageTheme('dark')).toBe('dark');
    expect(pageTheme('light')).toBe('light');
  });
});

describe('applyStoredAppearance', () => {
  it('applies the stored choice before returning, follows changed writes, stops', async () => {
    const source = fakeSource(optionsWith('light'));
    const root = document.createElement('div');
    const stop = await applyStoredAppearance(root, source);
    expect(root.getAttribute('data-theme')).toBe('light');

    source.write(optionsWith('dark'));
    expect(root.getAttribute('data-theme')).toBe('dark');

    // A write that keeps the choice must not touch the tree at all.
    source.write(optionsWith('dark'));
    expect(root.getAttribute('data-theme')).toBe('dark');

    stop();
    source.write(optionsWith('light'));
    expect(root.getAttribute('data-theme')).toBe('dark'); // nothing after stop
  });

  it('resolves a stored system choice to an unset attribute (the media query owns it)', async () => {
    const source = fakeSource(optionsWith('system'));
    const root = document.createElement('div');
    const stop = await applyStoredAppearance(root, source);
    expect(root.getAttribute('data-theme')).toBeNull();
    source.write(optionsWith('light'));
    expect(root.getAttribute('data-theme')).toBe('light');
    stop();
  });

  it('degrades a rejected write to the documented defaults, exactly like the read path', async () => {
    const source = fakeSource(optionsWith('dark'));
    const root = document.createElement('div');
    root.setAttribute('data-theme', 'light'); // a foreign/stray declaration
    const stop = await applyStoredAppearance(root, source);
    expect(root.getAttribute('data-theme')).toBe('dark');
    // A malformed write falls back to the default choice (`system`), which
    // for the page contract is the unset attribute.
    source.write('corrupt');
    expect(root.getAttribute('data-theme')).toBeNull();
    source.write(null); // a removed key: the item's delivered fallback
    expect(root.getAttribute('data-theme')).toBeNull();
    stop();
  });

  it('restores the unset attribute when the stored choice returns to system', async () => {
    const source = fakeSource(optionsWith('light'));
    const root = document.createElement('div');
    const stop = await applyStoredAppearance(root, source);
    expect(root.getAttribute('data-theme')).toBe('light');
    source.write(optionsWith('system'));
    expect(root.getAttribute('data-theme')).toBeNull();
    stop();
  });

  it('leaves the untouched attribute alone (setAttribute not called) on a no-op write', async () => {
    const source = fakeSource(optionsWith('dark'));
    const root = document.createElement('div');
    root.setAttribute('data-theme', 'dark');
    const stop = await applyStoredAppearance(root, source);
    expect(root.getAttribute('data-theme')).toBe('dark');
    const restyled = vi.spyOn(root, 'setAttribute');
    source.write(optionsWith('dark'));
    expect(restyled).not.toHaveBeenCalled();
    stop();
  });

  it('arms exactly one watch and stops it idempotently', async () => {
    const source = fakeSource(optionsWith('dark'));
    const root = document.createElement('div');
    const stop = await applyStoredAppearance(root, source);
    expect(source.armed()).toBe(1);
    stop();
    stop();
    expect(source.armed()).toBe(0);
  });

  it('skips a stale read when a write races it (the arm-first lost-update window)', async () => {
    const root = document.createElement('div');
    const watchers = new Set<(raw: unknown) => void>();
    let releaseRead!: (value: StoredOptions) => void;
    const source: AppearanceSource = {
      getValue: () =>
        new Promise<StoredOptions>((resolve) => {
          releaseRead = resolve;
        }),
      watch(onWrite) {
        watchers.add(onWrite);
        return () => {
          watchers.delete(onWrite);
        };
      }
    };
    const pending = applyStoredAppearance(root, source);
    // Inside the read window: the write applies through the armed watch.
    for (const watcher of [...watchers]) watcher(optionsWith('light'));
    expect(root.getAttribute('data-theme')).toBe('light');
    // The read resolves with the pre-write snapshot — skipped in its favor.
    releaseRead(optionsWith('dark'));
    await pending;
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('unwinds the armed watch when the read fails — no subscription left behind', async () => {
    const root = document.createElement('div');
    const watchers = new Set<(raw: unknown) => void>();
    const source: AppearanceSource = {
      getValue: () => Promise.reject(new Error('Extension context invalidated')),
      watch(onWrite) {
        watchers.add(onWrite);
        return () => {
          watchers.delete(onWrite);
        };
      }
    };
    await expect(applyStoredAppearance(root, source)).rejects.toThrow(
      'Extension context invalidated'
    );
    expect(watchers.size).toBe(0);
  });
});

describe('the document paint lock (index.html head rule + release)', () => {
  it('releases exactly once (a repeated release writes nothing)', () => {
    const root = document.createElement('div');
    const writes = vi.spyOn(root, 'setAttribute');
    releaseThemeLock(root);
    releaseThemeLock(root);
    // One write total: the second call sees the done value and no-ops.
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0]?.[0]).toBe('data-theme-lock');
    expect(writes.mock.calls[0]?.[1]).toBe('done');
    expect(root.getAttribute('data-theme-lock')).toBe('done');
  });

  it('releases only after the stored choice resolved (the hidden window covers the await)', async () => {
    const root = document.createElement('div');
    let releaseRead!: (value: StoredOptions) => void;
    const source: AppearanceSource = {
      getValue: () =>
        new Promise<StoredOptions>((resolve) => {
          releaseRead = resolve;
        }),
      watch: () => () => undefined
    };
    // The boot arm: the read is in flight — nothing may release the lock.
    const boot = (async () => {
      await applyStoredAppearance(root, source);
    })();
    expect(root.getAttribute('data-theme-lock')).toBeNull();
    releaseRead(optionsWith('dark'));
    await boot;
    expect(root.getAttribute('data-theme')).toBe('dark'); // the resolved choice
    releaseThemeLock(root);
    releaseThemeLock(root);
    expect(root.getAttribute('data-theme-lock')).toBe('done');
  });

  it('releases on the storage-failure arm too, exactly once (never a hidden panel)', async () => {
    const root = document.createElement('div');
    const source: AppearanceSource = {
      getValue: () => Promise.reject(new Error('Extension context invalidated')),
      watch: () => () => undefined
    };
    const boot = (async () => {
      try {
        await applyStoredAppearance(root, source);
      } catch {
        // the boot's logged-degrade arm: painting proceeds on the default
      }
      releaseThemeLock(root);
    })();
    await boot;
    expect(root.getAttribute('data-theme-lock')).toBe('done');
  });
});
