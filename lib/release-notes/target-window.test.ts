/**
 * The What's new tab's window: the last-focused normal window, never a
 * private one, else another usable window, else a new window; and the
 * bounded wait for the browser's first window (listener always removed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickTabTarget, waitForUsableWindow, type WindowFacts } from './target-window';

/** A window with overrides (default: a focused normal window, id 1). */
function win(overrides: Partial<WindowFacts>): WindowFacts {
  return { id: 1, type: 'normal', incognito: false, focused: true, ...overrides };
}

describe('pickTabTarget', () => {
  it('uses the last-focused normal window', () => {
    expect(pickTabTarget(win({ id: 7 }), [])).toEqual({ kind: 'window', windowId: 7 });
  });

  it('skips a private last-focused window for a usable one, focused first', () => {
    const all = [
      win({ id: 2, incognito: true }),
      win({ id: 3, focused: false }),
      win({ id: 4, focused: true })
    ];
    expect(pickTabTarget(win({ id: 2, incognito: true }), all)).toEqual({
      kind: 'window',
      windowId: 4
    });
    expect(pickTabTarget(null, all.slice(0, 2))).toEqual({ kind: 'window', windowId: 3 });
  });

  it('skips windows without an id or of another type', () => {
    expect(
      pickTabTarget(win({ type: 'popup' }), [win({ id: undefined }), win({ id: 5, type: 'app' })])
    ).toEqual({ kind: 'new-window' });
  });

  it('opens a new window when only private windows exist, or none', () => {
    expect(pickTabTarget(null, [win({ incognito: true })])).toEqual({ kind: 'new-window' });
    expect(pickTabTarget(null, [])).toEqual({ kind: 'new-window' });
  });
});

describe('waitForUsableWindow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A subscribe double recording the listener and its removal. */
  function source(): {
    subscribe: (listener: (window: WindowFacts) => void) => () => void;
    emit: (window: WindowFacts) => void;
    removed: () => number;
  } {
    let listener: ((window: WindowFacts) => void) | null = null;
    let removals = 0;
    return {
      subscribe: (next) => {
        listener = next;
        return () => {
          removals += 1;
          listener = null;
        };
      },
      emit: (window) => {
        listener?.(window);
      },
      removed: () => removals
    };
  }

  it('resolves with the first usable window, skipping private and other types', async () => {
    const windows = source();
    const waiting = waitForUsableWindow(windows.subscribe, 3_000);
    windows.emit(win({ id: 2, incognito: true }));
    windows.emit(win({ id: 3, type: 'popup' }));
    windows.emit(win({ id: 4 }));
    windows.emit(win({ id: 5 }));
    await expect(waiting).resolves.toMatchObject({ id: 4 });
    expect(windows.removed()).toBe(1);
  });

  it('resolves null at the timeout and removes the listener', async () => {
    vi.useFakeTimers();
    const windows = source();
    const waiting = waitForUsableWindow(windows.subscribe, 3_000);
    await vi.advanceTimersByTimeAsync(2_999);
    windows.emit(win({ incognito: true }));
    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toBeNull();
    expect(windows.removed()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles a window reported during subscription, clearing the timer', async () => {
    vi.useFakeTimers();
    let removals = 0;
    const waiting = waitForUsableWindow((listener) => {
      listener(win({ id: 8 }));
      return () => {
        removals += 1;
      };
    }, 3_000);
    await expect(waiting).resolves.toMatchObject({ id: 8 });
    expect(removals).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
