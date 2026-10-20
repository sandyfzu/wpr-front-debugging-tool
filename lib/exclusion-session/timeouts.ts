/**
 * The session core's time bounds, declared once: every backend call and
 * every I/O the controller awaits is time-boxed, so no hung browser API,
 * store or push can wedge a tab's event queue or hold a navigation, and
 * every host call a backend makes resolves within a declared bound.
 */
import { scheduleWithTimeout, type ScheduleTimer } from '../messaging/bounded-ask';
import { DOCUMENT_TRANSFORM_BUDGET_MS } from './document-transform';

/**
 * Per-step deadlines (ms). Generous against the real latencies (store and
 * push round trips are sub-millisecond to a few ms; a debugger attach is
 * tens of ms) — they exist to end a step that never settles, not to race
 * a slow one. An apply's arm path (read + arm + store + save + push) stays
 * under the overlay's apply ask deadline.
 */
export const SESSION_STEP_TIMEOUTS_MS = {
  /** `backend.arm` (attach + enable / listener setup). */
  arm: 6_000,
  /** `backend.disarm`. */
  disarm: 2_000,
  /** `backend.resume` (wake re-validation). */
  resume: 2_000,
  /** One session-store or saved-set read/write. */
  store: 1_000,
  /** The wake tab probe. */
  tabProbe: 1_000,
  /** One status push (tab or panels). */
  push: 1_000,
  /** One wait on the wake re-validation before an ask or document proceeds. */
  ready: 3_000,
  /** A runner's overhead past the engine budget (messaging, a worker spawn). */
  runnerOverhead: 1_000,
  /** How long a recording host call waits for its record (it still lands after). */
  record: 2_000
} as const;

const STEPS = SESSION_STEP_TIMEOUTS_MS;

/**
 * The bound (ms) within which each {@link InterceptionHost} method
 * resolves, whatever the stores or the backend do (CPU spent inside an
 * in-process engine step is the one thing a timer cannot preempt — the
 * budget is enforced between steps there). A backend arms its own release
 * deadline above these (see the seam).
 */
export const INTERCEPTION_HOST_BOUNDS_MS = {
  /** Wake wait + one session read. */
  shouldIntercept: STEPS.ready + STEPS.store,
  /** Wake wait + session read + engine budget + runner overhead + the post-run session re-check. */
  rewriteDocument:
    STEPS.ready + 2 * STEPS.store + DOCUMENT_TRANSFORM_BUDGET_MS + STEPS.runnerOverhead,
  /** Wake wait + session read + the record wait. */
  documentBodyUnavailable: STEPS.ready + STEPS.store + STEPS.record,
  /** Wake wait + the record wait. */
  interceptionEnded: STEPS.ready + STEPS.record
} as const;

/** A step that did not settle within its deadline. */
export class DeadlineExceededError extends Error {
  override readonly name = 'DeadlineExceededError';

  /**
   * @param step What timed out (for the log).
   * @param ms The deadline it missed.
   */
  constructor(
    readonly step: string,
    readonly ms: number
  ) {
    super(`${step} did not settle within ${String(ms)} ms`);
  }
}

/**
 * Run `work` under a deadline: its own settlement, or a
 * {@link DeadlineExceededError} rejection once `ms` pass (a late
 * settlement is ignored — never an unhandled rejection). A synchronous
 * throw from `work` is a rejection; rejections pass through unchanged.
 *
 * @param step What runs (names the timeout).
 * @param ms The deadline (ms).
 * @param work The step.
 * @param schedule Timer seam; defaults to `setTimeout`.
 */
export function withinDeadline<T>(
  step: string,
  ms: number,
  work: () => Promise<T>,
  schedule: ScheduleTimer = scheduleWithTimeout
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = schedule(() => {
      reject(new DeadlineExceededError(step, ms));
    }, ms);
    let running: Promise<T>;
    try {
      running = work();
    } catch (cause) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- passed through as thrown: the caller branches on the step's own failure
      running = Promise.reject(cause);
    }
    running.then(
      (value) => {
        cancel();
        resolve(value);
      },
      (cause: unknown) => {
        cancel();
        // Passed through as-is: callers branch on (and log) the step's own failure.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- see above
        reject(cause);
      }
    );
  });
}
