/**
 * Render tests for the shared switch: toggle through click (the 24px control,
 * or the visible label's label→input forwarding — Kobalte's toggle surfaces),
 * the keyboard paths (the hidden input's native activation, plus the
 * control's Space keydown affordance), controlled/initial values, the naming
 * contract and the disabled treatment.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Switch } from './switch';

afterEach(() => {
  cleanup();
});

/** The switch's wrapper root of the rendered instance. */
function rootOf(): Element {
  const input = screen.getByRole('switch');
  const root = input.closest('[data-fdt="switch"]');
  return root as Element;
}

/** The track control (the 24px toggle surface). */
function trackOf(): Element {
  return rootOf().querySelector('[data-fdt-switch-track]') as Element;
}

/**
 * The rendered label/track sibling order of the switch root (DOM order) —
 * the order property the `labelSide` prop promises. The hidden input is
 * filtered out; only these two kinds are compared.
 */
function getSiblingsOrder(): Array<'track' | 'label'> {
  return Array.from(rootOf().children)
    .map((node) => {
      const el = node as HTMLElement;
      if (el.hasAttribute('data-fdt-switch-track')) return 'track' as const;
      if (el.hasAttribute('data-fdt-switch-label')) return 'label' as const;
      return null;
    })
    .filter((kind) => kind !== null);
}

describe('Switch', () => {
  it('renders the hidden role="switch" input with its naming and state hooks', () => {
    render(() => <Switch label="Delay JavaScript" />);
    const input = screen.getByRole('switch');
    expect(input.getAttribute('aria-label')).toBeNull();
    // The visible label automatically names the control (Kobalte id wiring).
    expect(input.getAttribute('aria-labelledby')).not.toBeNull();
    expect(input.getAttribute('aria-checked')).toBe('false');
    expect(rootOf().hasAttribute('data-fdt-switch-labeled')).toBe(true);
    expect(input.getAttribute('type')).toBe('checkbox');
  });

  it('toggles on control click and reports the new state', () => {
    const onChange = vi.fn();
    render(() => <Switch label="Delay JavaScript" onChange={onChange} />);
    fireEvent.click(trackOf());
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('toggles with Space on the control (Kobalte keyboard-complete affordance)', () => {
    const onChange = vi.fn();
    render(() => <Switch aria-label="Wrap long lines" onChange={onChange} />);
    fireEvent.keyDown(trackOf(), { key: ' ' });
    expect(onChange).toHaveBeenCalledWith(true);
    // The name comes from the aria-label path (no visible label rendered).
    expect(screen.getByRole('switch').getAttribute('aria-label')).toBe('Wrap long lines');
  });

  it('toggles via the hidden input (native keyboard activation end state)', () => {
    const onChange = vi.fn();
    render(() => <Switch aria-label="Native path" onChange={onChange} />);
    // A keyboard user's Space/Enter lands on the hidden input — the input's
    // own activation is the same end state a screen reader announces.
    const input = screen.getByRole<HTMLInputElement>('switch');
    input.click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(input.getAttribute('aria-checked')).toBe('true');
  });

  it('toggles on the visible label click', () => {
    const onChange = vi.fn();
    render(() => <Switch label="Show live source" onChange={onChange} />);
    fireEvent.click(screen.getByText('Show live source'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('follows the controlled value loop', async () => {
    // The parent owns the value signal; the callback's payload is recorded in
    // a plain local so the assertion reads a settled value, not a live signal.
    const [checked, setChecked] = createSignal(false);
    render(() => (
      <Switch
        aria-label="Controlled"
        checked={checked()}
        onChange={(value) => {
          setChecked(value);
        }}
      />
    ));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(trackOf());
    await expect
      .poll(() => screen.getByRole('switch').getAttribute('aria-checked'), { timeout: 300 })
      .toBe('true');
  });

  it('respects the uncontrolled initial state and flips from there', () => {
    const onChange = vi.fn();
    render(() => <Switch aria-label="Initial" defaultChecked onChange={onChange} />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(trackOf());
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('orders the label to the side the caller asked for (DOM order, not only a hook)', () => {
    // Default `end`/control-lead: the track precedes the label in the DOM.
    render(() => <Switch label="Control first" />);
    expect(getSiblingsOrder()).toEqual(['track', 'label']);
    cleanup();
    // `start`: the label precedes the control — pinned as real sibling order
    // (the `data-fdt-switch-side` hook records intent, this pins the render).
    render(() => <Switch label="Label first" labelSide="start" />);
    expect(getSiblingsOrder()).toEqual(['label', 'track']);
  });

  it('stays inert when disabled (no toggle, dimmed, hover explainable)', () => {
    const onChange = vi.fn();
    render(() => <Switch label="Locked" disabled onChange={onChange} />);
    fireEvent.click(trackOf());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    // The shared disabled treatment (dimmed, never pointer-events-killed).
    const root = rootOf();
    expect(root.className).toContain('disabled:opacity-50');
    expect(root.className).not.toContain('pointer-events-none');
  });
});
