/**
 * Runs one RUCSS build (`./build`) in a fresh Web Worker under a hard time
 * budget: past {@link RUCSS_BUILD_TIMEOUT_MS} the worker is terminated and
 * the build ends as `timeout` — a catastrophic user pattern can never
 * freeze the caller nor run on. Without worker support the build ends as
 * `unavailable`: it never falls back to running the patterns on the
 * caller's thread.
 *
 * Only an extension page can spawn the worker (a content script cannot
 * start a worker from the extension's files: workers must be same-origin
 * with the page), so the DevTools panel runs it.
 */
import { scheduleWithTimeout, type ScheduleTimer } from '../messaging/bounded-ask';
import { isRecord, ownValue } from '../../utils/is-record';
import type { RucssBuildInput, RucssBuildResult } from './build';
import { RUCSS_BUILD_TIMEOUT_MS } from './deadlines';

/**
 * How a build ended: its result, or why there is none —
 * `timeout` (stopped at the budget), `unavailable` (no worker could run),
 * `failed` (the worker failed or answered junk).
 */
export type RucssBuildOutcome =
  RucssBuildResult | { readonly ok: false; readonly problem: 'timeout' | 'unavailable' | 'failed' };

/** The worker surface the client uses (a real `Worker`, or a test double). */
export interface BuildWorkerLike {
  postMessage: (message: RucssBuildInput) => void;
  terminate: () => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

/** Client seams (all optional in production). */
export interface RucssBuildOptions {
  /** Spawn a worker; throws when the platform has none. */
  readonly createWorker?: () => BuildWorkerLike;
  /** The budget (default {@link RUCSS_BUILD_TIMEOUT_MS}). */
  readonly timeoutMs?: number;
  /** Timer seam (default `setTimeout`). */
  readonly schedule?: ScheduleTimer;
}

/**
 * The real worker: Vite bundles the entry as its own file from this exact
 * `new Worker(new URL(…, import.meta.url))` form.
 *
 * @throws {@link Error} when the platform has no `Worker`.
 */
function spawnBuildWorker(): BuildWorkerLike {
  if (typeof Worker !== 'function') throw new Error('Worker is not available here.');
  return new Worker(new URL('./build.worker.ts', import.meta.url), {
    type: 'module'
  }) as unknown as BuildWorkerLike;
}

/**
 * Guard the worker's answer (shape only: the worker is this extension's code).
 *
 * @param data The message data.
 * @returns The outcome, or null for junk.
 */
function parseBuildAnswer(data: unknown): RucssBuildOutcome | null {
  if (!isRecord(data)) return null;
  const ok = ownValue(data, 'ok');
  if (ok === true) {
    const css = ownValue(data, 'css');
    const applied = ownValue(data, 'applied');
    const keepLinks = ownValue(data, 'keepLinks');
    return typeof css === 'string' && Array.isArray(applied) && Array.isArray(keepLinks)
      ? (data as RucssBuildOutcome)
      : null;
  }
  return ok === false && typeof ownValue(data, 'problem') === 'string'
    ? (data as RucssBuildOutcome)
    : null;
}

/**
 * Run one build in a fresh worker; never rejects.
 *
 * @param input The build input (plain data, structured-cloned to the worker).
 * @param options See {@link RucssBuildOptions}.
 * @returns The result, or why there is none.
 */
export function buildRucssInWorker(
  input: RucssBuildInput,
  options: RucssBuildOptions = {}
): Promise<RucssBuildOutcome> {
  const {
    createWorker = spawnBuildWorker,
    timeoutMs = RUCSS_BUILD_TIMEOUT_MS,
    schedule = scheduleWithTimeout
  } = options;
  let worker: BuildWorkerLike;
  try {
    worker = createWorker();
  } catch {
    // No worker here (the platform has none, or refused it): never run the patterns inline.
    return Promise.resolve({ ok: false, problem: 'unavailable' });
  }
  return new Promise((resolve) => {
    let settled = false;
    // The deadline's cancel, set once the timer is armed below.
    const deadline: { cancel?: () => void } = {};
    /** Settle once and release the worker in every branch. */
    const settle = (outcome: RucssBuildOutcome): void => {
      if (settled) return;
      settled = true;
      deadline.cancel?.();
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      resolve(outcome);
    };
    worker.onmessage = (event) => {
      settle(parseBuildAnswer(event.data) ?? { ok: false, problem: 'failed' });
    };
    worker.onerror = () => {
      // The worker script failed to load or threw outside the build's guard.
      settle({ ok: false, problem: 'failed' });
    };
    worker.onmessageerror = () => {
      // The answer could not be deserialized: no answer will follow — fail now, not at the budget.
      settle({ ok: false, problem: 'failed' });
    };
    deadline.cancel = schedule(() => {
      settle({ ok: false, problem: 'timeout' });
    }, timeoutMs);
    try {
      worker.postMessage(input);
    } catch {
      // The input could not be cloned to the worker (never plain data — a defect).
      settle({ ok: false, problem: 'failed' });
    }
  });
}
