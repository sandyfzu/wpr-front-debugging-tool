/**
 * The page side of a beacon test: find the runner (asking the background to
 * inject it on the first run), start one run with the panel's configuration
 * and answer how it ended — bounded by {@link BEACON_RUN_TIMEOUT_MS}: past
 * it the answer is `timed-out` with what the beacon collected so far, and
 * the beacon's watchdog is stopped. One run at a time per page; nothing is
 * written to the page or sent to the site (the runner's adapter owns that),
 * and nothing is logged about the page.
 *
 * Pure over its seams (the runner lookup, the background ask, the timer),
 * so the run's lifecycle is unit-tested with a fake runner.
 */
import { scheduleWithTimeout, type ScheduleTimer } from '../../../lib/messaging/bounded-ask';
import type { BeaconTestReply, BeaconTestRequest } from '../../../lib/messaging/beacon-test';
import { BEACON_RUN_TIMEOUT_MS } from '../../../lib/beacon-test/deadlines';
import { RESULT_RECORDS_MAX } from '../../../lib/beacon-test/results';
import type {
  BeaconRunEnd,
  BeaconRunHandle,
  BeaconRunner
} from '../../../lib/beacon-test/runner-bridge';
import { isRecord, ownValue } from '../../../utils/is-record';
import { capText } from '../../../utils/cap-text';

/** What the executor runs against (tests inject doubles). */
export interface BeaconTestExecutorDeps {
  /** The live runner, or null (none injected yet, or a dead one). */
  readonly readRunner: () => BeaconRunner | null;
  /** Ask the background to inject the runner; resolves whether it did. */
  readonly loadRunner: () => Promise<boolean>;
  /** Timer seam for the run's outer bound (default `setTimeout`). */
  readonly schedule?: ScheduleTimer;
}

/** The executor. */
export interface BeaconTestExecutor {
  readonly run: (request: BeaconTestRequest) => Promise<BeaconTestReply>;
  /**
   * The content script's context ended: stop a running test's watchdog and
   * its outer bound (nothing stays scheduled); its wait ends at once with
   * the partial results.
   */
  readonly dispose: () => void;
}

/** Code points kept of a failure message. */
const MESSAGE_MAX = 300;

/**
 * Bound the beacon's raw results by count before they cross to the panel
 * (whose guard validates every entry): each feature list keeps one entry
 * past the validator's cap, so the validator still sees the list was longer.
 *
 * @param raw The runner's raw results.
 * @returns The bounded copy (own `lcp`/`lrc` only), or `raw` when it is not a record.
 */
export function boundRawResults(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const bound = (list: unknown): unknown =>
    Array.isArray(list) ? list.slice(0, RESULT_RECORDS_MAX + 1) : list;
  return { lcp: bound(ownValue(raw, 'lcp')), lrc: bound(ownValue(raw, 'lrc')) };
}

/**
 * A caught failure's message, capped.
 *
 * @param cause Any caught value.
 */
function messageOf(cause: unknown): string {
  return capText(cause instanceof Error ? cause.message : String(cause), MESSAGE_MAX);
}

/**
 * The reply for a run that ended within the bound.
 *
 * @param end How the run ended.
 */
function replyOf(end: BeaconRunEnd): BeaconTestReply {
  switch (end.kind) {
    case 'completed':
      return {
        kind: 'completed',
        results: boundRawResults(end.results),
        scriptErrors: [...end.scriptErrors]
      };
    case 'bailed':
      return { kind: 'bailed', reason: end.reason };
    case 'failed':
      return { kind: 'failed', message: capText(end.message, MESSAGE_MAX) };
  }
}

/**
 * Read a timed-out run's partial results; a throwing read counts as none.
 *
 * @param handle The run.
 */
function partialOf(handle: BeaconRunHandle): unknown {
  try {
    return boundRawResults(handle.partial());
  } catch {
    // The runner's bundle broke mid-read: the timeout still answers, with nothing collected.
    return null;
  }
}

/**
 * Create the executor (one per page).
 *
 * @param deps See {@link BeaconTestExecutorDeps}.
 */
export function createBeaconTestExecutor(deps: BeaconTestExecutorDeps): BeaconTestExecutor {
  const schedule = deps.schedule ?? scheduleWithTimeout;
  // True from the first await of a run to its answer: one run per page.
  let busy = false;
  let active: BeaconRunHandle | null = null;
  // Ends the running test's wait now (its outer bound cleared); null between runs.
  let endWait: (() => void) | null = null;

  /** The runner, injected first when there is none (null when it cannot be had). */
  const findRunner = async (): Promise<BeaconRunner | null> => {
    const live = deps.readRunner();
    if (live !== null) return live;
    return (await deps.loadRunner()) ? deps.readRunner() : null;
  };

  /**
   * Await the run's end, or the outer bound.
   *
   * @returns The end, or null when the bound passed first.
   */
  const awaitEnd = (handle: BeaconRunHandle): Promise<BeaconRunEnd | null> =>
    new Promise((resolve) => {
      const cancel = schedule(() => {
        resolve(null);
      }, BEACON_RUN_TIMEOUT_MS);
      endWait = () => {
        cancel();
        resolve(null);
      };
      const settle = (end: BeaconRunEnd): void => {
        cancel();
        resolve(end);
      };
      // `done` never rejects by contract; a broken runner bundle still answers.
      handle.done.then(settle, (cause: unknown) => {
        settle({ kind: 'failed', message: messageOf(cause) });
      });
    });

  /** Start one run and answer its end, or its partial results past the bound. */
  const runWith = async (
    runner: BeaconRunner,
    request: BeaconTestRequest
  ): Promise<BeaconTestReply> => {
    let handle: BeaconRunHandle;
    try {
      handle = runner.start(request.config);
    } catch (cause) {
      return { kind: 'failed', message: messageOf(cause) };
    }
    active = handle;
    const end = await awaitEnd(handle);
    active = null;
    endWait = null;
    if (end !== null) return replyOf(end);
    const partial = partialOf(handle);
    handle.cancel();
    return { kind: 'timed-out', partial };
  };

  const run = async (request: BeaconTestRequest): Promise<BeaconTestReply> => {
    if (busy) return { kind: 'busy' };
    busy = true;
    try {
      const runner = await findRunner();
      return runner === null ? { kind: 'runner-unavailable' } : await runWith(runner, request);
    } finally {
      busy = false;
    }
  };

  return {
    run,
    dispose: () => {
      active?.cancel();
      active = null;
      endWait?.();
    }
  };
}
