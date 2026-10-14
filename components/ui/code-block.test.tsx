/**
 * Render tests for the code block. The state machine runs with injected
 * seams: a manual intersection gate (no layout — happy-dom) and a loader
 * double, so tests pin the exact contract: raw-text fallback first, highlight
 * after intersection + load, observer disconnected on unmount, wrap toggle
 * state, safe-HTML mount and language validation.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock, type IntersectionGate } from './code-block';
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
 * An overflow-watcher double: records what it watches and lets the test
 * flip the overflow state (happy-dom has no layout to overflow).
 */
function manualOverflow(): {
  watcher: OverflowWatcher;
  set: (overflowing: boolean) => void;
  watched: () => HTMLElement[];
  stops: () => number;
} {
  let report: (overflowing: boolean) => void = () => undefined;
  let watched: HTMLElement[] = [];
  let stops = 0;
  return {
    watcher: (scroller, content, onChange) => {
      watched = [scroller, content];
      report = onChange;
      return () => {
        stops += 1;
      };
    },
    set: (overflowing) => {
      report(overflowing);
    },
    watched: () => watched,
    stops: () => stops
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
  });
});
