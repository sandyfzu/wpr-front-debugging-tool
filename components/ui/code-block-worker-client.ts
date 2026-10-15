/**
 * The main-thread side of code highlighting: a shiki-free client that sends
 * one block at a time to the highlight worker and enforces a hard per-block
 * time budget. A block that overruns gets its worker terminated (the next
 * request respawns one lazily) and renders as plain text, so no code shape —
 * however pathological for the grammar — can freeze the panel. Requests
 * queue in order; an aborted request leaves the queue at once, and an
 * in-flight one is answered "aborted" immediately, its late result dropped
 * by id. Without worker support the client answers "unavailable" (plain
 * text), never falling back to main-thread tokenizing.
 */
import type { CodeLanguage } from './code-block-langs';
import { isHighlightResponse, type HighlightRequest } from './code-block-worker-protocol';

/** Per-block time budget (ms) — generous for real code, fatal for runaways. */
export const HIGHLIGHT_TIMEOUT_MS = 1_500;

/** Why a block got no highlighting (the caller renders plain text). */
export type HighlightFailure = 'timeout' | 'unavailable' | 'failed' | 'aborted';

/** The rejection the client's promises carry. */
export class HighlightUnavailableError extends Error {
  /**
   * @param reason Why no highlighting arrived.
   */
  constructor(readonly reason: HighlightFailure) {
    super(`Code highlighting ${reason}.`);
    this.name = 'HighlightUnavailableError';
  }
}

/** The worker surface the client uses (a real `Worker`, or a test double). */
export interface WorkerLike {
  postMessage: (message: HighlightRequest) => void;
  terminate: () => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Client seams (all optional in production). */
export interface WorkerHighlighterOptions {
  /** Spawn a worker; throws when the platform has none. */
  createWorker?: () => WorkerLike;
  /** The per-block budget (default {@link HIGHLIGHT_TIMEOUT_MS}). */
  timeoutMs?: number;
}

/** The client: what `CodeBlock` calls. */
export interface WorkerHighlighter {
  /**
   * Highlight one block in the worker.
   *
   * @returns The `<pre>` HTML (escaped by shiki — safe for `innerHTML`).
   * @throws {@link HighlightUnavailableError} (rejection) on timeout, abort,
   *   worker failure or a platform without workers.
   */
  highlight: (
    code: string,
    options: { lang: CodeLanguage; signal?: AbortSignal }
  ) => Promise<string>;
  /** Terminate the worker and fail every pending request (tests, teardown). */
  dispose: () => void;
}

/** How one request ended. */
type Outcome = { readonly html: string } | { readonly failure: HighlightFailure };

/** One queued request. */
interface Job {
  readonly request: HighlightRequest;
  readonly resolve: (html: string) => void;
  readonly reject: (error: HighlightUnavailableError) => void;
  settled: boolean;
}

/**
 * The real worker: Vite bundles the entry (shiki included) as its own chunk
 * from this exact `new Worker(new URL(…, import.meta.url))` form.
 *
 * @throws {@link Error} when the platform has no `Worker`.
 */
function spawnHighlightWorker(): WorkerLike {
  if (typeof Worker !== 'function') throw new Error('Worker is not available here.');
  return new Worker(new URL('./code-block-highlight.worker.ts', import.meta.url), {
    type: 'module'
  }) as unknown as WorkerLike;
}

/**
 * Create a client.
 *
 * @param options The seams (default: the real worker and budget).
 */
export function createWorkerHighlighter(options: WorkerHighlighterOptions = {}): WorkerHighlighter {
  const createWorker = options.createWorker ?? spawnHighlightWorker;
  const timeoutMs = options.timeoutMs ?? HIGHLIGHT_TIMEOUT_MS;
  const queue: Job[] = [];
  let worker: WorkerLike | undefined;
  let unavailable = false;
  let current: Job | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextId = 1;

  /** Settle a job once (late or duplicate outcomes are ignored). */
  const settle = (job: Job, outcome: Outcome): void => {
    if (job.settled) return;
    job.settled = true;
    if ('html' in outcome) job.resolve(outcome.html);
    else job.reject(new HighlightUnavailableError(outcome.failure));
  };

  /** Drop the worker (it is respawned lazily for the next request). */
  const killWorker = (): void => {
    worker?.terminate();
    worker = undefined;
  };

  /** Finish the in-flight request and move on. */
  const finishCurrent = (outcome: Outcome): void => {
    clearTimeout(timer);
    timer = undefined;
    const job = current;
    current = undefined;
    if (job !== undefined) settle(job, outcome);
    pump();
  };

  /** The worker, spawned on demand; `undefined` when the platform has none. */
  const ensureWorker = (): WorkerLike | undefined => {
    if (worker !== undefined || unavailable) return worker;
    try {
      const spawned = createWorker();
      spawned.onmessage = (event) => {
        const data = event.data;
        // Stale (an aborted or timed-out request's late answer) or malformed: drop.
        if (!isHighlightResponse(data) || current?.request.id !== data.id) return;
        finishCurrent('html' in data ? { html: data.html } : { failure: 'failed' });
      };
      spawned.onerror = () => {
        // The worker script itself failed (load, CSP): it will not recover.
        unavailable = true;
        killWorker();
        finishCurrent({ failure: 'unavailable' });
      };
      worker = spawned;
    } catch {
      unavailable = true;
    }
    return worker;
  };

  /** Send the next queued request when the worker is idle. */
  function pump(): void {
    if (current !== undefined) return;
    const job = queue.shift();
    if (job === undefined) return;
    if (job.settled) {
      pump();
      return;
    }
    const target = ensureWorker();
    if (target === undefined) {
      settle(job, { failure: 'unavailable' });
      for (const waiting of queue.splice(0)) settle(waiting, { failure: 'unavailable' });
      return;
    }
    current = job;
    target.postMessage(job.request);
    timer = setTimeout(() => {
      // A runaway block: kill the worker so it stops burning CPU.
      killWorker();
      finishCurrent({ failure: 'timeout' });
    }, timeoutMs);
  }

  return {
    highlight(code, { lang, signal }) {
      return new Promise<string>((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new HighlightUnavailableError('aborted'));
          return;
        }
        const job: Job = { request: { id: nextId++, code, lang }, resolve, reject, settled: false };
        signal?.addEventListener(
          'abort',
          () => {
            // Queued: it simply never runs. In flight: the caller is answered
            // now; the worker's late answer is dropped by id.
            settle(job, { failure: 'aborted' });
          },
          { once: true }
        );
        queue.push(job);
        pump();
      });
    },
    dispose() {
      clearTimeout(timer);
      killWorker();
      const pending = [current, ...queue.splice(0)];
      current = undefined;
      for (const job of pending) if (job !== undefined) settle(job, { failure: 'aborted' });
    }
  };
}

/** The panel's one client (one worker per document). */
let shared: WorkerHighlighter | undefined;

/** The shared client, created on first use (the worker spawns on first highlight). */
export function sharedWorkerHighlighter(): WorkerHighlighter {
  shared ??= createWorkerHighlighter();
  return shared;
}
