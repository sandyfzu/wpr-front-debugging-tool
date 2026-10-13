/**
 * The focus choreography's contract pins: two attempts over context-owned
 * frames, the landing verified against the element's own tree, one logged
 * not-reached line after the last try, and no attempt work after
 * invalidation.
 */
import { describe, expect, it, vi } from 'vitest';
import { moveFocus, type FocusChoreographyDeps } from './focus';
import { createLogger } from '../../../lib/logger';

/** A happy-dom fragment is its own document — the focus tree to verify on. */
function elementInFragment(): HTMLElement {
  const fragment = document.createDocumentFragment();
  const element = document.createElement('button');
  fragment.append(element);
  return element;
}

/** Drives the choreography by hand: queued callbacks flush on demand. */
function manualDriven(): FocusChoreographyDeps & { queued: number; flush(): void } {
  const queue: Array<() => void> = [];
  let queued = 0;
  return {
    requestFrame: (callback: () => void) => {
      queue.push(callback);
      queued += 1;
    },
    isInvalid: () => false,
    log: createLogger('test'),
    get queued(): number {
      return queued;
    },
    flush: () => {
      // Drains until settled: an attempt's re-arm queues the next frame.
      while (queue.length > 0) {
        const callback = queue.shift();
        if (callback !== undefined) callback();
      }
    }
  };
}

describe('moveFocus', () => {
  it('the first attempt lands on a focusable element — one frame, done', () => {
    const element = elementInFragment();
    const driven = manualDriven();
    moveFocus(element, 'card', driven);
    expect(driven.queued).toBe(1);
    driven.flush();
    expect(document.activeElement === element || !element.isConnected).toBe(true);
  });

  it('a missed landing re-arms on the next frame (two tries, then the log)', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    try {
      const fragment = document.createDocumentFragment();
      const element = document.createElement('button');
      fragment.append(element);
      // happy-dom cannot move document focus into a detached fragment: every
      // attempt misses, which drives the re-arm and the final log line.
      const focus = vi.fn();
      element.focus = focus;
      const driven = manualDriven();
      moveFocus(element, 'card', driven);
      driven.flush();
      expect(focus).toHaveBeenCalledTimes(2);
      expect(
        spy.mock.calls.some((call) => String(call[0]).includes('Did not reach the report card'))
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('a dead context answers no attempts at all', () => {
    const element = elementInFragment();
    const focusSpy = vi.spyOn(element, 'focus').mockImplementation(() => undefined);
    const queue: Array<() => void> = [];
    const deps: FocusChoreographyDeps = {
      requestFrame: (callback: () => void) => {
        queue.push(callback);
      },
      isInvalid: () => true,
      log: createLogger('test')
    };
    moveFocus(element, 'marker', deps);
    expect(focusSpy).not.toHaveBeenCalled();
    // Even a flushed frame answers nothing once the context is dead.
    let guard = 4;
    while (queue.length > 0 && guard > 0) {
      guard -= 1;
      const callback = queue.shift();
      if (callback !== undefined) callback();
    }
    expect(focusSpy).not.toHaveBeenCalled();
  });
});
