/**
 * Stepped work: a computation split into small steps, so a caller can run
 * it in time-boxed slices (each task stays short) or all at once — the
 * same steps in the same order, so the same result either way.
 */

/** A computation run a step at a time. */
export interface Stepped<T> {
  /**
   * Run the next step.
   *
   * @returns Whether every step is done.
   */
  step(): boolean;
  /**
   * The result (call once every step is done).
   *
   * @throws {@link Error} when steps are still to run.
   */
  result(): T;
}

/**
 * Run every step now and read the result.
 *
 * @param work The stepped computation.
 */
export function runStepped<T>(work: Stepped<T>): T {
  while (!work.step());
  return work.result();
}

/**
 * Run steps for `ms` on `clock` — at least one, so the work always
 * progresses however slow a step is.
 *
 * @param step One step; returns whether every step is done.
 * @param clock Monotonic ms now.
 * @param ms The time box.
 * @returns Whether every step is done.
 */
export function stepFor(step: () => boolean, clock: () => number, ms: number): boolean {
  const started = clock();
  let done = step();
  while (!done && clock() - started < ms) done = step();
  return done;
}

/**
 * A stepped computation that is already done (e.g. a cached result).
 *
 * @param value The result.
 */
export function steppedValue<T>(value: T): Stepped<T> {
  return { step: () => true, result: () => value };
}
