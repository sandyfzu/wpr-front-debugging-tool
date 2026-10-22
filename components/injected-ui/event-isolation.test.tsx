/**
 * The isolation as effects: an event from inside the shadow tree reaches
 * the UI's own (delegated) handler exactly once and never the document or
 * the window — where a host page's listeners, such as a delay runtime that
 * replays first interactions, would see it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { ISOLATED_UI_EVENTS, isolateUiEvents } from './event-isolation';

/** One mounted UI: host + shadow root + a rendered button counting its clicks. */
function mountButton(isolate: boolean): {
  host: HTMLElement;
  shadow: ShadowRoot;
  button: HTMLButtonElement;
  clicks: () => number;
  dispose: () => void;
} {
  const host = document.createElement('wpr-test-ui');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  shadow.append(container);
  if (isolate) isolateUiEvents(shadow);
  let count = 0;
  const dispose = render(
    () => (
      <button
        type="button"
        onClick={() => {
          count += 1;
        }}
      >
        <span>go</span>
      </button>
    ),
    container
  );
  const button = shadow.querySelector('button');
  if (button === null) throw new Error('the button did not render');
  return {
    host,
    shadow,
    button,
    clicks: () => count,
    dispose: () => {
      dispose();
      host.remove();
    }
  };
}

/** Page-side listeners on the document and the window (bubbling, as pages register them). */
function pageListeners(type: string): { document: () => number; window: () => number } {
  const onDocument = vi.fn();
  const onWindow = vi.fn();
  document.addEventListener(type, onDocument);
  window.addEventListener(type, onWindow);
  cleanups.push(() => {
    document.removeEventListener(type, onDocument);
    window.removeEventListener(type, onWindow);
  });
  return { document: () => onDocument.mock.calls.length, window: () => onWindow.mock.calls.length };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('isolateUiEvents', () => {
  it('runs the UI handler once and keeps the click from the document and the window', () => {
    const ui = mountButton(true);
    cleanups.push(ui.dispose);
    const page = pageListeners('click');
    ui.button
      .querySelector('span')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(ui.clicks()).toBe(1);
    expect(page.document()).toBe(0);
    expect(page.window()).toBe(0);
  });

  it('keeps every isolated event type from the page', () => {
    const ui = mountButton(true);
    cleanups.push(ui.dispose);
    for (const type of ISOLATED_UI_EVENTS) {
      const page = pageListeners(type);
      ui.button.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
      expect([type, page.document(), page.window()]).toEqual([type, 0, 0]);
    }
  });

  it('is idempotent: a second call neither adds a second delegation nor breaks the first', () => {
    const ui = mountButton(true);
    cleanups.push(ui.dispose);
    isolateUiEvents(ui.shadow);
    ui.button.click();
    expect(ui.clicks()).toBe(1);
  });

  it('leaves events outside the UI alone', () => {
    const ui = mountButton(true);
    cleanups.push(ui.dispose);
    const page = pageListeners('click');
    const outside = document.createElement('button');
    document.body.append(outside);
    cleanups.push(() => {
      outside.remove();
    });
    outside.click();
    expect(page.document()).toBe(1);
    expect(page.window()).toBe(1);
  });

  it('without it, the page sees the UI click (the leak the isolation closes)', () => {
    const ui = mountButton(false);
    cleanups.push(ui.dispose);
    const page = pageListeners('click');
    ui.button.click();
    expect(ui.clicks()).toBe(1);
    expect(page.window()).toBe(1);
  });
});
