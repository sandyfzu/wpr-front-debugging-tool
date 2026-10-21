/**
 * The shared mount's contract as effects: the stored palette is on the
 * container before the view renders, the live theme leg follows later
 * appearance writes over the real options item (storage events included),
 * and the returned disposer removes the tree AND the follow — a later write
 * after disposal touches nothing.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'solid-js';
import { mountShadowUi } from './mount';
import { optionsStore, FALLBACK, type StoredOptions } from '../../lib/storage/options';

/**
 * The renderer is mocked at the exact boundary the mount composes over: a
 * view rendered into the container, disposer removes it. Vitest resolves
 * `solid-js/web` to Solid's server build, and the mount's own contract —
 * palette before render, disposer joins the two cleanups — is what this file
 * pins; the renderer itself is Solid's domain (component tests in P5B/P12).
 */
vi.mock('solid-js/web', (): Record<string, unknown> => ({
  render: (view: () => JSX.Element, container: HTMLElement): (() => void) => {
    const node = (view as unknown as () => HTMLElement)();
    container.append(node);
    return () => {
      node.remove();
    };
  }
}));

beforeEach(() => {
  fakeBrowser.reset();
});

/** Whole-shape options with one appearance; the other slots seed from the defaults. */
function storedOptions(appearance: StoredOptions['appearance']): StoredOptions {
  return {
    improvements: { ...FALLBACK.improvements },
    appearance,
    features: { ...FALLBACK.features }
  };
}

/** A static probe view — mount-lifecycle assertions need no reactivity. */
function probeView(label: string): JSX.Element {
  const el = document.createElement('div');
  el.className = label;
  return el;
}

describe('mountShadowUi', () => {
  it('puts the stored appearance on the container before the view renders', async () => {
    await optionsStore.setValue(storedOptions('dark'));
    const container = document.createElement('div');
    let themeAtFirstRender: string | undefined;

    await mountShadowUi(container, () => {
      // Runs during the render: after the theme application, before any
      // frame of this tree could paint with a wrong palette.
      themeAtFirstRender = container.dataset.theme;
      return probeView('mount-probe');
    });

    expect(themeAtFirstRender).toBe('dark');
    expect(container.querySelector('.mount-probe')).not.toBeNull();
  });

  it('follows appearance writes live over the real item, until disposal', async () => {
    await optionsStore.setValue(storedOptions('dark'));
    const container = document.createElement('div');
    const dispose = await mountShadowUi(container, () => probeView('mount-probe'));
    expect(container.dataset.theme).toBe('dark');

    await optionsStore.setValue(storedOptions('light'));
    await vi.waitFor(() => {
      expect(container.dataset.theme).toBe('light');
    });

    dispose();
    await optionsStore.setValue(storedOptions('system'));
    await new Promise((resolve) => setTimeout(resolve, 25));
    // The follow ended with the tree: this write reaches nothing.
    expect(container.dataset.theme).toBe('light');
  });

  it('starts from the documented defaults when nothing is stored', async () => {
    const container = document.createElement('div');
    await mountShadowUi(container, () => probeView('mount-probe'));
    expect(container.dataset.theme).toBe(FALLBACK.appearance);
  });
});
