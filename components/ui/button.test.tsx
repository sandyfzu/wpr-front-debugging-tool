/**
 * Render tests for the shared button: variant/size classes, the disabled and
 * busy behaviors (native single-submit + `aria-busy`), and caller class
 * precedence. Class-level assertions pin *which token classes* are attached —
 * never pixel output.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  BUTTON_SIZES,
  BUTTON_VARIANT_CLASSES,
  BUTTON_VARIANT_HOVER_CLASSES,
  BUTTON_VARIANTS,
  invokeClickHandler,
  isHeld
} from './button';

afterEach(() => {
  cleanup();
});

describe('Button', () => {
  it('renders a button-typed control carrying the test hook', () => {
    render(() => <Button>Run</Button>);
    const button = screen.getByRole('button', { name: 'Run' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.dataset.fdt).toBe('button');
  });

  it('applies every variant and size class', () => {
    render(() => (
      <div>
        <For each={BUTTON_VARIANTS}>
          {(variant) => <Button variant={variant}>{variant}</Button>}
        </For>
        <For each={BUTTON_SIZES}>{(size) => <Button size={size}>{size}</Button>}</For>
      </div>
    ));
    for (const [variant, classes] of [
      ['primary', 'bg-accent-strong text-on-accent'],
      ['secondary', 'border-line-2 bg-surface-2'],
      ['ghost', 'border-transparent text-fg-secondary'],
      ['danger', 'bg-status-error-soft text-status-error']
    ] as const) {
      const button = screen.getByRole('button', { name: variant });
      for (const token of classes.split(' ')) {
        expect(button.className).toContain(token);
      }
    }
    expect(screen.getByRole('button', { name: 'sm' }).className).toContain('h-6');
    expect(screen.getByRole('button', { name: 'md' }).className).toContain('h-7');
  });

  it('flips to the busy state while loading: disabled, aria-busy, spinner present', () => {
    const onClick = vi.fn();
    render(() => (
      <Button loading onClick={onClick}>
        Reload data
      </Button>
    ));
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.dataset.fdtLoading).toBe('');
    expect(button.querySelector('[data-fdt-spinner]')).toBeTruthy();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('holds a busy button focusable: aria-disabled, aria-busy, spinner, clicks swallowed', () => {
    const onClick = vi.fn();
    const [busy, setBusy] = createSignal(true);
    render(() => (
      <Button busy={busy()} onClick={onClick}>
        Retry
      </Button>
    ));
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Retry' });
    button.focus();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.dataset.fdtLoading).toBe('');
    expect(button.querySelector('[data-fdt-spinner]')).toBeTruthy();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    // Leaving busy restores the live button without remounting.
    setBusy(false);
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.querySelector('[data-fdt-spinner]')).toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps a caller aria-disabled when not busy', () => {
    render(() => (
      <Button aria-disabled="true" busy={false}>
        Held
      </Button>
    ));
    expect(screen.getByRole('button').getAttribute('aria-disabled')).toBe('true');
  });

  it('invokes plain and bound click handlers, and tolerates none', () => {
    const event = new MouseEvent('click') as Parameters<typeof invokeClickHandler>[1];
    const plain = vi.fn();
    invokeClickHandler(plain, event);
    expect(plain).toHaveBeenCalledWith(event);
    const bound = vi.fn();
    invokeClickHandler([bound, 'row-1'], event);
    expect(bound).toHaveBeenCalledWith('row-1', event);
    expect(() => {
      invokeClickHandler(undefined, event);
    }).not.toThrow();
  });

  it('runs a bound click handler from JSX', () => {
    const bound = vi.fn();
    render(() => <Button onClick={[bound, 7]}>Bound</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(bound).toHaveBeenCalledTimes(1);
    expect(bound.mock.calls[0]?.[0]).toBe(7);
  });

  it('fires clicks while enabled and stops when disabled', () => {
    const onClick = vi.fn();
    render(() => <Button onClick={onClick}>Reload data</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    cleanup();
    render(() => (
      <Button disabled onClick={onClick}>
        Reload data
      </Button>
    ));
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps pointer feedback on a live button and drops it on a held one', () => {
    /** The pointer-state utilities on a class string (hover lift / press). */
    const pointerTokens = (className: string): string[] =>
      className.split(/\s+/).filter((token) => /^(hover|active):/.test(token));
    for (const variant of BUTTON_VARIANTS) {
      render(() => (
        <div>
          <Button variant={variant}>live</Button>
          <Button variant={variant} disabled>
            disabled
          </Button>
          <Button variant={variant} loading>
            loading
          </Button>
          <Button variant={variant} busy>
            busy
          </Button>
          <Button variant={variant} aria-disabled="true">
            held
          </Button>
          <Button variant={variant} aria-disabled={false}>
            not held
          </Button>
        </div>
      ));
      const live = screen.getByRole('button', { name: 'live' }).className;
      // The live look is the variant's rest classes plus its pointer feedback, unchanged.
      for (const token of `${BUTTON_VARIANT_CLASSES[variant]} ${BUTTON_VARIANT_HOVER_CLASSES[variant]}`.split(
        ' '
      )) {
        expect(live, variant).toContain(token);
      }
      expect(pointerTokens(live).length, variant).toBeGreaterThan(0);
      expect(pointerTokens(screen.getByRole('button', { name: 'not held' }).className)).toEqual(
        pointerTokens(live)
      );
      for (const name of ['disabled', 'loading', 'busy', 'held']) {
        const held = screen.getByRole('button', { name }).className;
        expect(pointerTokens(held), `${variant} ${name}`).toEqual([]);
        for (const token of BUTTON_VARIANT_CLASSES[variant].split(' ')) {
          expect(held, `${variant} ${name}`).toContain(token);
        }
      }
      cleanup();
    }
  });

  it('reads held from the native and the ARIA disabled state', () => {
    expect(isHeld(undefined, undefined)).toBe(false);
    expect(isHeld(false, false)).toBe(false);
    expect(isHeld(false, 'false')).toBe(false);
    expect(isHeld(true, undefined)).toBe(true);
    expect(isHeld(false, true)).toBe(true);
    expect(isHeld(undefined, 'true')).toBe(true);
  });

  it('lets the caller win over the preset classes', () => {
    render(() => <Button class="px-4">Run</Button>);
    const button = screen.getByRole('button');
    // The caller's padding wins over the preset size padding; height stays.
    expect(button.className).toContain('px-4');
    expect(button.className).not.toContain('px-2.5');
    expect(button.className).toContain('h-7');
  });
});
