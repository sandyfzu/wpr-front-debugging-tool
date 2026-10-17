/**
 * The shared field binding: "one query, two inputs" — the field streams into
 * the store, adopts changes made elsewhere (DevTools box, cancel, any foreign
 * delivery), never clobbers its own typing, and carries the panel's Esc rule.
 */
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSearchStore, SEARCH_DEBOUNCE_MS, type SearchStore } from './search';
import { bindSearchField, type SearchFieldBinding } from './search-field';

/** A binding inside a root, with its store and disposer. */
function setup(): { search: SearchStore; field: SearchFieldBinding; dispose: () => void } {
  return createRoot((dispose) => {
    const search = createSearchStore();
    return { search, field: bindSearchField(search), dispose };
  });
}

/**
 * One Esc (or other) keydown handed straight to the shared key handler, its
 * event target standing in for the page's field — the real page attaches the
 * handler on its controls wrapper, so the DOM dispatch never happens here.
 */
function keyOf(key: string, target: HTMLInputElement = inputOf()): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

/** An input of the given type (search by default). */
function inputOf(type = 'search'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  return input;
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

  it('a binding created while a foreign commit is pending starts from the committed query and the belt lands it', () => {
    const root = createRoot((dispose) => {
      const search = createSearchStore();
      search.perform('x'); // foreign delivery; its commit is still pending
      const field = bindSearchField(search); // bound within the quiet period
      return { search, field, dispose };
    });
    expect(root.field.value()).toBe(''); // the committed query, not the pending 'x'
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    // The late commit carries no revision bump: only the query belt lands it.
    expect(root.field.value()).toBe('x');
    expect(root.search.query()).toBe('x');
    root.dispose();
  });

  it('a second binding on the same store mirrors the committed store query (one field per page)', () => {
    const root = createRoot((dispose) => {
      const search = createSearchStore();
      return {
        search,
        field: bindSearchField(search),
        second: bindSearchField(search),
        dispose
      };
    });
    root.field.input('first');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(root.second.value()).toBe('first'); // starts from the committed query
    root.second.input('btwo');
    expect(root.field.value()).toBe('first'); // the first binding mirrors the then-committed query
    expect(root.second.value()).toBe('btwo'); // the typing field keeps its pending echo
    root.field.input('second');
    // A delivery that is foreign to the second binding makes it adopt the
    // then-committed query, dropping its pending echo.
    expect(root.second.value()).toBe('first');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    // The late commit lands for both through the belt.
    expect(root.field.value()).toBe('second');
    expect(root.second.value()).toBe('second');
    expect(root.search.query()).toBe('second');
    root.dispose();
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

  describe('foreign deliveries while the field echo is uncommitted', () => {
    it('a cancel while the committed query is empty still resets the field (the revision rule)', () => {
      const { search, field, dispose } = setup();
      field.input('pending');
      expect(search.query()).toBe('');
      search.cancel(); // from the DevTools side; the committed query never left ''
      expect(field.value()).toBe('');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
      expect(search.query()).toBe('');
      dispose();
    });

    it('a foreign keystroke takes query ownership at once, dropping the pending echo', () => {
      const { search, field, dispose } = setup();
      field.input('pending');
      search.perform('x');
      expect(field.value()).toBe(''); // the committed query (still empty), not the stale echo
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expect(field.value()).toBe('x');
      expect(search.query()).toBe('x');
      dispose();
    });

    it('the route-reset cancel reaches a bound field', () => {
      const { search, field, dispose } = setup();
      field.input('gtag');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      search.perform('next'); // pending from another place
      search.cancel();
      expect(field.value()).toBe('');
      dispose();
    });

    it('an own burst interleaved with a foreign delivery keeps the field the owner (the foreign value never lands)', () => {
      const { search, field, dispose } = setup();
      field.input('pending');
      search.perform('x'); // foreign delivery mid-burst
      expect(field.value()).toBe(''); // the pending echo drops to the then-committed query ('')
      field.input('q'); // a trailing own keystroke re-owns the query
      expect(field.value()).toBe('q');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      // Every perform restarted the shared debounced commit (last call wins),
      // so the eventual commit equals the echo and the foreign 'x' never lands.
      expect(field.value()).toBe('q');
      expect(search.query()).toBe('q');
      dispose();
    });
  });

  describe('onKeyDown (the panel-wide Esc rule)', () => {
    it('prevents and clears a search field showing text', () => {
      const { search, field, dispose } = setup();
      field.input('cart');
      const event = keyOf('Escape');
      field.onKeyDown(event);
      expect(event.defaultPrevented).toBe(true);
      expect(field.value()).toBe('');
      expect(search.query()).toBe(''); // the store clears with the field
      dispose();
    });

    it('takes Escape only on a search-type input', () => {
      const { field, dispose } = setup();
      field.input('cart');
      const textEvent = keyOf('Escape', inputOf('text'));
      field.onKeyDown(textEvent);
      expect(textEvent.defaultPrevented).toBe(false);
      expect(field.value()).toBe('cart');
      const searchEvent = keyOf('Escape', inputOf());
      field.onKeyDown(searchEvent);
      expect(searchEvent.defaultPrevented).toBe(true);
      expect(field.value()).toBe('');
      dispose();
    });

    it('leaves Escape alone while the field echo is empty', () => {
      const { search, field, dispose } = setup();
      field.input('cart');
      field.clear();
      const event = keyOf('Escape');
      field.onKeyDown(event);
      expect(event.defaultPrevented).toBe(false);
      expect(field.value()).toBe('');
      expect(search.query()).toBe('');
      dispose();
    });

    it('ignores every other key, however the field is typed', () => {
      const { field, dispose } = setup();
      field.input('cart');
      const event = keyOf('a');
      field.onKeyDown(event);
      expect(event.defaultPrevented).toBe(false);
      expect(field.value()).toBe('cart');
      dispose();
    });
  });

  it('store work after the field is disposed never resurrects anything', () => {
    const { search, field, dispose } = setup();
    field.input('gtag');
    dispose();
    expect(() => {
      search.cancel();
      search.perform('late');
    }).not.toThrow();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(search.query()).toBe('late'); // the store outlives the page binding
  });
});
