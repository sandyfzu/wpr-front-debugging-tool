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
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { RefreshCw } from 'lucide-solid';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * Fresh-module render of one tooltip — returns the trigger element. The file
 * opts out of the cross-tooltip skip-delay window (`0`) so a single tooltip
 * exercises the plain open/close pair; the module-reset is what keeps tests
 * from sharing state.
 */
async function renderTooltip(): Promise<HTMLElement> {
  vi.resetModules();
  const { Tooltip } = await import('./tooltip');
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
  vi.resetModules();
  const { Tooltip } = await import('./tooltip');
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
      // The reserved-row pattern: a disabled control must keep explaining
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
});
