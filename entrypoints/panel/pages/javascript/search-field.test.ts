/**
 * "One query, two inputs": the field streams into the store, adopts changes
 * made elsewhere (DevTools box, cancel), and never clobbers its own typing.
 */
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSearchStore, SEARCH_DEBOUNCE_MS, type SearchStore } from '../../state/search';
import { bindSearchField, type SearchFieldBinding } from './search-field';

/** A binding inside a root, with its store and disposer. */
function setup(): { search: SearchStore; field: SearchFieldBinding; dispose: () => void } {
  return createRoot((dispose) => {
    const search = createSearchStore();
    return { search, field: bindSearchField(search), dispose };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('bindSearchField', () => {
  it('starts from the committed query', () => {
    const root = createRoot((dispose) => {
      const search = createSearchStore();
      search.perform('jquery');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      return { field: bindSearchField(search), dispose };
    });
    expect(root.field.value()).toBe('jquery');
    root.dispose();
  });

  it('shows typing at once and commits it through the store debounce', () => {
    const { search, field, dispose } = setup();
    field.input('jq');
    field.input('jque');
    expect(field.value()).toBe('jque');
    expect(search.query()).toBe('');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(search.query()).toBe('jque');
    expect(field.value()).toBe('jque');
    dispose();
  });

  it('adopts a query committed from the DevTools box', () => {
    const { search, field, dispose } = setup();
    search.perform('analytics');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(field.value()).toBe('analytics');
    dispose();
  });

  it('adopts a cancel made elsewhere', () => {
    const { search, field, dispose } = setup();
    field.input('gtag');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    search.cancel();
    expect(field.value()).toBe('');
    dispose();
  });

  it('clears field and store now, dropping a pending commit', () => {
    const { search, field, dispose } = setup();
    field.input('gtag');
    field.clear();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(field.value()).toBe('');
    expect(search.query()).toBe('');
    dispose();
  });

  it('an emptied field clears the store immediately', () => {
    const { search, field, dispose } = setup();
    field.input('gtag');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    field.input('');
    expect(search.query()).toBe('');
    expect(field.value()).toBe('');
    dispose();
  });
});
