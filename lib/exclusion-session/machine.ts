/**
 * The exclusion-session state machine of one tab — pure: a state and an
 * event in, the next state and the effects to perform out. The controller
 * owns the I/O (backend, stores, pushes, reload) and serializes every
 * event of a tab, so a transition always sees the settled state.
 *
 * States are the observable statuses (`inactive` · `active` ·
 * `unavailable`) plus `arming`, held only while an apply's arm activity
 * runs (never stored or observed — observers keep seeing the previous
 * status until the activity settles).
 *
 * ```
 * inactive ─┐                 ┌─ armed ───────────────▶ active ─┬─ document ─▶ active
 * active ───┼─ apply ▶ arming ┼─ arm-unavailable ─────▶ unavailable           │
 * unavail. ─┘                 └─ arm-failed ──────────▶ inactive              │
 * active ── interception-ended (same start) ────────▶ unavailable            │
 * active ── stale ───────────────────────────────────▶ inactive               │
 * any settled ── stop | tab-closed ──────────────────▶ inactive ◀─────────────┘
 * ```
 */
import type { ExclusionSet } from '../exclusion-builder/set';
import type {
  ActiveExclusionSession,
  ExclusionDocumentOutcome,
  ExclusionSessionRecord,
  ExclusionSessionStatus,
  InterceptionUnavailableCause
} from '../messaging/exclusion-session';

/** An apply's arm activity in flight. */
export interface ArmingSession {
  readonly state: 'arming';
  readonly origin: string;
  readonly set: ExclusionSet;
  /** The start time the session will carry — its generation (strictly after a replaced session's). */
  readonly startedAt: number;
  /** The status before the apply (what observers still see). */
  readonly previous: ExclusionSessionStatus;
}

/** A tab's machine state. */
export type SessionMachineState = ExclusionSessionStatus | ArmingSession;

/** What can happen to a tab's session. */
export type SessionEvent =
  /** The overlay applied `set` from `origin` at `at` (epoch ms). */
  | {
      readonly type: 'apply';
      readonly origin: string;
      readonly set: ExclusionSet;
      readonly at: number;
    }
  /** The arm activity armed interception and stored the active record. */
  | { readonly type: 'armed' }
  /** The arm activity could not arm (or the live-session cap refused it). */
  | {
      readonly type: 'arm-unavailable';
      readonly cause: InterceptionUnavailableCause;
      readonly at: number;
    }
  /** The arm activity failed unexpectedly (a backend or store fault). */
  | { readonly type: 'arm-failed' }
  /** The overlay asked to stop. */
  | { readonly type: 'stop' }
  /** A document of the session started at `startedAt` was intercepted. */
  | {
      readonly type: 'document';
      readonly startedAt: number;
      readonly outcome: ExclusionDocumentOutcome;
    }
  /** The browser ended the interception of the session started at `startedAt`. */
  | {
      readonly type: 'interception-ended';
      readonly startedAt: number;
      readonly cause: InterceptionUnavailableCause;
      readonly at: number;
    }
  /** Wake re-validation found no live interception behind the stored session. */
  | { readonly type: 'stale' }
  /** The tab closed. */
  | { readonly type: 'tab-closed' };

/** The work a transition asks the controller to perform, in order. */
export type SessionEffect =
  /** Run the arm activity (capacity check, backend arm, store the active record). */
  | { readonly kind: 'arm' }
  /** Drop the tab's interception (idempotent). */
  | { readonly kind: 'disarm' }
  /** Store the tab's record. */
  | { readonly kind: 'store'; readonly record: ExclusionSessionRecord }
  /** Remove the tab's record. */
  | { readonly kind: 'clear' }
  /** Save the applied set as its origin's set. */
  | { readonly kind: 'save-set'; readonly origin: string; readonly set: ExclusionSet }
  /** Reload the tab (after the apply answer is on its way). */
  | { readonly kind: 'reload' }
  /** Push the new status to the tab's overlay and the panels. */
  | { readonly kind: 'notify'; readonly status: ExclusionSessionStatus };

/** A transition's result. */
export interface SessionTransition {
  readonly next: SessionMachineState;
  readonly effects: readonly SessionEffect[];
}

/** The inactive status (no record). */
export const INACTIVE: ExclusionSessionStatus = { state: 'inactive' };

/**
 * End a settled session: disarm always (a backend may hold leftovers even
 * with no record); clear and notify only when a record existed.
 */
function endSession(state: ExclusionSessionStatus, notify: boolean): SessionTransition {
  if (state.state === 'inactive') return { next: INACTIVE, effects: [{ kind: 'disarm' }] };
  const effects: SessionEffect[] = [{ kind: 'disarm' }, { kind: 'clear' }];
  if (notify) effects.push({ kind: 'notify', status: INACTIVE });
  return { next: INACTIVE, effects };
}

/** Start arming from a settled state. */
function startArming(
  state: ExclusionSessionStatus,
  event: Extract<SessionEvent, { type: 'apply' }>
): SessionTransition {
  // A replaced session's documents are told apart by start time: keep it strictly increasing.
  const startedAt = state.state === 'active' ? Math.max(event.at, state.startedAt + 1) : event.at;
  return {
    next: { state: 'arming', origin: event.origin, set: event.set, startedAt, previous: state },
    effects: [{ kind: 'arm' }]
  };
}

/** Settle an arming session. */
function settleArming(state: ArmingSession, event: SessionEvent): SessionTransition | null {
  switch (event.type) {
    case 'armed': {
      const active: ActiveExclusionSession = {
        state: 'active',
        origin: state.origin,
        set: state.set,
        startedAt: state.startedAt,
        document: null
      };
      // The record is already stored by the arm activity (a session exists once stored).
      return {
        next: active,
        effects: [
          { kind: 'save-set', origin: state.origin, set: state.set },
          { kind: 'notify', status: active },
          { kind: 'reload' }
        ]
      };
    }
    case 'arm-unavailable': {
      const record: ExclusionSessionRecord = {
        state: 'unavailable',
        cause: event.cause,
        at: event.at
      };
      return {
        next: record,
        effects: [{ kind: 'disarm' }, { kind: 'store', record }, { kind: 'notify', status: record }]
      };
    }
    case 'arm-failed':
      return {
        next: INACTIVE,
        effects: [{ kind: 'disarm' }, { kind: 'clear' }, { kind: 'notify', status: INACTIVE }]
      };
    default:
      return null;
  }
}

/**
 * The transition function.
 *
 * @param state The tab's current state.
 * @param event What happened.
 * @returns The next state and its effects, or null when the event does not
 *   apply in this state (ignored: no state change, nothing performed) — a
 *   late document of a replaced or ended session, an end signal with no
 *   live session or for another generation, or an event that only an
 *   arming session accepts.
 */
export function transition(
  state: SessionMachineState,
  event: SessionEvent
): SessionTransition | null {
  if (state.state === 'arming') return settleArming(state, event);
  switch (event.type) {
    case 'apply':
      return startArming(state, event);
    case 'stop':
      return endSession(state, true);
    case 'tab-closed':
      // Nothing is left to notify: the tab and its panel are gone.
      return endSession(state, false);
    case 'document': {
      if (state.state !== 'active' || state.startedAt !== event.startedAt) return null;
      const next: ActiveExclusionSession = { ...state, document: event.outcome };
      return {
        next,
        effects: [
          { kind: 'store', record: next },
          { kind: 'notify', status: next }
        ]
      };
    }
    case 'interception-ended': {
      // A replaced interception's late end must not kill the re-armed session.
      if (state.state !== 'active' || state.startedAt !== event.startedAt) return null;
      const record: ExclusionSessionRecord = {
        state: 'unavailable',
        cause: event.cause,
        at: event.at
      };
      return {
        next: record,
        effects: [{ kind: 'disarm' }, { kind: 'store', record }, { kind: 'notify', status: record }]
      };
    }
    case 'stale':
      return state.state === 'active' ? endSession(state, true) : null;
    default:
      // armed / arm-unavailable / arm-failed only settle an arming session.
      return null;
  }
}

/**
 * The status observers see for a state (an arming tab still shows its
 * previous status).
 */
export function observableStatus(state: SessionMachineState): ExclusionSessionStatus {
  return state.state === 'arming' ? state.previous : state;
}
