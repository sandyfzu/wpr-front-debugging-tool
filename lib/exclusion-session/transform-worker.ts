/**
 * The preempting engine runner: the pipeline runs off the background's
 * thread (a dedicated worker, or any port with the same shape — e.g. an
 * offscreen document hosting one) and a hard deadline kills a runaway run,
 * so no row can stall a navigation past its budget. The worker announces
 * each step as it starts, so the overrun still names its feature.
 *
 * Both halves live here: {@link handleTransformWorkerMessage} is the
 * worker's whole message handler; {@link createWorkerTransformRunner} the
 * host. Runs are serialized on one live port; a killed port is replaced
 * lazily on the next run.
 */
import type { ExclusionFeatureId } from '../exclusion-builder/set';
import { EXCLUSION_PIPELINE_IDS } from '../exclusion-builder/pipeline';
import type { ScheduleTimer } from '../messaging/bounded-ask';
import { parseExclusionSet } from '../messaging/exclusion-session';
import { isRecord } from '../../utils/is-record';
import {
  overBudgetOutcome,
  runDocumentPipeline,
  type DocumentTransformRequest,
  type DocumentTransformResult,
  type DocumentTransformRunner
} from './document-transform';

/** Extra time (ms) past the budget before a silent worker is killed (messaging latency). */
export const WORKER_GRACE_MS = 250;

/** Host → worker: run one request. */
export interface TransformWorkerRequest {
  readonly type: 'transform';
  readonly id: number;
  readonly request: DocumentTransformRequest;
}

/** Worker → host: a step started, or the run's result. */
export type TransformWorkerMessage =
  | { readonly type: 'step'; readonly id: number; readonly feature: ExclusionFeatureId }
  | { readonly type: 'result'; readonly id: number; readonly result: DocumentTransformResult };

/** The port the host drives: a `Worker`, or anything with its shape. */
export interface TransformWorkerPort {
  postMessage(message: TransformWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** A pipeline feature id (registry-derived). */
function isPipelineFeature(value: unknown): value is ExclusionFeatureId {
  return EXCLUSION_PIPELINE_IDS.some((id) => id === value);
}

/** A run id: a non-negative safe integer. */
function isRunId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Parse a host request (structured-cloned into the worker).
 *
 * @returns The request, or null when malformed.
 */
export function parseTransformWorkerRequest(data: unknown): TransformWorkerRequest | null {
  if (!isRecord(data) || data['type'] !== 'transform' || !isRunId(data['id'])) return null;
  const raw = data['request'];
  if (!isRecord(raw) || typeof raw['html'] !== 'string') return null;
  const documentUrl = raw['documentUrl'];
  const budgetMs = raw['budgetMs'];
  if (documentUrl !== null && typeof documentUrl !== 'string') return null;
  if (typeof budgetMs !== 'number' || !Number.isFinite(budgetMs) || budgetMs <= 0) return null;
  const set = parseExclusionSet(raw['set'], 'reject');
  if (set === null) return null;
  return {
    type: 'transform',
    id: data['id'],
    request: { html: raw['html'], set, documentUrl, budgetMs }
  };
}

/**
 * The worker side: run one request and post its step announcements and
 * result. Malformed requests are dropped (the host's deadline answers
 * them). An `engine-failed` cause crosses as its message only (an
 * arbitrary thrown value may not be cloneable).
 *
 * @param data The received message data.
 * @param post The worker's `postMessage`.
 * @param now The monotonic clock; defaults to `performance.now`.
 */
export function handleTransformWorkerMessage(
  data: unknown,
  post: (message: TransformWorkerMessage) => void,
  now: () => number = () => performance.now()
): void {
  const parsed = parseTransformWorkerRequest(data);
  if (parsed === null) return;
  const { id, request } = parsed;
  const result = runDocumentPipeline(request, now, (feature) => {
    post({ type: 'step', id, feature });
  });
  if (result.ok || result.cause === undefined) {
    post({ type: 'result', id, result });
    return;
  }
  const cause =
    result.cause instanceof Error
      ? result.cause.message
      : typeof result.cause === 'string'
        ? result.cause
        : 'Non-error engine failure';
  post({ type: 'result', id, result: { ok: false, outcome: result.outcome, cause } });
}

/**
 * Parse a worker result (re-checked by shape: the host trusts nothing a
 * port delivers — the outcome's reports are re-validated against the set
 * when the session stores them).
 */
function parseResult(value: unknown): DocumentTransformResult | null {
  if (!isRecord(value) || !isRecord(value['outcome'])) return null;
  const outcome = value['outcome'];
  if (value['ok'] === true) {
    if (typeof value['html'] !== 'string' || outcome['outcome'] !== 'rewritten') return null;
    if (!Array.isArray(outcome['reports'])) return null;
    return value as DocumentTransformResult;
  }
  if (value['ok'] !== false) return null;
  return outcome['outcome'] === 'over-budget' || outcome['outcome'] === 'failed'
    ? (value as DocumentTransformResult)
    : null;
}

/** Host options. */
export interface WorkerTransformRunnerOptions {
  /** Spawn a port (throws when the platform cannot host one). */
  readonly spawn: () => TransformWorkerPort;
  /** Timer seam; defaults to `setTimeout`. */
  readonly schedule?: ScheduleTimer;
  /** Grace past the budget; defaults to {@link WORKER_GRACE_MS}. */
  readonly graceMs?: number;
}

/** The host: the runner plus a teardown for the live port. */
export interface WorkerTransformRunner {
  readonly run: DocumentTransformRunner;
  /** Terminate the live port (an in-flight run answers `engine-failed`). */
  dispose(): void;
}

/** The platform timer. */
const defaultSchedule: ScheduleTimer = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => {
    clearTimeout(handle);
  };
};

/**
 * The first pipeline feature — blamed when a run is killed before the
 * worker announced any step.
 *
 * @throws {@link Error} when the pipeline declares no feature (a broken build).
 */
function firstPipelineFeature(): ExclusionFeatureId {
  const first = EXCLUSION_PIPELINE_IDS[0];
  if (first === undefined) throw new Error('The exclusion pipeline declares no feature');
  return first;
}

/** The `engine-failed` result with its cause. */
function failed(cause: unknown): DocumentTransformResult {
  return { ok: false, outcome: { outcome: 'failed', reason: 'engine-failed' }, cause };
}

/**
 * Create the preempting host. Runs are serialized; each gets `budgetMs` +
 * grace before its port is terminated and the run answers `over-budget`
 * for the feature the worker last announced (the first pipeline feature
 * when none was). A port error or a spawn failure answers `engine-failed`.
 *
 * @param options The spawn seam, timers and grace.
 */
export function createWorkerTransformRunner(
  options: WorkerTransformRunnerOptions
): WorkerTransformRunner {
  const schedule = options.schedule ?? defaultSchedule;
  const graceMs = options.graceMs ?? WORKER_GRACE_MS;
  let port: TransformWorkerPort | null = null;
  let nextId = 0;
  let tail: Promise<unknown> = Promise.resolve();
  /** Settles the in-flight run (dispose uses it). */
  let abortInFlight: ((cause: unknown) => void) | null = null;

  /** Kill the live port (the next run respawns one). */
  const kill = (): void => {
    const dead = port;
    port = null;
    if (dead === null) return;
    dead.onmessage = null;
    dead.onerror = null;
    dead.terminate();
  };

  /** Run one request on the live port (spawned on demand). */
  const runOne = (request: DocumentTransformRequest): Promise<DocumentTransformResult> =>
    new Promise((resolve) => {
      let live: TransformWorkerPort;
      try {
        live = port ?? options.spawn();
      } catch (cause) {
        resolve(failed(cause));
        return;
      }
      port = live;
      const id = nextId++;
      let lastFeature: ExclusionFeatureId | null = null;
      let settled = false;
      let cancelTimer: () => void = () => undefined;
      const settle = (result: DocumentTransformResult): void => {
        if (settled) return;
        settled = true;
        cancelTimer();
        abortInFlight = null;
        resolve(result);
      };
      cancelTimer = schedule(() => {
        kill();
        const feature = lastFeature ?? firstPipelineFeature();
        settle({ ok: false, outcome: overBudgetOutcome(request.set, feature, request.budgetMs) });
      }, request.budgetMs + graceMs);
      abortInFlight = (cause) => {
        settle(failed(cause));
      };
      live.onmessage = (event) => {
        const data: unknown = event.data;
        if (!isRecord(data) || data['id'] !== id) return; // a stale run's late message
        if (data['type'] === 'step' && isPipelineFeature(data['feature'])) {
          lastFeature = data['feature'];
        } else if (data['type'] === 'result') {
          const result = parseResult(data['result']);
          settle(result ?? failed(new Error('Transform worker sent a malformed result')));
        }
      };
      live.onerror = (event) => {
        kill();
        settle(failed(event));
      };
      try {
        live.postMessage({ type: 'transform', id, request });
      } catch (cause) {
        kill();
        settle(failed(cause));
      }
    });

  return {
    run: (request) => {
      const run = tail.then(() => runOne(request));
      tail = run.catch(() => undefined);
      return run;
    },
    dispose: () => {
      kill();
      abortInFlight?.(new Error('Transform worker disposed'));
    }
  };
}
