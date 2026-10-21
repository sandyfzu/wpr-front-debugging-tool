/**
 * The overlay's session port: the one seam between the overlay and the
 * session owner (the background). The overlay never reaches a store or a
 * backend — every read and action is an ask through this interface, and
 * every answer arrives as a typed outcome, so the view renders each miss as
 * its own state. Injected: tests and other hosts hand in their own port;
 * {@link createMessagingSessionPort} is the extension's.
 */
import type {
  ExclusionApplyReply,
  ExclusionSaveReply,
  ExclusionSessionStatus,
  SavedExclusionSetReply
} from '../../../lib/messaging/exclusion-session';
import {
  EXCLUSION_SESSION_DEADLINES_MS,
  parseExclusionApplyReply,
  parseExclusionSaveReply,
  parseExclusionSessionStatus,
  parseSavedExclusionSetReply
} from '../../../lib/messaging/exclusion-session';
import type { ExclusionSet } from '../../../lib/exclusion-builder/set';
import { boundedAsk, type AskOutcome } from '../../../lib/messaging/bounded-ask';
import type { Logger } from '../../../lib/logger';

/**
 * Why an ask produced no usable answer.
 *
 * - `no-receiver` — nothing answers (the background is not listening).
 * - `timeout` — no answer within the ask's deadline.
 * - `invalid-reply` — an answer arrived but failed its guard.
 * - `context-invalidated` — the extension was reloaded or updated under
 *   this page; this world can no longer reach it.
 * - `failed` — any other send failure (logged where it happened).
 */
export type SessionProblem =
  'no-receiver' | 'timeout' | 'invalid-reply' | 'context-invalidated' | 'failed';

/** One ask's outcome as the overlay consumes it. */
export type PortOutcome<T> =
  | { readonly kind: 'reply'; readonly reply: T }
  | { readonly kind: 'problem'; readonly problem: SessionProblem };

/** What the overlay can ask of the session owner for its own tab and origin. */
export interface ExclusionSessionPort {
  /** This tab's session status. */
  status(): Promise<PortOutcome<ExclusionSessionStatus>>;
  /** This origin's saved set (the editor's restore source). */
  savedSet(): Promise<PortOutcome<SavedExclusionSetReply>>;
  /** Start (or replace) the session with `set`; `applying` means the tab reloads next. */
  apply(set: ExclusionSet): Promise<PortOutcome<ExclusionApplyReply>>;
  /** End the session; answers the status after it. */
  stop(): Promise<PortOutcome<ExclusionSessionStatus>>;
  /** Store `set` as this origin's draft. */
  save(set: ExclusionSet): Promise<PortOutcome<ExclusionSaveReply>>;
  /**
   * Follow status pushes for this tab.
   *
   * @param listener Called with each validated pushed status.
   * @returns The unsubscribe (idempotent).
   */
  onStatus(listener: (status: ExclusionSessionStatus) => void): () => void;
}

/** The message words a dead extension context raises on every API call. */
const INVALIDATED_CONTEXT = 'Extension context invalidated';

/**
 * Fold a bounded ask's outcome into the port's: an answer stays an answer;
 * a real failure is named — the invalidated-context case apart (it has its
 * own remedy) — and logged with the operation, never dropped.
 *
 * @param operation The ask's name for the log line.
 * @param outcome The bounded ask's outcome.
 * @param log Where real failures are reported.
 */
export function portOutcome<T>(
  operation: string,
  outcome: AskOutcome<T>,
  log: Pick<Logger, 'warn'>
): PortOutcome<T> {
  switch (outcome.kind) {
    case 'reply':
      return { kind: 'reply', reply: outcome.reply };
    case 'failed': {
      const message =
        outcome.cause instanceof Error ? outcome.cause.message : String(outcome.cause);
      if (message.includes(INVALIDATED_CONTEXT)) {
        return { kind: 'problem', problem: 'context-invalidated' };
      }
      log.warn(`Session ask "${operation}" failed`, message);
      return { kind: 'problem', problem: 'failed' };
    }
    default:
      if (outcome.kind !== 'no-receiver') log.warn(`Session ask "${operation}": ${outcome.kind}`);
      return { kind: 'problem', problem: outcome.kind };
  }
}

/** The session ask rows of the extension protocol (`lib/messaging/protocol`). */
export type SessionAskRow =
  | 'getExclusionSession'
  | 'getSavedExclusionSet'
  | 'applyExclusionSession'
  | 'stopExclusionSession'
  | 'saveExclusionSet';

/** The transport the messaging port rides (the extension messenger in production). */
export interface SessionTransport {
  /** Send one session row from this content script to the background. */
  send(row: SessionAskRow, data?: unknown): Promise<unknown>;
  /**
   * Listen for the background's status pushes to this tab.
   *
   * @param handler Receives each push's raw payload (validated by the port).
   * @returns The listener's removal.
   */
  listen(handler: (raw: unknown) => void): () => void;
}

/**
 * The extension's port: each ask is a bounded ask over the session channels
 * with that channel's deadline and answer guard; pushes are guarded before
 * they reach a listener (an invalid push is dropped, logged).
 *
 * @param transport The send/listen pair (the typed messenger in production).
 * @param log The overlay's logger.
 */
export function createMessagingSessionPort(
  transport: SessionTransport,
  log: Pick<Logger, 'warn'>
): ExclusionSessionPort {
  /** One bounded ask folded into a port outcome. */
  const ask = async <T>(
    row: SessionAskRow,
    parse: (answer: unknown) => T | null,
    timeoutMs: number,
    data?: unknown
  ): Promise<PortOutcome<T>> =>
    portOutcome(
      row,
      await boundedAsk({ send: () => transport.send(row, data), parse, timeoutMs }),
      log
    );
  return {
    status: () =>
      ask(
        'getExclusionSession',
        parseExclusionSessionStatus,
        EXCLUSION_SESSION_DEADLINES_MS.status
      ),
    savedSet: () =>
      ask(
        'getSavedExclusionSet',
        parseSavedExclusionSetReply,
        EXCLUSION_SESSION_DEADLINES_MS.savedSet
      ),
    apply: (set) =>
      ask('applyExclusionSession', parseExclusionApplyReply, EXCLUSION_SESSION_DEADLINES_MS.apply, {
        set
      }),
    stop: () =>
      ask('stopExclusionSession', parseExclusionSessionStatus, EXCLUSION_SESSION_DEADLINES_MS.stop),
    save: (set) =>
      ask('saveExclusionSet', parseExclusionSaveReply, EXCLUSION_SESSION_DEADLINES_MS.save, {
        set
      }),
    onStatus: (listener) => {
      let active = true;
      const remove = transport.listen((raw) => {
        if (!active) return;
        const status = parseExclusionSessionStatus(raw);
        if (status === null) {
          log.warn('Dropped an invalid session status push');
          return;
        }
        listener(status);
      });
      return () => {
        if (!active) return;
        active = false;
        remove();
      };
    }
  };
}
