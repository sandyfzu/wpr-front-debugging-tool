/**
 * One-shot timers tied to a content-script context that let go of their
 * callback once they fire or are cancelled. The context's own `setTimeout`
 * registers an invalidation listener per timer and never removes it, and
 * that listener keeps the timer's whole closure scope — the callback
 * included — alive for the page's lifetime: every slice of long work would
 * pin what it read (a lane's whole translation) until the page goes.
 */

/** What a timer needs from the content-script context. */
export interface TimerContext {
  readonly isValid: boolean;
  /** Registers `cb` to run once the context is invalidated; returns its removal. */
  onInvalidated(cb: () => void): () => void;
}

/** The platform timer functions (injected, for tests). */
export interface TimerFunctions {
  readonly setTimeout: (run: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
}

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
