/**
 * The preempting engine runner: the pipeline runs off the background's
 * thread (a dedicated worker, or any port with the same shape — e.g. an
 * offscreen document hosting one) and a hard deadline kills a runaway run,
 * so no row can stall a navigation past its budget. The worker announces
 * each step as it starts, so the overrun still names its feature.
 *
 * Both halves live here: {@link handleTransformWorkerMessage} is the
 * worker's whole message handler; {@link createWorkerTransformRunner} the
 * host. Runs are serialized on one live port (FIFO); each run's deadline
 * starts when it is handed over, so a document queued behind others is
 * still answered within its own budget + grace from arrival. A killed port
 * is replaced lazily on the next run.
 */
import type { ExclusionFeatureId } from '../exclusion-builder/set';
import { EXCLUSION_PIPELINE_STEP_IDS } from '../exclusion-builder/pipeline';
import { scheduleWithTimeout, type ScheduleTimer } from '../messaging/bounded-ask';
import { isFeatureId, parseExclusionSet } from '../messaging/exclusion-session';
import { parseDocumentSimulationInput } from '../messaging/exclusion-simulation';
import { isCount } from '../messaging/guard-policy';
import type { SimulationStage } from '../wp-rocket-simulation/spec';
import { isRecord } from '../../utils/is-record';
import type { DocumentBytes } from '../exclusion-builder/libxml/charset';
import {
  engineFailed,
  overBudgetOutcome,
  runDocumentPipeline,
  type DocumentTransformRequest,
  type DocumentTransformResult,
  type DocumentTransformRunner,
  type UnmodifiedDocumentOutcome
} from './document-transform';

/** Extra time (ms) past the budget before a silent worker is killed (messaging latency). */
export const WORKER_GRACE_MS = 250;

/** Host → worker: run one request. */
export interface TransformWorkerRequest {
  readonly type: 'transform';
  readonly id: number;
  readonly request: DocumentTransformRequest;
}

/**
 * Worker → host: a step started (`stage: 'simulate'` for a feature's
 * simulation step, absent for its exclusion step), or the run's result.
 */
export type TransformWorkerMessage =
  | {
      readonly type: 'step';
      readonly id: number;
      readonly feature: ExclusionFeatureId;
      readonly stage?: SimulationStage;
    }
  | { readonly type: 'result'; readonly id: number; readonly result: DocumentTransformResult };

/** The port the host drives: a `Worker`, or anything with its shape. */
export interface TransformWorkerPort {
  postMessage(message: TransformWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/**
 * Parse a host request (structured-cloned into the worker).
 *
 * @returns The request, or null when malformed.
 */
export function parseTransformWorkerRequest(data: unknown): TransformWorkerRequest | null {
  if (!isRecord(data) || data['type'] !== 'transform' || !isCount(data['id'])) return null;
  const raw = data['request'];
  if (!isRecord(raw) || typeof raw['html'] !== 'string') return null;
  const budgetMs = raw['budgetMs'];
  if (typeof budgetMs !== 'number' || !Number.isFinite(budgetMs) || budgetMs <= 0) return null;
  const set = parseExclusionSet(raw['set'], 'reject');
  if (set === null) return null;
  const bytes = parseDocumentBytes(raw['bytes']);
  if (bytes === null) return null;
  const rawSimulate = raw['simulate'];
  const simulate =
    rawSimulate === undefined
      ? undefined
      : parseDocumentSimulationInput(rawSimulate, raw['html'].length);
  if (simulate === null) return null;
  return {
    type: 'transform',
    id: data['id'],
    request: {
      html: raw['html'],
      set,
      budgetMs,
      ...(bytes === undefined ? {} : { bytes }),
      ...(simulate === undefined ? {} : { simulate })
    }
  };
}

/** The longest encoding name a request may carry (WHATWG names are far shorter). */
const ENCODING_NAME_LIMIT = 64;

/**
 * Parse a request's optional decoding facts.
 *
 * @returns The facts, `undefined` when absent, or `null` when malformed.
 */
function parseDocumentBytes(raw: unknown): DocumentBytes | undefined | null {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) return null;
  const encoding = raw['encoding'];
  const bom = raw['bom'];
  if (typeof encoding !== 'string' || encoding.length > ENCODING_NAME_LIMIT) return null;
  return typeof bom === 'boolean' ? { encoding, bom } : null;
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

/** The outcome kinds an unmodified result may carry. */
const UNMODIFIED_OUTCOMES: readonly UnmodifiedDocumentOutcome['outcome'][] = [
  'over-budget',
  'failed',
  'runtime-unavailable'
];

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
  return UNMODIFIED_OUTCOMES.includes(outcome['outcome'] as UnmodifiedDocumentOutcome['outcome'])
    ? (value as DocumentTransformResult)
    : null;
}

/**
 * Whether a request simulates a feature — a step announced as its
 * simulation is honoured only then (any other `stage` claim is ignored).
 */
function simulatesFeature(request: DocumentTransformRequest, feature: ExclusionFeatureId): boolean {
  return request.simulate?.features.some((id) => id === feature) ?? false;
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
  /**
   * Retire the runner for good: terminate the live port and answer the
   * in-flight and every queued run `engine-failed`; later runs answer
   * `engine-failed` at once (no port is ever spawned again). Idempotent.
   */
  dispose(): void;
}

/**
 * The over-budget outcome of a run killed before the worker announced any
 * step: it was still starting up or validating the set, so no row had run —
 * billed to the first step's feature (the in-process runner bills that
 * setup time to the first step too), naming no row.
 *
 * @param budgetMs The budget the run overran.
 * @throws {@link Error} when the pipeline declares no step (a broken build).
 */
function overBudgetBeforeAnyStep(budgetMs: number): UnmodifiedDocumentOutcome {
  const first = EXCLUSION_PIPELINE_STEP_IDS[0];
  if (first === undefined) throw new Error('The exclusion pipeline declares no step');
  return { outcome: 'over-budget', feature: first, row: null, budgetMs };
}

/** One handed-over run: its request, its answer, and where it stands. */
interface PendingRun {
  readonly request: DocumentTransformRequest;
  readonly id: number;
  /** Resolves the run's promise (first call wins). */
  readonly settle: (result: DocumentTransformResult) => void;
  /** Whether the run is on the port (else still queued). */
  running: boolean;
  /** The feature the worker last announced for this run. */
  lastFeature: ExclusionFeatureId | null;
  /** Whether that announcement was the feature's simulation step (one the request simulates). */
  lastStage: SimulationStage | undefined;
}

/**
 * Create the preempting host. Runs are serialized (FIFO) on one port; each
 * run's deadline — `budgetMs` + grace — starts at hand-over. At the
 * deadline a running run's port is terminated and the run answers
 * `over-budget` for the feature the worker last announced (the first
 * step's feature, naming no row, when none was); a run still queued then is dropped as
 * `engine-failed` (it never got to run). A port error or a spawn failure
 * answers `engine-failed`.
 *
 * @param options The spawn seam, timers and grace.
 */
export function createWorkerTransformRunner(
  options: WorkerTransformRunnerOptions
): WorkerTransformRunner {
  const schedule = options.schedule ?? scheduleWithTimeout;
  const graceMs = options.graceMs ?? WORKER_GRACE_MS;
  let port: TransformWorkerPort | null = null;
  let nextId = 0;
  const queue: PendingRun[] = [];
  let current: PendingRun | null = null;
  /** Set by `dispose`: nothing runs or spawns afterwards. */
  let disposed = false;

  /** Kill the live port (the next run respawns one). */
  const kill = (): void => {
    const dead = port;
    port = null;
    if (dead === null) return;
    dead.onmessage = null;
    dead.onerror = null;
    dead.terminate();
  };

  /** Route a port message to the running run (a stale run's late message is dropped). */
  const onPortMessage = (data: unknown): void => {
    const run = current;
    if (run === null || !isRecord(data) || data['id'] !== run.id) return;
    if (data['type'] === 'step' && isFeatureId(data['feature'])) {
      run.lastFeature = data['feature'];
      run.lastStage =
        data['stage'] === 'simulate' && simulatesFeature(run.request, data['feature'])
          ? 'simulate'
          : undefined;
    } else if (data['type'] === 'result') {
      const result = parseResult(data['result']);
      run.settle(result ?? engineFailed(new Error('Transform worker sent a malformed result')));
    }
  };

  /** Start the next queued run when the port is idle. */
  const pump = (): void => {
    if (disposed || current !== null) return;
    const run = queue.shift();
    if (run === undefined) return;
    current = run;
    run.running = true;
    let live: TransformWorkerPort;
    try {
      live = port ?? options.spawn();
    } catch (cause) {
      run.settle(engineFailed(cause));
      return;
    }
    port = live;
    live.onmessage = (event) => {
      onPortMessage(event.data);
    };
    live.onerror = (event) => {
      kill();
      current?.settle(engineFailed(event));
    };
    try {
      live.postMessage({ type: 'transform', id: run.id, request: run.request });
    } catch (cause) {
      kill();
      run.settle(engineFailed(cause));
    }
  };

  /**
   * Hand one request over: queue it, then arm its deadline from now (queued
   * first, so a timer seam firing synchronously finds it to drop), then pump.
   */
  const run: DocumentTransformRunner = (request) =>
    new Promise((resolve) => {
      if (disposed) {
        resolve(engineFailed(new Error('Transform worker disposed')));
        return;
      }
      let settled = false;
      let cancelDeadline: () => void = () => undefined;
      const pending: PendingRun = {
        request,
        id: nextId++,
        running: false,
        lastFeature: null,
        lastStage: undefined,
        settle: (result) => {
          if (settled) return;
          settled = true;
          cancelDeadline();
          const queued = queue.indexOf(pending);
          if (queued !== -1) queue.splice(queued, 1);
          if (current === pending) current = null;
          resolve(result);
          pump();
        }
      };
      queue.push(pending);
      cancelDeadline = schedule(() => {
        if (!pending.running) {
          pending.settle(engineFailed(new Error('Transform run queued past its deadline')));
          return;
        }
        kill();
        pending.settle({
          ok: false,
          outcome:
            pending.lastFeature === null
              ? overBudgetBeforeAnyStep(request.budgetMs)
              : overBudgetOutcome(
                  request.set,
                  pending.lastFeature,
                  request.budgetMs,
                  pending.lastStage
                )
        });
      }, request.budgetMs + graceMs);
      pump();
    });

  return {
    run,
    dispose: () => {
      disposed = true;
      kill();
      const cause = new Error('Transform worker disposed');
      for (const pending of [...(current === null ? [] : [current]), ...queue]) {
        pending.settle(engineFailed(cause));
      }
    }
  };
}
