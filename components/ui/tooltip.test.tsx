/**
 * Render tests for the tooltip — the APG semantics Kobalte drives through our
 * wrapper: `role="tooltip"` content, hover + focus opening (focus opens
 * immediately, hover after the configured delay), portal'd rendering, and the
 * described-by linkage to the trigger.
 *
 * The wrapper is imported FRESH per test: Kobalte keeps cross-tooltip state
 * at module level (warmed-up/skip-delay heuristics armed with real timers
 * that survive `cleanup()`), so isolated-per-test module state is what makes
 * the delayed-open pins order-independent — any close in a previous test
 * could otherwise turn the next open into the immediate branch.
 *
 * Portability note: like the tabs, the exit uses solid-presence, whose
 * animationend tracking cannot resolve in happy-dom (`animationName` reads
 * `""`), so tests assert the open state via `aria-describedby` rather than
 * content removal; in Chromium the content unmounts on close.
 *
 * One runtime per test: the reset also re-evaluates the inlined Solid
 * runtime, so `render`, `createSignal` and the icon are re-imported with the
 * wrapper (`importFresh`) and disposed by that same copy's `cleanup` — a
 * component on a second runtime would outlive `cleanup()` and leak its portal
 * into the next test. DOM-level helpers (`screen`, `fireEvent`, …) stay
 * static: they carry no Solid state.
 */
import { fireEvent, screen, waitFor, within } from '@solidjs/testing-library';
import type { render as RenderFn } from '@solidjs/testing-library';
import type { createSignal as CreateSignalFn } from 'solid-js';
import type RefreshCwIcon from 'lucide-solid/icons/refresh-cw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tooltip as TooltipComponent } from './tooltip';

/** The modules one test renders with — all evaluated on one fresh Solid runtime. */
interface FreshModules {
  Tooltip: typeof TooltipComponent;
  RefreshCw: typeof RefreshCwIcon;
  render: typeof RenderFn;
  createSignal: typeof CreateSignalFn;
}

/** `cleanup` of the testing-library copy the current test rendered with. */
let cleanupFresh: (() => void) | undefined;

afterEach(() => {
  cleanupFresh?.();
  cleanupFresh = undefined;
});

/**
 * Resets the module registry and imports the wrapper with the Solid stack it
 * renders on, so its owners and the renderer share one runtime.
 *
 * @returns The fresh modules; their `cleanup` runs after the test.
 */
async function importFresh(): Promise<FreshModules> {
  vi.resetModules();
  const [{ Tooltip }, { default: RefreshCw }, testing, { createSignal }] = await Promise.all([
    import('./tooltip'),
    import('lucide-solid/icons/refresh-cw'),
    import('@solidjs/testing-library'),
    import('solid-js')
  ]);
  cleanupFresh = testing.cleanup;
  return { Tooltip, RefreshCw, render: testing.render, createSignal };
}

/**
 * Fresh-module render of one tooltip — returns the trigger element. The file
 * opts out of the cross-tooltip skip-delay window (`0`) so a single tooltip
 * exercises the plain open/close pair; the module-reset is what keeps tests
 * from sharing state.
 */
async function renderTooltip(): Promise<HTMLElement> {
  const { Tooltip, RefreshCw, render } = await importFresh();
  render(() => (
    <Tooltip content="Re-fetched data" openDelay={300} skipDelayDuration={0}>
      <RefreshCw size={12} />
    </Tooltip>
  ));
  return screen.getByRole('button');
}

/**
 * Same fresh-module render with an explicit trigger-prop override (the
 * disabled vector); returns the trigger element.
 */
async function renderTooltipWith(props: { disabled?: boolean }): Promise<HTMLElement> {
  const { Tooltip, RefreshCw, render } = await importFresh();
  render(() => (
    <Tooltip content="Re-fetched data" openDelay={300} skipDelayDuration={0} {...props}>
      <RefreshCw size={12} />
    </Tooltip>
  ));
  return screen.getByRole('button');
}

describe('Tooltip', () => {
  it('renders the trigger with the tooltip wiring (no content until shown)', async () => {
    const trigger = await renderTooltip();
    // The trigger wraps the icon content and links only once shown.
    expect(trigger.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });

  it('opens on hover after the delay and closes after the leave delay', async () => {
    vi.useFakeTimers();
    try {
      const trigger = await renderTooltip();
      fireEvent.pointerEnter(trigger);
      vi.advanceTimersByTime(299);
      expect(screen.queryByRole('tooltip')).toBeNull();
      vi.advanceTimersByTime(1);
      const content = screen.getByRole('tooltip');
      expect(content.textContent).toContain('Re-fetched data');
      expect(trigger.getAttribute('aria-describedby')).toBe(content.id);
      fireEvent.pointerLeave(trigger);
      vi.advanceTimersByTime(300);
      expect(trigger.getAttribute('aria-describedby')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens immediately on keyboard focus and closes on blur', async () => {
    const trigger = await renderTooltip();
    fireEvent.focus(trigger);
    const content = screen.getByRole('tooltip');
    expect(content.textContent).toContain('Re-fetched data');
    expect(trigger.getAttribute('aria-describedby')).toBe(content.id);
    fireEvent.blur(trigger);
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });

  it('floats as a raised chip: 6 px corner, surface-3 under its line, 8 x 4 px padding', async () => {
    const trigger = await renderTooltip();
    fireEvent.focus(trigger);
    const content = screen.getByRole('tooltip');
    expect(content.dataset.fdt).toBe('tooltip');
    const tokens = content.className.split(/\s+/);
    expect(tokens).toEqual(
      expect.arrayContaining([
        'rounded-md',
        'border',
        'border-line-3',
        'bg-surface-3',
        'px-2',
        'py-1',
        'text-2xs',
        'text-fg-primary',
        'shadow-elev-2'
      ])
    );
    expect(tokens).not.toContain('rounded');
    expect(tokens).not.toContain('px-1.5');
    fireEvent.blur(trigger);
  });

  it('closes on Escape (the APG tooltip dismissal), acknowledged from the content', async () => {
    const trigger = await renderTooltip();
    fireEvent.focus(trigger);
    expect(trigger.getAttribute('aria-describedby')).not.toBeNull();
    // Kobalte listens for the dismissal straight on the shown content — fire
    // there, matching how a buffered key event reaches the layer.
    const content = screen.getByRole('tooltip');
    fireEvent.keyDown(content, { key: 'Escape' });
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });

  it('renders a disabled trigger that still opens on hover (disabled-but-explained)', async () => {
    vi.useFakeTimers();
    try {
      // The disabled-but-explained pattern: a disabled control must keep explaining
      // itself, so the trigger carries the native attribute without
      // pointer-events suppression — hover stays the open path.
      const trigger = await renderTooltipWith({ disabled: true });
      expect(trigger.getAttribute('disabled')).not.toBeNull();
      fireEvent.pointerEnter(trigger);
      vi.advanceTimersByTime(300);
      expect(screen.getByRole('tooltip').textContent).toContain('Re-fetched data');
      fireEvent.pointerLeave(trigger);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a real anchor trigger (the nav-row form) with the same wiring', async () => {
    const { Tooltip, render, createSignal } = await importFresh();
    const [active, setActive] = createSignal(true);
    render(() => (
      <Tooltip
        as="a"
        href="#/javascript"
        ariaCurrent={active()}
        content="JavaScript — delayed 1/2"
        skipDelayDuration={0}
      >
        <span class="sr-only">JavaScript</span>
      </Tooltip>
    ));
    const trigger = screen.getByRole('link', { name: 'JavaScript' });
    expect(trigger.getAttribute('href')).toBe('#/javascript');
    expect(trigger.getAttribute('type')).toBeNull(); // the button's built-in `type` never leaks
    expect(trigger.getAttribute('aria-current')).toBe('page');
    // Focus opens immediately, exactly like the button form.
    fireEvent.focus(trigger);
    const content = screen.getByRole('tooltip');
    expect(content.textContent).toContain('JavaScript — delayed 1/2');
    expect(trigger.getAttribute('aria-describedby')).toBe(content.id);
    fireEvent.blur(trigger);
    expect(trigger.getAttribute('aria-describedby')).toBeNull();

    // The marker follows caller state through the polymorphic merge — the
    // mergeProps chains stay reactive end to end.
    setActive(false);
    await Promise.resolve();
    expect(trigger.getAttribute('aria-current')).toBeNull();
  });

  it('hands the trigger element to a callback ref in the button and anchor forms', async () => {
    const { Tooltip, RefreshCw, render } = await importFresh();
    const refs: HTMLElement[] = [];
    render(() => (
      <>
        <Tooltip content="Expand" ariaLabel="Expand" ref={(el) => refs.push(el)}>
          <RefreshCw size={12} />
        </Tooltip>
        <Tooltip as="a" href="#/javascript" content="JavaScript" ref={(el) => refs.push(el)}>
          <span class="sr-only">JavaScript</span>
        </Tooltip>
      </>
    ));
    expect(refs).toEqual([
      screen.getByRole('button', { name: 'Expand' }),
      screen.getByRole('link', { name: 'JavaScript' })
    ]);
  });

  it('carries the opener-trigger attributes the shell control uses', async () => {
    // The palette trigger's shape: icon-only button whose tooltip wraps a
    // real control — aria-label names it, haspopup/expanded state the
    // opened dialog, and the click forwards. (Pinned here in the wrapper's
    // own suite, not only end-to-end at the shell.)
    const { Tooltip, render, createSignal } = await importFresh();
    let clicks = 0;
    const [expanded, setExpanded] = createSignal(false);
    render(() => (
      <Tooltip
        content="Opens the command palette (⌘ K)"
        ariaLabel="Command palette"
        ariaHasPopup="dialog"
        ariaExpanded={expanded()}
        onClick={() => {
          clicks += 1;
        }}
        skipDelayDuration={0}
      >
        <span aria-hidden="true">⌘</span>
      </Tooltip>
    ));
    const trigger = screen.getByRole('button', { name: 'Command palette' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click(); // the click forwards to the opener
    expect(clicks).toBe(1);
    setExpanded(true);
    await Promise.resolve();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  describe('menu-trigger form (the rail overflow trigger)', () => {
    /**
     * One physical trigger carrying both contracts: the shared tooltip's
     * attribution axis and Kobalte's menu trigger. Renders a minimal menu
     * around it so the open side is exercisable in the same tree.
     */
    async function renderMenuTrigger(options?: { expanded: boolean }): Promise<HTMLElement> {
      const { Tooltip, render, createSignal } = await importFresh();
      // Imported after the reset, so the menu shares the fresh runtime.
      const { Menu, MENU_CONTENT_CLASSES, MENU_ITEM_CLASSES } = await import('./menu');
      const [open, setOpen] = createSignal(options?.expanded ?? false);
      render(() => (
        <Menu.Root open={open()} onOpenChange={setOpen} modal={false} placement="right-start">
          <Tooltip
            as="menu-trigger"
            content="More pages"
            ariaLabel="More pages"
            ariaHasPopup="menu"
            ariaExpanded={open()}
            skipDelayDuration={0}
          >
            <span aria-hidden="true">⌄</span>
          </Tooltip>
          <Menu.Portal>
            <Menu.Content class={MENU_CONTENT_CLASSES}>
              <Menu.Item as="a" href="#/lazyload" class={MENU_ITEM_CLASSES} closeOnSelect>
                Lazyload
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      ));
      return screen.getByRole('button', { name: 'More pages' });
    }

    it('carries the menu trigger contract on the same element the tooltip wraps', async () => {
      const trigger = await renderMenuTrigger();
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu'); // the caller's value wins
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('menu')).toBeNull();
      // Kobalte's trigger toggles on pointer down (the touch-pointer click
      // path is the only click-toggle), so the synthetic drive is the real
      // pointer sequence.
      fireEvent.pointerDown(trigger);
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeTruthy();
      });
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('keeps the tooltip wiring whole over the composed trigger — and hides when the trigger is clicked', async () => {
      const trigger = await renderMenuTrigger();
      // The attribution axis: focus opens the shared tooltip (described-by).
      fireEvent.focus(trigger);
      const content = screen.getByRole('tooltip');
      expect(content.textContent).toContain('More pages');
      expect(trigger.getAttribute('aria-describedby')).toBe(content.id);
      // The menu side: a pointer-down toggle opens the menu and (on the
      // click the pointer press continues into) the tooltip leaves — the
      // attribution never stacks over the opening surface.
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeTruthy();
      });
      expect(trigger.getAttribute('aria-describedby')).toBeNull();
    });

    it('the menu item keeps its anchor form inside the composed tree', async () => {
      await renderMenuTrigger({ expanded: true });
      const menu = await screen.findByRole('menu');
      const item = within(menu).getByRole('menuitem', { name: 'Lazyload' });
      expect(item.getAttribute('href')).toBe('#/lazyload');
    });
  });
});
