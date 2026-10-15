/**
 * The main-thread side of code highlighting: a shiki-free client that sends
 * one block at a time to the highlight worker and enforces a hard per-block
 * time budget. A block that overruns gets its worker terminated (the next
 * request respawns one lazily) and renders as plain text, so no code shape —
 * however pathological for the grammar — can freeze the panel.
 *
 * Requests queue in order. An aborted request leaves the queue at once; an
 * in-flight one is answered "aborted" immediately and its worker is cut short
 * after a short grace (a near-done block may still finish; a long one must
 * not hold up the blocks queued behind it), its late result dropped by id.
 * Results are cached (bounded LRU), so a remounted row does not re-highlight.
 * Without worker support the client answers "unavailable" (plain text),
 * never falling back to main-thread tokenizing.
 */
import type { CodeLanguage } from './code-block-langs';
import {
  isHighlightResponse,
  type HighlightedBlock,
  type HighlightRequest
} from './code-block-worker-protocol';

/**
 * Per-block time budget (ms). Measured in the worker (2026-10-14, with the
 * 1,500-char line cap): blocks under the render cap highlight in
 * ≤ ≈ 0.8 s (sixty quoted 480-char lines, the slowest shape seen; dense
 * ordinary code ≈ 0.1 s); a runaway is cut here and renders plain.
 */
export const HIGHLIGHT_TIMEOUT_MS = 1_000;

/**
 * Grace (ms) an aborted in-flight block keeps running before its worker is
 * terminated: short blocks finish inside it (no respawn), long ones stop
 * blocking the queue almost at once (a respawn costs ≈ 80 ms).
 */
export const ABORT_GRACE_MS = 50;

/** Cached results kept at most (entries). */
export const CACHE_MAX_ENTRIES = 64;

/** Cached code kept at most (characters, summed over entries). */
export const CACHE_MAX_CHARS = 1_000_000;

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
  /** The monotonic clock (default `performance.now`). */
  now?: () => number;
}

/** The client: what `CodeBlock` calls. */
export interface WorkerHighlighter {
  /**
   * Highlight one block in the worker (or answer from the cache).
   *
   * @returns The class-tagged `<pre>` HTML (escaped by shiki — safe for
   *   `innerHTML`) and its token classes.
   * @throws {@link HighlightUnavailableError} (rejection) on timeout, abort,
   *   worker failure or a platform without workers.
   */
  highlight: (
    code: string,
    options: { lang: CodeLanguage; signal?: AbortSignal }
  ) => Promise<HighlightedBlock>;
  /** Terminate the worker and fail every pending request (tests, teardown). */
  dispose: () => void;
}

/** How one request ended. */
type Outcome = { readonly block: HighlightedBlock } | { readonly failure: HighlightFailure };

/** One queued request. */
interface Job {
  readonly request: HighlightRequest;
  readonly resolve: (block: HighlightedBlock) => void;
  readonly reject: (error: HighlightUnavailableError) => void;
  settled: boolean;
}

/**
 * The real worker: Vite bundles the entry (shiki included) as its own file
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
 * The cache key: language and the exact text (the markup is theme-agnostic —
 * its colors resolve through `light-dark()` rules).
 *
 * @param request The request's text and language.
 */
function cacheKey(request: Pick<HighlightRequest, 'code' | 'lang'>): string {
  return `${request.lang}\u0000${request.code}`;
}

/** A bounded LRU of results, by entries and by cached characters. */
export class ResultCache {
  private readonly entries = new Map<string, HighlightedBlock>();
  private chars = 0;

  /**
   * The cached block, refreshed as the most recent.
   *
   * @param key The cache key.
   */
  get(key: string): HighlightedBlock | undefined {
    const block = this.entries.get(key);
    if (block === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, block);
    return block;
  }

  /**
   * Cache a block, evicting the least recent beyond either bound (a key
   * larger than the whole budget is not cached).
   *
   * @param key The cache key.
   * @param block The result.
   */
  set(key: string, block: HighlightedBlock): void {
    if (key.length > CACHE_MAX_CHARS) return;
    if (this.entries.delete(key)) this.chars -= key.length;
    this.entries.set(key, block);
    this.chars += key.length;
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= CACHE_MAX_ENTRIES && this.chars <= CACHE_MAX_CHARS) break;
      this.entries.delete(oldest);
      this.chars -= oldest.length;
    }
  }

  /** Entries held (tests). */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * Create a client.
 *
 * @param options The seams (default: the real worker, budget and clock).
 */
export function createWorkerHighlighter(options: WorkerHighlighterOptions = {}): WorkerHighlighter {
  const createWorker = options.createWorker ?? spawnHighlightWorker;
  const timeoutMs = options.timeoutMs ?? HIGHLIGHT_TIMEOUT_MS;
  const now = options.now ?? (() => performance.now());
  const cache = new ResultCache();
  const queue: Job[] = [];
  let worker: WorkerLike | undefined;
  let unavailable = false;
  let current: Job | undefined;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextId = 1;

  /** Settle a job once (late or duplicate outcomes are ignored). */
  const settle = (job: Job, outcome: Outcome): void => {
    if (job.settled) return;
    job.settled = true;
    if ('block' in outcome) job.resolve(outcome.block);
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

  /**
   * Arm the in-flight request's deadline `delay` ms from now: at expiry the
   * worker is killed and the request ends with `failure`.
   */
  const armDeadline = (delay: number, failure: HighlightFailure): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      killWorker();
      finishCurrent({ failure });
    }, delay);
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
        if ('error' in data) {
          finishCurrent({ failure: 'failed' });
          return;
        }
        const block: HighlightedBlock = { html: data.html, styles: data.styles };
        cache.set(cacheKey(current.request), block);
        finishCurrent({ block });
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
    startedAt = now();
    target.postMessage(job.request);
    armDeadline(timeoutMs, 'timeout');
  }

  /** Abort one job: queued, it never runs; in flight, it is cut short after the grace. */
  const abort = (job: Job): void => {
    settle(job, { failure: 'aborted' });
    if (current === job) armDeadline(Math.max(0, startedAt + ABORT_GRACE_MS - now()), 'aborted');
  };

  return {
    highlight(code, { lang, signal }) {
      return new Promise<HighlightedBlock>((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new HighlightUnavailableError('aborted'));
          return;
        }
        const cached = cache.get(cacheKey({ code, lang }));
        if (cached !== undefined) {
          resolve(cached);
          return;
        }
        const job: Job = { request: { id: nextId++, code, lang }, resolve, reject, settled: false };
        signal?.addEventListener(
          'abort',
          () => {
            abort(job);
          },
          { once: true }
        );
        queue.push(job);
        pump();
      });
    },
    dispose() {
      clearTimeout(timer);
      timer = undefined;
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
