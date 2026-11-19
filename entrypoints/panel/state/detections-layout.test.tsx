/**
 * The Detections layout store: default, switching, per-factory isolation,
 * the shown layout per page width and the shell-only context hook.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createRoot, type JSX } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { LIST_REGULAR_MIN_CONTENT_WIDTH } from '../../../lib/panel/list-tier';
import {
  createDetectionsLayout,
  DEFAULT_DETECTION_LAYOUT,
  DETECTION_LAYOUTS,
  DetectionsLayoutContext,
  shownDetectionLayout,
  useDetectionsLayout,
  type DetectionsLayoutStore
} from './detections-layout';

afterEach(() => {
  cleanup();
});

describe('createDetectionsLayout', () => {
  it('starts grouped and switches to every layout and back', () => {
    const store = createDetectionsLayout();
    expect(DEFAULT_DETECTION_LAYOUT).toBe('grouped');
    expect(store.layout()).toBe('grouped');
    store.setLayout('list');
    expect(store.layout()).toBe('list');
    store.setLayout('cards');
    expect(store.layout()).toBe('cards');
    store.setLayout('grouped');
    expect(store.layout()).toBe('grouped');
  });

  it('gives every factory call its own state (nothing module-level)', () => {
    const first = createDetectionsLayout();
    first.setLayout('list');
    expect(createDetectionsLayout().layout()).toBe('grouped');
    expect(first.layout()).toBe('list');
  });
});

describe('shownDetectionLayout', () => {
  const regular = LIST_REGULAR_MIN_CONTENT_WIDTH;

  it('shows Grouped below the regular tier whatever the choice', () => {
    for (const choice of ['grouped', 'list', 'cards'] as const) {
      expect(shownDetectionLayout(choice, 268)).toBe('grouped');
      expect(shownDetectionLayout(choice, regular - 0.5)).toBe('grouped');
    }
  });

  it('shows the choice from the regular tier up (the boundary included)', () => {
    for (const choice of ['grouped', 'list', 'cards'] as const) {
      expect(shownDetectionLayout(choice, regular)).toBe(choice);
      expect(shownDetectionLayout(choice, 1231)).toBe(choice);
    }
  });

  it('keeps the choice while the width is unmeasured (0)', () => {
    expect(shownDetectionLayout('list', 0)).toBe('list');
    expect(shownDetectionLayout('cards', 0)).toBe('cards');
  });

  it('rejects a measuring bug (negative or non-finite width), naming it', () => {
    expect(() => shownDetectionLayout('list', -1)).toThrow(RangeError);
    expect(() => shownDetectionLayout('list', Number.NaN)).toThrow(/NaN/);
  });
});

describe('DETECTION_LAYOUTS', () => {
  it('offers Grouped, List, Cards in that order, each with its icon', () => {
    expect(DETECTION_LAYOUTS.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 'grouped', label: 'Grouped' },
      { value: 'list', label: 'List' },
      { value: 'cards', label: 'Cards' }
    ]);
    const icons = DETECTION_LAYOUTS.map((option) => option.icon);
    for (const icon of icons) expect(typeof icon).toBe('function');
    expect(new Set(icons).size).toBe(3);
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
