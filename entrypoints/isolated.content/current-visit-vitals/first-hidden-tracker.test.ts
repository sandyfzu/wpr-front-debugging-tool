/**
 * The first-hidden tracker (engines without `visibility-state` entries):
 * a page hidden at install reads 0 (unless prerendering), the first hide's
 * time stamp is kept and later hides ignored (the listener leaves after
 * it), a restart forgets the hide and tracks the next one (one listener at
 * a time), the listener is passive and capturing, a failing read is
 * reported, and the context's end removes the listener.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackFirstHidden } from './first-hidden-tracker';

/** The document's visibility, set per test. */
let visibility: DocumentVisibilityState = 'visible';

/** Make the document read as this visibility. */
function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
}

vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);

afterEach(() => {
  setVisibility('visible');
});

/** Fire a visibility change with this time stamp. */
function change(timeStamp: number): void {
  const event = new Event('visibilitychange');
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  document.dispatchEvent(event);
}

describe('trackFirstHidden', () => {
  it('keeps the first hide’s time and ignores what follows', () => {
    const { read } = trackFirstHidden(document, new AbortController().signal, vi.fn());
    expect(read()).toBeNull();
    change(100);
    expect(read()).toBeNull();
    setVisibility('hidden');
    change(250);
    expect(read()).toBe(250);
    setVisibility('visible');
    change(300);
    setVisibility('hidden');
    change(900);
    expect(read()).toBe(250);
  });

  it('forgets the hide on restart and tracks the next one, one listener at a time', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const tracker = trackFirstHidden(document, new AbortController().signal, vi.fn());
    setVisibility('hidden');
    change(250);
    expect(tracker.read()).toBe(250);
    // Restored while the engine still reports hidden: not counted as a hide.
    tracker.restart();
    expect(tracker.read()).toBeNull();
    setVisibility('visible');
    change(5000);
    setVisibility('hidden');
    change(7000);
    expect(tracker.read()).toBe(7000);
    expect(add.mock.calls.filter((call) => call[0] === 'visibilitychange')).toHaveLength(2);
    // A restart while still listening adds no second listener.
    tracker.restart();
    tracker.restart();
    expect(add.mock.calls.filter((call) => call[0] === 'visibilitychange')).toHaveLength(3);
    add.mockRestore();
  });

  it('starts tracking on a restart of a page hidden at install', () => {
    setVisibility('hidden');
    const tracker = trackFirstHidden(document, new AbortController().signal, vi.fn());
    expect(tracker.read()).toBe(0);
    tracker.restart();
    expect(tracker.read()).toBeNull();
    change(60);
    expect(tracker.read()).toBe(60);
  });

  it('does not listen again after the context ended', () => {
    const context = new AbortController();
    const tracker = trackFirstHidden(document, context.signal, vi.fn());
    context.abort();
    const add = vi.spyOn(document, 'addEventListener');
    tracker.restart();
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it('reads a page hidden at install as hidden from the start', () => {
    setVisibility('hidden');
    const add = vi.spyOn(document, 'addEventListener');
    const { read } = trackFirstHidden(document, new AbortController().signal, vi.fn());
    expect(read()).toBe(0);
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it('does not count a prerendering page as hidden', () => {
    setVisibility('hidden');
    const prerendering = Object.assign(Object.create(document) as Document, { prerendering: true });
    Object.defineProperty(prerendering, 'visibilityState', { get: () => visibility });
    Object.defineProperty(prerendering, 'addEventListener', { value: vi.fn() });
    expect(trackFirstHidden(prerendering, new AbortController().signal, vi.fn()).read()).toBeNull();
  });

  it('listens passively in the capture phase', () => {
    const add = vi.spyOn(document, 'addEventListener');
    trackFirstHidden(document, new AbortController().signal, vi.fn());
    expect(add).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
      expect.objectContaining({ capture: true, passive: true })
    );
    add.mockRestore();
  });

  it('stops listening once the context ends', () => {
    const context = new AbortController();
    const { read } = trackFirstHidden(document, context.signal, vi.fn());
    context.abort();
    setVisibility('hidden');
    change(40);
    expect(read()).toBeNull();
  });

  it('reports a failing read instead of throwing into the page', () => {
    const onError = vi.fn();
    const { read } = trackFirstHidden(document, new AbortController().signal, onError);
    const failure = new Error('gone');
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => {
      throw failure;
    });
    change(10);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(read()).toBeNull();
    spy.mockImplementation(() => visibility);
  });
});
