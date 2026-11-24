/**
 * The shared mount's contract as effects: the root's input is isolated
 * and the stored palette is on the container before the view renders,
 * the live theme leg follows later
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
 * pins; the renderer itself is Solid's domain (the surfaces' component tests).
 * The disposer clears the whole container, as Solid's does
 * (`element.textContent = ""`): the container is shared across mounts.
 */
vi.mock('solid-js/web', (): Record<string, unknown> => ({
  render: (view: () => JSX.Element, container: HTMLElement): (() => void) => {
    const node = (view as unknown as () => HTMLElement)();
    container.append(node);
    return () => {
      container.textContent = '';
    };
  }
}));

/** Each `isolateUiEvents` call, in order with the renders (the mock records both). */
const calls: string[] = [];

/**
 * The isolation is mocked at the seam the mount composes over (its own
 * contract is `event-isolation.test.tsx`'s; the real one needs Solid's
 * client build, which this file's renderer mock replaces).
 */
vi.mock('./event-isolation', (): Record<string, unknown> => ({
  isolateUiEvents: (shadow: ShadowRoot): void => {
    calls.push(`isolate:${shadow.host.id}`);
  }
}));

beforeEach(() => {
  fakeBrowser.reset();
  calls.length = 0;
});

/** A container inside an open shadow root, as WXT's `onMount` hands them over. */
function shadowContainer(): { container: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement('div');
  host.id = 'ui-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  shadow.append(container);
  return { container, shadow };
}

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
  it('isolates the shadow root input once, before the view renders', async () => {
    const { container, shadow } = shadowContainer();
    await mountShadowUi(container, shadow, () => {
      calls.push('render');
      return probeView('mount-probe');
    });
    expect(calls).toEqual(['isolate:ui-host', 'render']);
  });

  it('puts the stored appearance on the container before the view renders', async () => {
    await optionsStore.setValue(storedOptions('dark'));
    const { container, shadow } = shadowContainer();
    let themeAtFirstRender: string | undefined;

    await mountShadowUi(container, shadow, () => {
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
    const { container, shadow } = shadowContainer();
    const dispose = await mountShadowUi(container, shadow, () => probeView('mount-probe'));
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
    const { container, shadow } = shadowContainer();
    await mountShadowUi(container, shadow, () => probeView('mount-probe'));
    expect(container.dataset.theme).toBe(FALLBACK.appearance);
  });

  it('carries the design tokens on the container (page rules on the host never reach it)', async () => {
    const { container, shadow } = shadowContainer();
    await mountShadowUi(container, shadow, () => probeView('tokens-probe'));
    expect(container.getAttribute('data-fdt-tokens')).toBe('');
  });

  it('still renders, in the system palette, when the appearance read is refused (one warning)', async () => {
    // Firefox refuses storage.sync for a temporary add-on without an id.
    vi.spyOn(optionsStore, 'getValue').mockRejectedValueOnce(
      new Error('The storage API will not work with a temporary addon ID.')
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container, shadow } = shadowContainer();
    const dispose = await mountShadowUi(container, shadow, () => probeView('refused'));
    expect(container.querySelector('.refused')).not.toBeNull();
    expect(container.getAttribute('data-theme')).toBe('system');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('[WPR FDT]');
    dispose();
    warn.mockRestore();
  });
  it('renders nothing and arms no follow for a mount already removed', async () => {
    const watch = vi.spyOn(optionsStore, 'watch');
    const { container, shadow } = shadowContainer();
    const removed = new AbortController();
    removed.abort();
    const dispose = await mountShadowUi(
      container,
      shadow,
      () => probeView('never'),
      removed.signal
    );
    expect(watch).not.toHaveBeenCalled();
    expect(container.childElementCount).toBe(0);
    dispose(); // the no-op disposer
    watch.mockRestore();
  });

  it('a removal during the appearance read stops the follow and skips the render', async () => {
    await optionsStore.setValue(storedOptions('dark'));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = optionsStore.getValue.bind(optionsStore);
    vi.spyOn(optionsStore, 'getValue').mockImplementationOnce(async () => {
      await gate;
      return read();
    });
    const { container, shadow } = shadowContainer();
    const removal = new AbortController();
    const mounting = mountShadowUi(container, shadow, () => probeView('late'), removal.signal);
    removal.abort();
    release();
    const dispose = await mounting;
    expect(container.querySelector('.late')).toBeNull();
    // The follow is gone: a later appearance write restyles nothing.
    const themed = container.dataset.theme;
    await optionsStore.setValue(storedOptions('light'));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(container.dataset.theme).toBe(themed);
    dispose();
  });

  it('a mount removed during its read never renders, so its disposer cannot wipe a newer view', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = optionsStore.getValue.bind(optionsStore);
    vi.spyOn(optionsStore, 'getValue').mockImplementationOnce(async () => {
      await gate;
      return read();
    });
    const { container, shadow } = shadowContainer();
    const removal = new AbortController();
    const stale = mountShadowUi(container, shadow, () => probeView('stale'), removal.signal);
    removal.abort();
    // The next mount of the same container renders while the stale read hangs.
    const disposeNewer = await mountShadowUi(container, shadow, () => probeView('newer'));
    release();
    const disposeStale = await stale;
    disposeStale();
    // Without the re-check right before `render()`, the stale tree would render
    // and its (container-clearing) disposer would take the newer view with it.
    expect(container.querySelector('.stale')).toBeNull();
    expect(container.querySelector('.newer')).not.toBeNull();
    disposeNewer();
  });
});
