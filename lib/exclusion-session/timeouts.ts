/**
 * The session core's time bounds, declared once: every backend call and
 * every I/O the controller awaits is time-boxed, so no hung browser API,
 * store or push can wedge a tab's event queue or hold a navigation, and
 * every host call a backend makes resolves within a declared bound.
 */
import { REGEX_ANALYSIS_LIMITS } from '../exclusion-builder/regex-risk';
import { EXCLUSION_FEATURES } from '../exclusion-builder/set';
import { scheduleWithTimeout, type ScheduleTimer } from '../messaging/bounded-ask';
import { EXCLUSION_SET_LIMITS } from '../messaging/exclusion-session';
import { DOCUMENT_TRANSFORM_BUDGET_MS } from './document-transform';

/**
 * Per-step deadlines (ms). Generous against the real latencies (store and
 * push round trips are sub-millisecond to a few ms; a debugger attach is
 * tens of ms) — they exist to end a step that never settles, not to race
 * a slow one. Sized so every ask's worst path ({@link SESSION_ASK_WORST_CASE_MS})
 * stays well under the sender's own ask deadline.
 */
export const SESSION_STEP_TIMEOUTS_MS = {
  /** `backend.arm` (attach + enable / listener setup). */
  arm: 5_000,
  /** `backend.disarm`. */
  disarm: 750,
  /** `backend.resume` (wake re-validation). */
  resume: 1_500,
  /** One session-store or saved-set read/write. */
  store: 500,
  /** The wake tab probe. */
  tabProbe: 500,
  /** One status push (tab and panels, in parallel). */
  push: 500,
  /** One wait on the wake re-validation before an ask or document proceeds. */
  ready: 1_000,
  /**
   * How long an ask may wait behind earlier events of its tab before it
   * gives up (rejects — the sender sees a retryable failure) instead of
   * starting late.
   */
  queueWait: 500,
  /** A runner's overhead past the engine budget (messaging, a worker spawn). */
  runnerOverhead: 1_000,
  /** How long a recording host call waits for its record (it still lands after). */
  record: 2_000
} as const;

const STEPS = SESSION_STEP_TIMEOUTS_MS;

/**
 * The most analysis work a whole set's prevalidation can spend (work
 * units), by construction: each pattern row's analysis is capped at
 * `workBase + workPerChar × length` (`analysisWorkBudget` — past it the
 * row is `too-complex`), and a wire-valid set holds at most
 * `totalChars` characters over at most `rowsPerFeature` rows per pattern
 * feature. Machine speed plays no part in this number.
 */
export const PREVALIDATION_WORK_BOUND =
  REGEX_ANALYSIS_LIMITS.workPerChar * EXCLUSION_SET_LIMITS.totalChars +
  REGEX_ANALYSIS_LIMITS.workBase *
    EXCLUSION_SET_LIMITS.rowsPerFeature *
    EXCLUSION_FEATURES.filter((feature) => feature.rowKind === 'pattern').length;

/**
 * Cost of one work unit (ns), declared from measurement: every inner step
 * the analysis takes is charged (sorts at n·log n, head copies, class
 * walks, matcher reads), so the cost per unit is near-uniform across
 * shapes. Measured 2026-10-20 over 23 cap-sized adversarial shapes (warm,
 * Node 24, development machine, no coverage, repeated runs): 3.8–8 ns on
 * the shapes that reach millions of units, up to 24 ns on light ones
 * (≤ 0.5 M units, ~3 ms runs); declared at the highest seen.
 */
export const PREVALIDATION_NS_PER_WORK_UNIT = 25;

/**
 * Work-independent prevalidation cost (ms): the one-time case-folding
 * index (~5 ms measured) plus constructing every row's `RegExp` for a
 * cap-sized set (< 1 ms measured), rounded up.
 */
export const PREVALIDATION_FIXED_MS = 10;

/**
 * The CPU an apply spends prevalidating its set before anything is queued
 * (ms) — synchronous, so a bound, not a timeout. The worst case on the
 * development machine is `PREVALIDATION_WORK_BOUND × NS_PER_WORK_UNIT +
 * FIXED` ≈ 155 ms (5.78 M units); this bound keeps ≥ 10× headroom for
 * slower machines (low-end laptops, a busy browser), pinned by a test.
 */
export const PREVALIDATION_CPU_BOUND_MS = 1_600;

/**
 * The longest each controller ask can take before it answers (ms), from
 * the step deadlines along its worst path — the sender's ask deadline
 * must stay above these with margin.
 */
export const SESSION_ASK_WORST_CASE_MS = {
  /**
   * Wake wait + prevalidation CPU + queue wait + state read + cap read +
   * arm + active-record write refused at the cap, then the warning: disarm
   * + write + re-read (the write failed) + push.
   */
  apply:
    STEPS.ready +
    PREVALIDATION_CPU_BOUND_MS +
    STEPS.queueWait +
    2 * STEPS.store +
    STEPS.arm +
    STEPS.store +
    STEPS.disarm +
    2 * STEPS.store +
    STEPS.push,
  /** Wake wait + queue wait + state read + disarm + removal + re-read (it failed) + push. */
  stop: STEPS.ready + STEPS.queueWait + STEPS.store + STEPS.disarm + 2 * STEPS.store + STEPS.push,
  /** Wake wait + queue wait + one read. */
  status: STEPS.ready + STEPS.queueWait + STEPS.store
} as const;

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
