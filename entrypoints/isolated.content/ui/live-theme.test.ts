/**
 * The live palette leg: the stored appearance applies at mount time, a later
 * write re-applies it while the follow is armed — only when the appearance
 * really changed — corrupt writes degrade to the documented defaults like
 * the read path, and the stop handle ends all of it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  containerTheme,
  followStoredAppearance,
  nextContainerTheme,
  type AppearanceSource
} from './live-theme';
import { FALLBACK, type StoredOptions } from '../../../lib/storage/options';

/**
 * Whole-shape options with one appearance; the other slots seed from the
 * documented defaults so the shape carries its required keys.
 */
function optionsWith(appearance: StoredOptions['appearance']): StoredOptions {
  return {
    improvements: { ...FALLBACK.improvements },
    appearance,
    features: { ...FALLBACK.features }
  };
}

/**
 * An in-memory `AppearanceSource` keeping its own value; `write` fans out to
 * the armed watchers like storage does (and the watch count is observable).
 */
function fakeSource(initial: unknown): AppearanceSource & {
  write(next: unknown): void;
  armed(): number;
} {
  let value = initial;
  const watchers = new Set<(raw: StoredOptions) => void>();
  return {
    // Matches the real item's async read shape; the leg awaits it regardless.
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
      for (const watcher of watchers) watcher(next as StoredOptions);
    },
    armed: () => watchers.size
  };
}

describe('containerTheme', () => {
  it('maps every stored choice to its container declaration', () => {
    expect(containerTheme('system')).toBe('system');
    expect(containerTheme('dark')).toBe('dark');
    expect(containerTheme('light')).toBe('light');
  });
});

describe('nextContainerTheme', () => {
  it('returns nothing when a write keeps the appearance (other slots write too)', () => {
    expect(nextContainerTheme('dark', optionsWith('dark'))).toBeNull();
    expect(nextContainerTheme('system', optionsWith('system'))).toBeNull();
  });

  it('returns the new declaration when the appearance changed', () => {
    expect(nextContainerTheme('dark', optionsWith('light'))).toBe('light');
    expect(nextContainerTheme('dark', optionsWith('system'))).toBe('system');
    expect(nextContainerTheme('system', optionsWith('dark'))).toBe('dark');
  });

  it('degrades a rejected write to the documented defaults, like the read path', () => {
    expect(nextContainerTheme('dark', 'corrupted')).toBe(containerTheme(FALLBACK.appearance));
    expect(nextContainerTheme('dark', optionsWith('dark'))).toBeNull();
  });
});

describe('followStoredAppearance', () => {
  it('applies the stored choice before returning, follows changed writes, stops on the handle', async () => {
    const source = fakeSource(optionsWith('dark'));
    const container = document.createElement('div');
    const stop = await followStoredAppearance(container, source);
    expect(container.dataset.theme).toBe('dark');

    source.write(optionsWith('light'));
    expect(container.dataset.theme).toBe('light');

    // A write that keeps the appearance must not touch the tree at all.
    const setTheme = vi.spyOn(container, 'setAttribute');
    source.write(optionsWith('light'));
    expect(setTheme).not.toHaveBeenCalled();

    // After the stop, even a real change reaches nothing.
    stop();
    source.write(optionsWith('dark'));
    expect(container.dataset.theme).toBe('light');
  });

  it('resets on a corrupt write and reads absence as the defaults', async () => {
    const source = fakeSource(optionsWith('dark'));
    const container = document.createElement('div');
    const stop = await followStoredAppearance(container, source);

    source.write('corrupted');
    expect(container.dataset.theme).toBe(containerTheme(FALLBACK.appearance));

    // A removed key: the item's watch delivers its fallback — the defaults.
    source.write(null);
    expect(container.dataset.theme).toBe(containerTheme(FALLBACK.appearance));
    stop();
  });

  it('arms exactly one watch and removes it exactly once', async () => {
    const source = fakeSource(optionsWith('dark'));
    const container = document.createElement('div');
    const stop = await followStoredAppearance(container, source);
    expect(source.armed()).toBe(1);
    stop();
    stop(); // idempotent — the mount composes it with the view's disposer
    expect(source.armed()).toBe(0);
  });

  it('skips a stale read when a write races it (the arm-first lost-update window)', async () => {
    // The window: a write committed after the arm but before the read
    // resolves. The watch callback must own that write; re-applying the
    // older read result afterwards would paint a palette the user just
    // left — the exact regression read-then-arm shipped.
    const container = document.createElement('div');
    const watchers = new Set<(raw: StoredOptions) => void>();
    let releaseRead: (value: StoredOptions) => void = () => {};
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
    const pending = followStoredAppearance(container, source);
    // Inside the read window: the write applies through the armed watch.
    for (const watcher of watchers) watcher(optionsWith('light'));
    expect(container.dataset.theme).toBe('light');
    // The read resolves with the pre-write snapshot — skipped in its favor.
    releaseRead(optionsWith('dark'));
    await pending;
    expect(container.dataset.theme).toBe('light');
  });

  it('unwinds the armed watch when the read fails — no subscription left behind', async () => {
    const container = document.createElement('div');
    const watchers = new Set<(raw: StoredOptions) => void>();
    const source: AppearanceSource = {
      getValue: () => Promise.reject(new Error('Extension context invalidated')),
      watch(onWrite) {
        watchers.add(onWrite);
        return () => {
          watchers.delete(onWrite);
        };
      }
    };
    await expect(followStoredAppearance(container, source)).rejects.toThrow(
      'Extension context invalidated'
    );
    expect(watchers.size).toBe(0);
  });
});
