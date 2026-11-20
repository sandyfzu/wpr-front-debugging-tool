/**
 * The pane splitter on its own: a pointer drag previews once per frame and
 * commits on release (also on cancel / a lost capture) only when it changed
 * the width, keeps the shown width when the pane unmounts mid-drag, ignores
 * secondary buttons and foreign pointers, shields the panel while dragging;
 * keys step, jump and hold at the bounds; a double-click resets.
 */
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaneSplitter, SPLITTER_HINT, SPLITTER_LABEL } from './pane-splitter';

/** Frames the test runs by hand. */
let frames: Map<number, () => void>;
let nextFrame: number;
/** happy-dom's own (absent or not) pointer capture, restored after each test. */
const ownCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  // happy-dom has no pointer capture; the splitter only needs the call to succeed.
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (ownCapture === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
  } else {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', ownCapture);
  }
});

/** Run every queued frame. */
function runFrames(): void {
  const due = [...frames.values()];
  frames.clear();
  for (const callback of due) callback();
}

/**
 * Mount a splitter over a 1200 px list (bounds 350…720) at a pane width.
 *
 * @param width The starting pane width.
 */
function mount(width = 500) {
  const [current, setCurrent] = createSignal(width);
  const onPreview = vi.fn((next: number) => setCurrent(next));
  const onCommit = vi.fn((next: number) => setCurrent(next));
  const onReset = vi.fn();
  const onSettle = vi.fn();
  const view = render(() => (
    <PaneSplitter
      width={current}
      contentWidth={() => 1200}
      onPreview={onPreview}
      onCommit={onCommit}
      onReset={onReset}
      onSettle={onSettle}
      requestFrame={(callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      }}
      cancelFrame={(id) => {
        frames.delete(id);
      }}
    />
  ));
  const handle = view.container.querySelector<HTMLElement>('[data-fdt="detail-splitter"]');
  if (handle === null) throw new Error('no splitter');
  return {
    handle,
    current,
    onPreview,
    onCommit,
    onReset,
    onSettle,
    unmount: view.unmount,
    container: view.container
  };
}

/** The drag shield, if shown. */
function shield(): Element | null {
  return document.querySelector('[data-fdt="detail-splitter-shield"]');
}

describe('PaneSplitter', () => {
  it('is a named, valued, focusable vertical separator with its hint', () => {
    const { handle } = mount();
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-label')).toBe(SPLITTER_LABEL);
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuenow')).toBe('500');
    expect(handle.getAttribute('aria-valuemin')).toBe('350');
    expect(handle.getAttribute('aria-valuemax')).toBe('720');
    expect(handle.getAttribute('title')).toBe(SPLITTER_HINT);
    expect(handle.getAttribute('tabindex')).toBe('0');
  });

  it('drags: previews once per frame with the latest pointer, commits on release', () => {
    const { handle, onPreview, onCommit } = mount();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    expect(handle.hasAttribute('data-dragging')).toBe(true);
    expect(shield()).not.toBeNull();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 790 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 760 });
    expect(frames.size).toBe(1);
    expect(onPreview).not.toHaveBeenCalled();
    runFrames();
    // 40 px left grows the pane by 40.
    expect(onPreview).toHaveBeenCalledExactlyOnceWith(540);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 });
    // The release commits where the pointer stands (clamped), pending frame dropped.
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(720);
    expect(frames.size).toBe(0);
    expect(handle.hasAttribute('data-dragging')).toBe(false);
    expect(shield()).toBeNull();
  });

  it('commits where the drag stood on a cancel or a lost capture', () => {
    const { handle, onCommit } = mount();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 900 });
    fireEvent.pointerCancel(handle, { pointerId: 3 });
    expect(onCommit).toHaveBeenLastCalledWith(400);
    fireEvent.pointerDown(handle, { button: 0, pointerId: 4, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 780 });
    fireEvent(handle, new PointerEvent('lostpointercapture', { pointerId: 4 }));
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith(420);
    expect(handle.hasAttribute('data-dragging')).toBe(false);
  });

  it('stores nothing for a press that never changed the width (a plain click)', () => {
    const { handle, onPreview, onCommit } = mount();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 800 });
    // A move that lands back on the start before any frame showed it: no change either.
    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 760 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 800 });
    runFrames();
    fireEvent.pointerCancel(handle, { pointerId: 2 });
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(handle.hasAttribute('data-dragging')).toBe(false);
  });

  it('commits a drag that came back to its start after showing a change', () => {
    const { handle, onPreview, onCommit } = mount();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 760 });
    runFrames();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 800 });
    runFrames();
    // The screen followed back to the start, so the store follows too.
    expect(onPreview.mock.calls).toEqual([[540], [500]]);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 800 });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(500);
  });

  it('keeps the shown width when the pane unmounts mid-drag (Esc, narrowing)', () => {
    const { handle, onSettle, onCommit, unmount } = mount();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    runFrames();
    // A later move still waiting for its frame is never shown: dropped.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
    unmount();
    expect(frames.size).toBe(0);
    expect(onSettle).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('settles nothing when the pane unmounts after a drag that showed no change', () => {
    const { handle, onSettle, unmount } = mount();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    unmount();
    expect(onSettle).not.toHaveBeenCalled();
  });

  it('settles nothing when the pane unmounts with no drag running', () => {
    const { handle, onSettle, unmount } = mount();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    runFrames();
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 700 });
    unmount();
    expect(onSettle).not.toHaveBeenCalled();
  });

  it('ignores a secondary button and another pointer', () => {
    const { handle, onPreview, onCommit } = mount();
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 800 });
    expect(handle.hasAttribute('data-dragging')).toBe(false);
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 600 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 600 });
    runFrames();
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(handle.hasAttribute('data-dragging')).toBe(true);
  });

  it('starts no drag when the pointer cannot be captured (already released)', () => {
    HTMLElement.prototype.setPointerCapture = vi.fn(() => {
      throw new DOMException('gone', 'NotFoundError');
    });
    const { handle } = mount();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 9, clientX: 800 });
    expect(handle.hasAttribute('data-dragging')).toBe(false);
    expect(shield()).toBeNull();
  });

  it('steps with ←/→ and jumps with Home/End, committing only real moves', () => {
    const { handle, onCommit } = mount(352);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenLastCalledWith(368);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith(350);
    onCommit.mockClear();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: 'End' });
    expect(onCommit).toHaveBeenLastCalledWith(720);
  });

  it('leaves other keys and modified arrows to the page', () => {
    const { handle, onCommit } = mount();
    for (const init of [
      { key: 'ArrowUp' },
      { key: 'Enter' },
      { key: 'Escape' },
      { key: 'ArrowLeft', ctrlKey: true },
      { key: 'ArrowLeft', metaKey: true },
      { key: 'ArrowLeft', altKey: true }
    ]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
      handle.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('resets on a double-click', () => {
    const { handle, onReset } = mount();
    fireEvent.dblClick(handle);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('drops a pending frame on unmount', () => {
    const { handle, onPreview, onSettle } = mount();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    expect(frames.size).toBe(1);
    cleanup();
    expect(frames.size).toBe(0);
    expect(onPreview).not.toHaveBeenCalled();
    // Nothing was shown yet: nothing to keep.
    expect(onSettle).not.toHaveBeenCalled();
  });
});
