/**
 * The overlay's view state machine: what the overlay knows about its
 * tab's session and what it is waiting for. Pure: events in, next state
 * out — the wiring performs the asks and feeds their answers back as
 * events. An event a state does not accept returns that same state object
 * (identity), so callers and tests can tell "ignored" from "moved".
 *
 * States:
 * - `loading` — the first status + saved-set asks are in flight.
 * - `load-failed` — they produced no usable answer; Retry re-enters `loading`.
 * - `ready` — the status is known; at most one action (`pending`) is in
 *   flight, and the last action's outcome may be on show (`notice`).
 * - `reloading` — an apply was accepted: the background reloads the tab
 *   next, which replaces this page (and the overlay). `stalled` once the
 *   reload is overdue, so the view offers to reload by hand — never a
 *   wait without an exit.
 */
import type {
  ExclusionApplyReply,
  ExclusionSessionStatus
} from '../../../lib/messaging/exclusion-session';
import type { SessionProblem } from './port';

/** An action the user started: apply the draft, re-apply the applied set, or stop. */
export type SessionAction = 'apply' | 'reset' | 'stop';

/** The last action's outcome, shown until the next action or a dismissal. */
export type ActionNotice =
  | {
      readonly kind: 'action-failed';
      readonly action: SessionAction;
      readonly problem: SessionProblem;
    }
  | { readonly kind: 'invalid'; readonly rows: number }
  | { readonly kind: 'stopped' };

/** The overlay's state (see the module doc). */
export type OverlayState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'load-failed'; readonly problem: SessionProblem }
  | {
      readonly phase: 'ready';
      readonly status: ExclusionSessionStatus;
      readonly pending: SessionAction | null;
      readonly notice: ActionNotice | null;
    }
  | { readonly phase: 'reloading'; readonly stalled: boolean };

/** What can happen to the overlay. */
export type OverlayEvent =
  | { readonly type: 'loaded'; readonly status: ExclusionSessionStatus }
  | { readonly type: 'load-failed'; readonly problem: SessionProblem }
  | { readonly type: 'retry-load' }
  | { readonly type: 'request'; readonly action: SessionAction }
  | { readonly type: 'apply-answered'; readonly reply: ExclusionApplyReply; readonly at: number }
  | { readonly type: 'stop-answered'; readonly status: ExclusionSessionStatus }
  | { readonly type: 'action-failed'; readonly problem: SessionProblem }
  | { readonly type: 'status-pushed'; readonly status: ExclusionSessionStatus }
  | { readonly type: 'reload-stalled' }
  | { readonly type: 'dismiss-notice' };

/** The machine's start. */
export const INITIAL_OVERLAY_STATE: OverlayState = { phase: 'loading' };

/** The `ready` state's shape. */
type Ready = Extract<OverlayState, { phase: 'ready' }>;

/**
 * Whether an action can start from a ready state: one at a time, and Stop
 * only when there is something to stop (an active session or a kept
 * warning — the warning lasts until Stop or the next apply); Reset only
 * re-applies an active session's set.
 */
export function canStart(state: OverlayState, action: SessionAction): boolean {
  if (state.phase !== 'ready' || state.pending !== null) return false;
  if (action === 'stop') return state.status.state !== 'inactive';
  if (action === 'reset') return state.status.state === 'active';
  return true;
}

/**
 * The ready state's answer to an apply.
 *
 * @param state The ready state awaiting it.
 * @param reply The background's answer.
 * @param at Epoch ms the answer arrived (stamps an `unavailable` status).
 */
function applyAnswered(state: Ready, reply: ExclusionApplyReply, at: number): OverlayState {
  switch (reply.outcome) {
    case 'applying':
      return { phase: 'reloading', stalled: false };
    case 'invalid':
      return { ...state, pending: null, notice: { kind: 'invalid', rows: reply.invalid.length } };
    case 'unavailable':
      return {
        phase: 'ready',
        status: { state: 'unavailable', cause: reply.cause, at },
        pending: null,
        notice: null
      };
  }
}

/** Transitions out of `ready`. */
function fromReady(state: Ready, event: OverlayEvent): OverlayState {
  switch (event.type) {
    case 'request':
      return canStart(state, event.action)
        ? { ...state, pending: event.action, notice: null }
        : state;
    case 'apply-answered':
      return state.pending === 'apply' || state.pending === 'reset'
        ? applyAnswered(state, event.reply, event.at)
        : state;
    case 'stop-answered':
      if (state.pending !== 'stop') return state;
      return {
        phase: 'ready',
        status: event.status,
        pending: null,
        // Only a stopped live session leaves a rewritten page behind; a
        // cleared warning changed nothing on the page.
        notice: state.status.state === 'active' ? { kind: 'stopped' } : null
      };
    case 'action-failed':
      return state.pending === null
        ? state
        : {
            ...state,
            pending: null,
            notice: { kind: 'action-failed', action: state.pending, problem: event.problem }
          };
    case 'status-pushed':
      return { ...state, status: event.status };
    case 'dismiss-notice':
      return state.notice === null ? state : { ...state, notice: null };
    default:
      return state;
  }
}

/**
 * The next state for one event (identity when the state ignores it).
 *
 * @param state The current state.
 * @param event What happened.
 */
export function overlayTransition(state: OverlayState, event: OverlayEvent): OverlayState {
  switch (state.phase) {
    case 'loading':
      if (event.type === 'loaded') {
        return { phase: 'ready', status: event.status, pending: null, notice: null };
      }
      return event.type === 'load-failed'
        ? { phase: 'load-failed', problem: event.problem }
        : state;
    case 'load-failed':
      return event.type === 'retry-load' ? INITIAL_OVERLAY_STATE : state;
    case 'ready':
      return fromReady(state, event);
    case 'reloading':
      if (event.type === 'reload-stalled' && !state.stalled)
        return { phase: 'reloading', stalled: true };
      // The session went unavailable instead of reloading (the arm ended
      // right after answering): the page stays, so the warning must show.
      if (event.type === 'status-pushed' && event.status.state === 'unavailable') {
        return { phase: 'ready', status: event.status, pending: null, notice: null };
      }
      return state;
  }
}
