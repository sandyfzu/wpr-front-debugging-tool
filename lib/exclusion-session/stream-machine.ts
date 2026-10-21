/**
 * The lifecycle of one streamed top-level response under a response-body
 * filter (a stream the browser hands over chunk by chunk, that must be
 * written and ended by its owner) — pure: a state and an event in, the next
 * state and the effects to perform out. The streaming backend owns the I/O
 * (the filter, the host calls, the timers) and feeds every event of a stream
 * through {@link streamTransition}.
 *
 * Guarantees, by construction (pinned exhaustively by tests):
 * - **Ended exactly once.** Every path to `done` other than the filter's own
 *   error emits exactly one `end` effect (`close` once the body is complete,
 *   `disconnect` mid-stream — the rest then flows natively); a filter error
 *   ends it without one (the filter is dead). Nothing is emitted from `done`.
 * - **Never lost.** Whenever the stream is not served rewritten, every
 *   buffered byte is written through, in order, before the end.
 * - **Withdrawn ⇒ never rewritten.** A withdrawal (abort, a denied gate, a
 *   network failure) latches before the body starts and ends the stream
 *   unmodified once it has.
 * - **Latest final facts decide.** Response facts are last-write-wins and
 *   only a final status decides: a conditional request reports `304` and
 *   then the cached `200`, so a 1xx/3xx never decides on a request whose
 *   filter is still open.
 * - **Complete bodies only.** A truncated transfer still ends the filter
 *   normally, so the body is rewritten only once the request itself
 *   completed (`completed`, before or after the body's end); a network
 *   failure (`failed`) serves it unmodified and reports it. If neither
 *   arrives within the settle wait, the body is trusted (bounded fallback).
 * - **Bounded.** At most {@link DOCUMENT_BODY_BYTE_LIMIT} bytes are held.
 * - **Ineligible ⇒ unrecorded.** Only an eligible response
 *   ({@link isRewritableResponse}) is ever asked to be rewritten or reported
 *   unreadable; a response of unknown eligibility is never reported.
 * - **Nothing before start.** A filter accepts writes and ends only once it
 *   started (Firefox throws on `disconnect` before `onstart`), so a decision
 *   taken earlier is applied at the start.
 *
 * ```
 * opening ─start─▶ buffering ─stop─▶ settling ─completed | settle─┬─ eligible ─▶ rewriting ─rewritten | release─▶ done
 *    │                │  └─stop (completed already)─▶ (decided)  └─ undecided ─▶ awaiting-facts ─final facts─▶ rewriting
 *    │                └─ ineligible | denied | abort | failed | overflow ─▶ done (written through)
 *    └─ (withdrawn or ineligible) start ─▶ done (disconnected)   any ─error─▶ done (no end: the filter is dead)
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

/** Why a stream that had not started yet was withdrawn (latched: the first wins). */
export type StreamWithdrawal = 'abort' | 'gate-denied' | 'failed';

/** Before the filter started: facts and withdrawals are recorded, applied at start. */
export interface OpeningStream {
  readonly phase: 'opening';
  /** The latest response facts (any status), or null. */
  readonly facts: InterceptedResponseFacts | null;
  readonly withdrawn: StreamWithdrawal | null;
  /** The request already completed on the network. */
  readonly completed: boolean;
}

/** Started, collecting the body. */
export interface BufferingStream {
  readonly phase: 'buffering';
  readonly facts: InterceptedResponseFacts | null;
  readonly chunks: ChunkList | null;
  readonly bytes: number;
  /** The request already completed on the network. */
  readonly completed: boolean;
}

/** The body ended; it waits (bounded) for the request to complete on the network. */
export interface SettlingStream {
  readonly phase: 'settling';
  readonly facts: InterceptedResponseFacts | null;
  readonly chunks: ChunkList | null;
}

/** The body is complete but no final response facts have arrived yet. */
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
  | OpeningStream
  | BufferingStream
  | SettlingStream
  | AwaitingFactsStream
  | RewritingStream
  | DoneStream;

/** Which wait a timer bounds: the completion wait, the late-facts wait, the release deadline. */
export type StreamWait = 'settle' | 'facts' | 'release';

/** What can happen to a stream. */
export type StreamEvent =
  /** The filter started (it now accepts writes and an end). */
  | { readonly type: 'start' }
  /** One body chunk arrived. */
  | { readonly type: 'data'; readonly chunk: Uint8Array }
  /** The filter reported the body's end. */
  | { readonly type: 'stop' }
  /** The filter failed (it is dead: no write, no end). */
  | { readonly type: 'error' }
  /** The request failed on the network (a truncated transfer, an aborted load). */
  | { readonly type: 'failed' }
  /** The request completed on the network (its body is whole). */
  | { readonly type: 'completed' }
  /** Response facts arrived (several may: `304`, then the cached `200`). */
  | { readonly type: 'facts'; readonly facts: InterceptedResponseFacts }
  /** The host answered whether the tab's session wants this document. */
  | { readonly type: 'gate'; readonly allowed: boolean }
  /** The host answered the rewrite: bytes to serve, or null for the original. */
  | { readonly type: 'rewritten'; readonly body: Uint8Array | null }
  /** The timer armed for `wait` fired (a stale wait is ignored). */
  | { readonly type: 'timer'; readonly wait: StreamWait }
  /** The stream's interception was withdrawn (disarm, re-arm, tab close, redirect). */
  | { readonly type: 'abort' };

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
  /** Report the eligible body unreadable (overflow, failure). */
  | { readonly type: 'report-unavailable' }
  /** (Re)arm the stream's one timer (replacing any armed one). */
  | { readonly type: 'arm-timer'; readonly wait: StreamWait };

/** A transition's result. */
export interface StreamTransition {
  readonly state: StreamState;
  readonly effects: readonly StreamEffect[];
}

/** A fresh stream (just attached, not started). */
export const OPENING_STREAM: OpeningStream = {
  phase: 'opening',
  facts: null,
  withdrawn: null,
  completed: false
};

/** The one terminal state (shared: it carries nothing). */
const DONE: DoneStream = { phase: 'done' };

/** The unreadable-body report. */
const UNAVAILABLE: StreamEffect = { type: 'report-unavailable' };

/** The state unchanged, nothing to do. */
const ignore = (state: StreamState): StreamTransition => ({ state, effects: [] });

/**
 * Whether facts carry a final status: a 1xx is interim, and a 3xx on a
 * request whose filter is still open is a revalidation (`304`, followed by
 * the cached response) or a redirect (followed by a new request).
 *
 * @param facts The response facts.
 */
export function isFinalStatus(facts: InterceptedResponseFacts): boolean {
  const interim = facts.status >= 100 && facts.status <= 199;
  const redirection = facts.status >= 300 && facts.status <= 399;
  return !interim && !redirection;
}

/** How the latest facts decide. */
type Verdict = 'eligible' | 'ineligible' | 'undecided';

/** The verdict of the latest facts (no facts or a non-final status: undecided). */
function verdictOf(facts: InterceptedResponseFacts | null): Verdict {
  if (facts === null || !isFinalStatus(facts)) return 'undecided';
  return isRewritableResponse(facts) ? 'eligible' : 'ineligible';
}

/** The unreadable report, only for an eligible response. */
function reportIfEligible(facts: InterceptedResponseFacts | null): StreamEffect[] {
  return verdictOf(facts) === 'eligible' ? [UNAVAILABLE] : [];
}

/** The gate ask, only for eligible facts. */
function gateFor(facts: InterceptedResponseFacts): StreamEffect[] {
  return verdictOf(facts) === 'eligible' ? [{ type: 'ask-gate' }] : [];
}

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

/** Decide a complete, settled body from its latest facts. */
function decideComplete(
  chunks: ChunkList | null,
  facts: InterceptedResponseFacts | null
): StreamTransition {
  if (facts !== null && verdictOf(facts) === 'eligible') {
    return {
      state: { phase: 'rewriting', chunks },
      effects: [
        { type: 'ask-rewrite', body: joinChunks(chunksOf(chunks)), facts },
        { type: 'arm-timer', wait: 'release' }
      ]
    };
  }
  if (verdictOf(facts) === 'ineligible') return passThrough(chunks, 'close');
  return {
    state: { phase: 'awaiting-facts', chunks },
    effects: [{ type: 'arm-timer', wait: 'facts' }]
  };
}

/** `opening`: facts recorded (latest wins), withdrawals latched (first wins); applied at start. */
function fromOpening(state: OpeningStream, event: StreamEvent): StreamTransition {
  const withdraw = (why: StreamWithdrawal, effects: StreamEffect[] = []): StreamTransition =>
    state.withdrawn === null ? { state: { ...state, withdrawn: why }, effects } : ignore(state);
  const passesAtStart = state.withdrawn !== null || verdictOf(state.facts) === 'ineligible';
  switch (event.type) {
    case 'start':
      return passesAtStart
        ? passThrough(null, 'disconnect')
        : {
            state: {
              phase: 'buffering',
              facts: state.facts,
              chunks: null,
              bytes: 0,
              completed: state.completed
            },
            effects: []
          };
    case 'data':
    case 'stop': {
      // A body event implies the start (defensive: the start precedes data).
      if (passesAtStart) {
        return event.type === 'data'
          ? passThrough({ chunk: event.chunk, previous: null }, 'disconnect')
          : passThrough(null, 'close');
      }
      const buffering: BufferingStream = {
        phase: 'buffering',
        facts: state.facts,
        chunks: null,
        bytes: 0,
        completed: state.completed
      };
      return streamTransition(buffering, event);
    }
    case 'facts':
      return {
        state: { ...state, facts: event.facts },
        effects: state.withdrawn === null ? gateFor(event.facts) : []
      };
    case 'gate':
      return event.allowed ? ignore(state) : withdraw('gate-denied');
    case 'abort':
      return withdraw('abort');
    case 'failed':
      return withdraw('failed', reportIfEligible(state.facts));
    case 'error':
      return {
        state: DONE,
        effects: state.withdrawn === null ? reportIfEligible(state.facts) : []
      };
    case 'completed':
      return ignore({ ...state, completed: true });
    case 'rewritten':
    case 'timer':
      return ignore(state);
  }
}

/** `buffering`: collect within the bound; final facts may still arrive. */
function fromBuffering(state: BufferingStream, event: StreamEvent): StreamTransition {
  switch (event.type) {
    case 'data': {
      const chunks: ChunkList = { chunk: event.chunk, previous: state.chunks };
      const bytes = state.bytes + event.chunk.length;
      if (bytes <= DOCUMENT_BODY_BYTE_LIMIT) return ignore({ ...state, chunks, bytes });
      return passThrough(chunks, 'disconnect', reportIfEligible(state.facts));
    }
    case 'stop':
      return state.completed
        ? decideComplete(state.chunks, state.facts)
        : {
            state: { phase: 'settling', facts: state.facts, chunks: state.chunks },
            effects: [{ type: 'arm-timer', wait: 'settle' }]
          };
    case 'completed':
      return ignore({ ...state, completed: true });
    case 'facts':
      if (!isFinalStatus(event.facts)) return ignore(state);
      return verdictOf(event.facts) === 'ineligible'
        ? passThrough(state.chunks, 'disconnect')
        : { state: { ...state, facts: event.facts }, effects: gateFor(event.facts) };
    case 'gate':
      return event.allowed ? ignore(state) : passThrough(state.chunks, 'disconnect');
    case 'abort':
      return passThrough(state.chunks, 'disconnect');
    case 'failed':
      return passThrough(state.chunks, 'disconnect', reportIfEligible(state.facts));
    case 'error':
      return { state: DONE, effects: reportIfEligible(state.facts) };
    case 'start':
    case 'rewritten':
    case 'timer':
      return ignore(state);
  }
}

/** `settling`: the body ended; the request's completion (or failure) decides it. */
function fromSettling(state: SettlingStream, event: StreamEvent): StreamTransition {
  switch (event.type) {
    case 'completed':
      return decideComplete(state.chunks, state.facts);
    case 'timer':
      // The completion signal never came: trust the body (bounded fallback).
      return event.wait === 'settle' ? decideComplete(state.chunks, state.facts) : ignore(state);
    case 'facts':
      return isFinalStatus(event.facts) ? ignore({ ...state, facts: event.facts }) : ignore(state);
    case 'gate':
      return event.allowed ? ignore(state) : passThrough(state.chunks, 'close');
    case 'abort':
      return passThrough(state.chunks, 'close');
    case 'failed':
      return passThrough(state.chunks, 'close', reportIfEligible(state.facts));
    case 'error':
      return { state: DONE, effects: reportIfEligible(state.facts) };
    case 'start':
    case 'data':
    case 'stop':
    case 'rewritten':
      return ignore(state);
  }
}

/** `awaiting-facts`: the body is complete; the first final facts decide (bounded wait). */
function fromAwaitingFacts(state: AwaitingFactsStream, event: StreamEvent): StreamTransition {
  switch (event.type) {
    case 'facts':
      return isFinalStatus(event.facts) ? decideComplete(state.chunks, event.facts) : ignore(state);
    case 'gate':
      return event.allowed ? ignore(state) : passThrough(state.chunks, 'close');
    case 'timer':
      return event.wait === 'facts' ? passThrough(state.chunks, 'close') : ignore(state);
    case 'abort':
    case 'failed':
      // Eligibility unknown: never reported.
      return passThrough(state.chunks, 'close');
    case 'error':
      return ignore(DONE);
    case 'start':
    case 'data':
    case 'stop':
    case 'completed':
    case 'rewritten':
      return ignore(state);
  }
}

/** `rewriting`: serve the host's answer, or the original at the deadline/withdrawal/failure. */
function fromRewriting(state: RewritingStream, event: StreamEvent): StreamTransition {
  switch (event.type) {
    case 'rewritten':
      return passThrough(
        event.body === null ? state.chunks : { chunk: event.body, previous: null },
        'close'
      );
    case 'timer':
      return event.wait === 'release' ? passThrough(state.chunks, 'close') : ignore(state);
    case 'abort':
      return passThrough(state.chunks, 'close');
    case 'failed':
      // Only eligible bodies reach this phase: the failure is reported.
      return passThrough(state.chunks, 'close', [UNAVAILABLE]);
    case 'error':
      return { state: DONE, effects: [UNAVAILABLE] };
    case 'start':
    case 'data':
    case 'stop':
    case 'completed':
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
    case 'settling':
      return fromSettling(state, event);
    case 'awaiting-facts':
      return fromAwaitingFacts(state, event);
    case 'rewriting':
      return fromRewriting(state, event);
    case 'done':
      return ignore(state);
  }
}
