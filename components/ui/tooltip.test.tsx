/**
 * Render tests for the tooltip — the APG semantics Kobalte drives through our
 * wrapper: `role="tooltip"` content, hover + focus opening (focus opens
 * immediately, hover after the configured delay), portal'd rendering, and the
 * described-by linkage to the trigger.
 *
 * Portability note: like the tabs, the exit uses solid-presence, whose
 * animationend tracking cannot resolve in happy-dom (`animationName` reads
 * `""`), so tests assert the open state via `aria-describedby` rather than
 * content removal; in Chromium the content unmounts on close.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './tooltip';
import { RefreshCw } from 'lucide-solid';

afterEach(() => {
  cleanup();
});

/** Mounts our wrapper with the common icon trigger; returns the trigger element. */
function renderTooltip(): HTMLElement {
  render(() => (
    <Tooltip content="Re-fetched data" openDelay={300}>
      <RefreshCw size={12} />
    </Tooltip>
  ));
  return screen.getByRole('button');
}

describe('Tooltip', () => {
  it('renders the trigger with the tooltip wiring (no content until shown)', () => {
    const trigger = renderTooltip();
    // The trigger wraps the icon content and links only once shown.
    expect(trigger.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });

  it('opens on hover after the delay and closes after the leave delay', () => {
    vi.useFakeTimers();
    try {
      const trigger = renderTooltip();
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

  it('opens immediately on keyboard focus and closes on blur', () => {
    const trigger = renderTooltip();
    fireEvent.focus(trigger);
    const content = screen.getByRole('tooltip');
    expect(content.textContent).toContain('Re-fetched data');
    expect(trigger.getAttribute('aria-describedby')).toBe(content.id);
    fireEvent.blur(trigger);
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });
});
