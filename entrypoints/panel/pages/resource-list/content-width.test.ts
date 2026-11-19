/** The live content-width signal. */
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContentWidth, entryWidth } from './content-width';
import { installFakeResizeObserver } from './fake-resize-observer';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** An entry reporting a content width. */
function entry(width: number): ResizeObserverEntry {
  return { contentRect: { width } } as unknown as ResizeObserverEntry;
}

describe('entryWidth', () => {
  it('reads the content box, clamping junk to 0', () => {
    expect(entryWidth(entry(812.5))).toBe(812.5);
    for (const junk of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(entryWidth(entry(junk))).toBe(0);
    }
  });
});

describe('createContentWidth', () => {
  it('starts at 0, follows each measure, and disconnects with its owner', () => {
    const observers = installFakeResizeObserver();
    createRoot((dispose) => {
      const measured = createContentWidth();
      expect(measured.width()).toBe(0);
      measured.ref(document.createElement('div'));
      expect(observers.live()).toBe(1);
      observers.resize(900);
      expect(measured.width()).toBe(900);
      observers.resize(400);
      expect(measured.width()).toBe(400);
      dispose();
    });
    expect(observers.live()).toBe(0);
  });

  it('observes only the latest element when re-bound', () => {
    const observers = installFakeResizeObserver();
    createRoot((dispose) => {
      const measured = createContentWidth();
      measured.ref(document.createElement('div'));
      measured.ref(document.createElement('div'));
      expect(observers.live()).toBe(1);
      dispose();
    });
  });

  it('stays at 0 without a ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    createRoot((dispose) => {
      const measured = createContentWidth();
      measured.ref(document.createElement('div'));
      expect(measured.width()).toBe(0);
      dispose();
    });
  });
});
