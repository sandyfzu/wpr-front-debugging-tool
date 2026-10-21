import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPicking, type PickerEvents } from './picker';

/** Every picker the cases started (window listeners must not leak across cases). */
const running: (() => void)[] = [];

afterEach(() => {
  for (const stop of running.splice(0)) stop();
  document.body.replaceChildren();
});

/** A page with a link, the overlay host, and a running picker. */
function setup() {
  const link = document.createElement('a');
  link.href = '#nav';
  const host = document.createElement('div');
  const own = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('button'));
  document.body.append(link, host);
  const context = new AbortController();
  const events: PickerEvents<string> = {
    hover: vi.fn(),
    pick: vi.fn(),
    cancel: vi.fn(),
    tab: vi.fn()
  };
  const pageClick = vi.fn();
  link.addEventListener('click', pageClick);
  const stop = startPicking<string>(
    {
      win: window,
      host,
      resolve: (x) => (x > 10 ? 'target' : null),
      pointed: () => link,
      requestFrame: (run) => {
        run();
      },
      signal: context.signal
    },
    events
  );
  running.push(stop);
  return { link, own, events, pageClick, stop, context };
}

/** A pointer-like event at a point. */
function at<T extends Event>(event: T, x: number): T {
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: 5 });
  return event;
}

describe('startPicking', () => {
  it('reports hovers per frame and picks on click, the page never seeing the click', () => {
    const { link, events, pageClick } = setup();
    link.dispatchEvent(at(new MouseEvent('pointermove', { bubbles: true }), 20));
    expect(events.hover).toHaveBeenLastCalledWith('target');
    const click = at(new MouseEvent('click', { bubbles: true, cancelable: true }), 20);
    link.dispatchEvent(click);
    expect(events.pick).toHaveBeenCalledWith('target', link);
    expect(pageClick).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
  });

  it('reports a miss with what was pointed at', () => {
    const { link, events } = setup();
    link.dispatchEvent(at(new MouseEvent('click', { bubbles: true, cancelable: true }), 1));
    expect(events.pick).toHaveBeenCalledWith(null, link);
  });

  it('swallows the rest of the gesture (pointerdown/mousedown/up)', () => {
    const { link } = setup();
    const pageDown = vi.fn();
    link.addEventListener('mousedown', pageDown);
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(pageDown).not.toHaveBeenCalled();
  });

  it("lets the overlay's own input through", () => {
    const { own, events } = setup();
    const ownClick = vi.fn();
    own.addEventListener('click', ownClick);
    own.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(ownClick).toHaveBeenCalledTimes(1);
    expect(events.pick).not.toHaveBeenCalled();
  });

  it('owns Escape and Tab wherever focus is', () => {
    const { events } = setup();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
    );
    expect(events.tab).toHaveBeenCalledWith(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(events.cancel).toHaveBeenCalledTimes(1);
  });

  it('stops on request and with the content-script context', () => {
    const first = setup();
    first.stop();
    first.link.dispatchEvent(at(new MouseEvent('click', { bubbles: true, cancelable: true }), 20));
    expect(first.events.pick).not.toHaveBeenCalled();
    expect(first.pageClick).toHaveBeenCalledTimes(1);
    const second = setup();
    second.context.abort();
    second.link.dispatchEvent(at(new MouseEvent('click', { bubbles: true, cancelable: true }), 20));
    expect(second.events.pick).not.toHaveBeenCalled();
  });
});
