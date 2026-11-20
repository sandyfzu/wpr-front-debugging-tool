/**
 * Render tests for the shared text field: density classes, the invalid paint
 * driven by `aria-invalid`, and caller precedence.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Input } from './input';

afterEach(() => {
  cleanup();
});

describe('Input', () => {
  it('renders the chip-density field with its test hook and classes', () => {
    render(() => <Input placeholder="Filter…" />);
    const input = screen.getByPlaceholderText('Filter…');
    expect(input.dataset.fdt).toBe('input');
    expect(input.className).toContain('h-7');
    expect(input.className).toContain('border-line-2');
    expect(input.className).toContain('bg-surface-2');
  });

  it('wears the search-field look: 7 px control corner, 10 px inline padding, no key hint', () => {
    render(() => <Input type="search" aria-label="Search scripts" />);
    const input = screen.getByLabelText('Search scripts');
    const tokens = input.className.split(/\s+/);
    expect(tokens).toEqual(expect.arrayContaining(['h-7', 'rounded-control', 'px-2.5']));
    expect(tokens).not.toContain('rounded');
    expect(tokens).not.toContain('px-2');
    // The field renders alone: no key-hint element or attribute beside it.
    expect(input.parentElement?.children).toHaveLength(1);
    expect(input.hasAttribute('aria-keyshortcuts')).toBe(false);
  });

  it('lets a caller start padding sit beside the inline padding (a leading icon)', () => {
    render(() => <Input class="ps-7" aria-label="With icon" />);
    const tokens = screen.getByLabelText('With icon').className.split(/\s+/);
    // Both survive; the stylesheet orders `ps-*` after `px-*`, so the icon room wins.
    expect(tokens).toEqual(expect.arrayContaining(['px-2.5', 'ps-7']));
  });

  it('paints the error state from the aria-invalid attribute', () => {
    render(() => <Input aria-invalid="true" aria-label="Delay JS source" />);
    const input = screen.getByLabelText('Delay JS source');
    expect(input.className).toContain('aria-invalid:border-status-error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('threads native props through and lets callers win classes', () => {
    render(() => <Input type="search" class="w-full" aria-label="Query" />);
    const input = screen.getByLabelText('Query');
    expect(input.getAttribute('type')).toBe('search');
    expect(input.className).toContain('w-full');
    expect(input.className).toContain('focus-visible:outline-accent');
  });
});
