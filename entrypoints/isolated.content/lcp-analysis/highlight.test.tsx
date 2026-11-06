/**
 * The LCP highlight. The view: an inert layer holding one frame at the
 * element's box (none while there is no box). The host, wired for real (a
 * real content-script context, WXT's real shadow-root factory, the deferred
 * render stand-in): the frame re-measures the element every animation frame
 * while up (layout changes with no scroll/resize), leaves after its time, on
 * the frame after the element leaves the page, on a hide and with the
 * context — no frame stays scheduled; the element itself is never written
 * to; one shadow UI across shows.
 */
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type * as ShadowRootUi from 'wxt/utils/content-script-ui/shadow-root';
import { createLogger } from '../../../lib/logger';
import { LCP_HIGHLIGHT_MS } from '../../../lib/lcp-analysis/deadlines';
import {
  renders,
  resetRenders,
  settle
} from '../../../components/injected-ui/deferred-mount.testing';
import {
  HighlightView,
  LCP_HIGHLIGHT_HOST_NAME,
  createLcpHighlighter,
  frameOf,
  sameFrame,
  type FrameRect
} from './highlight';

vi.mock(
  '../../../components/injected-ui/mount',
  () => import('../../../components/injected-ui/deferred-mount.testing')
);

/** WXT's real factory, counted. */
vi.mock('wxt/utils/content-script-ui/shadow-root', async (importOriginal) => {
  const real = await importOriginal<typeof ShadowRootUi>();
  return { createShadowRootUi: vi.fn(real.createShadowRootUi) };
});

const hosts = (): number => document.querySelectorAll(LCP_HIGHLIGHT_HOST_NAME).length;

let ctx: ContentScriptContext;
let seq = 0;

/** A page element with markup the highlight must leave alone. */
function pageElement(): HTMLElement {
  const element = document.createElement('img');
  element.setAttribute('style', 'border: 1px solid red');
  element.className = 'hero';
  document.body.append(element);
  return element;
}

/** The element's attributes, for the untouched check. */
function attributesOf(element: Element): [string, string][] {
  return [...element.attributes].map((attribute) => [attribute.name, attribute.value]);
}

beforeEach(() => {
  resetRenders();
  vi.mocked(createShadowRootUi).mockClear();
  seq += 1;
  ctx = new ContentScriptContext(`lcp-highlight-${String(seq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  document.querySelectorAll(LCP_HIGHLIGHT_HOST_NAME).forEach((host) => {
    host.remove();
  });
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('frameOf', () => {
  it('reads a connected element’s box, and none once it left the page', () => {
    const element = pageElement();
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 30,
      height: 40
    } as DOMRect);
    expect(frameOf(element)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    element.remove();
    expect(frameOf(element)).toBeNull();
  });
});

describe('sameFrame', () => {
  const box: FrameRect = { x: 1, y: 2, width: 3, height: 4 };
  it.each<[FrameRect | null, FrameRect | null, boolean]>([
    [null, null, true],
    [box, null, false],
    [null, box, false],
    [box, { ...box }, true],
    [box, { ...box, x: 9 }, false],
    [box, { ...box, y: 9 }, false],
    [box, { ...box, width: 9 }, false],
    [box, { ...box, height: 9 }, false]
  ])('compares %o with %o → %s', (a, b, same) => {
    expect(sameFrame(a, b)).toBe(same);
  });
});

describe('HighlightView', () => {
  it('draws one frame at the box, inert, and nothing without a box', () => {
    const [rect, setRect] = createSignal<FrameRect | null>({ x: 5, y: 6, width: 7, height: 8 });
    const registerLayer = vi.fn();
    const { container } = render(() => <HighlightView rect={rect} registerLayer={registerLayer} />);
    const layer = container.querySelector('.lh-layer');
    expect(registerLayer).toHaveBeenCalledWith(layer);
    const frame = container.querySelector<HTMLElement>('[data-fdt="lcp-highlight"]');
    expect(frame?.style.transform).toBe('translate(5px, 6px)');
    expect(frame?.style.width).toBe('7px');
    expect(frame?.style.height).toBe('8px');
    expect(container.querySelector('button, a, input')).toBeNull();
    setRect(null);
    expect(container.querySelector('[data-fdt="lcp-highlight"]')).toBeNull();
  });
});

describe('createLcpHighlighter', () => {
  /** Capture the context's countdowns: the test elapses them by hand. */
  function countdowns(): { ms: number[]; elapse: () => void } {
    const pending: (() => void)[] = [];
    const ms: number[] = [];
    vi.spyOn(ctx, 'setTimeout').mockImplementation((run, timeout) => {
      pending.push(run);
      ms.push(timeout ?? 0);
      return pending.length;
    });
    return { ms, elapse: () => pending.at(-1)?.() };
  }

  /** Capture animation frames: the test runs them by hand (the layer's placement included). */
  function animationFrames(): { pending: () => number; step: () => void } {
    const queue = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((run) => {
      id += 1;
      queue.set(id, run);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      queue.delete(handle);
    });
    return {
      pending: () => queue.size,
      step: () => {
        const due = [...queue.values()];
        queue.clear();
        for (const run of due) run(0);
      }
    };
  }

  /** Show the highlight on an element and settle its mount. */
  async function shownOn(element: Element): Promise<ReturnType<typeof createLcpHighlighter>> {
    const highlighter = createLcpHighlighter(ctx, createLogger('test'));
    const shown = highlighter.show(element);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    renders[0]?.resolve();
    await expect(shown).resolves.toBe(true);
    return highlighter;
  }

  it('re-measures the element every frame while up, with no scroll or resize', async () => {
    const frames = animationFrames();
    const element = pageElement();
    const measure = vi.spyOn(element, 'getBoundingClientRect');
    await shownOn(element);
    const before = measure.mock.calls.length;
    frames.step();
    frames.step();
    expect(measure.mock.calls.length).toBe(before + 2);
    expect(hosts()).toBe(1);
    expect(frames.pending()).toBe(1);
  });

  it('leaves on the frame after the element leaves the page, nothing left scheduled', async () => {
    const frames = animationFrames();
    const element = pageElement();
    await shownOn(element);
    frames.step();
    element.remove();
    frames.step();
    expect(hosts()).toBe(0);
    expect(frames.pending()).toBe(0);
  });

  it('stops re-measuring when its time is up, on hide and with the context', async () => {
    const frames = animationFrames();
    const timers = countdowns();
    const element = pageElement();
    const highlighter = await shownOn(element);
    timers.elapse();
    expect(frames.pending()).toBe(0);
    // The re-measure is scheduled synchronously by show (before its mount settles).
    const again = highlighter.show(element);
    expect(frames.pending()).toBe(1);
    highlighter.hide();
    expect(frames.pending()).toBe(0);
    await expect(again).resolves.toBe(false);
    const last = highlighter.show(element);
    expect(frames.pending()).toBe(1);
    ctx.notifyInvalidated();
    expect(frames.pending()).toBe(0);
    await expect(last).resolves.toBe(false);
  });

  it('frames the element for its time, then leaves — the element never touched', async () => {
    const timers = countdowns();
    const element = pageElement();
    const before = attributesOf(element);
    const highlighter = createLcpHighlighter(ctx, createLogger('test'));
    const shown = highlighter.show(element);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    renders[0]?.resolve();
    await expect(shown).resolves.toBe(true);
    expect(timers.ms).toEqual([LCP_HIGHLIGHT_MS]);
    timers.elapse();
    expect(hosts()).toBe(0);
    expect(attributesOf(element)).toEqual(before);
  });

  it('cycles one shadow UI across shows and restarts the countdown', async () => {
    const timers = countdowns();
    const first = pageElement();
    const second = pageElement();
    const highlighter = createLcpHighlighter(ctx, createLogger('test'));
    const shown = highlighter.show(first);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    renders[0]?.resolve();
    await shown;
    await expect(highlighter.show(second)).resolves.toBe(true);
    expect(timers.ms).toEqual([LCP_HIGHLIGHT_MS, LCP_HIGHLIGHT_MS]);
    timers.elapse();
    expect(hosts()).toBe(0);
    const again = highlighter.show(first);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    renders[1]?.resolve();
    await expect(again).resolves.toBe(true);
    expect(createShadowRootUi).toHaveBeenCalledTimes(1);
  });

  it('leaves on hide and with the context; later shows do nothing', async () => {
    const element = pageElement();
    const highlighter = createLcpHighlighter(ctx, createLogger('test'));
    const shown = highlighter.show(element);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    renders[0]?.resolve();
    await shown;
    highlighter.hide();
    expect(hosts()).toBe(0);
    highlighter.hide();
    const again = highlighter.show(element);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    renders[1]?.resolve();
    await again;
    ctx.notifyInvalidated();
    expect(hosts()).toBe(0);
    await expect(highlighter.show(element)).resolves.toBe(false);
    await settle();
    expect(hosts()).toBe(0);
  });

  it('refuses an element that left the page', async () => {
    const element = pageElement();
    element.remove();
    const highlighter = createLcpHighlighter(ctx, createLogger('test'));
    await expect(highlighter.show(element)).resolves.toBe(false);
    expect(hosts()).toBe(0);
    expect(createShadowRootUi).not.toHaveBeenCalled();
  });

  it('answers false (logged) when the frame cannot be created', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(createShadowRootUi).mockRejectedValueOnce(new Error('no css'));
    const element = pageElement();
    const highlighter = createLcpHighlighter(ctx, createLogger('test'));
    await expect(highlighter.show(element)).resolves.toBe(false);
    expect(hosts()).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('removes the frame when following the element throws (logged)', async () => {
    const frames = animationFrames();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const element = pageElement();
    const highlighter = createLcpHighlighter(ctx, createLogger('test'));
    const shown = highlighter.show(element);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    renders[0]?.resolve();
    await shown;
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
      throw new Error('layout');
    });
    frames.step();
    expect(hosts()).toBe(0);
    expect(frames.pending()).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
