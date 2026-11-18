/**
 * The toggle chip's contract: a native `<button aria-pressed>` (keyboard by
 * the platform), pressed state on three carriers (attribute, hook, raise),
 * the controlled flip loop, counts, and the disabled state's readable text.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FOCUS_RING } from '../../../../components/ui/classes';
import { SEGMENT_COUNT, SEGMENT_RAISED, SEGMENTED_TRAY } from '../../../../components/ui/segmented';
import { ToggleChip } from './toggle-chip';

afterEach(() => {
  cleanup();
});

/** The chip's button. */
function chip(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button');
}

describe('ToggleChip', () => {
  it('renders unpressed: aria-pressed=false, no hook, idle tone, inside the tray', () => {
    render(() => (
      <ToggleChip value="minified" label="Minified" pressed={false} onChange={() => {}} />
    ));
    expect(chip().tagName).toBe('BUTTON');
    expect(chip().type).toBe('button');
    expect(chip().getAttribute('aria-pressed')).toBe('false');
    expect(chip().hasAttribute('data-fdt-pressed')).toBe(false);
    expect(chip().getAttribute('data-fdt-toggle-chip')).toBe('minified');
    expect(chip().className).not.toContain(SEGMENT_RAISED);
    expect(chip().className).toContain('text-fg-secondary');
    expect(chip().className).toContain(FOCUS_RING);
    expect(chip().parentElement?.className).toBe(SEGMENTED_TRAY);
  });

  it('renders pressed: aria-pressed=true, the hook and the raise', () => {
    render(() => <ToggleChip value="minified" label="Minified" pressed onChange={() => {}} />);
    expect(chip().getAttribute('aria-pressed')).toBe('true');
    expect(chip().hasAttribute('data-fdt-pressed')).toBe(true);
    expect(chip().className).toContain(SEGMENT_RAISED);
    expect(chip().className).toContain('text-fg-primary');
  });

  it('flips through the controlled loop on each activation', async () => {
    const [pressed, setPressed] = createSignal(false);
    render(() => (
      <ToggleChip value="excluded" label="Excluded" pressed={pressed()} onChange={setPressed} />
    ));
    fireEvent.click(chip());
    await expect.poll(() => chip().getAttribute('aria-pressed'), { timeout: 300 }).toBe('true');
    fireEvent.click(chip());
    await expect.poll(() => chip().getAttribute('aria-pressed'), { timeout: 300 }).toBe('false');
  });

  it('reports the flipped state and never moves on its own (controlled)', () => {
    const onChange = vi.fn<(pressed: boolean) => void>();
    render(() => <ToggleChip value="font" label="Font" pressed onChange={onChange} />);
    fireEvent.click(chip());
    expect(onChange).toHaveBeenCalledWith(false);
    expect(chip().getAttribute('aria-pressed')).toBe('true');
  });

  it('is keyboard-reachable natively: a focusable button (Enter/Space activate it by the platform)', () => {
    render(() => (
      <ToggleChip value="minified" label="Minified" pressed={false} onChange={() => {}} />
    ));
    // No tabindex override and no custom key handling: the native button's
    // own Tab stop and Enter/Space activation are the whole contract.
    expect(chip().hasAttribute('tabindex')).toBe(false);
    chip().focus();
    expect(document.activeElement).toBe(chip());
  });

  it('shows a count (zero included) muted, inside the accessible name; zero stays pressable', () => {
    const onChange = vi.fn<(pressed: boolean) => void>();
    render(() => (
      <ToggleChip value="async" label="Async" count={0} pressed={false} onChange={onChange} />
    ));
    const count = chip().querySelector('[data-fdt-toggle-count]');
    expect(count?.textContent).toBe('0');
    expect(count?.className).toBe(SEGMENT_COUNT);
    expect(screen.getByRole('button', { name: 'Async 0' })).toBe(chip());
    expect(chip().disabled).toBe(false);
    fireEvent.click(chip());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders no count element without a count', () => {
    render(() => <ToggleChip value="font" label="Font" pressed={false} onChange={() => {}} />);
    expect(chip().querySelector('[data-fdt-toggle-count]')).toBeNull();
    expect(chip().textContent).toBe('Font');
  });

  it('disables natively with muted readable text, no hover, no opacity, and a reason', () => {
    const onChange = vi.fn();
    render(() => (
      <ToggleChip
        value="minified"
        label="Minified"
        pressed={false}
        disabled
        title="No minified scripts on this page"
        onChange={onChange}
      />
    ));
    expect(chip().disabled).toBe(true);
    expect(chip().title).toBe('No minified scripts on this page');
    expect(chip().className).toContain('text-fg-muted');
    expect(chip().className).toContain('cursor-not-allowed');
    expect(chip().className).not.toMatch(/hover:|opacity/u);
    fireEvent.click(chip());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('throws naming the chip on an invalid count', () => {
    expect(() =>
      render(() => (
        <ToggleChip value="font" label="Font" count={2.5} pressed={false} onChange={() => {}} />
      ))
    ).toThrow(/"font": count must be a non-negative integer/u);
  });
});
