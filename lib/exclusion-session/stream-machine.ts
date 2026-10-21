/**
 * The lifecycle of one streamed top-level response under a response-body
 * filter (a stream the browser hands over chunk by chunk, that must be
 * written and ended by its owner) — pure: a state and an event in, the next
 * state and the effects to perform out. The streaming backend owns the I/O
 * (the filter, the host calls, the timer) and feeds every event of a stream
 * through {@link streamTransition}.
 *
 * Guarantees, by construction (pinned exhaustively by tests):
 * - **Ended exactly once.** Every path to `done` other than the filter's own
 *   error emits exactly one `end` effect (`close` once the body is complete,
 *   `disconnect` mid-stream — the rest then flows natively); a filter error
 *   ends it without one (the filter is dead). Nothing is emitted from `done`.
 * - **Never lost.** Whenever the stream is not served rewritten, every
 *   buffered byte is written through, in order, before the end.
 * - **Bounded.** At most {@link DOCUMENT_BODY_BYTE_LIMIT} bytes are held; past
 *   it the stream passes through.
 * - **Ineligible ⇒ unrecorded.** Only an eligible response
 *   ({@link isRewritableResponse}) is ever asked to be rewritten or reported
 *   unreadable; a response of unknown eligibility is never reported.
 * - **Nothing before start.** A filter accepts writes and ends only once it
 *   started (verified: Firefox throws on `disconnect` before `onstart`), so a
 *   decision taken earlier is deferred to the start.
 *
 * ```
 * opening ──start──▶ buffering ──stop (facts eligible)──▶ rewriting ──rewritten | deadline──▶ done
 *    │                  │  └──stop (facts unknown)──▶ awaiting-facts ──facts eligible──▶ rewriting
 *    │                  └──ineligible | gate denied | abort | overflow──▶ done (written through)
 *    └──(passing) start──▶ done (disconnected)          any ──error──▶ done (no end: the filter is dead)
 * ```
 */
import {
  DOCUMENT_BODY_BYTE_LIMIT,
  isRewritableResponse,
  type InterceptedResponseFacts
} from './document-transform';

/**
 * The body received so far, newest chunk first — a persistent list, so
 * appending a chunk is O(1) and a state is never mutated.
 */
export interface ChunkList {
  readonly chunk: Uint8Array;
  readonly previous: ChunkList | null;
}

/** The chunks of a list in arrival order. */
export function chunksOf(list: ChunkList | null): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let node = list; node !== null; node = node.previous) chunks.push(node.chunk);
  return chunks.reverse();
}

/** The response facts once known, with their eligibility. */
interface KnownFacts {
  readonly facts: InterceptedResponseFacts;
  readonly eligible: boolean;
}

/** Before the filter started: decisions are recorded, applied at start. */
export interface OpeningStream {
  readonly phase: 'opening';
  readonly facts: KnownFacts | null;
  /** Decided to pass the stream through untouched (applied at start). */
  readonly passing: boolean;
}

/** Started, collecting the body. */
export interface BufferingStream {
  readonly phase: 'buffering';
  readonly facts: KnownFacts | null;
  readonly chunks: ChunkList | null;
  readonly bytes: number;
}

/** The body is complete but the response facts have not arrived yet. */
export interface AwaitingFactsStream {
  readonly phase: 'awaiting-facts';
  readonly chunks: ChunkList | null;
}

/** The complete body is with the host (the release deadline runs). */
export interface RewritingStream {
  readonly phase: 'rewriting';
  readonly chunks: ChunkList | null;
}

/** Ended (closed, disconnected, or failed) — every event is ignored. */
export interface DoneStream {
  readonly phase: 'done';
}

/** A stream's machine state. */
export type StreamState =
  OpeningStream | BufferingStream | AwaitingFactsStream | RewritingStream | DoneStream;

/** What can happen to a stream. */
export type StreamEvent =
  /** The filter started (it now accepts writes and an end). */
  | { readonly type: 'start' }
  /** One body chunk arrived. */
  | { readonly type: 'data'; readonly chunk: Uint8Array }
  /** The body is complete. */
  | { readonly type: 'stop' }
  /** The filter failed (it is dead: no write, no end). */
  | { readonly type: 'error' }
  /** The response's status, method and content type arrived. */
  | { readonly type: 'facts'; readonly facts: InterceptedResponseFacts }
  /** The host answered whether the tab's session wants this document. */
  | { readonly type: 'gate'; readonly allowed: boolean }
  /** The host answered the rewrite: bytes to serve, or null for the original. */
  | { readonly type: 'rewritten'; readonly body: Uint8Array | null }
  /** The armed deadline passed. */
  | { readonly type: 'deadline' }
  /** The stream's interception was withdrawn (disarm, re-arm, tab close, redirect). */
  | { readonly type: 'abort' };

/** Which wait a deadline bounds. */
export type StreamDeadline = 'facts' | 'release';

/** What the backend performs, in order. */
export type StreamEffect =
  /** Write these chunks to the filter, in order. */
  | { readonly type: 'write'; readonly chunks: readonly Uint8Array[] }
  /** End the filter — exactly once per stream. */
  | { readonly type: 'end'; readonly how: 'close' | 'disconnect' }
  /** Ask the host whether the tab's session wants this document (answer: `gate`). */
  | { readonly type: 'ask-gate' }
  /** Hand the complete body to the host (answer: `rewritten`). */
  | {
      readonly type: 'ask-rewrite';
      readonly body: Uint8Array;
      readonly facts: InterceptedResponseFacts;
    }
  /** Report the eligible body unreadable (overflow or filter failure). */
  | { readonly type: 'report-unavailable' }
  /** (Re)arm the stream's one deadline (replacing any armed one). */
  | { readonly type: 'arm-deadline'; readonly wait: StreamDeadline };

/** A transition's result. */
export interface StreamTransition {
  readonly state: StreamState;
  readonly effects: readonly StreamEffect[];
}

/** A fresh stream (just attached, not started). */
export const OPENING_STREAM: OpeningStream = { phase: 'opening', facts: null, passing: false };

const DONE: DoneStream = { phase: 'done' };

/** The state unchanged, nothing to do. */
const ignore = (state: StreamState): StreamTransition => ({ state, effects: [] });

/** Write the original chunks through and end the filter. */
function passThrough(
  list: ChunkList | null,
  how: 'close' | 'disconnect',
  extra: readonly StreamEffect[] = []
): StreamTransition {
  const write: StreamEffect[] = list === null ? [] : [{ type: 'write', chunks: chunksOf(list) }];
  return { state: DONE, effects: [...write, { type: 'end', how }, ...extra] };
}

/** The chunks joined into one body. */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

/** The facts with their eligibility. */
function knownFacts(facts: InterceptedResponseFacts): KnownFacts {
  return { facts, eligible: isRewritableResponse(facts) };
}

/** Hand the complete body over for rewriting, under the release deadline. */
function startRewrite(chunks: ChunkList | null, facts: KnownFacts): StreamTransition {
  return {
    state: { phase: 'rewriting', chunks },
    effects: [
      { type: 'ask-rewrite', body: joinChunks(chunksOf(chunks)), facts: facts.facts },
      { type: 'arm-deadline', wait: 'release' }
    ]
  };
}

/** `opening`: record decisions; apply them at start. */
function fromOpening(state: OpeningStream, event: StreamEvent): StreamTransition {
  switch (event.type) {
    case 'start':
      return state.passing
        ? passThrough(null, 'disconnect')
        : {
            state: { phase: 'buffering', facts: state.facts, chunks: null, bytes: 0 },
            effects: []
          };
    case 'data':
    case 'stop': {
      // A body event implies the start (defensive: the start precedes data).
      if (!state.passing) {
        const buffering: BufferingStream = {
          phase: 'buffering',
          facts: state.facts,
          chunks: null,
          bytes: 0
        };
        return streamTransition(buffering, event);
      }
      return event.type === 'data'
        ? passThrough({ chunk: event.chunk, previous: null }, 'disconnect')
        : passThrough(null, 'close');
    }
    case 'facts': {
      const facts = knownFacts(event.facts);
      return {
        state: { ...state, facts, passing: state.passing || !facts.eligible },
        effects: facts.eligible && !state.passing ? [{ type: 'ask-gate' }] : []
      };
    }
    case 'gate':
      return event.allowed ? ignore(state) : ignore({ ...state, passing: true });
    case 'abort':
      return ignore({ ...state, passing: true });
    case 'error':
      return {
        state: DONE,
        effects: state.facts?.eligible === true && !state.passing ? [unavailable()] : []
      };
    case 'rewritten':
    case 'deadline':
      return ignore(state);
  }
}

/** The unreadable-body report. */
function unavailable(): StreamEffect {
  return { type: 'report-unavailable' };
}

/** `buffering`: collect within the bound; decide at the facts and at stop. */
function fromBuffering(state: BufferingStream, event: StreamEvent): StreamTransition {
  switch (event.type) {
    case 'data': {
      const chunks: ChunkList = { chunk: event.chunk, previous: state.chunks };
      const bytes = state.bytes + event.chunk.length;
      if (bytes <= DOCUMENT_BODY_BYTE_LIMIT) return ignore({ ...state, chunks, bytes });
      return passThrough(
        chunks,
        'disconnect',
        state.facts?.eligible === true ? [unavailable()] : []
      );
    }
    case 'stop':
      return state.facts === null
        ? {
            state: { phase: 'awaiting-facts', chunks: state.chunks },
            effects: [{ type: 'arm-deadline', wait: 'facts' }]
          }
        : startRewrite(state.chunks, state.facts);
    case 'facts': {
      const facts = knownFacts(event.facts);
      return facts.eligible
        ? { state: { ...state, facts }, effects: [{ type: 'ask-gate' }] }
        : passThrough(state.chunks, 'disconnect');
    }
    case 'gate':
      return event.allowed ? ignore(state) : passThrough(state.chunks, 'disconnect');
    case 'abort':
      return passThrough(state.chunks, 'disconnect');
    case 'error':
      return { state: DONE, effects: state.facts?.eligible === true ? [unavailable()] : [] };
    case 'start':
    case 'rewritten':
    case 'deadline':
      return ignore(state);
  }
}

/** `awaiting-facts`: the body is complete; the facts decide (bounded wait). */
function fromAwaitingFacts(state: AwaitingFactsStream, event: StreamEvent): StreamTransition {
  switch (event.type) {
    case 'facts': {
      const facts = knownFacts(event.facts);
      return facts.eligible
        ? startRewrite(state.chunks, facts)
        : passThrough(state.chunks, 'close');
    }
    case 'gate':
      return event.allowed ? ignore(state) : passThrough(state.chunks, 'close');
    case 'deadline':
    case 'abort':
      return passThrough(state.chunks, 'close');
    case 'error':
      // Eligibility unknown: never reported.
      return ignore(DONE);
    case 'start':
    case 'data':
    case 'stop':
    case 'rewritten':
      return ignore(state);
  }
}

/** `rewriting`: serve the host's answer, or the original at the deadline/abort. */
function fromRewriting(state: RewritingStream, event: StreamEvent): StreamTransition {
  switch (event.type) {
    case 'rewritten':
      return passThrough(
        event.body === null ? state.chunks : { chunk: event.body, previous: null },
        'close'
      );
    case 'deadline':
    case 'abort':
      return passThrough(state.chunks, 'close');
    case 'error':
      return ignore(DONE);
    case 'start':
    case 'data':
    case 'stop':
    case 'facts':
    case 'gate':
      return ignore(state);
  }
}

/**
 * The next state and effects of a stream.
 *
 * @param state The stream's current state.
 * @param event What happened.
 */
export function streamTransition(state: StreamState, event: StreamEvent): StreamTransition {
  switch (state.phase) {
    case 'opening':
      return fromOpening(state, event);
    case 'buffering':
      return fromBuffering(state, event);
    case 'awaiting-facts':
      return fromAwaitingFacts(state, event);
    case 'rewriting':
      return fromRewriting(state, event);
    case 'done':
      return ignore(state);
  }
}
