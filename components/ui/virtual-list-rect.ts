/**
 * The virtual list's scroller-size watch, shrinks one frame late on purpose.
 * The core's own watch re-renders the row window inside its `ResizeObserver`
 * callback: when the scroller shrinks, rows unmount while the core's row
 * observer still watches them, and Chromium reports "ResizeObserver loop
 * completed with undelivered notifications" as a page error (seen on short
 * panels, where a resize shrinks a list). Re-windowing a shrink on the next
 * frame breaks that loop. Growth passes through at once (it only mounts
 * rows, and a late one would paint a blank band under the old window for a
 * frame), as does the first size at attach, so the first paint has its rows.
 *
 * Why not the core's `useAnimationFrameWithResizeObserver` option: it
 * defers every report — growth too (the blank band) — and every row
 * measurement, which also makes index scrolls wait an extra frame to settle.
 * Only the scroller's shrink needs the frame.
 */
/** A size the core reads (`Rect` of `@tanstack/virtual-core`). */
export interface ScrollerRect {
  readonly width: number;
  readonly height: number;
}

/** The core's watch signature, generic over its instance. */
export type ObserveRect<Instance> = (
  instance: Instance,
  callback: (rect: ScrollerRect) => void
) => (() => void) | undefined;

/** Frame scheduling (a seam: tests drive frames by hand). */
export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/** The browser's animation frames. */
const ANIMATION_FRAMES: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle);
  }
};

/**
 * Whether `next` is no smaller than `shown` on either axis (a growth or no
 * change: the row window only gains rows).
 *
 * @param next The new size.
 * @param shown The size the core last got.
 * @returns True for growth (or the same size).
 */
export function isGrowth(next: ScrollerRect, shown: ScrollerRect): boolean {
  return next.width >= shown.width && next.height >= shown.height;
}

/**
 * Wrap the core's watch: the size reported while attaching and every growth
 * pass through at once (dropping a pending shrink they supersede); a shrink
 * on either axis coalesces into one report on the next frame (the latest
 * wins). Stopping drops a pending report.
 *
 * @param observe The core's watch (`observeElementRect`).
 * @param frames The frame scheduler (default: animation frames).
 * @returns The watch to pass as the core's `observeElementRect`.
 */
export function frameDeferredRect<Instance>(
  observe: ObserveRect<Instance>,
  frames: FrameScheduler = ANIMATION_FRAMES
): ObserveRect<Instance> {
  return (instance, callback) => {
    let shown: ScrollerRect | null = null;
    let pending: number | null = null;
    let latest: ScrollerRect | null = null;
    const report = (rect: ScrollerRect): void => {
      shown = rect;
      callback(rect);
    };
    const stop = observe(instance, (rect) => {
      if (shown === null || isGrowth(rect, shown)) {
        if (pending !== null) frames.cancel(pending);
        pending = null;
        latest = null;
        report(rect);
        return;
      }
      latest = rect;
      pending ??= frames.request(() => {
        pending = null;
        if (latest !== null) report(latest);
        latest = null;
      });
    });
    return () => {
      if (pending !== null) frames.cancel(pending);
      pending = null;
      stop?.();
    };
  };
}
