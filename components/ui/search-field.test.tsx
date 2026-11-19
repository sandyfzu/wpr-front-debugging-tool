/** Render tests for the list pages' search field: name, placeholder, the controlled loop and its width rule. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { SearchField } from './search-field';

afterEach(() => {
  cleanup();
});

describe('SearchField', () => {
  it('is a named search box with its placeholder and a decorative icon', () => {
    render(() => (
      <SearchField
        value=""
        onValueChange={() => undefined}
        label="Search header and cookie names"
        placeholder="Search names…"
      />
    ));
    const field = screen.getByRole<HTMLInputElement>('searchbox', {
      name: 'Search header and cookie names'
    });
    expect(field.placeholder).toBe('Search names…');
    expect(
      field.closest('[data-fdt="search-field"]')?.querySelector('svg')?.getAttribute('aria-hidden')
    ).toBe('true');
  });

  it('wires the field through the controlled loop', () => {
    // The page owns the query signal; changes are recorded through a plain local.
    const [query] = createSignal('delay');
    let typed: string | undefined;
    render(() => (
      <SearchField
        value={query()}
        onValueChange={(value) => {
          typed = value;
        }}
        label="Search"
        placeholder="Search…"
      />
    ));
    const field = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search' });
    expect(field.value).toBe('delay');
    fireEvent.input(field, { target: { value: 'exclud' } });
    expect(typed).toBe('exclud');
  });

  it('sizes the field: full row while compact, bounded from the regular tier', () => {
    render(() => (
      <SearchField value="" onValueChange={() => undefined} label="Search" placeholder="Search…" />
    ));
    const field = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search' });
    expect(field.className).toContain('w-full');
    expect(field.className).toContain('@regular:max-w-80');
    expect(field.className).toContain('ps-7');
  });
});
