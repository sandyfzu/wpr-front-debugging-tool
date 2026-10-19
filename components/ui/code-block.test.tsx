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
import {
  CodeBlock,
  HIGHLIGHT_MAX_CHARS,
  PLAIN_NOTES,
  type CodeBlockProps,
  type IntersectionGate
} from './code-block';
import { HighlightUnavailableError, type HighlightFailure } from './code-block-worker-client';
import type { HighlightedBlock } from './code-block-worker-protocol';
import { CODE_BLOCK_LANGS } from './code-block-langs';
import type { OverflowWatcher } from './overflow-watch';

/** A multi-line block (5,000 chars over 50 lines). */
const MULTI_SLICE = Array.from({ length: 50 }, () => 'y'.repeat(99)).join('\n');

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
  highlight: (code: string, options: { lang: string }) => HighlightedBlock;
}> {
  return () =>
    Promise.resolve({
      highlight: (code, options) => ({
        html: `<pre class="shiki-probe" data-local-lang="${options.lang}"><code>${code}</code></pre>`,
        styles: []
      })
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

describe('CodeBlock — toolbar-less chrome', () => {
  it('renders no toolbar chrome and no note strip by default', () => {
    render(() => (
      <CodeBlock
        text="const a = 1;"
        lang="javascript"
        toolbar={false}
        wrap={false}
        loadHighlighter={stubLoader()}
      />
    ));
    // The consumer owns language + Wrap: no chrome of the block's own.
    expect(document.querySelector('[data-fdt-code-block-lang]')).toBeNull();
    expect(document.querySelector('[data-fdt-code-block-wrap]')).toBeNull();
    expect(document.querySelector('[data-fdt-code-block-plain]')).toBeNull();
    // The code surface is exactly the toolbar-mode one minus the toolbar.
    const { area, fallback, root } = controls();
    expect(area?.className).toContain('whitespace-pre');
    expect(fallback?.textContent).toBe('const a = 1;');
    expect(root?.className).toContain('bg-surface-1');
  });

  it('shows the required plain note as its own strip (took too long)', async () => {
    const gate = manualGate();
    const loader = asyncLoader();
    render(() => (
      <CodeBlock
        text={MULTI_SLICE}
        lang="javascript"
        toolbar={false}
        wrap={false}
        createObserver={() => gate}
        loadHighlighter={loader.load}
      />
    ));
    gate.fires();
    await vi.waitFor(() => {
      expect(loader.requests.length).toBeGreaterThan(0);
    });
    loader.requests[0]?.fail('timeout');
    await vi.waitFor(() => {
      expect(document.querySelector('[data-fdt-code-block-plain]')?.textContent).toBe(
        'Not highlighted (took too long)'
      );
    });
    // The raw text stays under the note, exactly as the toolbar presents it.
    expect(controls().fallback?.textContent).toBe(MULTI_SLICE);
  });

  it('names too-large code in the strip and never requests it', async () => {
    const loader = asyncLoader();
    const text = 'z'.repeat(HIGHLIGHT_MAX_CHARS + 1);
    render(() => (
      <CodeBlock
        text={text}
        lang="javascript"
        toolbar={false}
        wrap={false}
        createObserver={() => manualGate()}
        loadHighlighter={loader.load}
      />
    ));
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.requests).toHaveLength(0);
    expect(document.querySelector('[data-fdt-code-block-plain]')?.textContent).toBe(
      PLAIN_NOTES['too-large']
    );
  });

  it('follows the consumer-owned wrap state, reactively', () => {
    const [wrapping, setWrapping] = createSignal(false);
    render(() => (
      <CodeBlock
        text="const a = 1;"
        lang="javascript"
        toolbar={false}
        wrap={wrapping()}
        loadHighlighter={stubLoader()}
      />
    ));
    const area = controls().area as HTMLElement;
    expect(area.className).not.toContain('whitespace-pre-wrap');
    setWrapping(true);
    expect(area.className).toContain('whitespace-pre-wrap');
    expect(area.className).toContain('[&_pre]:wrap-anywhere');
    setWrapping(false);
    expect(area.className).toContain('[&_pre]:whitespace-pre');
  });

  it('throws when an owned wrap prop becomes undefined (fail fast)', () => {
    const [wrapping, setWrapping] = createSignal<boolean | undefined>(false);
    render(() => (
      <CodeBlock
        text="const a = 1;"
        lang="javascript"
        toolbar={false}
        wrap={wrapping()}
        loadHighlighter={stubLoader()}
      />
    ));
    const area = controls().area as HTMLElement;
    expect(area.className).not.toContain('whitespace-pre-wrap');
    expect(() => {
      setWrapping(undefined);
    }).toThrow(/wrap must stay defined/);
  });

  it('keeps the group naming, clipping and overflow behavior identical to the toolbar', () => {
    const overflow = manualOverflow();
    render(() => (
      <CodeBlock
        text="const a = 1;"
        lang="javascript"
        toolbar={false}
        wrap={false}
        maxLines={2}
        createObserver={() => manualGate()}
        watchOverflow={overflow.watcher}
      />
    ));
    const area = controls().area as HTMLElement;
    overflow.set(true);
    expect(screen.getByRole('group', { name: 'javascript code' })).toBe(area);
    overflow.setClipped(true);
    expect(area.getAttribute('data-fdt-clipped')).toBe('');
  });

  it('answers the toolbar button through onWrapToggle when the state is consumer-owned', () => {
    const [wrapping, setWrapping] = createSignal(false);
    render(() => (
      <CodeBlock
        text="x"
        lang="json"
        wrap={wrapping()}
        onWrapToggle={setWrapping}
        loadHighlighter={stubLoader()}
      />
    ));
    const wrap = controls().wrap as Element;
    expect(wrap.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(wrap);
    expect(wrap.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(wrap);
    expect(wrap.getAttribute('aria-pressed')).toBe('false');
  });

  it.each([
    [
      'consumer-owned state also seeded by defaultWrap',
      { wrap: false, defaultWrap: true } satisfies Partial<CodeBlockProps>
    ],
    [
      'toolbar-less without a reachable state',
      { toolbar: false } satisfies Partial<CodeBlockProps>
    ],
    [
      'consumer-owned state under the toolbar with no writer',
      { wrap: false } satisfies Partial<CodeBlockProps>
    ],
    [
      'a callback the block can never answer',
      { onWrapToggle: () => undefined } satisfies Partial<CodeBlockProps>
    ]
  ])('throws on %s (fail fast)', (_reason, extra) => {
    expect(() => render(() => <CodeBlock text="x" lang="json" {...extra} />)).toThrow(/CodeBlock:/);
  });
});

/** An async loader double (the worker client's shape): requests resolve or fail on demand. */
function asyncLoader(): {
  load: () => Promise<{
    highlight: (code: string, options: { signal?: AbortSignal }) => Promise<HighlightedBlock>;
  }>;
  requests: Array<{
    code: string;
    signal?: AbortSignal;
    resolve: () => void;
    fail: (reason: HighlightFailure) => void;
  }>;
} {
  const requests: Array<{
    code: string;
    signal?: AbortSignal;
    resolve: () => void;
    fail: (reason: HighlightFailure) => void;
  }> = [];
  return {
    requests,
    load: () =>
      Promise.resolve({
        highlight: (code: string, options: { signal?: AbortSignal }) =>
          new Promise<HighlightedBlock>((resolve, reject) => {
            requests.push({
              code,
              signal: options.signal,
              resolve: () => {
                resolve({
                  html: `<pre class="probe"><code><span class="line"><span class="fdt-tk-probe">${String(code.length)}</span></span></code></pre>`,
                  styles: [['fdt-tk-probe', 'color:light-dark(#111111, #eeeeee)']]
                });
              },
              fail: (reason) => {
                reject(new HighlightUnavailableError(reason));
              }
            });
          })
      })
  };
}

describe('CodeBlock — worker highlighting', () => {
  /** Render a block over the async loader, latched visible. */
  async function mount(
    text: () => string,
    loader = asyncLoader()
  ): Promise<{ loader: ReturnType<typeof asyncLoader>; unmount: () => void }> {
    const gate = manualGate();
    const { unmount } = render(() => (
      <CodeBlock
        text={text()}
        lang="javascript"
        createObserver={() => gate}
        loadHighlighter={loader.load}
      />
    ));
    gate.fires();
    await vi.waitFor(() => {
      expect(loader.requests.length).toBeGreaterThan(0);
    });
    return { loader, unmount };
  }

  it('shows raw text until the worker answers, then the highlighted markup', async () => {
    const { loader } = await mount(() => MULTI_SLICE);
    expect(controls().fallback?.textContent).toBe(MULTI_SLICE);
    loader.requests[0]?.resolve();
    await vi.waitFor(() => {
      expect(controls().highlighted?.textContent).toBe(String(MULTI_SLICE.length));
    });
  });

  it('drops stale colors and aborts the request in flight when the text changes', async () => {
    const [text, setText] = createSignal('first();');
    // eslint-disable-next-line solid/reactivity -- the accessor itself is handed over, read inside the component
    const { loader } = await mount(text);
    loader.requests[0]?.resolve();
    await vi.waitFor(() => {
      expect(controls().highlighted).toBeTruthy();
    });
    setText(MULTI_SLICE);
    // The previous colors never linger over the new text.
    expect(controls().highlighted).toBeNull();
    expect(controls().fallback?.textContent).toBe(MULTI_SLICE);
    await vi.waitFor(() => {
      expect(loader.requests).toHaveLength(2);
    });
    setText('third();');
    expect(loader.requests[1]?.signal?.aborted).toBe(true);
  });

  it('aborts the request in flight when the block unmounts', async () => {
    const { loader, unmount } = await mount(() => MULTI_SLICE);
    expect(loader.requests[0]?.signal?.aborted).toBe(false);
    unmount();
    expect(loader.requests[0]?.signal?.aborted).toBe(true);
  });

  it("installs the block's token classes into its document before painting", async () => {
    const { loader } = await mount(() => MULTI_SLICE);
    loader.requests[0]?.resolve();
    await vi.waitFor(() => {
      expect(controls().highlighted).toBeTruthy();
    });
    const rules = document.adoptedStyleSheets
      .flatMap((sheet) => [...sheet.cssRules])
      .map((rule) => rule.cssText);
    expect(rules.some((rule) => rule.includes('fdt-tk-probe'))).toBe(true);
  });

  it('never paints an answer that arrives after its request was superseded', async () => {
    const [text, setText] = createSignal(MULTI_SLICE);
    // eslint-disable-next-line solid/reactivity -- the accessor itself is handed over, read inside the component
    const { loader } = await mount(text);
    setText('next();');
    // The aborted request still answers (a double that ignores the signal).
    loader.requests[0]?.resolve();
    // Let the whole promise chain settle (a macrotask outlasts its microtasks).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controls().highlighted).toBeNull();
    expect(controls().fallback?.textContent).toBe('next();');
  });

  it('shows no failure note for a request that failed after it was superseded', async () => {
    const [text, setText] = createSignal(MULTI_SLICE);
    // eslint-disable-next-line solid/reactivity -- the accessor itself is handed over, read inside the component
    const { loader } = await mount(text);
    setText('next();');
    loader.requests[0]?.fail('timeout');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-fdt-code-block-plain]')).toBeNull();
  });

  it('keeps raw text and says so when the block took too long', async () => {
    const { loader } = await mount(() => MULTI_SLICE);
    loader.requests[0]?.fail('timeout');
    await vi.waitFor(() => {
      expect(document.querySelector('[data-fdt-code-block-plain]')?.textContent).toBe(
        'Not highlighted (took too long)'
      );
    });
    expect(controls().fallback?.textContent).toBe(MULTI_SLICE);
  });

  it('keeps raw text quietly when workers are unavailable', async () => {
    const { loader } = await mount(() => MULTI_SLICE);
    loader.requests[0]?.fail('unavailable');
    await Promise.resolve();
    await Promise.resolve();
    expect(controls().fallback?.textContent).toBe(MULTI_SLICE);
    expect(document.querySelector('[data-fdt-code-block-plain]')).toBeNull();
  });

  it('never requests code above the size limit and says so', async () => {
    const gate = manualGate();
    const loader = asyncLoader();
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
    expect(loader.requests).toHaveLength(0);
    expect(controls().fallback?.textContent).toBe(text);
    expect(document.querySelector('[data-fdt-code-block-plain]')?.textContent).toBe(
      PLAIN_NOTES['too-large']
    );
  });

  it('shows no plain note for code within the limit', () => {
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

describe('CodeBlock — cut marks', () => {
  it('marks the named lines with an ellipsis outside the text, raw and highlighted', async () => {
    const gate = manualGate();
    const loader = asyncLoader();
    render(() => (
      <CodeBlock
        text={'first\nsecond\nthird'}
        lang="javascript"
        cutLines={[1]}
        createObserver={() => gate}
        loadHighlighter={loader.load}
      />
    ));
    // Raw: one element per line, the cut one marked; the text itself unchanged.
    const raw = [...document.querySelectorAll('[data-fdt-code-fallback] .line')];
    expect(raw.map((line) => line.textContent)).toEqual(['first', 'second', 'third']);
    expect(raw.map((line) => line.hasAttribute('data-fdt-cut'))).toEqual([false, true, false]);
    expect(controls().fallback?.textContent).toBe('first\nsecond\nthird');
    gate.fires();
    await vi.waitFor(() => {
      expect(loader.requests).toHaveLength(1);
    });
    loader.requests[0]?.resolve();
    await vi.waitFor(() => {
      expect(controls().highlighted).toBeTruthy();
    });
    // The probe markup has one line: it is not cut (index 0).
    expect(controls().highlighted?.querySelector('[data-fdt-cut]')).toBeNull();
  });

  it('renders the raw text as one node when nothing is cut', () => {
    render(() => <CodeBlock text={'a\nb'} lang="javascript" loadHighlighter={stubLoader()} />);
    expect(document.querySelector('[data-fdt-code-fallback] .line')).toBeNull();
  });
});
