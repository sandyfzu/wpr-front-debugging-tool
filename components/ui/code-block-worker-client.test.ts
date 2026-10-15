/**
 * The worker client's state machine: one request at a time, the per-block
 * budget (timeout → terminate → plain, lazy respawn), aborts (queued; in
 * flight with the grace, racing an answer), stale-id drops, worker failures,
 * platforms without workers, and the result cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HighlightedBlock, HighlightRequest } from './code-block-worker-protocol';
import {
  ABORT_GRACE_MS,
  CACHE_MAX_CHARS,
  CACHE_MAX_ENTRIES,
  HIGHLIGHT_TIMEOUT_MS,
  HighlightUnavailableError,
  ResultCache,
  createWorkerHighlighter,
  type WorkerLike
} from './code-block-worker-client';

/** A fake worker recording what it was sent; tests answer by hand. */
class FakeWorker implements WorkerLike {
  readonly sent: HighlightRequest[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  postMessage(message: HighlightRequest): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answer a request (default: the last one) with HTML and one token class. */
  answer(html: string, id = this.sent.at(-1)?.id ?? -1): void {
    this.onmessage?.({ data: { id, html, styles: [['fdt-tk-a', 'color:red']] } });
  }
}

/** The block a fake answer resolves to. */
function block(html: string): HighlightedBlock {
  return { html, styles: [['fdt-tk-a', 'color:red']] };
}

/** A client over spawned fakes, on the fake clock. */
function setup(timeoutMs?: number): {
  client: ReturnType<typeof createWorkerHighlighter>;
  workers: FakeWorker[];
} {
  const workers: FakeWorker[] = [];
  const client = createWorkerHighlighter({
    timeoutMs,
    now: () => Date.now(),
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });
  return { client, workers };
}

/** The failure reason a rejected request carries. */
async function reasonOf(pending: Promise<HighlightedBlock>): Promise<string> {
  try {
    await pending;
  } catch (error: unknown) {
    if (error instanceof HighlightUnavailableError) return error.reason;
    throw error;
  }
  throw new Error('request resolved');
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createWorkerHighlighter — the request flow', () => {
  it('spawns the worker lazily and resolves with its block', async () => {
    const { client, workers } = setup();
    expect(workers).toHaveLength(0);
    const pending = client.highlight('a', { lang: 'javascript' });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.sent).toEqual([{ id: 1, code: 'a', lang: 'javascript' }]);
    workers[0]?.answer('<pre>a</pre>');
    await expect(pending).resolves.toEqual(block('<pre>a</pre>'));
  });

  it('sends one request at a time, in order, on one worker', async () => {
    const { client, workers } = setup();
    const first = client.highlight('a', { lang: 'javascript' });
    const second = client.highlight('b', { lang: 'json' });
    const worker = workers[0] as FakeWorker;
    expect(worker.sent.map((request) => request.code)).toEqual(['a']);
    worker.answer('A');
    await expect(first).resolves.toEqual(block('A'));
    expect(worker.sent.map((request) => request.code)).toEqual(['a', 'b']);
    worker.answer('B');
    await expect(second).resolves.toEqual(block('B'));
    expect(workers).toHaveLength(1);
  });

  it('disarms a finished request’s deadline (the idle worker is never killed)', async () => {
    const { client, workers } = setup();
    const first = client.highlight('a', { lang: 'javascript' });
    workers[0]?.answer('A');
    await first;
    vi.advanceTimersByTime(HIGHLIGHT_TIMEOUT_MS * 2);
    expect(workers[0]?.terminated).toBe(false);
    const second = client.highlight('b', { lang: 'javascript' });
    expect(workers).toHaveLength(1);
    workers[0]?.answer('B');
    await expect(second).resolves.toEqual(block('B'));
  });
});

describe('createWorkerHighlighter — the budget', () => {
  it('times a runaway block out: terminates the worker, rejects, respawns for the next', async () => {
    const { client, workers } = setup();
    const slow = client.highlight('slow', { lang: 'javascript' });
    const next = client.highlight('next', { lang: 'javascript' });
    vi.advanceTimersByTime(HIGHLIGHT_TIMEOUT_MS - 1);
    expect(workers[0]?.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(await reasonOf(slow)).toBe('timeout');
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.sent.map((request) => request.code)).toEqual(['next']);
    workers[1]?.answer('N');
    await expect(next).resolves.toEqual(block('N'));
  });

  it('honours a custom budget', async () => {
    const { client } = setup(10);
    const pending = client.highlight('a', { lang: 'javascript' });
    vi.advanceTimersByTime(10);
    expect(await reasonOf(pending)).toBe('timeout');
  });
});

describe('createWorkerHighlighter — aborts', () => {
  it('drops a queued request on abort, never sending it', async () => {
    const { client, workers } = setup();
    const first = client.highlight('a', { lang: 'javascript' });
    const controller = new AbortController();
    const queued = client.highlight('b', { lang: 'javascript', signal: controller.signal });
    controller.abort();
    expect(await reasonOf(queued)).toBe('aborted');
    workers[0]?.answer('A');
    await first;
    expect(workers[0]?.sent.map((request) => request.code)).toEqual(['a']);
    expect(workers[0]?.terminated).toBe(false);
  });

  it('answers an in-flight abort at once and cuts the worker short after the grace', async () => {
    const { client, workers } = setup();
    const controller = new AbortController();
    const inFlight = client.highlight('a', { lang: 'javascript', signal: controller.signal });
    const next = client.highlight('b', { lang: 'javascript' });
    controller.abort();
    expect(await reasonOf(inFlight)).toBe('aborted');
    vi.advanceTimersByTime(ABORT_GRACE_MS - 1);
    expect(workers[0]?.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(workers[0]?.terminated).toBe(true);
    // The queue moves on at once, on a fresh worker.
    expect(workers[1]?.sent.map((request) => request.code)).toEqual(['b']);
    workers[1]?.answer('B');
    await expect(next).resolves.toEqual(block('B'));
  });

  it('counts the grace from the request’s start: a long-running block stops at once', async () => {
    const { client, workers } = setup();
    const controller = new AbortController();
    const inFlight = client.highlight('a', { lang: 'javascript', signal: controller.signal });
    vi.advanceTimersByTime(ABORT_GRACE_MS * 4);
    controller.abort();
    expect(await reasonOf(inFlight)).toBe('aborted');
    vi.advanceTimersByTime(0);
    expect(workers[0]?.terminated).toBe(true);
  });

  it('aborting a queued job leaves the running one alone', async () => {
    const { client, workers } = setup();
    const running = client.highlight('a', { lang: 'javascript' });
    const controller = new AbortController();
    const queued = client.highlight('b', { lang: 'javascript', signal: controller.signal });
    controller.abort();
    expect(await reasonOf(queued)).toBe('aborted');
    vi.advanceTimersByTime(ABORT_GRACE_MS * 4);
    expect(workers[0]?.terminated).toBe(false);
    workers[0]?.answer('A', 1);
    await expect(running).resolves.toEqual(block('A'));
  });

  it('lets an aborted block that answers within the grace finish (no respawn; result cached)', async () => {
    const { client, workers } = setup();
    const controller = new AbortController();
    const inFlight = client.highlight('a', { lang: 'javascript', signal: controller.signal });
    controller.abort();
    workers[0]?.answer('A');
    // The abort stands for its caller …
    expect(await reasonOf(inFlight)).toBe('aborted');
    vi.advanceTimersByTime(ABORT_GRACE_MS * 2);
    expect(workers[0]?.terminated).toBe(false);
    // … and the answer it raced serves the next identical request from cache.
    await expect(client.highlight('a', { lang: 'javascript' })).resolves.toEqual(block('A'));
    expect(workers[0]?.sent).toHaveLength(1);
  });

  it('rejects an already-aborted request without sending it', async () => {
    const { client, workers } = setup();
    expect(
      await reasonOf(client.highlight('a', { lang: 'javascript', signal: AbortSignal.abort() }))
    ).toBe('aborted');
    expect(workers).toHaveLength(0);
  });
});

describe('createWorkerHighlighter — messages and failures', () => {
  it('ignores stale and malformed messages', async () => {
    const { client, workers } = setup();
    const pending = client.highlight('a', { lang: 'javascript' });
    const worker = workers[0] as FakeWorker;
    worker.answer('stale', 99);
    worker.onmessage?.({ data: 'garbage' });
    worker.onmessage?.({ data: { id: 1 } });
    worker.answer('A', 1);
    await expect(pending).resolves.toEqual(block('A'));
  });

  it('reports a worker-side failure as "failed" and keeps the worker', async () => {
    const { client, workers } = setup();
    const pending = client.highlight('a', { lang: 'javascript' });
    workers[0]?.onmessage?.({ data: { id: 1, error: 'boom' } });
    expect(await reasonOf(pending)).toBe('failed');
    expect(workers[0]?.terminated).toBe(false);
  });

  it('turns a worker that cannot run into "unavailable" for good, flushing the queue', async () => {
    const { client, workers } = setup();
    const pending = ['a', 'b', 'c'].map((code) => client.highlight(code, { lang: 'javascript' }));
    workers[0]?.onerror?.(new Event('error'));
    expect(await Promise.all(pending.map(reasonOf))).toEqual([
      'unavailable',
      'unavailable',
      'unavailable'
    ]);
    expect(workers[0]?.terminated).toBe(true);
    expect(await reasonOf(client.highlight('d', { lang: 'javascript' }))).toBe('unavailable');
    expect(workers).toHaveLength(1);
  });

  it('tries to spawn once on a platform without workers', async () => {
    const createWorker = vi.fn((): WorkerLike => {
      throw new Error('Worker is not available here.');
    });
    const client = createWorkerHighlighter({ createWorker });
    expect(await reasonOf(client.highlight('a', { lang: 'javascript' }))).toBe('unavailable');
    expect(await reasonOf(client.highlight('b', { lang: 'javascript' }))).toBe('unavailable');
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('uses the real Worker constructor by default and reports its absence', async () => {
    vi.stubGlobal('Worker', undefined);
    try {
      const client = createWorkerHighlighter();
      expect(await reasonOf(client.highlight('a', { lang: 'javascript' }))).toBe('unavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('disposes: terminates the worker and aborts everything pending', async () => {
    const { client, workers } = setup();
    const first = client.highlight('a', { lang: 'javascript' });
    const second = client.highlight('b', { lang: 'javascript' });
    client.dispose();
    expect(workers[0]?.terminated).toBe(true);
    expect(await reasonOf(first)).toBe('aborted');
    expect(await reasonOf(second)).toBe('aborted');
    vi.advanceTimersByTime(HIGHLIGHT_TIMEOUT_MS);
  });
});

describe('createWorkerHighlighter — the cache', () => {
  it('serves a repeated block from the cache, per language', async () => {
    const { client, workers } = setup();
    const first = client.highlight('a', { lang: 'javascript' });
    workers[0]?.answer('A');
    await first;
    await expect(client.highlight('a', { lang: 'javascript' })).resolves.toEqual(block('A'));
    expect(workers[0]?.sent).toHaveLength(1);
    void client.highlight('a', { lang: 'json' });
    expect(workers[0]?.sent).toHaveLength(2);
  });

  it('never caches a failure', async () => {
    const { client, workers } = setup();
    const first = client.highlight('a', { lang: 'javascript' });
    workers[0]?.onmessage?.({ data: { id: 1, error: 'boom' } });
    await reasonOf(first);
    void client.highlight('a', { lang: 'javascript' });
    expect(workers[0]?.sent).toHaveLength(2);
  });
});

describe('ResultCache', () => {
  it('weighs code, markup and class declarations against the memory bound', () => {
    const cache = new ResultCache();
    cache.set('ab', { html: '<pre>xyz</pre>', styles: [['fdt-tk-a', 'color:red']] });
    expect(cache.weight).toBe(2 + '<pre>xyz</pre>'.length + 'fdt-tk-a'.length + 'color:red'.length);
    // Small code with huge markup is evicted by the markup, not the code.
    const huge = { html: 'h'.repeat(CACHE_MAX_CHARS / 2), styles: [] };
    cache.set('x', huge);
    cache.set('y', huge);
    expect(cache.get('ab')).toBeUndefined();
    expect(cache.get('x')).toBeUndefined();
    expect(cache.get('y')).toEqual(huge);
    expect(cache.weight).toBeLessThanOrEqual(CACHE_MAX_CHARS);
    cache.set('z', { html: 'h'.repeat(CACHE_MAX_CHARS), styles: [] });
    expect(cache.get('z')).toBeUndefined();
  });

  it('evicts the least recently used beyond its entry bound', () => {
    const cache = new ResultCache();
    for (let i = 0; i < CACHE_MAX_ENTRIES; i += 1) cache.set(`k${String(i)}`, block(String(i)));
    expect(cache.get('k0')).toEqual(block('0'));
    cache.set('new', block('new'));
    expect(cache.size).toBe(CACHE_MAX_ENTRIES);
    expect(cache.get('k0')).toEqual(block('0'));
    expect(cache.get('k1')).toBeUndefined();
  });

  it('evicts beyond its character bound and refuses a single oversized key', () => {
    const cache = new ResultCache();
    const half = 'x'.repeat(CACHE_MAX_CHARS / 2);
    cache.set(`a${half}`, block('a'));
    cache.set(`b${half}`, block('b'));
    expect(cache.get(`a${half}`)).toBeUndefined();
    expect(cache.get(`b${half}`)).toEqual(block('b'));
    cache.set('y'.repeat(CACHE_MAX_CHARS + 1), block('big'));
    expect(cache.get('y'.repeat(CACHE_MAX_CHARS + 1))).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it('re-caching a key replaces it without double-counting', () => {
    const cache = new ResultCache();
    cache.set('k', block('first'));
    const once = cache.weight;
    cache.set('k', block('first'));
    expect(cache.weight).toBe(once);
    cache.set('k', block('much longer markup'));
    expect(cache.weight).toBe(once + 'much longer markup'.length - 'first'.length);
    expect(cache.size).toBe(1);
  });
});
