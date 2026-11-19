/** Focus by row key over a virtualized window. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRowFocus, ROW_FOCUS_WAIT_MS } from './row-focus';

/** A connected, focusable button. */
function button(name: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.textContent = name;
  document.body.append(el);
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('createRowFocus', () => {
  it('focuses a mounted row at once, without scrolling', () => {
    const focus = createRowFocus();
    const a = button('a');
    const spy = vi.spyOn(a, 'focus');
    focus.register('a', a);
    focus.focus('a');
    expect(document.activeElement).toBe(a);
    expect(spy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('waits for an unmounted row and focuses it when it registers', () => {
    const focus = createRowFocus();
    focus.focus('b');
    const b = button('b');
    focus.register('b', b);
    expect(document.activeElement).toBe(b);
  });

  it('expires a waiting request so a late mount cannot grab focus', () => {
    const focus = createRowFocus();
    const other = button('other');
    other.focus();
    focus.focus('c');
    vi.advanceTimersByTime(ROW_FOCUS_WAIT_MS);
    focus.register('c', button('c'));
    expect(document.activeElement).toBe(other);
  });

  it('a newer request replaces the waiting one', () => {
    const focus = createRowFocus();
    focus.focus('x');
    focus.focus('y');
    const x = button('x');
    focus.register('x', x);
    expect(document.activeElement).not.toBe(x);
    const y = button('y');
    focus.register('y', y);
    expect(document.activeElement).toBe(y);
  });

  it('cancel drops the waiting request', () => {
    const focus = createRowFocus();
    focus.focus('d');
    focus.cancel();
    const d = button('d');
    focus.register('d', d);
    expect(document.activeElement).not.toBe(d);
  });

  it('treats a disconnected registered target as unmounted', () => {
    const focus = createRowFocus();
    const stale = document.createElement('button');
    focus.register('e', stale);
    focus.focus('e');
    expect(document.activeElement).not.toBe(stale);
    const fresh = button('e');
    focus.register('e', fresh);
    expect(document.activeElement).toBe(fresh);
  });

  it('unregistering keeps a newer target registered under the same key', () => {
    const focus = createRowFocus();
    const first = button('f1');
    const releaseFirst = focus.register('f', first);
    const second = button('f2');
    focus.register('f', second);
    releaseFirst();
    focus.focus('f');
    expect(document.activeElement).toBe(second);
  });

  it('unregistering forgets the row', () => {
    const focus = createRowFocus();
    const g = button('g');
    focus.register('g', g)();
    focus.focus('g');
    expect(document.activeElement).not.toBe(g);
  });

  it('runs on an injected clock', () => {
    const clock = { setTimeout: vi.fn(() => 42), clearTimeout: vi.fn() };
    const focus = createRowFocus(clock);
    focus.focus('h');
    expect(clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), ROW_FOCUS_WAIT_MS);
    focus.cancel();
    expect(clock.clearTimeout).toHaveBeenCalledWith(42);
  });
});
