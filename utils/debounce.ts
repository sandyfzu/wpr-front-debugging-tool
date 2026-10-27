/** Return type of {@link debounce}: the debounced function plus lifecycle handles. */
export interface DebouncedFunction<TArgs extends unknown[]> {
  /** Schedule an invocation; replaces any pending one (trailing debounce). */
  (...args: TArgs): void;
  /** Drop the pending invocation without running it. */
  cancel(): void;
}

/**
 * Debounce a function to its *last* call: only the final invocation of a burst runs,
 * `waitMs` after the burst went quiet. Replaces the hand-rolled copies previously
 * needed for search input, observer rescans and error batching.
 *
 * The invocation is always asynchronous relative to the call; arguments captured are
 * those of the last call. A pending invocation is lost on `cancel()` — use cancel
 * when tearing down listeners so a not-yet-fired callback never runs. The callback
 * runs through a timer without a surrounding listener: anything it throws surfaces
 * as an uncaught exception in the calling context (whose global handlers report it),
 * never swallowed by this wrapper.
 *
 * With `maxWaitMs`, a burst that never goes quiet still runs `fn` at least
 * that often (with the latest arguments) — a continuously mutating page must
 * not starve its observer forever.
 *
 * @param fn The function to debounce. No result is preserved (ignore return values).
 * @param waitMs Quiet period before `fn` runs; negative values are clamped to 0.
 * @param options `maxWaitMs`: the longest a pending call may wait (unset: unbounded).
 * @returns The debounced function with a {@link DebouncedFunction.cancel | cancel} handle.
 */
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  waitMs: number,
  options: { readonly maxWaitMs?: number } = {}
): DebouncedFunction<TArgs> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let latestArgs: TArgs = [] as unknown as TArgs;

  const clearTimers = (): void => {
    if (timer !== null) clearTimeout(timer);
    if (maxTimer !== null) clearTimeout(maxTimer);
    timer = null;
    maxTimer = null;
  };

  const run = (): void => {
    clearTimers();
    fn(...latestArgs);
  };

  const debounced = (...args: TArgs): void => {
    latestArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, Math.max(0, waitMs));
    if (options.maxWaitMs !== undefined && maxTimer === null) {
      maxTimer = setTimeout(run, Math.max(0, options.maxWaitMs));
    }
  };

  debounced.cancel = (): void => {
    clearTimers();
  };

  return debounced;
}
