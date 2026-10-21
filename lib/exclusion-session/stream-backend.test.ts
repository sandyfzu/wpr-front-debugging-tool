/**
 * The streaming backend over injected shims (filter, host, timers): the
 * synchronous armed-tab gate, arm/disarm/resume and generations, the full
 * rewrite path, every pass-through and failure arm, the release and facts
 * deadlines, redirects, and isolation of failing filter calls — each filter
 * ended at most once.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger';
import type { ScheduleTimer } from '../messaging/bounded-ask';
import type { InterceptedDocument, InterceptedResponseIdentity, InterceptionHost } from './backend';
import {
  createStreamInterceptionBackend,
  responseContentType,
  responseFacts,
  streamTimerMs,
  type ResponseStreamFilter,
  type StreamResponseDetails
} from './stream-backend';
import {
  INTERCEPTION_HOST_BOUNDS_MS,
  STREAM_FACTS_WAIT_MS,
  STREAM_HOLD_WORST_CASE_MS,
  STREAM_SETTLE_WAIT_MS
} from './timeouts';

const TAB = 4;
const RELEASE_MS = streamTimerMs('release');
const SETTLE_MS = STREAM_SETTLE_WAIT_MS;
const URL = 'https://site.test/page';
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A filter shim recording every call. */
class FakeFilter implements ResponseStreamFilter {
  onstart: ((event: unknown) => void) | null = null;
  ondata: ((event: { readonly data: ArrayBuffer }) => void) | null = null;
  onstop: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  error = '';
  readonly calls: string[] = [];
  readonly written: string[] = [];
  failWrite = false;
  failEnd = false;

  write(data: Uint8Array): void {
    if (this.failWrite) throw new Error('write refused');
    this.calls.push('write');
    this.written.push(new TextDecoder().decode(data));
  }
  close(): void {
    if (this.failEnd) throw new Error('close refused');
    this.calls.push('close');
  }
  disconnect(): void {
    if (this.failEnd) throw new Error('disconnect refused');
    this.calls.push('disconnect');
  }
  /** How many times the filter was ended. */
  get ends(): number {
    return this.calls.filter((call) => call === 'close' || call === 'disconnect').length;
  }
  start(): void {
    this.onstart?.({});
  }
  data(text: string): void {
    const bytes = new Uint8Array(enc(text).length);
    bytes.set(enc(text));
    this.ondata?.({ data: bytes.buffer });
  }
  stop(): void {
    this.onstop?.({});
  }
  fail(message: string): void {
    this.error = message;
    this.onerror?.({});
  }
}

/** A manual timer. */
function manualTimers(): {
  schedule: ScheduleTimer;
  fire: (ms?: number) => void;
  delays: number[];
  pending: () => number[];
} {
  const pending = new Map<() => void, number>();
  const delays: number[] = [];
  return {
    schedule: (run, ms) => {
      delays.push(ms);
      pending.set(run, ms);
      return () => pending.delete(run);
    },
    fire: (ms) => {
      for (const [run, delay] of [...pending]) {
        if (ms !== undefined && delay !== ms) continue;
        pending.delete(run);
        run();
      }
    },
    delays,
    pending: () => [...pending.values()]
  };
}

/** A silent recording logger. */
function quietLog(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const record = (message: string): void => {
    lines.push(message);
  };
  return { lines, debug: record, info: record, warn: record, error: record };
}

/** Let promise callbacks run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** A deferred value. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface Harness {
  backend: ReturnType<typeof createStreamInterceptionBackend>;
  filters: FakeFilter[];
  host: InterceptionHost & {
    rewrites: InterceptedDocument[];
    abandons: (() => boolean)[];
    gates: string[];
    unavailable: string[];
    unavailableIdentities: (InterceptedResponseIdentity | undefined)[];
  };
  timers: ReturnType<typeof manualTimers>;
  log: ReturnType<typeof quietLog>;
  /** The next host rewrite answer (default: resolved null). */
  answer: { next: Promise<Uint8Array | null> };
  gateAnswer: { next: Promise<boolean> };
}

function harness(options: { openFilter?: (id: string) => ResponseStreamFilter } = {}): Harness {
  const filters: FakeFilter[] = [];
  const answer = { next: Promise.resolve<Uint8Array | null>(null) };
  const gateAnswer = { next: Promise.resolve(true) };
  const rewrites: InterceptedDocument[] = [];
  const abandons: (() => boolean)[] = [];
  const gates: string[] = [];
  const unavailable: string[] = [];
  const unavailableIdentities: (InterceptedResponseIdentity | undefined)[] = [];
  const host = {
    rewrites,
    abandons,
    gates,
    unavailable,
    unavailableIdentities,
    shouldIntercept: (_tabId: number, url: string) => {
      gates.push(url);
      return gateAnswer.next;
    },
    rewriteDocument: (document: InterceptedDocument, abandoned?: () => boolean) => {
      rewrites.push(document);
      if (abandoned !== undefined) abandons.push(abandoned);
      return answer.next;
    },
    documentBodyUnavailable: (
      _tabId: number,
      url: string,
      identity?: InterceptedResponseIdentity
    ) => {
      unavailable.push(url);
      unavailableIdentities.push(identity);
      return Promise.resolve();
    },
    interceptionEnded: () => Promise.resolve()
  };
  const timers = manualTimers();
  const log = quietLog();
  const backend = createStreamInterceptionBackend({
    host,
    log,
    schedule: timers.schedule,
    now: () => STARTED_AT,
    openFilter:
      options.openFilter ??
      (() => {
        const filter = new FakeFilter();
        filters.push(filter);
        return filter;
      })
  });
  return { backend, filters, host, timers, log, answer, gateAnswer };
}

const HTML_HEADERS: StreamResponseDetails = {
  requestId: 'r1',
  tabId: TAB,
  statusCode: 200,
  method: 'GET',
  responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }]
};

/** End the body, then report the request completed on the network. */
function stopAndSettle(h: Harness, filter: FakeFilter | undefined, requestId = 'r1'): void {
  filter?.stop();
  h.backend.requestCompleted({ requestId, tabId: TAB });
}

/** Open an armed request r1 on TAB and return its filter. */
async function openArmed(h: Harness, requestId = 'r1'): Promise<FakeFilter> {
  await h.backend.arm(TAB, 1);
  h.backend.requestStarted({ requestId, tabId: TAB, url: URL });
  const filter = h.filters.at(-1);
  if (filter === undefined) throw new Error('no filter opened');
  return filter;
}

describe('stream backend — the armed-tab gate', () => {
  it('opens no filter for an unarmed tab', () => {
    const h = harness();
    h.backend.requestStarted({ requestId: 'r1', tabId: TAB, url: URL });
    expect(h.filters).toHaveLength(0);
  });

  it('opens a filter for an armed tab only, and none after disarm', async () => {
    const h = harness();
    await expect(h.backend.arm(TAB, 1)).resolves.toEqual({ armed: true });
    h.backend.requestStarted({ requestId: 'r1', tabId: TAB + 1, url: URL });
    expect(h.filters).toHaveLength(0);
    h.backend.requestStarted({ requestId: 'r2', tabId: TAB, url: URL });
    expect(h.filters).toHaveLength(1);
    await h.backend.disarm(TAB);
    h.backend.requestStarted({ requestId: 'r3', tabId: TAB, url: URL });
    expect(h.filters).toHaveLength(1);
  });

  it('resume confirms only a tab this background armed (a fresh one is stale)', async () => {
    const h = harness();
    await expect(h.backend.resume(TAB, 1)).resolves.toBe(false);
    await h.backend.arm(TAB, 1);
    await expect(h.backend.resume(TAB, 2)).resolves.toBe(true);
    await h.backend.disarm(TAB);
    await expect(h.backend.resume(TAB, 2)).resolves.toBe(false);
  });

  it('disarm of an unarmed tab is a no-op', async () => {
    const h = harness();
    await expect(h.backend.disarm(TAB)).resolves.toBeUndefined();
  });

  it('exposes the injected runner (absent → undefined)', () => {
    const runner = vi.fn();
    const withRunner = createStreamInterceptionBackend({
      host: harness().host,
      log: quietLog(),
      openFilter: () => new FakeFilter(),
      runner
    });
    expect(withRunner.runner).toBe(runner);
    expect(harness().backend.runner).toBeUndefined();
  });

  it('logs and opens nothing when the filter cannot be attached', async () => {
    const h = harness({
      openFilter: () => {
        throw new Error('no filter');
      }
    });
    await h.backend.arm(TAB, 1);
    h.backend.requestStarted({ requestId: 'r1', tabId: TAB, url: URL });
    h.backend.responseStarted(HTML_HEADERS);
    await settle();
    expect(h.log.lines).toContain('Stream filter unavailable — document served unmodified');
    expect(h.host.gates).toEqual([]);
  });
});

/** The request start the fake clock answers. */
const STARTED_AT = 1_800_000_000_000;

describe('stream backend — response identity', () => {
  const IDENTITY = {
    token: 'r1',
    receivedAt: STARTED_AT,
    speculationRulesHeader: false,
    servedAsCopy: false
  };

  it('hands the host the request id and start, never a copy nor a header to drop', async () => {
    const h = harness();
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('<p>x</p>');
    stopAndSettle(h, filter);
    await settle();
    expect(h.host.rewrites[0]?.identity).toEqual(IDENTITY);
  });

  it('reports an unreadable body with the same identity', async () => {
    const h = harness();
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('a');
    filter.fail('Channel redirected');
    stopAndSettle(h, filter);
    await settle();
    expect(h.host.unavailableIdentities).toEqual([IDENTITY]);
  });
});

describe('stream backend — the rewrite path', () => {
  it('buffers, hands the whole body with its facts to the host, writes the answer once and closes', async () => {
    const h = harness();
    h.answer.next = Promise.resolve(enc('REWRITTEN'));
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('<html>');
    filter.data('</html>');
    expect(filter.calls).toEqual([]);
    stopAndSettle(h, filter);
    await settle();
    expect(h.host.gates).toEqual([URL]);
    expect(h.host.rewrites).toHaveLength(1);
    const document = h.host.rewrites[0];
    expect(document).toMatchObject({
      tabId: TAB,
      documentUrl: URL,
      status: 200,
      method: 'GET',
      contentType: 'text/html; charset=utf-8'
    });
    expect(new TextDecoder().decode(document?.body)).toBe('<html></html>');
    expect(filter.written).toEqual(['REWRITTEN']);
    expect(filter.calls).toEqual(['write', 'close']);
    expect(h.timers.delays).toEqual([SETTLE_MS, RELEASE_MS]);
    // Answered: no timer is left behind.
    expect(h.timers.pending()).toEqual([]);
  });

  it('writes the original chunks through when the host answers null', async () => {
    const h = harness();
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('a');
    filter.data('b');
    stopAndSettle(h, filter);
    await settle();
    expect(filter.written).toEqual(['a', 'b']);
    expect(filter.calls.at(-1)).toBe('close');
    expect(filter.ends).toBe(1);
  });

  it('serves the original at its release deadline and ignores the late answer', async () => {
    const h = harness();
    const late = deferred<Uint8Array | null>();
    h.answer.next = late.promise;
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('orig');
    stopAndSettle(h, filter);
    h.timers.fire(RELEASE_MS);
    expect(filter.written).toEqual(['orig']);
    late.resolve(enc('late'));
    await settle();
    expect(filter.written).toEqual(['orig']);
    expect(filter.ends).toBe(1);
    expect(h.log.lines).toContain(
      'Stream rewrite missed its deadline — document served unmodified'
    );
  });

  it('keeps its release deadline above the host rewrite bound', () => {
    expect(RELEASE_MS).toBeGreaterThan(INTERCEPTION_HOST_BOUNDS_MS.rewriteDocument);
    expect(streamTimerMs('facts')).toBe(STREAM_FACTS_WAIT_MS);
    expect(streamTimerMs('settle')).toBe(STREAM_SETTLE_WAIT_MS);
  });

  it('waits up to 1 s for the completion signal (a cold or busy background delivers it late)', () => {
    // Observed: completion 238 ms after the body's end at a cold start; a
    // failure 60 ms after it under load — 1 s keeps both inside the wait.
    expect(STREAM_SETTLE_WAIT_MS).toBe(1_000);
  });

  it('declares the longest hold of a navigation: settle + late facts + release', () => {
    expect(STREAM_HOLD_WORST_CASE_MS).toBe(
      streamTimerMs('settle') + streamTimerMs('facts') + streamTimerMs('release')
    );
    // The release timer starts only once the body is settled: settling never
    // eats into the host's rewrite bound.
    expect(streamTimerMs('release')).toBeGreaterThan(INTERCEPTION_HOST_BOUNDS_MS.rewriteDocument);
  });

  it('serves the original when the host rejects (it never should)', async () => {
    const h = harness();
    h.answer.next = Promise.reject(new Error('boom'));
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('x');
    stopAndSettle(h, filter);
    await settle();
    expect(filter.written).toEqual(['x']);
    expect(filter.ends).toBe(1);
    expect(h.log.lines).toContain('Stream rewrite failed — document served unmodified');
  });

  it('waits a bounded time for late facts, then rewrites them', async () => {
    const h = harness();
    const filter = await openArmed(h);
    filter.start();
    filter.data('x');
    stopAndSettle(h, filter);
    expect(h.timers.delays).toEqual([SETTLE_MS, STREAM_FACTS_WAIT_MS]);
    h.answer.next = new Promise(() => undefined);
    h.backend.responseStarted(HTML_HEADERS);
    await settle();
    expect(h.host.rewrites).toHaveLength(1);
    expect(h.timers.delays).toEqual([SETTLE_MS, STREAM_FACTS_WAIT_MS, RELEASE_MS]);
    // The late-facts timer was cancelled: a rewrite longer than it is not cut off.
    expect(h.timers.pending()).toEqual([RELEASE_MS]);
  });

  it('writes through when the facts never arrive', () => {
    return (async () => {
      const h = harness();
      const filter = await openArmed(h);
      filter.start();
      filter.data('x');
      stopAndSettle(h, filter);
      h.timers.fire(STREAM_FACTS_WAIT_MS);
      expect(filter.written).toEqual(['x']);
      expect(filter.calls.at(-1)).toBe('close');
      expect(h.host.rewrites).toHaveLength(0);
    })();
  });
});

describe('stream backend — pass-through and failure arms', () => {
  it('passes an ineligible response through untouched and unrecorded', async () => {
    const h = harness();
    const filter = await openArmed(h);
    h.backend.responseStarted({
      ...HTML_HEADERS,
      responseHeaders: [{ name: 'content-type', value: 'text/plain' }]
    });
    filter.start();
    filter.data('late');
    await settle();
    expect(filter.calls).toEqual(['disconnect']);
    expect(h.host.gates).toEqual([]);
    expect(h.host.unavailable).toEqual([]);
  });

  it('passes through when the session does not want the document (gate denied)', async () => {
    const h = harness();
    h.gateAnswer.next = Promise.resolve(false);
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('a');
    await settle();
    expect(filter.written).toEqual(['a']);
    expect(filter.calls).toEqual(['write', 'disconnect']);
  });

  it('logs a gate rejection and keeps buffering', async () => {
    const h = harness();
    h.gateAnswer.next = Promise.reject(new Error('gate'));
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('a');
    await settle();
    expect(h.log.lines).toContain('Stream gate failed');
    expect(filter.calls).toEqual([]);
  });

  it('writes an oversized body through mid-stream and reports it', async () => {
    const h = harness();
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    const big = new ArrayBuffer(8 * 1024 * 1024);
    filter.ondata?.({ data: big });
    filter.data('x');
    await settle();
    expect(filter.calls).toEqual(['write', 'write', 'disconnect']);
    expect(h.host.unavailable).toEqual([URL]);
  });

  it('reports an eligible body whose filter failed, touching the filter no further', async () => {
    const h = harness();
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('a');
    filter.fail('Channel redirected');
    stopAndSettle(h, filter);
    await settle();
    expect(filter.calls).toEqual([]);
    expect(h.host.unavailable).toEqual([URL]);
  });

  it('logs a failed unavailable report', async () => {
    const h = harness();
    h.host.documentBodyUnavailable = () => Promise.reject(new Error('record'));
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.fail('x');
    await settle();
    expect(h.log.lines).toContain('Stream unavailable report failed');
  });

  it('stops writing at the first failed write and still ends the filter once', async () => {
    const h = harness();
    const filter = await openArmed(h);
    filter.start();
    filter.data('a');
    filter.data('b');
    filter.failWrite = true;
    await h.backend.disarm(TAB);
    expect(filter.calls).toEqual(['disconnect']);
    expect(h.log.lines.filter((line) => line === 'Stream write failed')).toHaveLength(1);
  });

  it('logs a failing end', async () => {
    const h = harness();
    const filter = await openArmed(h);
    filter.failEnd = true;
    filter.start();
    await h.backend.disarm(TAB);
    expect(h.log.lines).toContain('Stream end failed');
  });

  it('isolates a failing effect (logged; the deadline still releases the body)', async () => {
    const h = harness();
    h.host.rewriteDocument = () => {
      throw new Error('sync host fault');
    };
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('a');
    stopAndSettle(h, filter);
    expect(h.log.lines).toContain('Stream effect failed');
    h.timers.fire(RELEASE_MS);
    expect(filter.written).toEqual(['a']);
    expect(filter.ends).toBe(1);
  });
  it('isolates a failing filter callback (logged, the stream keeps working)', async () => {
    const h = harness();
    const filter = await openArmed(h);
    filter.start();
    filter.ondata?.({
      get data(): ArrayBuffer {
        throw new Error('detached buffer');
      }
    });
    expect(h.log.lines).toContain('Stream event handling failed');
    filter.data('a');
    await h.backend.disarm(TAB);
    expect(filter.written).toEqual(['a']);
  });
});

describe('stream backend — withdrawals', () => {
  it('disarm mid-buffer writes through and disconnects', async () => {
    const h = harness();
    const filter = await openArmed(h);
    filter.start();
    filter.data('a');
    await h.backend.disarm(TAB);
    expect(filter.calls).toEqual(['write', 'disconnect']);
  });

  it('disarm mid-rewrite serves the original, closes, and drops the late answer', async () => {
    const h = harness();
    const late = deferred<Uint8Array | null>();
    h.answer.next = late.promise;
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('a');
    stopAndSettle(h, filter);
    await h.backend.disarm(TAB);
    late.resolve(enc('late'));
    await settle();
    expect(filter.written).toEqual(['a']);
    expect(filter.calls).toEqual(['write', 'close']);
  });

  it('disarm before the start defers the pass-through to the start', async () => {
    const h = harness();
    const filter = await openArmed(h);
    await h.backend.disarm(TAB);
    expect(filter.calls).toEqual([]);
    // Withdrawn: it left the table (its headers no longer route to it).
    h.backend.responseStarted(HTML_HEADERS);
    await settle();
    expect(h.host.gates).toEqual([]);
    filter.start();
    expect(filter.calls).toEqual(['disconnect']);
  });

  it('a re-arm with a new generation withdraws in-flight streams; the same generation keeps them', async () => {
    const h = harness();
    const filter = await openArmed(h);
    filter.start();
    filter.data('a');
    await h.backend.arm(TAB, 1);
    await h.backend.resume(TAB, 1);
    expect(filter.calls).toEqual([]);
    await h.backend.arm(TAB, 2);
    expect(filter.calls).toEqual(['write', 'disconnect']);
  });

  it('a resume with a new generation withdraws in-flight streams', async () => {
    const h = harness();
    const filter = await openArmed(h);
    filter.start();
    await h.backend.resume(TAB, 3);
    expect(filter.calls).toEqual(['disconnect']);
  });

  it('withdraws only the disarmed tab’s streams', async () => {
    const h = harness();
    const filter = await openArmed(h);
    await h.backend.arm(TAB + 1, 1);
    h.backend.requestStarted({ requestId: 'other', tabId: TAB + 1, url: URL });
    const other = h.filters.at(-1);
    filter.start();
    other?.start();
    await h.backend.disarm(TAB + 1);
    expect(filter.calls).toEqual([]);
    expect(other?.calls).toEqual(['disconnect']);
  });

  it('a redirect re-entering with the same id supersedes the earlier filter', async () => {
    const h = harness();
    const first = await openArmed(h);
    h.backend.responseStarted({ ...HTML_HEADERS, statusCode: 302 });
    h.backend.requestStarted({ requestId: 'r1', tabId: TAB, url: `${URL}/next` });
    const second = h.filters.at(-1);
    expect(second).not.toBe(first);
    // The redirected filter dies without being touched.
    first.fail('Invalid request ID');
    h.backend.responseStarted(HTML_HEADERS);
    second?.start();
    second?.data('final');
    stopAndSettle(h, second);
    await settle();
    expect(first.calls).toEqual([]);
    expect(h.host.unavailable).toEqual([]);
    expect(h.host.rewrites.map((document) => document.documentUrl)).toEqual([`${URL}/next`]);
    expect(second?.calls).toEqual(['write', 'close']);
  });

  it('ignores headers of an unknown request or another tab, and events after the end', async () => {
    const h = harness();
    h.backend.responseStarted(HTML_HEADERS);
    const filter = await openArmed(h);
    h.backend.responseStarted({ ...HTML_HEADERS, tabId: TAB + 1 });
    expect(h.host.gates).toEqual([]);
    filter.start();
    await h.backend.disarm(TAB);
    filter.data('after');
    stopAndSettle(h, filter);
    h.backend.responseStarted(HTML_HEADERS);
    await settle();
    expect(filter.ends).toBe(1);
    expect(h.host.rewrites).toEqual([]);
  });
});

describe('stream backend — response facts', () => {
  it('joins every Content-Type header case-insensitively; none → null', () => {
    expect(
      responseContentType([
        { name: 'content-type', value: 'text/html' },
        { name: 'X-Other', value: 'y' },
        { name: 'CONTENT-TYPE', value: 'charset=utf-8' },
        { name: 'Content-Type' }
      ])
    ).toBe('text/html, charset=utf-8');
    expect(responseContentType([])).toBeNull();
    expect(responseContentType(undefined)).toBeNull();
  });

  it('reads status, method and content type from the headers hook', () => {
    expect(responseFacts(HTML_HEADERS)).toEqual({
      status: 200,
      method: 'GET',
      contentType: 'text/html; charset=utf-8'
    });
  });
});

describe('stream backend — revalidation, failures, abandonment', () => {
  const NOT_MODIFIED: StreamResponseDetails = {
    ...HTML_HEADERS,
    statusCode: 304,
    responseHeaders: []
  };

  it('rewrites a revalidated document (304, then the cached 200, before the body)', async () => {
    const h = harness();
    h.answer.next = Promise.resolve(enc('REWRITTEN'));
    const filter = await openArmed(h);
    h.backend.responseStarted(NOT_MODIFIED);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('orig');
    stopAndSettle(h, filter);
    await settle();
    expect(h.host.rewrites).toHaveLength(1);
    expect(filter.written).toEqual(['REWRITTEN']);
    expect(filter.calls).toEqual(['write', 'close']);
  });

  it('serves a truncated body unmodified and reports it (failure in the settle tick)', async () => {
    const h = harness();
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('partial');
    filter.stop();
    h.backend.requestFailed({
      requestId: 'r1',
      tabId: TAB,
      error: 'NS_ERROR_NET_PARTIAL_TRANSFER'
    });
    await settle();
    expect(h.host.rewrites).toEqual([]);
    expect(filter.written).toEqual(['partial']);
    expect(filter.calls).toEqual(['write', 'close']);
    expect(h.host.unavailable).toEqual([URL]);
    expect(h.timers.pending()).toEqual([]);
    expect(h.backend.inFlight()).toEqual([]);
  });

  it('trusts the body when no completion arrives within the settle wait (bounded fallback)', async () => {
    const h = harness();
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('x');
    filter.stop();
    expect(h.host.rewrites).toEqual([]);
    h.timers.fire(SETTLE_MS);
    await settle();
    expect(h.host.rewrites).toHaveLength(1);
  });

  it('rewrites at once when the completion came before the body’s end', async () => {
    const h = harness();
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('x');
    h.backend.requestCompleted({ requestId: 'r1', tabId: TAB });
    h.backend.requestCompleted({ requestId: 'r1', tabId: TAB + 1 });
    h.backend.requestCompleted({ requestId: 'other', tabId: TAB });
    filter.stop();
    expect(h.host.rewrites).toHaveLength(1);
    expect(h.timers.delays).toEqual([RELEASE_MS]);
  });

  it('a failure while the host rewrites serves the original, reports it, and abandons the ask', async () => {
    const h = harness();
    const late = deferred<Uint8Array | null>();
    h.answer.next = late.promise;
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('orig');
    stopAndSettle(h, filter);
    const abandoned = h.host.abandons[0];
    expect(abandoned?.()).toBe(false);
    h.backend.requestFailed({ requestId: 'r1', tabId: TAB, error: 'NS_BINDING_ABORTED' });
    expect(abandoned?.()).toBe(true);
    late.resolve(enc('late'));
    await settle();
    expect(filter.written).toEqual(['orig']);
    expect(filter.calls).toEqual(['write', 'close']);
    expect(h.host.unavailable).toEqual([URL]);
  });

  it('a filter error while the host rewrites reports it and abandons the ask', async () => {
    const h = harness();
    h.answer.next = new Promise(() => undefined);
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    filter.start();
    filter.data('orig');
    stopAndSettle(h, filter);
    filter.fail('Channel closed');
    await settle();
    expect(h.host.abandons[0]?.()).toBe(true);
    expect(h.host.unavailable).toEqual([URL]);
    expect(filter.calls).toEqual([]);
    expect(h.timers.pending()).toEqual([]);
  });

  it('a failure before the start withdraws the stream (reported, disconnected at start)', async () => {
    const h = harness();
    const filter = await openArmed(h);
    h.backend.responseStarted(HTML_HEADERS);
    await settle();
    h.backend.requestFailed({ requestId: 'r1', tabId: TAB, error: 'NS_BINDING_ABORTED' });
    expect(h.backend.inFlight()).toEqual([]);
    expect(h.host.unavailable).toEqual([URL]);
    filter.start();
    expect(filter.calls).toEqual(['disconnect']);
  });

  it('ignores failures of an unknown request or another tab', async () => {
    const h = harness();
    h.backend.requestFailed({ requestId: 'nope', tabId: TAB, error: 'x' });
    const filter = await openArmed(h);
    h.backend.requestFailed({ requestId: 'r1', tabId: TAB + 1, error: 'x' });
    expect(h.backend.inFlight()).toEqual(['r1']);
    filter.start();
    expect(filter.calls).toEqual([]);
  });

  it('a withdrawn (not yet started) stream leaves the routing table at once', async () => {
    const h = harness();
    await openArmed(h);
    expect(h.backend.inFlight()).toEqual(['r1']);
    await h.backend.disarm(TAB);
    expect(h.backend.inFlight()).toEqual([]);
  });

  it('a superseded (redirected) filter is withdrawn: passed through if it ever starts', async () => {
    const h = harness();
    const first = await openArmed(h);
    h.backend.responseStarted({ ...HTML_HEADERS, statusCode: 302, responseHeaders: [] });
    h.backend.requestStarted({ requestId: 'r1', tabId: TAB, url: `${URL}/next` });
    first.start();
    expect(first.calls).toEqual(['disconnect']);
    expect(h.backend.inFlight()).toEqual(['r1']);
  });
});
