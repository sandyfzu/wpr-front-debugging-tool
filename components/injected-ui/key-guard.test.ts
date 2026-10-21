import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_HOST_NAME, installKeyGuard } from './key-guard';

/** Guards installed by a case (window listeners must not leak across cases). */
const guards: AbortController[] = [];

afterEach(() => {
  for (const guard of guards.splice(0)) guard.abort();
  document.body.replaceChildren();
});

/** A guarded page: the overlay host with an input in its shadow root, and a page listener registered after the guard. */
function setup() {
  const guard = new AbortController();
  guards.push(guard);
  installKeyGuard(window, OVERLAY_HOST_NAME, guard.signal);
  const host = document.createElement(OVERLAY_HOST_NAME);
  const shadow = host.attachShadow({ mode: 'open' });
  const input = document.createElement('input');
  shadow.append(input);
  const outside = document.createElement('input');
  document.body.append(host, outside);
  const page = vi.fn();
  const pageListeners = new AbortController();
  window.addEventListener('keydown', page, { capture: true, signal: pageListeners.signal });
  window.addEventListener('input', page, { capture: true, signal: pageListeners.signal });
  guards.push(pageListeners);
  return { guard, host, shadow, input, outside, page };
}

/** A trusted-like composed keydown from `target`. */
const keydown = (key: string) =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });

describe('installKeyGuard', () => {
  it("keeps the overlay's keys from the page's later window-capture listeners, re-delivering them inside", () => {
    const { input, page } = setup();
    const inside = vi.fn((event: KeyboardEvent) => event.key);
    input.addEventListener('keydown', inside);
    input.dispatchEvent(keydown('/'));
    expect(page).not.toHaveBeenCalled();
    expect(inside).toHaveBeenCalledTimes(1);
    expect(inside.mock.results[0]?.value).toBe('/');
  });

  it("hands the overlay's preventDefault back to the original event", () => {
    const { input } = setup();
    input.addEventListener('keydown', (event) => {
      event.preventDefault();
    });
    const original = keydown('Enter');
    input.dispatchEvent(original);
    expect(original.defaultPrevented).toBe(true);
  });

  it('re-delivers input events (with their data) inside the overlay only', () => {
    const { input, shadow, page } = setup();
    const atRoot = vi.fn((event: InputEvent) => event.data);
    shadow.addEventListener('input', (event) => {
      if (event instanceof InputEvent) atRoot(event);
    });
    input.dispatchEvent(new InputEvent('input', { data: 'a', bubbles: true, composed: true }));
    expect(page).not.toHaveBeenCalled();
    expect(atRoot.mock.results[0]?.value).toBe('a');
  });

  it("leaves the page's own keys alone", () => {
    const { outside, page } = setup();
    outside.dispatchEvent(keydown('/'));
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('never throws into the page, and fails open', () => {
    const { input, page } = setup();
    const broken = keydown('x');
    Object.defineProperty(broken, 'key', {
      get: () => {
        throw new Error('hostile');
      }
    });
    expect(() => input.dispatchEvent(broken)).not.toThrow();
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('stops with its signal', () => {
    const { guard, input, page } = setup();
    guard.abort();
    input.dispatchEvent(keydown('/'));
    expect(page).toHaveBeenCalledTimes(1);
  });
});
