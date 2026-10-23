/**
 * One-shot timers and animation frames tied to a content-script context
 * that let go of their callback once they fire or are cancelled. The
 * context's own `setTimeout` / `requestAnimationFrame` register an
 * invalidation listener per call and never remove it, and that listener
 * keeps the call's whole closure scope — the callback included — alive for
 * the page's lifetime (measured: 50 of 50 fired callbacks still reachable
 * after GC; none with these): every slice of long work, every highlight or
 * focus frame would pin what it closed over until the page goes.
 */

/** What a timer needs from the content-script context. */
export interface TimerContext {
  readonly isValid: boolean;
  /** Registers `cb` to run once the context is invalidated; returns its removal. */
  onInvalidated(cb: () => void): () => void;
}

/** The platform frame functions (injected, for tests). */
export interface FrameFunctions {
  readonly requestAnimationFrame: (run: () => void) => number;
  readonly cancelAnimationFrame: (id: number) => void;
}

/** The platform timer functions (injected, for tests). */
export interface TimerFunctions {
  readonly setTimeout: (run: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
}

/** The window's timers (read when called). */
export const WINDOW_TIMERS: TimerFunctions = {
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (id) => {
    window.clearTimeout(id);
  }
};

/** The window's animation frames (read when called). */
export const WINDOW_FRAMES: FrameFunctions = {
  requestAnimationFrame: (run) => window.requestAnimationFrame(run),
  cancelAnimationFrame: (id) => {
    window.cancelAnimationFrame(id);
  }
};

/**
 * A one-shot scheduler on `ctx`: `run` fires after `ms` unless cancelled or
 * the context was invalidated meanwhile (which clears it); either way its
 * invalidation listener is removed, so nothing keeps `run` afterwards.
 *
 * @param ctx The content-script context.
 * @param timers The platform timers.
 * @returns `(run, ms) → cancel`.
 */
export function contextScheduler(
  ctx: TimerContext,
  timers: TimerFunctions
): (run: () => void, ms: number) => () => void {
  return (run, ms) => {
    let unwatch: (() => void) | null = null;
    const id = timers.setTimeout(() => {
      unwatch?.();
      unwatch = null;
      if (ctx.isValid) run();
    }, ms);
    // Its own scope: the listener keeps the id only, never `run`.
    unwatch = ctx.onInvalidated(clearer(timers, id));
    return () => {
      unwatch?.();
      unwatch = null;
      timers.clearTimeout(id);
    };
  };
}

/**
 * A listener clearing one timer (built apart so it captures nothing else).
 *
 * @param timers The platform timers.
 * @param id The timer.
 */
function clearer(timers: TimerFunctions, id: number): () => void {
  return () => {
    timers.clearTimeout(id);
  };
}

/**
 * A next-frame scheduler on `ctx`, as {@link contextScheduler} for frames:
 * `run` fires on the next frame unless the context was invalidated
 * meanwhile (which cancels it); its invalidation listener is removed either way.
 *
 * @param ctx The content-script context.
 * @param frames The platform frame functions.
 * @returns `(run) → cancel`.
 */
export function contextFrames(
  ctx: TimerContext,
  frames: FrameFunctions
): (run: () => void) => () => void {
  const schedule = contextScheduler(ctx, {
    setTimeout: (run) => frames.requestAnimationFrame(run),
    clearTimeout: (id) => {
      frames.cancelAnimationFrame(id);
    }
  });
  // A frame takes no delay: the scheduler's `ms` goes unused.
  return (run) => schedule(run, 0);
}
