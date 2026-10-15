/**
 * The worker client: one request at a time, the per-block budget (timeout →
 * terminate → plain, lazy respawn), aborts (queued and in flight), stale-id
 * drops, worker failures, and platforms without workers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HighlightRequest } from './code-block-worker-protocol';
import {
  HIGHLIGHT_TIMEOUT_MS,
  HighlightUnavailableError,
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

  /** Answer the last request with HTML. */
  answer(html: string, id = this.sent.at(-1)?.id ?? -1): void {
    this.onmessage?.({ data: { id, html } });
  }
}

/** A client over spawned fakes. */
function setup(timeoutMs?: number): {
  client: ReturnType<typeof createWorkerHighlighter>;
  workers: FakeWorker[];
} {
  const workers: FakeWorker[] = [];
  const client = createWorkerHighlighter({
    timeoutMs,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });
  return { client, workers };
}

/** The failure reason a rejected request carries. */
async function reasonOf(pending: Promise<string>): Promise<string> {
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

describe('createWorkerHighlighter', () => {
  it('spawns the worker lazily and resolves with its HTML', async () => {
    const { client, workers } = setup();
    expect(workers).toHaveLength(0);
    const pending = client.highlight('a', { lang: 'javascript' });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.sent).toEqual([{ id: 1, code: 'a', lang: 'javascript' }]);
    workers[0]?.answer('<pre>a</pre>');
    await expect(pending).resolves.toBe('<pre>a</pre>');
  });

  it('sends one request at a time, in order, on one worker', async () => {
    const { client, workers } = setup();
    const first = client.highlight('a', { lang: 'javascript' });
    const second = client.highlight('b', { lang: 'json' });
    const worker = workers[0] as FakeWorker;
    expect(worker.sent.map((request) => request.code)).toEqual(['a']);
    worker.answer('A');
    await expect(first).resolves.toBe('A');
    expect(worker.sent.map((request) => request.code)).toEqual(['a', 'b']);
    worker.answer('B');
    await expect(second).resolves.toBe('B');
    expect(workers).toHaveLength(1);
  });

  it('times a runaway block out: terminates the worker, rejects, respawns for the next', async () => {
    const { client, workers } = setup();
    const slow = client.highlight('slow', { lang: 'javascript' });
    const next = client.highlight('next', { lang: 'javascript' });
    vi.advanceTimersByTime(HIGHLIGHT_TIMEOUT_MS);
    expect(await reasonOf(slow)).toBe('timeout');
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.sent.map((request) => request.code)).toEqual(['next']);
    workers[1]?.answer('N');
    await expect(next).resolves.toBe('N');
  });

  it('honours a custom budget', async () => {
    const { client } = setup(10);
    const pending = client.highlight('a', { lang: 'javascript' });
    vi.advanceTimersByTime(9);
    vi.advanceTimersByTime(1);
    expect(await reasonOf(pending)).toBe('timeout');
  });

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
  });

  it('answers an in-flight abort at once and drops its late result by id', async () => {
    const { client, workers } = setup();
    const controller = new AbortController();
    const inFlight = client.highlight('a', { lang: 'javascript', signal: controller.signal });
    const next = client.highlight('b', { lang: 'javascript' });
    controller.abort();
    expect(await reasonOf(inFlight)).toBe('aborted');
    const worker = workers[0] as FakeWorker;
    worker.answer('late A', 1);
    expect(worker.sent.map((request) => request.code)).toEqual(['a', 'b']);
    worker.answer('B', 2);
    await expect(next).resolves.toBe('B');
  });

  it('rejects an already-aborted request without sending it', async () => {
    const { client, workers } = setup();
    expect(
      await reasonOf(client.highlight('a', { lang: 'javascript', signal: AbortSignal.abort() }))
    ).toBe('aborted');
    expect(workers).toHaveLength(0);
  });

  it('ignores stale and malformed messages', async () => {
    const { client, workers } = setup();
    const pending = client.highlight('a', { lang: 'javascript' });
    const worker = workers[0] as FakeWorker;
    worker.answer('stale', 99);
    worker.onmessage?.({ data: 'garbage' });
    worker.onmessage?.({ data: { id: 1 } });
    worker.answer('A', 1);
    await expect(pending).resolves.toBe('A');
  });

  it('reports a worker-side failure as "failed"', async () => {
    const { client, workers } = setup();
    const pending = client.highlight('a', { lang: 'javascript' });
    workers[0]?.onmessage?.({ data: { id: 1, error: 'boom' } });
    expect(await reasonOf(pending)).toBe('failed');
  });

  it('turns a worker that cannot run (load or CSP error) into "unavailable" for good', async () => {
    const { client, workers } = setup();
    const first = client.highlight('a', { lang: 'javascript' });
    const queued = client.highlight('b', { lang: 'javascript' });
    workers[0]?.onerror?.(new Event('error'));
    expect(await reasonOf(first)).toBe('unavailable');
    expect(await reasonOf(queued)).toBe('unavailable');
    expect(await reasonOf(client.highlight('c', { lang: 'javascript' }))).toBe('unavailable');
    expect(workers).toHaveLength(1);
  });

  it('falls back to "unavailable" (plain text) when the platform has no workers', async () => {
    const client = createWorkerHighlighter({
      createWorker: () => {
        throw new Error('Worker is not available here.');
      }
    });
    expect(await reasonOf(client.highlight('a', { lang: 'javascript' }))).toBe('unavailable');
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
  });
});
