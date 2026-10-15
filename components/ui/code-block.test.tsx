/**
 * Render tests for the code block. The state machine runs with injected
 * seams: a manual intersection gate (no layout — happy-dom) and a loader
 * double, so tests pin the exact contract: raw-text fallback first, highlight
 * after intersection + load, observer disconnected on unmount, wrap toggle
 * state, safe-HTML mount and language validation.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock, HIGHLIGHT_MAX_CHARS, type IntersectionGate } from './code-block';

/** Code that does not fit one highlighting slice (5,000 chars over 50 lines). */
const MULTI_SLICE = Array.from({ length: 50 }, () => 'y'.repeat(99)).join('\n');
import { CODE_BLOCK_LANGS } from './code-block-langs';
import type { OverflowWatcher } from './overflow-watch';

afterEach(() => {
  cleanup();
});

/**
 * A gate double: saves the latch callback, counts its disconnects.
 * (happy-dom has no layout, so a real IntersectionObserver never fires — the
 * seam exists for exactly this.)
 */
function manualGate(): IntersectionGate & { fires: () => void; disconnects: () => number } {
  let onVisible: () => void = () => undefined;
  let disconnects = 0;
  return {
    observe: (callback) => {
      onVisible = callback;
    },
    disconnect: () => {
      disconnects += 1;
    },
    fires: () => {
      onVisible();
    },
    disconnects: () => disconnects
  };
}

/**
 * An overflow-watcher double: records both watches a block opens — the
 * scroll watch (default measure) and the clamp's clip watch (a custom
 * measure) — and lets the test flip each state (happy-dom has no layout).
 */
function manualOverflow(): {
  watcher: OverflowWatcher;
  set: (overflowing: boolean) => void;
  setClipped: (clipped: boolean) => void;
  watched: () => HTMLElement[];
  clipWatched: () => HTMLElement[];
  stops: () => number;
  clipStops: () => number;
} {
  /** One recorded watch: its reporter, watched elements and stop count. */
  interface Watch {
    report: (state: boolean) => void;
    watched: HTMLElement[];
    stops: number;
  }
  const idle = (): Watch => ({ report: () => undefined, watched: [], stops: 0 });
  const scroll = idle();
  const clip = idle();
  return {
    watcher: (box, content, onChange, measure) => {
      const watch = measure === undefined ? scroll : clip;
      watch.watched = [box, content];
      watch.report = onChange;
      return () => {
        watch.stops += 1;
      };
    },
    set: (overflowing) => {
      scroll.report(overflowing);
    },
    setClipped: (clipped) => {
      clip.report(clipped);
    },
    watched: () => scroll.watched,
    clipWatched: () => clip.watched,
    stops: () => scroll.stops,
    clipStops: () => clip.stops
  };
}

/** A loader double returning a highlighter that echoes the code, wrapped. */
function stubLoader(): () => Promise<{
  highlight: (code: string, options: { lang: string }) => string;
}> {
  return () =>
    Promise.resolve({
      highlight: (code, options) =>
        `<pre class="shiki-probe" data-local-lang="${options.lang}"><code>${code}</code></pre>`
    });
}

/** The live controls to drive one rendered block; every field nullable as queried. */
function controls(): {
  area: Element | null;
  fallback: Element | null;
  highlighted: Element | null;
  wrap: Element | null;
  root: Element | null;
} {
  return {
    area: document.querySelector('[data-fdt-code-area]'),
    fallback: document.querySelector('[data-fdt-code-fallback]'),
    highlighted: document.querySelector('[data-fdt-code-highlighted]'),
    wrap: document.querySelector('[data-fdt-code-block-wrap]'),
    root: document.querySelector('[data-fdt="code-block"]')
  };
}

describe('CodeBlock', () => {
  it('renders the raw-text fallback from first paint (content never hidden)', () => {
    render(() => (
      <CodeBlock text="const a = 1;" lang="javascript" loadHighlighter={stubLoader()} />
    ));
    const { fallback, highlighted, root } = controls();
    expect(fallback?.textContent).toBe('const a = 1;');
    // No hidden content and no skeleton people come from the raw fallback.
    expect(highlighted).toBeNull();
    expect(root?.getAttribute('data-fdt-highlighted')).toBeNull();
  });

  it('latches highlight rendering behind the intersection gate and the loader', async () => {
    const gate = manualGate();
    render(() => (
      <CodeBlock
        text={'"escape": "quote</code>"'}
        lang="json"
        createObserver={() => gate}
        loadHighlighter={stubLoader()}
      />
    ));
    expect(document.querySelector('[data-fdt-code-highlighted]')).toBeNull(); // before the gate: the raw fallback.
    gate.fires();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-fdt-code-highlighted]')).toBeTruthy();
    });
    // The highlighted surface now carries the loader's echoed output; the
    // raw fallback does not coexist with it (Show swapped, the same area).
    expect(
      document.querySelector('[data-fdt="code-block"]')?.getAttribute('data-fdt-highlighted')
    ).toBe('');
    expect(document.querySelector('[data-fdt-code-fallback]')).toBeNull();
    // The prop did not leak as a DOM attribute (innerHTML is set, not written as attribute).
    expect(document.querySelector('[data-fdt-code-highlighted]')?.hasAttribute('innerhtml')).toBe(
      false
    );
  });

  it('disconnects the observer on unmount — and only there', () => {
    const gate = manualGate();
    const { unmount } = render(() => (
      <CodeBlock text="const a = 1;" lang="javascript" createObserver={() => gate} />
    ));
    expect(gate.disconnects()).toBe(0);
    unmount();
    expect(gate.disconnects()).toBe(1);
  });

  it('degrades to the raw-text fallback when the loader fails (never a dead end)', async () => {
    const gate = manualGate();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(() => (
      <CodeBlock
        text="const a = 1;"
        lang="javascript"
        createObserver={() => gate}
        loadHighlighter={() => Promise.reject(new Error('chunk failed'))}
      />
    ));
    gate.fires();
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
    // The fallback stays readable: no crash, no hidden content.
    expect(document.querySelector('[data-fdt-code-fallback]')?.textContent).toBe('const a = 1;');
    warn.mockRestore();
  });

  it('toggles line wrapping without remounting code chrome', () => {
    render(() => (
      <CodeBlock text="const a = 1;" lang="javascript" createObserver={() => manualGate()} />
    ));
    const { wrap, area, fallback } = controls();
    expect(wrap?.getAttribute('aria-pressed')).toBe('false');
    // The wrap state lives on the code area (our shared `pre` selector), not
    // on individual content nodes — both fallback and highlighted surfaces obey.
    expect(area?.className).not.toContain('whitespace-pre-wrap');
    fireEvent.click(wrap as Element);
    expect(wrap?.getAttribute('aria-pressed')).toBe('true');
    expect(area?.className).toContain('whitespace-pre-wrap');
    // Long unbroken tokens wrap too, so wrap mode never scrolls sideways.
    expect(area?.className).toContain('[&_pre]:wrap-anywhere');
    // Area chrome (lang tag, buttons) survives the toggling round trip.
    expect(fallback?.textContent).toBe('const a = 1;');
    expect(screen.getByText('javascript')).toBeTruthy();
  });

  it('rejects a language outside the registered set (fail fast)', () => {
    // The hook contract list is pinned itself: javascript + json is the whole set.
    expect(CODE_BLOCK_LANGS).toEqual(['javascript', 'json']);
    expect(() => render(() => <CodeBlock text="x" lang={'perl' as never} />)).toThrow(
      /unsupported language/
    );
  });

  it('renders on the surface-1 token (the background its theme contrast is gated on)', () => {
    render(() => <CodeBlock text="x" lang="json" createObserver={() => manualGate()} />);
    expect(controls().root?.className).toContain('bg-surface-1');
  });

  it('mounts the highlighted markup in a div — never a pre inside a pre', async () => {
    const gate = manualGate();
    render(() => (
      <CodeBlock
        text="const a = 1;"
        lang="javascript"
        createObserver={() => gate}
        loadHighlighter={stubLoader()}
      />
    ));
    gate.fires();
    await vi.waitFor(() => {
      expect(controls().highlighted).toBeTruthy();
    });
    const { highlighted, area } = controls();
    expect(highlighted?.tagName).toBe('DIV');
    // Exactly one pre (the highlighter's), so the area's wrap/typography
    // selectors reach the element that actually lays out the text.
    expect(area?.querySelectorAll('pre')).toHaveLength(1);
    expect(area?.className).toContain('[&_pre]:whitespace-pre');
  });

  it('makes the code area a named, focusable group only while it overflows', () => {
    const overflow = manualOverflow();
    render(() => (
      <CodeBlock
        text="const a = 1;"
        lang="javascript"
        createObserver={() => manualGate()}
        watchOverflow={overflow.watcher}
      />
    ));
    const area = controls().area as HTMLElement;
    // It watches the area and its content box.
    expect(overflow.watched()[0]).toBe(area);
    expect(overflow.watched()[1]?.hasAttribute('data-fdt-code-content')).toBe(true);
    // Fits: no tab stop, no role, no name.
    expect(area.hasAttribute('tabindex')).toBe(false);
    expect(area.hasAttribute('role')).toBe(false);
    expect(area.hasAttribute('aria-label')).toBe(false);
    overflow.set(true);
    expect(area.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('group', { name: 'javascript code' })).toBe(area);
    expect(area.hasAttribute('data-fdt-scrollable')).toBe(true);
    expect(area.className).toContain('focus-visible:outline-2');
    overflow.set(false);
    expect(area.hasAttribute('tabindex')).toBe(false);
    expect(screen.queryByRole('group', { name: 'javascript code' })).toBeNull();
  });

  it('names the scroll region from the label prop when given', () => {
    const overflow = manualOverflow();
    render(() => (
      <CodeBlock
        text="{}"
        lang="json"
        label="Response body"
        createObserver={() => manualGate()}
        watchOverflow={overflow.watcher}
      />
    ));
    overflow.set(true);
    expect(screen.getByRole('group', { name: 'Response body' })).toBe(controls().area);
  });

  it('stops the overflow watch on unmount', () => {
    const overflow = manualOverflow();
    const { unmount } = render(() => (
      <CodeBlock
        text="x"
        lang="json"
        createObserver={() => manualGate()}
        watchOverflow={overflow.watcher}
      />
    ));
    expect(overflow.stops()).toBe(0);
    unmount();
    expect(overflow.stops()).toBe(1);
    expect(overflow.clipStops()).toBe(1);
  });

  it('keeps a focused area focusable after its overflow ends, then drops it on blur', () => {
    const overflow = manualOverflow();
    render(() => (
      <CodeBlock
        text="const a = 1;"
        lang="javascript"
        createObserver={() => manualGate()}
        watchOverflow={overflow.watcher}
      />
    ));
    const area = controls().area as HTMLElement;
    overflow.set(true);
    area.focus();
    expect(document.activeElement).toBe(area);
    // E.g. the panel widened: nothing to scroll any more, but focus is here.
    overflow.set(false);
    expect(area.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('group', { name: 'javascript code' })).toBe(area);
    expect(document.activeElement).toBe(area);
    area.blur();
    expect(area.hasAttribute('tabindex')).toBe(false);
    expect(area.hasAttribute('role')).toBe(false);
  });

  it('clamps to maxLines on the inner box, reactively, and unclamps in place', () => {
    const [lines, setLines] = createSignal<number | undefined>(3);
    const overflow = manualOverflow();
    render(() => (
      <CodeBlock
        text={'a\nb\nc\nd\ne'}
        lang="javascript"
        maxLines={lines()}
        createObserver={() => manualGate()}
        watchOverflow={overflow.watcher}
      />
    ));
    const area = controls().area as HTMLElement;
    const clamp = area.querySelector<HTMLElement>('[data-fdt-code-content]') as HTMLElement;
    // The clip watch measures the clamp box against its natural-height lines.
    expect(overflow.clipWatched()[0]).toBe(clamp);
    expect(overflow.clipWatched()[1]?.hasAttribute('data-fdt-code-lines')).toBe(true);
    expect(area.hasAttribute('data-fdt-clamped')).toBe(true);
    expect(clamp.style.getPropertyValue('--fdt-code-max-lines')).toBe('3');
    expect(clamp.className).toContain('max-h-[calc(var(--fdt-code-max-lines)*1lh+1rem)]');
    // `clip`: not a scroll container, so nothing can scroll the preview.
    expect(clamp.className).toContain('overflow-y-clip');
    setLines(undefined);
    expect(controls().area).toBe(area); // same elements, no remount
    expect(area.querySelector('[data-fdt-code-content]')).toBe(clamp);
    expect(area.hasAttribute('data-fdt-clamped')).toBe(false);
    expect(clamp.style.getPropertyValue('--fdt-code-max-lines')).toBe('');
    expect(clamp.className).not.toContain('overflow-y-clip');
  });

  it('fades the clamp only while lines are really cut off', () => {
    const [lines, setLines] = createSignal<number | undefined>(3);
    const overflow = manualOverflow();
    render(() => (
      <CodeBlock
        text={'a\nb\nc'}
        lang="javascript"
        maxLines={lines()}
        createObserver={() => manualGate()}
        watchOverflow={overflow.watcher}
      />
    ));
    const area = controls().area as HTMLElement;
    const clamp = area.querySelector<HTMLElement>('[data-fdt-code-content]') as HTMLElement;
    overflow.setClipped(false); // 3 lines in a 3-line clamp: nothing hidden
    expect(area.hasAttribute('data-fdt-clipped')).toBe(false);
    expect(clamp.className).not.toMatch(/mask-/);
    overflow.setClipped(true);
    expect(area.hasAttribute('data-fdt-clipped')).toBe(true);
    // A short fade over the half-shown next line only.
    expect(clamp.className).toContain('mask-b-from-[calc(100%-0.5rem)]');
    // Unclamped, a stale "clipped" reading never fades or flags anything.
    setLines(undefined);
    expect(area.hasAttribute('data-fdt-clipped')).toBe(false);
    expect(clamp.className).not.toMatch(/mask-/);
  });

  it('never masks the focusable scroller (a mask would clip its focus ring)', () => {
    const overflow = manualOverflow();
    render(() => (
      <CodeBlock
        text={'a\nb\nc\nd'}
        lang="javascript"
        maxLines={2}
        createObserver={() => manualGate()}
        watchOverflow={overflow.watcher}
      />
    ));
    overflow.set(true);
    overflow.setClipped(true);
    const area = controls().area as HTMLElement;
    expect(area.getAttribute('tabindex')).toBe('0');
    expect(area.className).not.toMatch(/(^|\s)mask-/);
    expect(area.className).toContain('focus-visible:outline-2');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects maxLines=%s (fail fast)', (lines) => {
    expect(() =>
      render(() => (
        <CodeBlock text="x" lang="json" maxLines={lines} createObserver={() => manualGate()} />
      ))
    ).toThrow(/maxLines must be a positive integer/);
  });
});

/** A sliced-capable loader double: records each call, resolves on demand. */
function slicedLoader(): {
  load: () => Promise<{
    highlight: (code: string) => string;
    highlightSliced: (code: string, options: { signal?: AbortSignal }) => Promise<string>;
  }>;
  syncCalls: string[];
  sliced: Array<{ code: string; signal?: AbortSignal; resolve: () => void }>;
} {
  const syncCalls: string[] = [];
  const sliced: Array<{ code: string; signal?: AbortSignal; resolve: () => void }> = [];
  const wrap = (code: string): string =>
    `<pre class="probe"><code>${String(code.length)}</code></pre>`;
  return {
    syncCalls,
    sliced,
    load: () =>
      Promise.resolve({
        highlight: (code: string) => {
          syncCalls.push(code);
          return wrap(code);
        },
        highlightSliced: (code: string, options: { signal?: AbortSignal }) =>
          new Promise<string>((resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
            sliced.push({
              code,
              signal: options.signal,
              resolve: () => {
                resolve(wrap(code));
              }
            });
          })
      })
  };
}

describe('CodeBlock — highlighting cost bounds', () => {
  it('highlights short code synchronously (no plain-text flash)', async () => {
    const gate = manualGate();
    const loader = slicedLoader();
    render(() => (
      <CodeBlock
        text="const a = 1;"
        lang="javascript"
        createObserver={() => gate}
        loadHighlighter={loader.load}
      />
    ));
    gate.fires();
    await vi.waitFor(() => {
      expect(controls().highlighted).toBeTruthy();
    });
    expect(loader.syncCalls).toEqual(['const a = 1;']);
    expect(loader.sliced).toHaveLength(0);
  });

  it('highlights longer code in slices, raw text showing until they finish', async () => {
    const gate = manualGate();
    const loader = slicedLoader();
    const text = MULTI_SLICE;
    render(() => (
      <CodeBlock
        text={text}
        lang="javascript"
        createObserver={() => gate}
        loadHighlighter={loader.load}
      />
    ));
    gate.fires();
    await vi.waitFor(() => {
      expect(loader.sliced).toHaveLength(1);
    });
    expect(loader.syncCalls).toHaveLength(0);
    expect(controls().fallback?.textContent).toBe(text);
    loader.sliced[0]?.resolve();
    await vi.waitFor(() => {
      expect(controls().highlighted?.textContent).toBe(String(text.length));
    });
  });

  it('drops stale colors and aborts the slices in flight when the text changes', async () => {
    const gate = manualGate();
    const loader = slicedLoader();
    const long = MULTI_SLICE;
    const [text, setText] = createSignal(long);
    render(() => (
      <CodeBlock
        text={text()}
        lang="javascript"
        createObserver={() => gate}
        loadHighlighter={loader.load}
      />
    ));
    gate.fires();
    await vi.waitFor(() => {
      expect(loader.sliced).toHaveLength(1);
    });
    setText('short();');
    expect(loader.sliced[0]?.signal?.aborted).toBe(true);
    expect(controls().highlighted?.textContent).toBe(String('short();'.length));
    setText(long);
    // The short text's colors never linger over the long text.
    expect(controls().highlighted).toBeNull();
    expect(controls().fallback?.textContent).toBe(long);
  });

  it('never highlights code above the size limit and says so', async () => {
    const gate = manualGate();
    const loader = slicedLoader();
    const text = 'z'.repeat(HIGHLIGHT_MAX_CHARS + 1);
    render(() => (
      <CodeBlock
        text={text}
        lang="javascript"
        createObserver={() => gate}
        loadHighlighter={loader.load}
      />
    ));
    gate.fires();
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.syncCalls).toHaveLength(0);
    expect(loader.sliced).toHaveLength(0);
    expect(controls().fallback?.textContent).toBe(text);
    expect(document.querySelector('[data-fdt-code-block-plain]')?.textContent).toBe(
      'Not highlighted (too large)'
    );
  });

  it('shows no size note for code within the limit', () => {
    render(() => <CodeBlock text="a" lang="javascript" loadHighlighter={stubLoader()} />);
    expect(document.querySelector('[data-fdt-code-block-plain]')).toBeNull();
  });
});

describe('CodeBlock — clip reporting', () => {
  it('reports whether the clamp cuts lines off, false while unclamped', () => {
    const overflow = manualOverflow();
    const reports: boolean[] = [];
    const [lines, setLines] = createSignal<number | undefined>(3);
    render(() => (
      <CodeBlock
        text={'a\nb\nc\nd'}
        lang="javascript"
        maxLines={lines()}
        watchOverflow={overflow.watcher}
        onClipChange={(clipped) => reports.push(clipped)}
        loadHighlighter={stubLoader()}
      />
    ));
    expect(reports).toEqual([false]);
    overflow.setClipped(true);
    expect(reports).toEqual([false, true]);
    setLines(undefined);
    expect(reports).toEqual([false, true, false]);
  });
});
