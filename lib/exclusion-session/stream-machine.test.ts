/**
 * The stream machine, exhaustively: every phase × event pair pinned, then
 * its guarantees (ended exactly once, nothing lost, bounded, ineligible ⇒
 * unrecorded, nothing before start) checked over every event sequence up to
 * length 4 and over long seeded random sequences.
 */
import { describe, expect, it } from 'vitest';
import { DOCUMENT_BODY_BYTE_LIMIT, type InterceptedResponseFacts } from './document-transform';
import {
  chunksOf,
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
  dataB: { type: 'data', chunk: B },
  stop: { type: 'stop' },
  error: { type: 'error' },
  html: { type: 'facts', facts: HTML },
  plain: { type: 'facts', facts: PLAIN },
  allowed: { type: 'gate', allowed: true },
  denied: { type: 'gate', allowed: false },
  rewritten: { type: 'rewritten', body: REWRITTEN },
  unchanged: { type: 'rewritten', body: null },
  deadline: { type: 'deadline' },
  abort: { type: 'abort' }
} as const satisfies Record<string, StreamEvent>;

const KNOWN_HTML = { facts: HTML, eligible: true };
const DONE: StreamState = { phase: 'done' };

/** One state of every phase (and the decision variants that matter). */
const STATES = {
  opening: OPENING_STREAM,
  'opening (eligible facts)': { phase: 'opening', facts: KNOWN_HTML, passing: false },
  'opening (passing)': { phase: 'opening', facts: null, passing: true },
  'buffering (no facts)': { phase: 'buffering', facts: null, chunks: list(A), bytes: 2 },
  'buffering (eligible)': { phase: 'buffering', facts: KNOWN_HTML, chunks: list(A), bytes: 2 },
  'awaiting-facts': { phase: 'awaiting-facts', chunks: list(A, B) },
  rewriting: { phase: 'rewriting', chunks: list(A, B) },
  done: DONE
} as const satisfies Record<string, StreamState>;

type Pin = readonly [StreamState['phase'], readonly StreamEffect[]];
const write = (...chunks: Uint8Array[]): StreamEffect => ({ type: 'write', chunks });
const close: StreamEffect = { type: 'end', how: 'close' };
const disconnect: StreamEffect = { type: 'end', how: 'disconnect' };
const gate: StreamEffect = { type: 'ask-gate' };
const report: StreamEffect = { type: 'report-unavailable' };
const askRewrite = (...chunks: Uint8Array[]): StreamEffect => ({
  type: 'ask-rewrite',
  body: joinChunks(chunks),
  facts: HTML
});
const release: StreamEffect = { type: 'arm-deadline', wait: 'release' };
const factsWait: StreamEffect = { type: 'arm-deadline', wait: 'facts' };

/** The full matrix: [state][event] → [next phase, effects]. */
const MATRIX: Record<keyof typeof STATES, Record<keyof typeof ev, Pin>> = {
  opening: {
    start: ['buffering', []],
    dataA: ['buffering', []],
    dataB: ['buffering', []],
    stop: ['awaiting-facts', [factsWait]],
    error: ['done', []],
    html: ['opening', [gate]],
    plain: ['opening', []],
    allowed: ['opening', []],
    denied: ['opening', []],
    rewritten: ['opening', []],
    unchanged: ['opening', []],
    deadline: ['opening', []],
    abort: ['opening', []]
  },
  'opening (eligible facts)': {
    start: ['buffering', []],
    dataA: ['buffering', []],
    dataB: ['buffering', []],
    stop: ['rewriting', [askRewrite(), release]],
    error: ['done', [report]],
    html: ['opening', [gate]],
    plain: ['opening', []],
    allowed: ['opening', []],
    denied: ['opening', []],
    rewritten: ['opening', []],
    unchanged: ['opening', []],
    deadline: ['opening', []],
    abort: ['opening', []]
  },
  'opening (passing)': {
    start: ['done', [disconnect]],
    dataA: ['done', [write(A), disconnect]],
    dataB: ['done', [write(B), disconnect]],
    stop: ['done', [close]],
    error: ['done', []],
    html: ['opening', []],
    plain: ['opening', []],
    allowed: ['opening', []],
    denied: ['opening', []],
    rewritten: ['opening', []],
    unchanged: ['opening', []],
    deadline: ['opening', []],
    abort: ['opening', []]
  },
  'buffering (no facts)': {
    start: ['buffering', []],
    dataA: ['buffering', []],
    dataB: ['buffering', []],
    stop: ['awaiting-facts', [factsWait]],
    error: ['done', []],
    html: ['buffering', [gate]],
    plain: ['done', [write(A), disconnect]],
    allowed: ['buffering', []],
    denied: ['done', [write(A), disconnect]],
    rewritten: ['buffering', []],
    unchanged: ['buffering', []],
    deadline: ['buffering', []],
    abort: ['done', [write(A), disconnect]]
  },
  'buffering (eligible)': {
    start: ['buffering', []],
    dataA: ['buffering', []],
    dataB: ['buffering', []],
    stop: ['rewriting', [askRewrite(A), release]],
    error: ['done', [report]],
    html: ['buffering', [gate]],
    plain: ['done', [write(A), disconnect]],
    allowed: ['buffering', []],
    denied: ['done', [write(A), disconnect]],
    rewritten: ['buffering', []],
    unchanged: ['buffering', []],
    deadline: ['buffering', []],
    abort: ['done', [write(A), disconnect]]
  },
  'awaiting-facts': {
    start: ['awaiting-facts', []],
    dataA: ['awaiting-facts', []],
    dataB: ['awaiting-facts', []],
    stop: ['awaiting-facts', []],
    error: ['done', []],
    html: ['rewriting', [askRewrite(A, B), release]],
    plain: ['done', [write(A, B), close]],
    allowed: ['awaiting-facts', []],
    denied: ['done', [write(A, B), close]],
    rewritten: ['awaiting-facts', []],
    unchanged: ['awaiting-facts', []],
    deadline: ['done', [write(A, B), close]],
    abort: ['done', [write(A, B), close]]
  },
  rewriting: {
    start: ['rewriting', []],
    dataA: ['rewriting', []],
    dataB: ['rewriting', []],
    stop: ['rewriting', []],
    error: ['done', []],
    html: ['rewriting', []],
    plain: ['rewriting', []],
    allowed: ['rewriting', []],
    denied: ['rewriting', []],
    rewritten: ['done', [write(REWRITTEN), close]],
    unchanged: ['done', [write(A, B), close]],
    deadline: ['done', [write(A, B), close]],
    abort: ['done', [write(A, B), close]]
  },
  done: {
    start: ['done', []],
    dataA: ['done', []],
    dataB: ['done', []],
    stop: ['done', []],
    error: ['done', []],
    html: ['done', []],
    plain: ['done', []],
    allowed: ['done', []],
    denied: ['done', []],
    rewritten: ['done', []],
    unchanged: ['done', []],
    deadline: ['done', []],
    abort: ['done', []]
  }
};

describe('stream machine — the full phase × event matrix', () => {
  for (const [stateName, state] of Object.entries(STATES)) {
    for (const [eventName, event] of Object.entries(ev)) {
      const [phase, effects] =
        MATRIX[stateName as keyof typeof STATES][eventName as keyof typeof ev];
      it(`${stateName} × ${eventName} → ${phase}`, () => {
        const next = streamTransition(state, event);
        expect(next.state.phase).toBe(phase);
        expect(next.effects).toEqual(effects);
      });
    }
  }
});

describe('stream machine — decisions recorded before start', () => {
  it('ineligible facts, a denied gate and an abort each make the start a pass-through', () => {
    for (const decision of [ev.plain, ev.denied, ev.abort]) {
      expect(run([decision, ev.start]).effects).toEqual([disconnect]);
    }
  });

  it('a gate is asked once facts are eligible, never for a stream already passing', () => {
    expect(run([ev.abort, ev.html]).effects).toEqual([]);
  });

  it('facts known before start carry into buffering and drive the rewrite at stop', () => {
    expect(run([ev.html, ev.start, ev.dataA, ev.dataB, ev.stop]).effects).toEqual([
      gate,
      askRewrite(A, B),
      release
    ]);
  });
});

describe('stream machine — buffering', () => {
  it('collects chunks in arrival order and counts the bytes', () => {
    const { state } = run([ev.start, ev.dataA, ev.dataB]);
    expect(state.phase === 'buffering' && chunksOf(state.chunks)).toEqual([A, B]);
    expect(state.phase === 'buffering' && state.bytes).toBe(3);
  });

  it('passes through past the byte limit, reporting only an eligible body', () => {
    const big = new Uint8Array(DOCUMENT_BODY_BYTE_LIMIT);
    const at = run([ev.start, { type: 'data', chunk: big }]);
    expect(at.state.phase).toBe('buffering');
    const over = run([ev.html, ev.start, { type: 'data', chunk: big }, ev.dataB]);
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
    expect(over.effects[2]).toEqual(disconnect);
    const unknown = run([ev.start, { type: 'data', chunk: big }, ev.dataB]);
    expect(unknown.effects.map((effect) => effect.type)).toEqual(['write', 'end']);
  });

  it('awaits late facts with a bounded wait, then rewrites them', () => {
    expect(run([ev.start, ev.dataA, ev.stop, ev.html]).effects).toEqual([
      factsWait,
      askRewrite(A),
      release
    ]);
  });
});

describe('stream machine — chunk helpers', () => {
  it('joins chunks into one body (empty → empty)', () => {
    expect(joinChunks([A, B])).toEqual(new Uint8Array([1, 2, 3]));
    expect(joinChunks([])).toEqual(new Uint8Array(0));
    expect(chunksOf(null)).toEqual([]);
  });
});

// ── Guarantees over every sequence ─────────────────────────────────────

const ALPHABET: readonly StreamEvent[] = Object.values(ev);

/** The guarantees one event sequence must satisfy. */
function checkGuarantees(events: readonly StreamEvent[]): void {
  let state: StreamState = OPENING_STREAM;
  let ends = 0;
  let started = false;
  let errored = false;
  let eligibleFacts = false;
  let received: Uint8Array[] = [];
  let written: Uint8Array[] = [];
  let servedRewritten = false;
  let lastAsk: Uint8Array | null = null;
  for (const event of events) {
    if (event.type === 'start' || event.type === 'data' || event.type === 'stop') started = true;
    if (event.type === 'facts') eligibleFacts = event.facts.contentType === HTML.contentType;
    const wasDone = state.phase === 'done';
    const wasRewriting = state.phase === 'rewriting';
    if (event.type === 'data' && !wasDone && state.phase !== 'awaiting-facts' && !wasRewriting) {
      received = [...received, event.chunk];
    }
    if (event.type === 'error' && !wasDone) errored = true;
    const next = streamTransition(state, event);
    if (wasDone) expect(next.effects).toEqual([]);
    // Nothing is written after the end.
    const endAt = next.effects.findIndex((effect) => effect.type === 'end');
    if (endAt !== -1) {
      expect(next.effects.slice(endAt).some((effect) => effect.type === 'write')).toBe(false);
    }
    for (const effect of next.effects) {
      if (effect.type === 'write' || effect.type === 'end') expect(started).toBe(true);
      if (effect.type === 'write') written = [...written, ...effect.chunks];
      if (effect.type === 'end') ends += 1;
      if (effect.type === 'report-unavailable') expect(eligibleFacts).toBe(true);
      if (effect.type === 'ask-rewrite') {
        expect(eligibleFacts).toBe(true);
        lastAsk = effect.body;
      }
    }
    if (wasRewriting && event.type === 'rewritten' && event.body !== null) servedRewritten = true;
    state = next.state;
    if (state.phase === 'buffering')
      expect(state.bytes).toBeLessThanOrEqual(DOCUMENT_BODY_BYTE_LIMIT);
  }
  expect(ends).toBeLessThanOrEqual(1);
  if (state.phase === 'done' && !errored) expect(ends).toBe(1);
  if (ends === 1 && !servedRewritten) expect(written).toEqual(received);
  if (servedRewritten) expect(written).toEqual([REWRITTEN]);
  if (lastAsk !== null) expect(lastAsk).toEqual(joinChunks(received));
}

describe('stream machine — guarantees over every event sequence', () => {
  it('holds for every sequence up to length 4', () => {
    const sequences: StreamEvent[][] = [[]];
    let count = 0;
    for (let length = 0; length < 4; length++) {
      const frontier = sequences.splice(0);
      for (const prefix of frontier) {
        for (const event of ALPHABET) {
          const sequence = [...prefix, event];
          checkGuarantees(sequence);
          count += 1;
          sequences.push(sequence);
        }
      }
    }
    expect(count).toBe(13 + 13 ** 2 + 13 ** 3 + 13 ** 4);
  });

  it('holds for long seeded random sequences', () => {
    let seed = 0x5eed;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 3_000; i++) {
      const length = 6 + (next() % 20);
      const events = Array.from(
        { length },
        () => ALPHABET[next() % ALPHABET.length] as StreamEvent
      );
      checkGuarantees(events);
    }
  });
});
