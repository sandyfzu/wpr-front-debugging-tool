/**
 * One panel ask as a small machine, for tool pages that ask the inspected
 * page and show its answer: `idle` → `pending` → `shown{outcome, page}`.
 * Asking again keeps the shown answer on screen while pending (a refresh
 * never blanks the view); one ask at a time; an ask that throws is logged
 * and shown as the caller's failure outcome. A failed ask never replaces a
 * good answer: the good one stays shown and the failure is kept beside it
 * (`failure`) until the next good answer. Answers belong to the page load
 * they measured: once it reloads or navigates (a new payload identity) they
 * read as stale.
 */
import { batch, createComputed, createMemo, createSignal, type Accessor } from 'solid-js';
import type { Logger } from '../../../lib/logger';
import { isOtherLoad, settleStamp, stampAsk, type LoadStamp } from '../state/page-identity';

/** An answer on screen. */
export interface ShownAnswer<O> {
  readonly outcome: O;
  /** The page load it measured (payload identity; null when unknown or not yet settled). */
  readonly page: string | null;
  /** Asked mid-refetch: `page` becomes the load the shell settles on. */
  readonly provisional: boolean;
  /** Names this answer (a newer one gets a higher number). */
  readonly sequence: number;
}

/** One ask's state. */
export interface AskRunState<O> {
  /** An ask is on its way. */
  readonly pending: boolean;
  /**
   * The latest good answer, kept while a newer ask is pending and when a
   * newer one failed; a failure only while no good answer exists; null
   * before the first.
   */
  readonly shown: ShownAnswer<O> | null;
  /** A failed ask newer than the shown good answer (null when none). */
  readonly failure: ShownAnswer<O> | null;
}

/** One ask's machine. */
export interface AskRun<O> {
  readonly state: Accessor<AskRunState<O>>;
  /** The shown answer measured an earlier page load. */
  readonly stale: Accessor<boolean>;
  /** Ask (ignored while one is pending). */
  readonly start: () => Promise<void>;
  /** Stop recording answers (the session's owner is gone). */
  readonly dispose: () => void;
}

/** The outcome an ask that threw is shown as. */
export const ASK_THREW = { kind: 'page-unreachable', miss: 'failed' } as const;

/**
 * Whether an outcome is a page ask that went unanswered (the failure shape
 * every tool's outcome shares with {@link ASK_THREW}).
 *
 * @param outcome A tool's outcome.
 * @returns True for `page-unreachable`.
 */
export function isPageUnreachable(outcome: { readonly kind: string }): boolean {
  return outcome.kind === ASK_THREW.kind;
}

/** What an ask machine needs. */
export interface AskRunDeps<O> {
  /** The ask (expected to never reject; a rejection is logged and shown as {@link ASK_THREW}). */
  readonly ask: () => Promise<O>;
  readonly threw: O;
  /** Whether an outcome is a failure (kept beside a good answer, never replacing it). */
  readonly isFailure: (outcome: O) => boolean;
  readonly pageId: Accessor<string | null>;
  /** Whether `pageId` is current (no shell refetch in flight). */
  readonly pageSettled: Accessor<boolean>;
  readonly log: Logger;
  /** Names the ask in the log. */
  readonly label: string;
}

/**
 * Settle an answer's provisional stamp.
 *
 * @param answer The answer (or null).
 * @param id The shell's identity now.
 * @param settled Whether it is current.
 * @returns The same answer when nothing changes, else a re-stamped copy.
 */
function settleAnswer<O>(
  answer: ShownAnswer<O> | null,
  id: string | null,
  settled: boolean
): ShownAnswer<O> | null {
  if (answer === null || !answer.provisional) return answer;
  const stamp = settleStamp(answer, id, settled);
  return stamp === answer ? answer : { ...answer, ...stamp };
}

/**
 * Create one ask machine (call inside a reactive root).
 *
 * @param deps See {@link AskRunDeps}.
 */
export function createAskRun<O>(deps: AskRunDeps<O>): AskRun<O> {
  const [pending, setPending] = createSignal(false);
  const [shown, setShown] = createSignal<ShownAnswer<O> | null>(null);
  const [failure, setFailure] = createSignal<ShownAnswer<O> | null>(null);
  let sequence = 0;
  let disposed = false;

  const state = createMemo((): AskRunState<O> => ({
    pending: pending(),
    shown: shown(),
    failure: failure()
  }));
  const stale = createMemo((): boolean => {
    const answer = shown();
    return answer !== null && isOtherLoad(answer.page, deps.pageId());
  });

  // A provisional answer takes the load the shell settles on.
  createComputed(() => {
    const id = deps.pageId();
    const settled = deps.pageSettled();
    if (!settled) return;
    batch(() => {
      setShown((answer) => settleAnswer(answer, id, settled));
      setFailure((answer) => settleAnswer(answer, id, settled));
    });
  });

  /**
   * Record an answer: a good one replaces everything; a failure sits beside
   * a good answer, or is shown while none exists.
   *
   * @param answer The new answer.
   */
  const record = (answer: ShownAnswer<O>): void => {
    const current = shown();
    if (!deps.isFailure(answer.outcome)) {
      setShown(answer);
      setFailure(null);
    } else if (current !== null && !deps.isFailure(current.outcome)) {
      setFailure(answer);
    } else {
      setShown(answer);
      setFailure(null);
    }
  };

  /** Ask (never rejects). */
  const start = async (): Promise<void> => {
    if (pending()) return;
    const started: LoadStamp = stampAsk(deps.pageId(), deps.pageSettled());
    setPending(true);
    let outcome: O;
    try {
      outcome = await deps.ask();
    } catch (cause) {
      deps.log.error(
        `${deps.label}: the ask threw`,
        cause instanceof Error ? cause.message : cause
      );
      outcome = deps.threw;
    }
    if (disposed) return;
    sequence += 1;
    const stamp = settleStamp(started, deps.pageId(), deps.pageSettled());
    batch(() => {
      record({ outcome, ...stamp, sequence });
      setPending(false);
    });
  };

  return {
    state,
    stale,
    start,
    dispose: () => {
      disposed = true;
    }
  };
}
