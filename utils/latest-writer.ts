/**
 * A writer that keeps only the latest value: one write in flight at a time;
 * values submitted meanwhile collapse into the newest, written once the
 * current write settles. For a setting that changes in bursts (a splitter
 * moved key by key) — every value lands in order, the last one always lands,
 * and a burst costs one write per round trip, not one per change. No timers:
 * nothing is lost when the page closes between a change and a deadline.
 */

/** Submit a value (never rejects: failures go to the writer's `onError`). */
export type LatestWriter<T> = (value: T) => void;

/**
 * Create a latest-wins writer.
 *
 * @param write The persistence (one value per call).
 * @param onError Told about each failed write, with the value it carried;
 *   the next pending value is still written.
 * @returns The submit function.
 */
export function createLatestWriter<T>(
  write: (value: T) => Promise<void>,
  onError: (cause: unknown, value: T) => void
): LatestWriter<T> {
  let busy = false;
  let pending: { readonly value: T } | undefined;
  const run = (value: T): void => {
    busy = true;
    // A synchronous throw is a failed write too (wrapped into the chain).
    void Promise.resolve()
      .then(() => write(value))
      .catch((cause: unknown) => {
        onError(cause, value);
      })
      .finally(() => {
        busy = false;
        const next = pending;
        pending = undefined;
        if (next !== undefined) run(next.value);
      });
  };
  return (value) => {
    if (busy) pending = { value };
    else run(value);
  };
}
