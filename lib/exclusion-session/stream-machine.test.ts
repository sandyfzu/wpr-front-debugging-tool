/**
 * The stream machine, exhaustively: every state × event pair pinned (next
 * state, withdrawal reason included, and ordered effects), the regressions
 * (revalidated `304 → 200`, truncated bodies, completion order, stale timers), then its
 * guarantees checked over every event sequence up to length 3 and over long
 * seeded random sequences.
 */
import { describe, expect, it } from 'vitest';
import { DOCUMENT_BODY_BYTE_LIMIT, type InterceptedResponseFacts } from './document-transform';
import {
  chunksOf,
  isFinalStatus,
  joinChunks,
  OPENING_STREAM,
  streamTransition,
  type ChunkList,
  type StreamEffect,
  type StreamEvent,
  type StreamState
} from './stream-machine';

const HTML: InterceptedResponseFacts = {
  status: 200,
  method: 'GET',
  contentType: 'text/html; charset=utf-8'
};
const PLAIN: InterceptedResponseFacts = { ...HTML, contentType: 'text/plain' };
const NOT_MODIFIED: InterceptedResponseFacts = { status: 304, method: 'GET', contentType: null };
const A = new Uint8Array([1, 2]);
const B = new Uint8Array([3]);
const REWRITTEN = new Uint8Array([9, 9, 9]);

/** A chunk list from chunks in arrival order. */
function list(...chunks: Uint8Array[]): ChunkList | null {
  let node: ChunkList | null = null;
  for (const chunk of chunks) node = { chunk, previous: node };
  return node;
}

/** Feed events from a state; returns the final state and every effect in order. */
function run(
  events: readonly StreamEvent[],
  from: StreamState = OPENING_STREAM
): { state: StreamState; effects: StreamEffect[] } {
  let state = from;
  const effects: StreamEffect[] = [];
  for (const event of events) {
    const next = streamTransition(state, event);
    state = next.state;
    effects.push(...next.effects);
  }
  return { state, effects };
}

const ev = {
  start: { type: 'start' },
  dataA: { type: 'data', chunk: A },
  stop: { type: 'stop' },
  error: { type: 'error' },
  failed: { type: 'failed' },
  completed: { type: 'completed' },
  html: { type: 'facts', facts: HTML },
  plain: { type: 'facts', facts: PLAIN },
  notModified: { type: 'facts', facts: NOT_MODIFIED },
  allowed: { type: 'gate', allowed: true },
  denied: { type: 'gate', allowed: false },
  rewritten: { type: 'rewritten', body: REWRITTEN },
  unchanged: { type: 'rewritten', body: null },
  settle: { type: 'timer', wait: 'settle' },
  factsWait: { type: 'timer', wait: 'facts' },
  release: { type: 'timer', wait: 'release' },
  abort: { type: 'abort' }
} as const satisfies Record<string, StreamEvent>;
type EventName = keyof typeof ev;

const DONE: StreamState = { phase: 'done' };
const opening = (
  facts: InterceptedResponseFacts | null = null,
  withdrawn: 'abort' | 'gate-denied' | 'failed' | null = null,
  completed = false
): StreamState => ({ phase: 'opening', facts, withdrawn, completed });
const buffering = (
  facts: InterceptedResponseFacts | null,
  ...chunks: Uint8Array[]
): StreamState => ({
  phase: 'buffering',
  facts,
  chunks: list(...chunks),
  bytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  completed: false
});
/** A buffering state whose request already completed on the network. */
const completedBuffering = (facts: InterceptedResponseFacts | null): StreamState => ({
  phase: 'buffering',
  facts,
  chunks: list(A),
  bytes: 2,
  completed: true
});
const settling = (facts: InterceptedResponseFacts | null): StreamState => ({
  phase: 'settling',
  facts,
  chunks: list(A, B)
});
const AWAITING: StreamState = { phase: 'awaiting-facts', chunks: list(A, B) };
const REWRITING: StreamState = { phase: 'rewriting', chunks: list(A, B) };
const REWRITING_A: StreamState = { phase: 'rewriting', chunks: list(A) };

const write = (...chunks: Uint8Array[]): StreamEffect => ({ type: 'write', chunks });
const close: StreamEffect = { type: 'end', how: 'close' };
const disconnect: StreamEffect = { type: 'end', how: 'disconnect' };
const gate: StreamEffect = { type: 'ask-gate' };
const report: StreamEffect = { type: 'report-unavailable' };
const askRewrite = (facts: InterceptedResponseFacts, ...chunks: Uint8Array[]): StreamEffect => ({
  type: 'ask-rewrite',
  body: joinChunks(chunks),
  facts
});
const arm = (wait: 'settle' | 'facts' | 'release'): StreamEffect => ({ type: 'arm-timer', wait });

type Pin = readonly [StreamState, readonly StreamEffect[]];
type Row = Record<EventName, Pin>;

/** A row where every event leaves the state as it is, then overridden. */
function rowOf(state: StreamState, pins: Partial<Row>): Row {
  const row = {} as Record<EventName, Pin>;
  for (const name of Object.keys(ev) as EventName[]) row[name] = pins[name] ?? [state, []];
  return row;
}

/** The states pinned, each with its full row. */
const MATRIX: Record<string, readonly [StreamState, Row]> = {
  opening: [
    opening(),
    rowOf(opening(), {
      start: [buffering(null), []],
      dataA: [buffering(null, A), []],
      stop: [{ phase: 'settling', facts: null, chunks: null }, [arm('settle')]],
      error: [DONE, []],
      failed: [opening(null, 'failed'), []],
      html: [opening(HTML), [gate]],
      plain: [opening(PLAIN), []],
      notModified: [opening(NOT_MODIFIED), []],
      denied: [opening(null, 'gate-denied'), []],
      abort: [opening(null, 'abort'), []],
      completed: [opening(null, null, true), []]
    })
  ],
  'opening (eligible)': [
    opening(HTML),
    rowOf(opening(HTML), {
      start: [buffering(HTML), []],
      dataA: [buffering(HTML, A), []],
      stop: [{ phase: 'settling', facts: HTML, chunks: null }, [arm('settle')]],
      error: [DONE, [report]],
      failed: [opening(HTML, 'failed'), [report]],
      html: [opening(HTML), [gate]],
      plain: [opening(PLAIN), []],
      notModified: [opening(NOT_MODIFIED), []],
      denied: [opening(HTML, 'gate-denied'), []],
      abort: [opening(HTML, 'abort'), []],
      completed: [opening(HTML, null, true), []]
    })
  ],
  'opening (304 seen)': [
    opening(NOT_MODIFIED),
    rowOf(opening(NOT_MODIFIED), {
      start: [buffering(NOT_MODIFIED), []],
      dataA: [buffering(NOT_MODIFIED, A), []],
      stop: [{ phase: 'settling', facts: NOT_MODIFIED, chunks: null }, [arm('settle')]],
      error: [DONE, []],
      failed: [opening(NOT_MODIFIED, 'failed'), []],
      html: [opening(HTML), [gate]],
      plain: [opening(PLAIN), []],
      denied: [opening(NOT_MODIFIED, 'gate-denied'), []],
      abort: [opening(NOT_MODIFIED, 'abort'), []],
      completed: [opening(NOT_MODIFIED, null, true), []]
    })
  ],
  'opening (ineligible)': [
    opening(PLAIN),
    rowOf(opening(PLAIN), {
      start: [DONE, [disconnect]],
      dataA: [DONE, [write(A), disconnect]],
      stop: [DONE, [close]],
      error: [DONE, []],
      failed: [opening(PLAIN, 'failed'), []],
      html: [opening(HTML), [gate]],
      notModified: [opening(NOT_MODIFIED), []],
      denied: [opening(PLAIN, 'gate-denied'), []],
      abort: [opening(PLAIN, 'abort'), []],
      completed: [opening(PLAIN, null, true), []]
    })
  ],
  'opening (withdrawn)': [
    opening(HTML, 'abort'),
    rowOf(opening(HTML, 'abort'), {
      start: [DONE, [disconnect]],
      dataA: [DONE, [write(A), disconnect]],
      stop: [DONE, [close]],
      error: [DONE, []],
      html: [opening(HTML, 'abort'), []],
      plain: [opening(PLAIN, 'abort'), []],
      notModified: [opening(NOT_MODIFIED, 'abort'), []],
      completed: [opening(HTML, 'abort', true), []]
    })
  ],
  'buffering (no facts)': [
    buffering(null, A),
    rowOf(buffering(null, A), {
      dataA: [buffering(null, A, A), []],
      stop: [{ phase: 'settling', facts: null, chunks: list(A) }, [arm('settle')]],
      error: [DONE, []],
      failed: [DONE, [write(A), disconnect]],
      html: [buffering(HTML, A), [gate]],
      plain: [DONE, [write(A), disconnect]],
      denied: [DONE, [write(A), disconnect]],
      abort: [DONE, [write(A), disconnect]],
      completed: [completedBuffering(null), []]
    })
  ],
  'buffering (eligible)': [
    buffering(HTML, A),
    rowOf(buffering(HTML, A), {
      dataA: [buffering(HTML, A, A), []],
      stop: [{ phase: 'settling', facts: HTML, chunks: list(A) }, [arm('settle')]],
      error: [DONE, [report]],
      failed: [DONE, [write(A), disconnect, report]],
      html: [buffering(HTML, A), [gate]],
      plain: [DONE, [write(A), disconnect]],
      denied: [DONE, [write(A), disconnect]],
      abort: [DONE, [write(A), disconnect]],
      completed: [completedBuffering(HTML), []]
    })
  ],
  'buffering (completed, eligible)': [
    completedBuffering(HTML),
    rowOf(completedBuffering(HTML), {
      dataA: [
        { ...(completedBuffering(HTML) as object), chunks: list(A, A), bytes: 4 } as StreamState,
        []
      ],
      stop: [REWRITING_A, [askRewrite(HTML, A), arm('release')]],
      error: [DONE, [report]],
      failed: [DONE, [write(A), disconnect, report]],
      html: [completedBuffering(HTML), [gate]],
      plain: [DONE, [write(A), disconnect]],
      denied: [DONE, [write(A), disconnect]],
      abort: [DONE, [write(A), disconnect]]
    })
  ],
  'settling (eligible)': [
    settling(HTML),
    rowOf(settling(HTML), {
      settle: [REWRITING, [askRewrite(HTML, A, B), arm('release')]],
      completed: [REWRITING, [askRewrite(HTML, A, B), arm('release')]],
      error: [DONE, [report]],
      failed: [DONE, [write(A, B), close, report]],
      plain: [settling(PLAIN), []],
      denied: [DONE, [write(A, B), close]],
      abort: [DONE, [write(A, B), close]]
    })
  ],
  'settling (no facts)': [
    settling(null),
    rowOf(settling(null), {
      settle: [AWAITING, [arm('facts')]],
      completed: [AWAITING, [arm('facts')]],
      error: [DONE, []],
      failed: [DONE, [write(A, B), close]],
      html: [settling(HTML), []],
      plain: [settling(PLAIN), []],
      denied: [DONE, [write(A, B), close]],
      abort: [DONE, [write(A, B), close]]
    })
  ],
  'awaiting-facts': [
    AWAITING,
    rowOf(AWAITING, {
      html: [REWRITING, [askRewrite(HTML, A, B), arm('release')]],
      plain: [DONE, [write(A, B), close]],
      error: [DONE, []],
      failed: [DONE, [write(A, B), close]],
      denied: [DONE, [write(A, B), close]],
      factsWait: [DONE, [write(A, B), close]],
      abort: [DONE, [write(A, B), close]]
    })
  ],
  rewriting: [
    REWRITING,
    rowOf(REWRITING, {
      rewritten: [DONE, [write(REWRITTEN), close]],
      unchanged: [DONE, [write(A, B), close]],
      release: [DONE, [write(A, B), close]],
      abort: [DONE, [write(A, B), close]],
      failed: [DONE, [write(A, B), close, report]],
      error: [DONE, [report]]
    })
  ],
  done: [DONE, rowOf(DONE, {})]
};

describe('stream machine — the full state × event matrix', () => {
  for (const [stateName, [state, row]] of Object.entries(MATRIX)) {
    for (const [eventName, event] of Object.entries(ev)) {
      const [next, effects] = row[eventName as EventName];
      it(`${stateName} × ${eventName} → ${next.phase}`, () => {
        const result = streamTransition(state, event);
        expect(result.state).toEqual(next);
        expect(result.effects).toEqual(effects);
      });
    }
  }
});

describe('stream machine — regressions', () => {
  it('rewrites a revalidated document (304, then the cached 200, before the body)', () => {
    const { state, effects } = run([
      ev.notModified,
      ev.html,
      ev.start,
      ev.dataA,
      ev.stop,
      ev.settle
    ]);
    expect(state.phase).toBe('rewriting');
    expect(effects).toEqual([gate, arm('settle'), askRewrite(HTML, A), arm('release')]);
  });

  it('serves a truncated body unmodified and reports it (failure after the body ends)', () => {
    const { state, effects } = run([ev.html, ev.start, ev.dataA, ev.stop, ev.failed, ev.settle]);
    expect(state.phase).toBe('done');
    expect(effects).toEqual([gate, arm('settle'), write(A), close, report]);
  });

  it('rewrites at once when the request completed before the body ended', () => {
    const { effects } = run([ev.html, ev.start, ev.dataA, ev.completed, ev.stop]);
    expect(effects).toEqual([gate, askRewrite(HTML, A), arm('release')]);
  });

  it('rewrites when the completion follows the body’s end', () => {
    const { effects } = run([ev.html, ev.start, ev.dataA, ev.stop, ev.completed]);
    expect(effects).toEqual([gate, arm('settle'), askRewrite(HTML, A), arm('release')]);
  });

  it('ignores a stale timer of another wait (e.g. the facts wait once rewriting)', () => {
    expect(run([ev.factsWait, ev.settle], REWRITING).effects).toEqual([]);
    expect(run([ev.release, ev.factsWait], settling(HTML)).state).toEqual(settling(HTML));
  });

  it('a 304 alone never decides: the body waits for final facts, bounded', () => {
    const { state, effects } = run([ev.notModified, ev.start, ev.dataA, ev.stop, ev.settle]);
    expect(state.phase).toBe('awaiting-facts');
    expect(effects).toEqual([arm('settle'), arm('facts')]);
  });

  it('the first withdrawal wins and is never replaced by a later one', () => {
    expect(run([ev.denied, ev.abort, ev.failed]).state).toEqual(opening(null, 'gate-denied'));
  });
});

describe('stream machine — buffering bound', () => {
  it('passes through past the byte limit, reporting only an eligible body', () => {
    const big = new Uint8Array(DOCUMENT_BODY_BYTE_LIMIT);
    expect(run([ev.start, { type: 'data', chunk: big }]).state.phase).toBe('buffering');
    const over = run([ev.html, ev.start, { type: 'data', chunk: big }, { type: 'data', chunk: B }]);
    expect(over.state.phase).toBe('done');
    expect(over.effects.map((effect) => effect.type)).toEqual([
      'ask-gate',
      'write',
      'end',
      'report-unavailable'
    ]);
    const written = over.effects[1];
    // Identity, not deep equality: the very chunks received are written back.
    expect(written?.type === 'write' && written.chunks[0]).toBe(big);
    expect(written?.type === 'write' && written.chunks[1]).toBe(B);
    const unknown = run([ev.start, { type: 'data', chunk: big }, { type: 'data', chunk: B }]);
    expect(unknown.effects.map((effect) => effect.type)).toEqual(['write', 'end']);
  });
});

describe('stream machine — helpers', () => {
  it('joins chunks into one body (empty → empty) and lists them in arrival order', () => {
    expect(joinChunks([A, B])).toEqual(new Uint8Array([1, 2, 3]));
    expect(joinChunks([])).toEqual(new Uint8Array(0));
    expect(chunksOf(null)).toEqual([]);
    expect(chunksOf(list(A, B))).toEqual([A, B]);
  });

  it('only 1xx and 3xx statuses are non-final', () => {
    const at = (status: number): boolean => isFinalStatus({ ...HTML, status });
    expect([99, 100, 199, 200, 299, 300, 304, 399, 400, 599].map(at)).toEqual([
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      true
    ]);
  });
});

// ── Guarantees over every sequence ─────────────────────────────────────

const ALPHABET: readonly StreamEvent[] = [...Object.values(ev), { type: 'data', chunk: B }];

/** The guarantees one event sequence must satisfy. */
function checkGuarantees(events: readonly StreamEvent[]): void {
  let state: StreamState = OPENING_STREAM;
  let ends = 0;
  let reports = 0;
  let started = false;
  let errored = false;
  let withdrawn = false;
  let eligibleSeen = false;
  let latestFinal: InterceptedResponseFacts | null = null;
  let received: Uint8Array[] = [];
  let written: Uint8Array[] = [];
  let servedRewritten = false;
  let whole = false;
  for (const event of events) {
    const before = state.phase;
    if (event.type === 'completed') whole = true;
    if (event.type === 'timer' && event.wait === 'settle' && before === 'settling') whole = true;
    if (event.type === 'start' || event.type === 'data' || event.type === 'stop') started = true;
    if (event.type === 'facts' && isFinalStatus(event.facts)) {
      if (before === 'opening' || before === 'buffering' || before === 'settling') {
        latestFinal = event.facts;
      } else if (before === 'awaiting-facts') latestFinal = event.facts;
      if (event.facts.contentType === HTML.contentType) eligibleSeen = true;
    }
    if (event.type === 'data' && (before === 'opening' || before === 'buffering')) {
      received = [...received, event.chunk];
    }
    if (before !== 'done') {
      if (event.type === 'error') errored = true;
      if (event.type === 'abort' || event.type === 'failed') withdrawn = true;
      if (event.type === 'gate' && !event.allowed && before !== 'rewriting') withdrawn = true;
    }
    const next = streamTransition(state, event);
    if (before === 'done') expect(next.effects).toEqual([]);
    const endAt = next.effects.findIndex((effect) => effect.type === 'end');
    if (endAt !== -1) {
      // Nothing is written after the end.
      expect(next.effects.slice(endAt).some((effect) => effect.type === 'write')).toBe(false);
    }
    for (const effect of next.effects) {
      if (effect.type === 'write' || effect.type === 'end') expect(started).toBe(true);
      if (effect.type === 'write') written = [...written, ...effect.chunks];
      if (effect.type === 'end') ends += 1;
      if (effect.type === 'report-unavailable') {
        reports += 1;
        expect(eligibleSeen).toBe(true);
      }
      if (effect.type === 'ask-rewrite') {
        // Withdrawn ⇒ never rewritten; only the complete body, with the latest final facts.
        expect(withdrawn).toBe(false);
        // Complete bodies only: after the network completion (or the bounded fallback).
        expect(whole).toBe(true);
        expect(effect.facts).toBe(latestFinal);
        expect(effect.body).toEqual(joinChunks(received));
      }
    }
    if (before === 'rewriting' && event.type === 'rewritten' && event.body !== null) {
      servedRewritten = true;
      expect(withdrawn).toBe(false);
    }
    state = next.state;
    if (state.phase === 'buffering')
      expect(state.bytes).toBeLessThanOrEqual(DOCUMENT_BODY_BYTE_LIMIT);
  }
  expect(ends).toBeLessThanOrEqual(1);
  expect(reports).toBeLessThanOrEqual(1);
  if (state.phase === 'done' && !errored) expect(ends).toBe(1);
  if (ends === 1 && !servedRewritten) expect(written).toEqual(received);
  if (servedRewritten) expect(written).toEqual([REWRITTEN]);
}

describe('stream machine — guarantees over every event sequence', () => {
  it('holds for every sequence up to length 3', () => {
    let frontier: StreamEvent[][] = [[]];
    let count = 0;
    for (let length = 0; length < 3; length++) {
      const next: StreamEvent[][] = [];
      for (const prefix of frontier) {
        for (const event of ALPHABET) {
          const sequence = [...prefix, event];
          checkGuarantees(sequence);
          count += 1;
          next.push(sequence);
        }
      }
      frontier = next;
    }
    const n = ALPHABET.length;
    expect(count).toBe(n + n ** 2 + n ** 3);
  });

  it('holds for long seeded random sequences', () => {
    let seed = 0x5eed;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 8_000; i++) {
      const length = 4 + (random() % 20);
      const events = Array.from(
        { length },
        () => ALPHABET[random() % ALPHABET.length] as StreamEvent
      );
      checkGuarantees(events);
    }
  });
});
