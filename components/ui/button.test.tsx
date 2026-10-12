/**
 * Render tests for the shared button: variant/size classes, the disabled and
 * busy behaviors (native single-submit + `aria-busy`), and caller class
 * precedence. Class-level assertions pin *which token classes* are attached —
 * never pixel output.
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, BUTTON_SIZES, BUTTON_VARIANTS } from './button';

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

  it('lets the caller win over the preset classes', () => {
    render(() => <Button class="px-4">Run</Button>);
    const button = screen.getByRole('button');
    // The caller's padding wins over the preset size padding; height stays.
    expect(button.className).toContain('px-4');
    expect(button.className).not.toContain('px-2.5');
    expect(button.className).toContain('h-7');
  });
});
