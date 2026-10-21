import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_HOST_NAME, installKeyGuard } from './key-guard';

/** Guards installed by a case (window listeners must not leak across cases). */
const guards: AbortController[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
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

const NativeEvent = Event;
const NativeKeyboardEvent = KeyboardEvent;

/**
 * Stub `Event` and `KeyboardEvent` so every constructed one escapes its shadow
 * root, whatever its init says.
 *
 * @param reported What their `composed` getter claims (false: an engine that lies).
 */
function composeEveryEvent(reported: boolean): void {
  vi.stubGlobal(
    'Event',
    class extends NativeEvent {
      constructor(type: string, init?: EventInit) {
        super(type, { ...init, composed: true });
      }
      override get composed(): boolean {
        return reported;
      }
    }
  );
  vi.stubGlobal(
    'KeyboardEvent',
    class extends NativeKeyboardEvent {
      constructor(type: string, init?: KeyboardEventInit) {
        super(type, { ...init, composed: true });
      }
      override get composed(): boolean {
        return reported;
      }
    }
  );
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
      atRoot(event as InputEvent);
    });
    input.dispatchEvent(new InputEvent('input', { data: 'a', bubbles: true, composed: true }));
    expect(page).not.toHaveBeenCalled();
    expect(atRoot.mock.results[0]?.value).toBe('a');
  });

  it('delivers keys inside where the engine composes every KeyboardEvent (Firefox)', () => {
    // Firefox ignores `composed: false` for constructed keyboard events.
    vi.stubGlobal(
      'KeyboardEvent',
      class extends NativeKeyboardEvent {
        constructor(type: string, init?: KeyboardEventInit) {
          super(type, { ...init, composed: true });
        }
      }
    );
    const { input, page } = setup();
    const inside = vi.fn((event: KeyboardEvent) => event.key);
    input.addEventListener('keydown', inside);
    input.dispatchEvent(keydown('Enter'));
    expect(page).not.toHaveBeenCalled();
    expect(inside).toHaveBeenCalledTimes(1);
    expect(inside.mock.results[0]?.value).toBe('Enter');
  });

  it('never dispatches a copy that would compose: the original goes on untouched', () => {
    composeEveryEvent(true);
    const { input, page } = setup();
    const inside = vi.fn((event: KeyboardEvent) => event);
    input.addEventListener('keydown', inside);
    const original = keydown('/');
    input.dispatchEvent(original);
    expect(inside).toHaveBeenCalledTimes(1);
    expect(inside.mock.results[0]?.value).toBe(original);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('lets its own copy pass if it escapes anyway, instead of copying it again', () => {
    composeEveryEvent(false);
    const { input } = setup();
    const inside = vi.fn((event: KeyboardEvent) => event.key);
    input.addEventListener('keydown', inside);
    input.dispatchEvent(keydown('ArrowUp'));
    expect(inside).toHaveBeenCalledTimes(1);
    expect(inside.mock.results[0]?.value).toBe('ArrowUp');
  });

  it('carries isComposing on a keydown copy', () => {
    const { input } = setup();
    const inside = vi.fn((event: KeyboardEvent) => event.isComposing);
    input.addEventListener('keydown', inside);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', isComposing: true, bubbles: true, composed: true })
    );
    expect(inside.mock.results[0]?.value).toBe(true);
  });

  it('carries clipboardData on a paste copy', () => {
    const { input } = setup();
    const inside = vi.fn((event: ClipboardEvent) => event.clipboardData?.getData('text/plain'));
    input.addEventListener('paste', inside);
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true });
    const clipboardData = { getData: () => 'a\nb' };
    Object.defineProperty(paste, 'clipboardData', { value: clipboardData });
    input.dispatchEvent(paste);
    expect(inside).toHaveBeenCalledTimes(1);
    expect(inside.mock.results[0]?.value).toBe('a\nb');
  });

  it("leaves the page's own keys alone", () => {
    const { outside, page } = setup();
    outside.dispatchEvent(keydown('/'));
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('leaves keys aimed at the host itself alone (they are not from inside)', () => {
    const { host, page } = setup();
    const original = keydown('/');
    host.dispatchEvent(original);
    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0]?.[0]).toBe(original);
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
