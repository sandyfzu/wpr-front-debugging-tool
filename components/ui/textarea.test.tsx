/**
 * Render tests for the shared text area: the mono chip density, the
 * `aria-invalid` paint, native prop threading and caller class precedence.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Input } from './input';
import { Textarea } from './textarea';

afterEach(() => {
  cleanup();
});

describe('Textarea', () => {
  it('renders the mono field with its test hook', () => {
    render(() => <Textarea placeholder="Deny JS sources" />);
    const field = screen.getByPlaceholderText('Deny JS sources');
    expect(field.getAttribute('data-fdt')).toBe('textarea');
    expect(field.className).toContain('font-mono');
    expect(field.className).toContain('border-line-2');
  });

  it("shares Input's look: fill, border, 7 px control corner and inline padding", () => {
    render(() => (
      <>
        <Textarea aria-label="Patterns" />
        <Input aria-label="Search" />
      </>
    ));
    const area = screen.getByLabelText('Patterns').className.split(/\s+/);
    const input = screen.getByLabelText('Search').className.split(/\s+/);
    for (const token of ['rounded-control', 'border-line-2', 'bg-surface-2', 'px-2.5']) {
      expect(area, token).toContain(token);
      expect(input, token).toContain(token);
    }
    expect(area).toContain('py-1.5');
    expect(area).not.toContain('rounded');
  });

  it('paints the error state from aria-invalid', () => {
    render(() => <Textarea aria-invalid="true" aria-label="Exclusion patterns" />);
    const field = screen.getByLabelText('Exclusion patterns');
    expect(field.className).toContain('aria-invalid:border-status-error');
    expect(field.getAttribute('aria-invalid')).toBe('true');
  });

  it('threads native props through and lets callers win classes', () => {
    render(() => <Textarea rows={4} disabled class="h-24" aria-label="Notes" />);
    const field = screen.getByLabelText<HTMLInputElement>('Notes');
    expect(field.getAttribute('rows')).toBe('4');
    expect(field.disabled).toBe(true);
    expect(field.className).toContain('h-24');
    expect(field.className).toContain('focus-visible:outline-accent');
  });
});
