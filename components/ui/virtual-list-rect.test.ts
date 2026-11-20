/** The scroller-size watch: attach and growth pass through, shrinks coalesce into the next frame. */
import { describe, expect, it, vi } from 'vitest';
import {
  frameDeferredRect,
  isGrowth,
  type FrameScheduler,
  type ScrollerRect
} from './virtual-list-rect';

/** A watch double: reports `initial` while attaching, then whatever the test emits. */
function fakeWatch(initial: ScrollerRect | null) {
  let emit: ((rect: ScrollerRect) => void) | undefined;
  const stop = vi.fn();
  const observe = vi.fn((_instance: object, callback: (rect: ScrollerRect) => void) => {
    emit = callback;
    if (initial !== null) callback(initial);
    return stop;
  });
  return {
    observe,
    stop,
    emit: (rect: ScrollerRect) => {
      emit?.(rect);
    }
  };
}

/** Frames run by hand. */
function manualFrames() {
  const queued = new Map<number, () => void>();
  let next = 1;
  const frames: FrameScheduler = {
    request: (callback) => {
      const id = next++;
      queued.set(id, callback);
      return id;
    },
    cancel: (id) => {
      queued.delete(id);
    }
  };
  return {
    frames,
    queued,
    run: () => {
      const due = [...queued.values()];
      queued.clear();
      for (const callback of due) callback();
    }
  };
}

describe('frameDeferredRect', () => {
  it('reports the attach-time size at once, with the instance passed through', () => {
    const watch = fakeWatch({ width: 300, height: 200 });
    const { frames, queued } = manualFrames();
    const callback = vi.fn();
    const instance = {};
    frameDeferredRect(watch.observe, frames)(instance, callback);
    expect(watch.observe).toHaveBeenCalledWith(instance, expect.any(Function));
    expect(callback).toHaveBeenCalledExactlyOnceWith({ width: 300, height: 200 });
    expect(queued.size).toBe(0);
  });

  it('applies shrinks on the next frame, one report with the latest', () => {
    const watch = fakeWatch({ width: 300, height: 200 });
    const { frames, queued, run } = manualFrames();
    const callback = vi.fn();
    frameDeferredRect(watch.observe, frames)({}, callback);
    callback.mockClear();
    watch.emit({ width: 300, height: 150 });
    watch.emit({ width: 300, height: 120 });
    expect(callback).not.toHaveBeenCalled();
    expect(queued.size).toBe(1);
    run();
    expect(callback).toHaveBeenCalledExactlyOnceWith({ width: 300, height: 120 });
    watch.emit({ width: 280, height: 120 });
    run();
    expect(callback).toHaveBeenLastCalledWith({ width: 280, height: 120 });
  });

  it('passes growth through at once (no blank band under the old window)', () => {
    const watch = fakeWatch({ width: 300, height: 300 });
    const { frames, queued } = manualFrames();
    const callback = vi.fn();
    frameDeferredRect(watch.observe, frames)({}, callback);
    callback.mockClear();
    watch.emit({ width: 300, height: 1_100 });
    expect(callback).toHaveBeenCalledExactlyOnceWith({ width: 300, height: 1_100 });
    // The same size is no shrink either.
    watch.emit({ width: 300, height: 1_100 });
    expect(callback).toHaveBeenCalledTimes(2);
    expect(queued.size).toBe(0);
  });

  it('defers a size smaller on either axis, even when the other grows', () => {
    const watch = fakeWatch({ width: 300, height: 300 });
    const { frames, queued, run } = manualFrames();
    const callback = vi.fn();
    frameDeferredRect(watch.observe, frames)({}, callback);
    callback.mockClear();
    watch.emit({ width: 280, height: 900 });
    expect(callback).not.toHaveBeenCalled();
    run();
    expect(callback).toHaveBeenCalledExactlyOnceWith({ width: 280, height: 900 });
    expect(queued.size).toBe(0);
  });

  it('measures a shrink against what the core was last given, and lets growth cancel it', () => {
    const watch = fakeWatch({ width: 300, height: 300 });
    const { frames, queued, run } = manualFrames();
    const callback = vi.fn();
    frameDeferredRect(watch.observe, frames)({}, callback);
    callback.mockClear();
    watch.emit({ width: 300, height: 200 });
    // Larger than the pending 200 but smaller than the shown 300: still a shrink.
    watch.emit({ width: 300, height: 250 });
    expect(callback).not.toHaveBeenCalled();
    // Back past the shown size: reported now, the pending shrink dropped.
    watch.emit({ width: 300, height: 320 });
    expect(callback).toHaveBeenCalledExactlyOnceWith({ width: 300, height: 320 });
    expect(queued.size).toBe(0);
    run();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('passes the first size through when attaching reported none (no scroller yet)', () => {
    const watch = fakeWatch(null);
    const { frames, queued } = manualFrames();
    const callback = vi.fn();
    frameDeferredRect(watch.observe, frames)({}, callback);
    watch.emit({ width: 10, height: 10 });
    expect(callback).toHaveBeenCalledExactlyOnceWith({ width: 10, height: 10 });
    expect(queued.size).toBe(0);
  });

  it('stops the core watch and drops a pending report', () => {
    const watch = fakeWatch({ width: 300, height: 200 });
    const { frames, queued, run } = manualFrames();
    const callback = vi.fn();
    const stop = frameDeferredRect(watch.observe, frames)({}, callback);
    callback.mockClear();
    watch.emit({ width: 300, height: 100 });
    if (typeof stop !== 'function') throw new Error('no stop');
    stop();
    expect(watch.stop).toHaveBeenCalledOnce();
    expect(queued.size).toBe(0);
    run();
    expect(callback).not.toHaveBeenCalled();
  });

  it('tolerates a core watch without a stop (no scroller yet)', () => {
    const observe = vi.fn(() => undefined);
    const stop = frameDeferredRect(observe, manualFrames().frames)({}, vi.fn());
    expect(() => {
      if (typeof stop === 'function') stop();
    }).not.toThrow();
  });

  it('uses animation frames by default', () => {
    const request = vi.spyOn(globalThis, 'requestAnimationFrame');
    const watch = fakeWatch({ width: 2, height: 2 });
    frameDeferredRect(watch.observe)({}, vi.fn());
    watch.emit({ width: 1, height: 1 });
    expect(request).toHaveBeenCalledOnce();
    request.mockRestore();
  });
});

describe('isGrowth', () => {
  it('is true only when neither axis shrinks', () => {
    expect(isGrowth({ width: 10, height: 20 }, { width: 10, height: 10 })).toBe(true);
    expect(isGrowth({ width: 10, height: 10 }, { width: 10, height: 10 })).toBe(true);
    expect(isGrowth({ width: 9, height: 20 }, { width: 10, height: 10 })).toBe(false);
    expect(isGrowth({ width: 20, height: 9 }, { width: 10, height: 10 })).toBe(false);
  });
});
