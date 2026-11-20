/**
 * The bottom sheet's render tests: the open flag drives the mount (fresh per
 * open), the dialog seams (Escape, scrim) request a close once and never
 * unmount on their own, the exit keeps the sheet mounted exactly its
 * computed duration (the reduced-motion collapse closes at once), and focus
 * returns to the caller's target after the close — never thrown on, nor
 * jumped elsewhere, when the target is gone. Geometry is asserted on
 * classes (no layout here).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { focusWouldBeLost, restoreFocus, Sheet } from './sheet';
import { Button } from './button';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** The mounted sheet's dialog panel, or null. */
function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-fdt="dialog"]');
}

/** The mounted sheet's scrim, or null. */
function scrim(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-fdt="dialog-overlay"]');
}

/**
 * Report `overrides` in every element's computed style (the resource-less
 * DOM computes no stylesheet), all other properties real.
 */
function stubComputedStyle(overrides: Partial<Record<keyof CSSStyleDeclaration, string>>): void {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = real(element, pseudo);
    return new Proxy(style, {
      get(target, key) {
        if (typeof key === 'string' && key in overrides) {
          return overrides[key as keyof CSSStyleDeclaration];
        }
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      }
    });
  });
}

/** Report `duration` as every element's computed `transition-duration`. */
function stubTransitionDuration(duration: string): void {
  stubComputedStyle({ transitionDuration: duration });
}

/**
 * A real browser's computed style for the sheet: a 180 ms transition and no
 * keyframe animation (`animationName: none` — the resource-less DOM's `''`
 * reads as "animating" to the library's presence and hid an early unmount).
 */
function stubBrowserStyle(): void {
  stubComputedStyle({ transitionDuration: '0.18s', animationName: 'none' });
}

/** The class list of an element, split (whole-word assertions). */
function classesOf(element: Element | null): string[] {
  return (element?.className ?? '').split(/\s+/);
}

/** The mounted sheet's `data-state`, or null when unmounted. */
function sheetState(): string | null {
  return document.querySelector('[data-fdt="sheet"]')?.getAttribute('data-state') ?? null;
}

/**
 * Render a sheet with its opener like a facet bar does; the caller closes on
 * `onClose` (unless `ignoreClose`). A `data-kb-top-layer` control stands for
 * a top-layer surface (a toast) the modal trap lets focus through to.
 */
function renderSheet(options?: {
  open?: boolean;
  footer?: boolean;
  actions?: boolean;
  ignoreClose?: boolean;
}) {
  const [open, setOpen] = createSignal(options?.open ?? false);
  const [target, setTarget] = createSignal<HTMLElement | undefined>();
  const onClose = vi.fn(() => {
    if (options?.ignoreClose !== true) setOpen(false);
  });
  render(() => (
    <>
      <button type="button" ref={setTarget} onClick={() => setOpen(true)}>
        Filters
      </button>
      <button type="button">Elsewhere</button>
      <div data-kb-top-layer="">
        <button type="button">Toast action</button>
      </div>
      <Sheet
        open={open()}
        onClose={onClose}
        title="Filters"
        description="Narrow the list"
        restoreFocusTo={target}
        actions={options?.actions ? <Button size="sm">Reset</Button> : undefined}
        footer={options?.footer ? <Button>Show 3 scripts</Button> : undefined}
      >
        <Button>First facet</Button>
      </Sheet>
    </>
  ));
  const opener = screen.getByRole('button', { name: 'Filters' });
  return { onClose, setOpen, setTarget, opener };
}

/** Open the sheet from its opener (focus on the opener first, as a click leaves it). */
async function openFromOpener(opener: HTMLElement, setOpen: (open: boolean) => void) {
  opener.focus();
  setOpen(true);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'First facet' })).toBe(document.activeElement);
  });
}

describe('Sheet structure', () => {
  it('renders nothing while closed and a titled, described dialog once open', () => {
    const { setOpen } = renderSheet();
    expect(panel()).toBeNull();
    setOpen(true);
    const dialog = screen.getByRole('dialog');
    const title = document.querySelector('[data-fdt="dialog-title"]') as HTMLElement;
    expect(title.textContent).toBe('Filters');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(
      document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent
    ).toBe('Narrow the list');
  });

  it('mounts at once when open from the start', () => {
    renderSheet({ open: true });
    expect(panel()).not.toBeNull();
    expect(panel()?.querySelector('[data-fdt="sheet"]')?.getAttribute('data-state')).toBe('open');
  });

  it('shows a decorative handle, a visual heading twin, the actions and the footer', () => {
    renderSheet({ open: true, actions: true, footer: true });
    const handle = document.querySelector('[data-fdt="sheet-handle"]') as HTMLElement;
    expect(handle.getAttribute('aria-hidden')).toBe('true');
    const header = document.querySelector('[data-fdt="sheet-header"]') as HTMLElement;
    expect(header.querySelector('[aria-hidden="true"]')?.textContent).toBe('Filters');
    expect(header.contains(screen.getByRole('button', { name: 'Reset' }))).toBe(true);
    const footer = document.querySelector('[data-fdt="sheet-footer"]') as HTMLElement;
    expect(footer.className).toContain('sticky');
    expect(footer.contains(screen.getByRole('button', { name: 'Show 3 scripts' }))).toBe(true);
  });

  it('builds the footer slot once per mount, and keeps a null footer as a present row', () => {
    let built = 0;
    /** A footer that counts its own creations (each read of a JSX prop builds anew). */
    function CountedFooter() {
      built += 1;
      return <Button>Apply</Button>;
    }
    render(() => (
      <Sheet
        open
        onClose={() => {}}
        title="Filters"
        restoreFocusTo={() => undefined}
        footer={<CountedFooter />}
      >
        <Button>First facet</Button>
      </Sheet>
    ));
    expect(built).toBe(1);
    expect(document.querySelectorAll('[data-fdt="sheet-footer"] button')).toHaveLength(1);
    cleanup();
    render(() => (
      <Sheet open onClose={() => {}} title="Filters" restoreFocusTo={() => undefined} footer={null}>
        <Button>First facet</Button>
      </Sheet>
    ));
    expect(document.querySelector('[data-fdt="sheet-footer"]')).not.toBeNull();
    expect(document.querySelector('[data-fdt="sheet-body"]')?.className).toContain('pb-2');
  });

  it('renders no footer row without a footer', () => {
    renderSheet({ open: true });
    expect(document.querySelector('[data-fdt="sheet-footer"]')).toBeNull();
    expect(document.querySelector('[data-fdt="sheet-body"]')?.className).toContain('pb-4');
  });

  it('anchors to the bottom edge, full width, rounded top, clamped with one inner scroller', () => {
    renderSheet({ open: true });
    const classes = (panel() as HTMLElement).className.split(' ');
    for (const expected of ['bottom-0', 'top-auto', 'left-0', 'right-0', 'translate-x-0']) {
      expect(classes).toContain(expected);
    }
    expect(classes).toContain('rounded-t-xl');
    expect(classes).toContain('max-h-[calc(100dvh-1.5rem)]');
    // The centered plate's geometry is gone (tailwind-merge resolved the overrides).
    for (const removed of ['top-16', 'left-1/2', '-translate-x-1/2', 'rounded-lg', 'border']) {
      expect(classes).not.toContain(removed);
    }
    const scroller = document.querySelector('[data-fdt="sheet"]') as HTMLElement;
    expect(scroller.className).toContain('overflow-y-auto');
    expect(scroller.className).toContain('min-h-0');
  });

  it('moves on the floating-chrome tokens only: slow entrance in, base standard out', async () => {
    const { setOpen } = renderSheet({ open: true });
    const enter = (panel() as HTMLElement).className;
    expect(enter).toContain('starting:translate-y-full');
    expect(enter).toContain('duration-[var(--motion-slow)]');
    expect(enter).toContain('ease-[var(--ease-entrance)]');
    expect(scrim()?.className).toContain('starting:opacity-0');
    stubTransitionDuration('0.18s');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setOpen(false);
    const exit = (panel() as HTMLElement).className;
    expect(exit).toContain('translate-y-full');
    expect(exit).toContain('duration-[var(--motion-base)]');
    expect(exit).toContain('ease-[var(--ease-standard)]');
    expect(exit).toContain('pointer-events-none');
    // Whole words: `starting:opacity-0` (the entrance) must not pass for the exit.
    const scrimExit = classesOf(scrim());
    expect(scrimExit).toContain('opacity-0');
    expect(scrimExit).toContain('pointer-events-none');
    expect(scrimExit).not.toContain('starting:opacity-0');
    for (const classes of [enter, exit, scrim()?.className ?? '']) {
      expect(classes).not.toMatch(/duration-[0-9]|transition-all|animate-/);
    }
    await vi.runAllTimersAsync();
  });
});

describe('Sheet dismissals', () => {
  it('requests a close on Escape, exactly once', async () => {
    const { onClose, setOpen } = renderSheet();
    setOpen(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(panel()).toBeNull();
    });
  });

  it('requests a close on a scrim press', async () => {
    const { onClose } = renderSheet({ open: true });
    scrim()?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(panel()).toBeNull();
    });
  });

  it('ignores a dismissal while the exit plays (the close it already is)', () => {
    stubTransitionDuration('0.18s');
    const { onClose, setOpen } = renderSheet({ open: true });
    setOpen(false);
    expect(panel()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays mounted exactly the computed exit duration, then unmounts', async () => {
    stubTransitionDuration('0.18s, 120ms');
    const { setOpen } = renderSheet({ open: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setOpen(false);
    expect(panel()?.querySelector('[data-fdt="sheet"]')?.getAttribute('data-state')).toBe(
      'closing'
    );
    await vi.advanceTimersByTimeAsync(179);
    expect(panel()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(panel()).toBeNull();
  });

  it('closes at once under reduced motion (the collapsed duration is the wait)', async () => {
    stubTransitionDuration('1e-05s');
    const { setOpen } = renderSheet({ open: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setOpen(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(panel()).toBeNull();
    expect(scrim()).toBeNull();
  });

  it('reopens as a fresh surface when shown again mid-exit', async () => {
    stubTransitionDuration('0.18s');
    const { setOpen } = renderSheet({ open: true });
    const first = panel();
    setOpen(false);
    setOpen(true);
    const second = panel();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(second?.querySelector('[data-fdt="sheet"]')?.getAttribute('data-state')).toBe('open');
    // The cancelled exit never closes the reopened sheet.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(panel()).toBe(second);
  });
});

describe('Sheet dismissals in a browser-like style (no keyframe animation)', () => {
  it('plays the exit on Escape — the panel stays mounted through it — then restores focus', async () => {
    stubBrowserStyle();
    const { onClose, opener, setOpen } = renderSheet();
    await openFromOpener(opener, setOpen);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sheetState()).toBe('closing');
    expect(classesOf(panel())).toContain('translate-y-full');
    await vi.advanceTimersByTimeAsync(179);
    expect(sheetState()).toBe('closing');
    await vi.advanceTimersByTimeAsync(1);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('plays the exit on a scrim press the armed library sees too, then restores focus', async () => {
    stubBrowserStyle();
    const { onClose, opener, setOpen } = renderSheet();
    await openFromOpener(opener, setOpen);
    // Let the library arm its outside-pointer listener (a task after mount), as by any real click.
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    scrim()?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sheetState()).toBe('closing');
    expect(classesOf(scrim())).toContain('opacity-0');
    await vi.advanceTimersByTimeAsync(180);
    expect(panel()).toBeNull();
    expect(scrim()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('stays visibly open when the caller ignores the request, and asks again on the next one', async () => {
    stubBrowserStyle();
    const { onClose } = renderSheet({ open: true, ignoreClose: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // The visible state follows `open`, which the caller kept: no hidden "open" sheet.
    expect(sheetState()).toBe('open');
    expect(classesOf(panel())).not.toContain('translate-y-full');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(sheetState()).toBe('open');
  });
});

describe('Sheet focus restore', () => {
  it('focuses the restore target once a close finishes', async () => {
    const { opener, setOpen } = renderSheet();
    await openFromOpener(opener, setOpen);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(panel()).toBeNull();
    });
    expect(document.activeElement).toBe(opener);
  });

  it('restores after a close the caller made itself (an apply action)', async () => {
    const { opener, setOpen } = renderSheet();
    await openFromOpener(opener, setOpen);
    setOpen(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it('leaves focus alone, without throwing, when the target was removed', async () => {
    const { opener, setOpen } = renderSheet();
    await openFromOpener(opener, setOpen);
    opener.remove();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(panel()).toBeNull();
    });
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves focus alone when there is no target', async () => {
    const { opener, setOpen, setTarget } = renderSheet();
    await openFromOpener(opener, setOpen);
    setTarget(undefined);
    setOpen(false);
    await waitFor(() => {
      expect(panel()).toBeNull();
    });
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves focus on a top-layer control the user moved to during the exit', async () => {
    stubBrowserStyle();
    const { opener, setOpen } = renderSheet();
    await openFromOpener(opener, setOpen);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setOpen(false);
    const toast = screen.getByRole('button', { name: 'Toast action' });
    toast.focus();
    expect(document.activeElement).toBe(toast);
    await vi.advanceTimersByTimeAsync(180);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(toast);
  });

  it('keeps focus in a sheet reopened mid-exit past the first exit’s end', async () => {
    stubBrowserStyle();
    const { opener, setOpen } = renderSheet();
    await openFromOpener(opener, setOpen);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setOpen(false);
    await vi.advanceTimersByTimeAsync(100);
    setOpen(true);
    // The reopened mount's autofocus lands inside it (the library's task-deferred autofocus).
    await vi.advanceTimersByTimeAsync(0);
    const reopened = panel() as HTMLElement;
    expect(reopened.contains(document.activeElement)).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(panel()).toBe(reopened);
    expect(reopened.contains(document.activeElement)).toBe(true);
  });

  it('gives a close after a mid-exit reopen its full exit (the first exit’s timer is cancelled)', async () => {
    stubBrowserStyle();
    const { opener, setOpen } = renderSheet();
    await openFromOpener(opener, setOpen);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setOpen(false);
    await vi.advanceTimersByTimeAsync(50);
    setOpen(true);
    await vi.advanceTimersByTimeAsync(50);
    setOpen(false);
    // t=180 would end the first exit; the second one began at t=100.
    await vi.advanceTimersByTimeAsync(179);
    expect(sheetState()).toBe('closing');
    await vi.advanceTimersByTimeAsync(1);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('restores nothing when the sheet itself unmounts mid-exit', async () => {
    stubTransitionDuration('0.05s');
    const { opener, setOpen } = renderSheet();
    await openFromOpener(opener, setOpen);
    setOpen(false);
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(document.activeElement).not.toBe(opener);
  });
});

describe('focusWouldBeLost', () => {
  it('is true on the body or inside the panel, false on a control outside', () => {
    document.body.innerHTML =
      '<div id="p"><button id="in">In</button></div><button id="out">Out</button>';
    const sheetPanel = document.getElementById('p') as HTMLElement;
    (document.activeElement as HTMLElement | null)?.blur();
    expect(focusWouldBeLost(document, sheetPanel)).toBe(true);
    document.getElementById('in')?.focus();
    expect(focusWouldBeLost(document, sheetPanel)).toBe(true);
    document.getElementById('out')?.focus();
    expect(focusWouldBeLost(document, sheetPanel)).toBe(false);
  });

  it('with no panel (gone before the close), is true only on the body', () => {
    document.body.innerHTML = '<button id="out">Out</button>';
    (document.activeElement as HTMLElement | null)?.blur();
    expect(focusWouldBeLost(document, null)).toBe(true);
    document.getElementById('out')?.focus();
    expect(focusWouldBeLost(document, null)).toBe(false);
  });
});

describe('restoreFocus', () => {
  it('focuses a connected target and reports it', () => {
    document.body.innerHTML = '<button id="t">T</button>';
    const target = document.getElementById('t') as HTMLElement;
    expect(restoreFocus(target)).toBe(true);
    expect(document.activeElement).toBe(target);
  });

  it('is a no-op for a missing or disconnected target', () => {
    expect(restoreFocus(undefined)).toBe(false);
    const detached = document.createElement('button');
    expect(restoreFocus(detached)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('reports a target that refuses focus (disabled) without moving focus', () => {
    document.body.innerHTML = '<button id="t" disabled>T</button>';
    expect(restoreFocus(document.getElementById('t') as HTMLElement)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
