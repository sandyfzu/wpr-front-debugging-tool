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
import {
  READY_WAIT_MS,
  RECORD_STEP_MS,
  REWRITE_DOCUMENT_BOUND_MS,
  RUNNER_OVERHEAD_MS,
  SIMULATION_RUNTIME_READ_MS,
  STORE_STEP_MS
} from './document-hold';

// Declared in their own lean modules (the engine worker and the overlay
// import them without the rest of this table's imports).
export { DOCUMENT_TRANSFORM_BUDGET_MS } from './engine-budget';
export {
  CHROMIUM_RELEASE_MARGIN_MS,
  SIMULATION_PREPARATION_BOUND_MS,
  SIMULATION_PREPARATION_CPU_BOUND_MS,
  STREAM_FACTS_WAIT_MS,
  STREAM_RELEASE_MARGIN_MS,
  STREAM_SETTLE_WAIT_MS,
  chromiumReleaseMs,
  documentRecordWaitMs,
  rewriteDocumentBoundMs,
  streamHoldWorstCaseMs
} from './document-hold';

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
  store: STORE_STEP_MS,
  /** The wake tab probe. */
  tabProbe: 500,
  /** One status push (tab and panels, in parallel). */
  push: 500,
  /** One wait on the wake re-validation before an ask or document proceeds. */
  ready: READY_WAIT_MS,
  /**
   * How long an ask may wait behind earlier events of its tab before it
   * gives up (rejects — the sender sees a retryable failure) instead of
   * starting late.
   */
  queueWait: 500,
  /** A runner's overhead past the engine budget (messaging, a worker spawn). */
  runnerOverhead: RUNNER_OVERHEAD_MS,
  /** How long a recording host call waits for its record (it still lands after). */
  record: RECORD_STEP_MS
} as const;

const STEPS = SESSION_STEP_TIMEOUTS_MS;

/**
 * Deadlines (ms) for each awaited simulation input source while a document
 * is prepared: past one, that source's own fallback applies (runtime: the
 * document is not simulated, `asset-unreachable`; list: the bundled rows,
 * miss `unreadable`; marker id: the document is served unmodified) — a hung
 * source never holds the release.
 */
export const SIMULATION_SOURCE_TIMEOUTS_MS = {
  /**
   * The packaged data's first read in a background lifetime (a ~20 KB
   * extension file: fetch, parse, hash — milliseconds), then a memory read.
   */
  runtime: SIMULATION_RUNTIME_READ_MS,
  /** The exclusion list choice (the kept copy, read from storage once per background lifetime). */
  list: STEPS.store,
  /** The marker id (one memo write). */
  markerId: STEPS.store,
  /** The marker's settling after the run (one memo write narrowing it to the simulated features). */
  settleMarker: STEPS.store
} as const;

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
  /**
   * Wake wait + session read + engine budget + runner overhead + the
   * post-run session re-check — a session that does not simulate (one that
   * does: {@link rewriteDocumentBoundMs}).
   */
  rewriteDocument: REWRITE_DOCUMENT_BOUND_MS,
  /** Wake wait + session read + the record wait. */
  documentBodyUnavailable: STEPS.ready + STEPS.store + STEPS.record,
  /** Wake wait + session read + the record wait. */
  documentNotServed: STEPS.ready + STEPS.store + STEPS.record,
  /** Wake wait + session read + the record wait. */
  documentPassed: STEPS.ready + STEPS.store + STEPS.record,
  /** Wake wait + the record wait. */
  interceptionEnded: STEPS.ready + STEPS.record,
  /**
   * Wake wait + queue wait (behind the tab's document record) + session
   * read + the packaged data and runtime file reads (memory reads once a
   * document of this lifetime simulated).
   */
  simulatedRuntime:
    STEPS.ready + STEPS.queueWait + STEPS.store + 2 * SIMULATION_SOURCE_TIMEOUTS_MS.runtime
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

/**
 * {@link withinDeadline} with a deadline `work` may lengthen once: both
 * timers start now, and the base one rejects only while `work` has not
 * called `extend` — so the extended deadline counts from the same start
 * (no clock needed) and a work that never extends keeps the base exactly.
 *
 * @param step What runs (names the timeout).
 * @param baseMs The deadline (ms) unless extended.
 * @param extendedMs The deadline (ms) once extended (≥ `baseMs`).
 * @param work The step; `extend` lengthens its deadline (a no-op once the
 *   base deadline passed — the step already timed out).
 * @param schedule Timer seam; defaults to `setTimeout`.
 * @throws {@link RangeError} When `extendedMs` is below `baseMs`.
 */
export function withinExtensibleDeadline<T>(
  step: string,
  baseMs: number,
  extendedMs: number,
  work: (extend: () => void) => Promise<T>,
  schedule: ScheduleTimer = scheduleWithTimeout
): Promise<T> {
  if (extendedMs < baseMs) {
    throw new RangeError(
      `${step}: extended deadline ${String(extendedMs)} ms is below its base ${String(baseMs)} ms`
    );
  }
  let extended = false;
  let cancelBase: (() => void) | undefined;
  return withinDeadline(
    step,
    extendedMs,
    () =>
      new Promise<T>((resolve, reject) => {
        cancelBase = schedule(() => {
          if (!extended) reject(new DeadlineExceededError(step, baseMs));
        }, baseMs);
        const extend = (): void => {
          extended = true;
        };
        let running: Promise<T>;
        try {
          running = work(extend);
        } catch (cause) {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- passed through as thrown: the caller branches on the step's own failure
          running = Promise.reject(cause);
        }
        running.then(resolve, reject);
      }),
    schedule
  ).finally(() => {
    cancelBase?.();
  });
}
