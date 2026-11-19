/**
 * The extension pages' boot appearance leg: the followed value tracks the stored
 * choice (the read, then every write), a failed read degrades to System
 * yet still follows later writes (document + menu), a failed re-arm is
 * logged, and the paint lock releases in every arm — the leg never rejects.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../lib/logger';
import type { AppearanceSource } from '../lib/appearance/appearance';
import { FALLBACK, type StoredOptions } from '../lib/storage/options';
import { bootAppearance } from './boot-appearance';

/** Whole-shape options with one choice. */
function optionsWith(appearance: StoredOptions['appearance']): StoredOptions {
  return {
    improvements: { ...FALLBACK.improvements },
    appearance,
    features: { ...FALLBACK.features }
  };
}

/** A logger whose methods are traced mocks. */
function tracedLog(): {
  [level in keyof Logger]: Mock<(message: string, ...details: unknown[]) => void>;
} {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * A source whose read resolves `initial` (or rejects with it when an
 * `Error`); `write` fans out to the armed watchers like storage does, and
 * the armed count is observable.
 */
function fakeSource(
  initial: StoredOptions | Error
): AppearanceSource & { write(next: unknown): void; armed(): number } {
  const watchers = new Set<(raw: unknown) => void>();
  return {
    getValue: () => (initial instanceof Error ? Promise.reject(initial) : Promise.resolve(initial)),
    watch(onWrite) {
      watchers.add(onWrite);
      return () => {
        watchers.delete(onWrite);
      };
    },
    write(next) {
      for (const watcher of [...watchers]) watcher(next);
    },
    armed: () => watchers.size
  };
}

describe('bootAppearance', () => {
  it('feeds the menu the stored choice, then every write; the lock releases', async () => {
    const root = document.createElement('div');
    const source = fakeSource(optionsWith('dark'));
    const appearance = await bootAppearance(root, tracedLog(), source);
    expect(appearance()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-theme-lock')).toBe('done');
    expect(source.armed()).toBe(1); // one follow, never a second subscription
    source.write(optionsWith('light'));
    expect(appearance()).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('a failed read shows System, logs, and still follows a later write (document + menu)', async () => {
    const root = document.createElement('div');
    const log = tracedLog();
    const source = fakeSource(new Error('Extension context invalidated'));
    const appearance = await bootAppearance(root, log, source);
    expect(appearance()).toBe('system');
    expect(root.hasAttribute('data-theme')).toBe(false); // the token default paints
    expect(root.getAttribute('data-theme-lock')).toBe('done');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(source.armed()).toBe(1); // the read's watch unwound, the write half re-armed once
    source.write(optionsWith('dark')); // e.g. the menu's own pick lands
    expect(appearance()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('a failed read and a failed re-arm both log; the leg still resolves with the lock released', async () => {
    const root = document.createElement('div');
    const log = tracedLog();
    let arms = 0;
    const source: AppearanceSource = {
      getValue: () => Promise.reject(new Error('read failed')),
      watch: () => {
        arms += 1;
        if (arms > 1) throw new Error('arm failed'); // the first arm (the read's) works
        return () => undefined;
      }
    };
    const appearance = await bootAppearance(root, log, source);
    expect(appearance()).toBe('system');
    expect(root.getAttribute('data-theme-lock')).toBe('done');
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn.mock.calls[1]?.[1]).toEqual({ message: 'arm failed' });
  });
});
