/**
 * The Detections layout store: default, switching, per-factory isolation and
 * the shell-only context hook.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createRoot, type JSX } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDetectionsLayout,
  DEFAULT_DETECTION_LAYOUT,
  DETECTION_LAYOUTS,
  DetectionsLayoutContext,
  useDetectionsLayout,
  type DetectionsLayoutStore
} from './detections-layout';

afterEach(() => {
  cleanup();
});

describe('createDetectionsLayout', () => {
  it('starts adaptive and switches both ways', () => {
    const store = createDetectionsLayout();
    expect(DEFAULT_DETECTION_LAYOUT).toBe('adaptive');
    expect(store.layout()).toBe('adaptive');
    store.setLayout('list');
    expect(store.layout()).toBe('list');
    store.setLayout('adaptive');
    expect(store.layout()).toBe('adaptive');
  });

  it('gives every factory call its own state (nothing module-level)', () => {
    const first = createDetectionsLayout();
    first.setLayout('list');
    expect(createDetectionsLayout().layout()).toBe('adaptive');
    expect(first.layout()).toBe('list');
  });
});

describe('DETECTION_LAYOUTS', () => {
  it('offers Adaptive then List', () => {
    expect(DETECTION_LAYOUTS).toEqual([
      { value: 'adaptive', label: 'Adaptive' },
      { value: 'list', label: 'List' }
    ]);
  });
});

describe('useDetectionsLayout', () => {
  it('throws outside the panel shell', () => {
    createRoot((dispose) => {
      expect(() => useDetectionsLayout()).toThrow(
        'useDetectionsLayout() ran outside the panel shell.'
      );
      dispose();
    });
  });

  it('returns the provided store', () => {
    const store = createDetectionsLayout();
    let seen: DetectionsLayoutStore | undefined;
    /** Reads the hook where a page body would. */
    function Probe(): JSX.Element {
      seen = useDetectionsLayout();
      return null;
    }
    render(() => (
      <DetectionsLayoutContext.Provider value={store}>
        <Probe />
      </DetectionsLayoutContext.Provider>
    ));
    expect(seen).toBe(store);
  });
});
