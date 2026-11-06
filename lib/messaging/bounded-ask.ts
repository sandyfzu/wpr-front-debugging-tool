/**
 * A request/response ask with a deadline and typed outcomes: the sender-side
 * branch point between an answer, the expected misses (nothing listening,
 * no answer in time, a malformed answer) and a real failure — so a surface
 * renders each as its own state instead of catching one opaque rejection.
 * Transport-agnostic: the send and the answer guard are injected.
 */
import type { Logger } from '../logger';
import { isNoReceiverError } from './no-receiver';

/**
 * How one ask ended.
 *
 * - `reply` — the receiver answered and the answer passed the guard.
 * - `no-receiver` — nothing listens yet (see `./no-receiver`).
 * - `timeout` — no settlement within the deadline (a late one is ignored).
 * - `invalid-reply` — an answer arrived but failed the guard.
 * - `failed` — the send rejected for a real reason; the caller logs `cause`.
 */
export type AskOutcome<T> =
  | { readonly kind: 'reply'; readonly reply: T }
  | { readonly kind: 'no-receiver' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'invalid-reply' }
  | { readonly kind: 'failed'; readonly cause: unknown };

/** An ask that got no usable answer. */
export type AskMiss = Exclude<AskOutcome<unknown>['kind'], 'reply'>;

/**
 * Log an ask miss: a real send failure loudly (with its cause), the expected
 * misses quietly.
 *
 * @param log The asking module's logger.
 * @param ask What was asked, for the message (e.g. "Beacon test").
 * @param outcome The miss.
 */
export function logAskMiss(
  log: Logger,
  ask: string,
  outcome: Exclude<AskOutcome<unknown>, { kind: 'reply' }>
): void {
  if (outcome.kind === 'failed') {
    log.warn(
      `${ask} failed`,
      outcome.cause instanceof Error ? outcome.cause.message : outcome.cause
    );
  } else {
    log.debug(`${ask} got no answer: ${outcome.kind}`);
  }
}

/** Arms a one-shot timer; returns its cancel. */
export type ScheduleTimer = (run: () => void, ms: number) => () => void;

/** The platform timer behind {@link ScheduleTimer} (the default every timer seam falls back to). */
export const scheduleWithTimeout: ScheduleTimer = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => {
    clearTimeout(handle);
  };
};

/** Whether a value can be awaited as a promise (has a callable `then`). */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Inputs of {@link boundedAsk}. */
export interface BoundedAskOptions<T> {
  /** Performs the send (e.g. `() => sendMessage('row', data)`). */
  readonly send: () => Promise<unknown>;
  /** The answer guard: the typed answer, or null to reject it. */
  readonly parse: (answer: unknown) => T | null;
  /** The deadline, in ms (a positive finite number). */
  readonly timeoutMs: number;
  /** Timer seam for tests; defaults to `setTimeout`. */
  readonly schedule?: ScheduleTimer;
}

/**
 * Ask once and classify the outcome; never rejects — a send that throws
 * synchronously or returns a non-thenable is `failed`, and a deadline that
 * expires before the send starts (a synchronous timer seam) skips it.
 *
 * @param options The send, the answer guard, the deadline, the timer seam.
 * @returns The typed outcome (see {@link AskOutcome}).
 * @throws {@link RangeError} when `timeoutMs` is not a positive finite
 *   number — a broken caller, not a send outcome.
 */
export function boundedAsk<T>(options: BoundedAskOptions<T>): Promise<AskOutcome<T>> {
  const { send, parse, timeoutMs, schedule = scheduleWithTimeout } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      `boundedAsk: timeoutMs must be a positive finite number, got ${String(timeoutMs)}`
    );
  }
  return new Promise((resolve) => {
    let settled = false;
    // Assigned right below; a timer seam that fires synchronously still
    // finds a callable cancel.
    let cancel = (): void => undefined;
    /** Resolve once; later settlements (a late answer after the deadline) are dropped. */
    const settle = (outcome: AskOutcome<T>): void => {
      if (settled) return;
      settled = true;
      cancel();
      resolve(outcome);
    };
    /** Classify a send failure: the expected miss, or a real one. */
    const fail = (cause: unknown): void => {
      settle(isNoReceiverError(cause) ? { kind: 'no-receiver' } : { kind: 'failed', cause });
    };
    cancel = schedule(() => {
      settle({ kind: 'timeout' });
    }, timeoutMs);
    // A timer seam that fired synchronously already ended the ask: never send.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `schedule` may have run `settle` synchronously; flow analysis cannot see the closure write
    if (settled) return;
    let sending: unknown;
    try {
      sending = send();
    } catch (cause) {
      // A synchronous throw is a send that failed before leaving: same arms.
      fail(cause);
      return;
    }
    if (!isThenable(sending)) {
      settle({
        kind: 'failed',
        cause: new TypeError(`boundedAsk: send() returned a non-thenable: ${typeof sending}`)
      });
      return;
    }
    // `Promise.resolve` adopts any thenable (a foreign one included).
    void Promise.resolve(sending).then((answer) => {
      // Guards return null rather than throw; a throwing one is a real failure.
      let reply: T | null;
      try {
        reply = parse(answer);
      } catch (cause) {
        settle({ kind: 'failed', cause });
        return;
      }
      settle(reply === null ? { kind: 'invalid-reply' } : { kind: 'reply', reply });
    }, fail);
  });
}
