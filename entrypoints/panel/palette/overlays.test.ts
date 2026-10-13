/**
 * The overlay store's behavior over fake focus targets: at most one overlay
 * open; open/close/toggle pairs; focus restores to the captured element on
 * every close; toggling while the other overlay is up closes that one first
 * (its restore runs, so the new capture is the settled point); running a
 * command closes then executes; a rejected run's escape is logged, never
 * unhandled.
 */
import { describe, expect, it, vi } from 'vitest';
import { createOverlayStore, type FocusRestoreTarget } from './overlays';

/** A focus-return probe (its focus records the calls, arrow-style — no `this`). */
function fakeTarget(): { focus(options?: FocusOptions): void; focusCalls: number } {
  const target: { focus(options?: FocusOptions): void; focusCalls: number } = {
    focusCalls: 0,
    focus: () => {
      target.focusCalls += 1;
    }
  };
  return target;
}

/** The store over fake element probes; `active` settable per test. */
function makeStore() {
  let current: FocusRestoreTarget | null = null;
  const store = createOverlayStore({
    activeElement: () => current
  });
  return {
    store,
    /** Set what focus holds right now (what the next open will capture). */
    capture: (element: FocusRestoreTarget | null): void => {
      current = element;
    }
  };
}

describe('overlay store — one overlay at a time', () => {
  it('opens exactly one overlay; opening the other closes this one first', () => {
    const { store, capture } = makeStore();
    capture(fakeTarget());
    store.openPalette();
    expect(store.paletteOpen()).toBe(true);
    expect(store.shortcutsOpen()).toBe(false);

    capture(fakeTarget());
    store.openShortcuts();
    expect(store.shortcutsOpen()).toBe(true);
    expect(store.paletteOpen()).toBe(false); // the palette yielded first
  });

  it('openPalette is idempotent while open (no second capture)', () => {
    const { store, capture } = makeStore();
    const target = fakeTarget();
    capture(target);
    store.openPalette();
    capture(fakeTarget()); // should never be read while already open
    store.openPalette();
    expect(store.paletteOpen()).toBe(true);
    // The close restores to the FIRST capture.
    store.closePalette();
    expect(target.focusCalls).toBe(1);
  });
});

describe('overlay store — toggle pairs', () => {
  it('toggles each overlay independently and restores on every close', () => {
    const { store, capture } = makeStore();
    const paletteOpener = fakeTarget();
    capture(paletteOpener);
    store.togglePalette();
    expect(store.paletteOpen()).toBe(true);
    store.togglePalette(); // close
    expect(store.paletteOpen()).toBe(false);
    expect(paletteOpener.focusCalls).toBe(1);

    const shortcutsOpener = fakeTarget();
    capture(shortcutsOpener);
    store.toggleShortcuts();
    expect(store.shortcutsOpen()).toBe(true);
    store.toggleShortcuts();
    expect(store.shortcutsOpen()).toBe(false);
    expect(shortcutsOpener.focusCalls).toBe(1);
  });
});

describe('overlay store — focus restoration', () => {
  it('captures whatever holds focus at open and restores it at close', () => {
    const { store, capture } = makeStore();
    const opener = fakeTarget();
    capture(opener);
    store.openPalette();
    store.closePalette();
    expect(opener.focusCalls).toBe(1);
  });

  it('restores nothing when the capture is null (focus on the body shell)', () => {
    const { store, capture } = makeStore();
    capture(null);
    store.openPalette();
    store.closePalette(); // must not throw on the missing element
  });
});

describe('overlay store — command runs', () => {
  it('closes the palette first, then runs (the run owns final focus)', () => {
    const { store, capture } = makeStore();
    const opener = fakeTarget();
    capture(opener);
    store.openPalette();
    const order: string[] = [];
    store.runCommand(() => {
      order.push(`run-began-after-close:${String(!store.paletteOpen())}`);
    });
    expect(order).toEqual(['run-began-after-close:true']);
    expect(opener.focusCalls).toBe(1); // the close restored before the run
  });

  it('logs a rejected run instead of throwing past the invocation', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { store } = makeStore();
      store.runCommand(() => Promise.reject(new Error('a wiring bug')));
      await Promise.resolve();
      await Promise.resolve();
      expect(
        error.mock.calls.some((call) => call.join(' ').includes('rejected past its own guarding'))
      ).toBe(true);
    } finally {
      error.mockRestore();
    }
  });

  it('contains a synchronously throwing run the same way (closed, restored, logged, no escape)', () => {
    // A run throwing BEFORE any promise exists cannot ride the rejection
    // path — the guard owns this shape explicitly.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { store, capture } = makeStore();
      const opener = fakeTarget();
      capture(opener);
      store.openPalette();
      expect(() => {
        store.runCommand(() => {
          throw new Error('a sync wiring bug');
        });
      }).not.toThrow();
      expect(store.paletteOpen()).toBe(false); // the close ran first
      expect(opener.focusCalls).toBe(1); // and the restore with it
      expect(
        error.mock.calls.some((call) => call.join(' ').includes('threw past its own guarding'))
      ).toBe(true);
    } finally {
      error.mockRestore();
    }
  });
});
