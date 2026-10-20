/**
 * The session state machine, exhaustively: every state × event pair is
 * either a pinned transition (next state + ordered effects) or ignored.
 */
import { describe, expect, it } from 'vitest';
import { activeRecord, validSet } from '../messaging/exclusion-session.fixtures';
import type {
  ActiveExclusionSession,
  ExclusionSessionStatus,
  UnavailableExclusionSession
} from '../messaging/exclusion-session';
import {
  observableStatus,
  transition,
  type ArmingSession,
  type SessionEvent,
  type SessionMachineState
} from './machine';

const INACTIVE: ExclusionSessionStatus = { state: 'inactive' };
const ACTIVE: ActiveExclusionSession = { ...activeRecord(), document: null };
const UNAVAILABLE: UnavailableExclusionSession = {
  state: 'unavailable',
  cause: 'attach-denied',
  at: 5
};
const ORIGIN = 'https://site.test';
const SET = validSet();
const ARMING: ArmingSession = {
  state: 'arming',
  origin: ORIGIN,
  set: SET,
  startedAt: 100,
  previous: INACTIVE
};
const OUTCOME = { outcome: 'failed', reason: 'decode-failed' } as const;

/** One of every event. */
const EVENTS: Record<SessionEvent['type'], SessionEvent> = {
  apply: { type: 'apply', origin: ORIGIN, set: SET, at: 100 },
  armed: { type: 'armed' },
  'arm-unavailable': { type: 'arm-unavailable', cause: 'infobar-cancelled', at: 7 },
  'arm-failed': { type: 'arm-failed' },
  stop: { type: 'stop' },
  document: { type: 'document', startedAt: ACTIVE.startedAt, outcome: OUTCOME },
  'interception-ended': { type: 'interception-ended', cause: 'detached', at: 9 },
  stale: { type: 'stale' },
  'tab-closed': { type: 'tab-closed' }
};

/** One of every state. */
const STATES: Record<string, SessionMachineState> = {
  inactive: INACTIVE,
  active: ACTIVE,
  unavailable: UNAVAILABLE,
  arming: ARMING
};

/** The accepted (state, event) pairs; every other pair must be ignored. */
const ACCEPTED = new Set([
  'inactive:apply',
  'inactive:stop',
  'inactive:tab-closed',
  'active:apply',
  'active:stop',
  'active:tab-closed',
  'active:document',
  'active:interception-ended',
  'active:stale',
  'unavailable:apply',
  'unavailable:stop',
  'unavailable:tab-closed',
  'arming:armed',
  'arming:arm-unavailable',
  'arming:arm-failed'
]);

describe('transition matrix', () => {
  const pairs = Object.entries(STATES).flatMap(([stateName, state]) =>
    Object.values(EVENTS).map((event) => [`${stateName}:${event.type}`, state, event] as const)
  );

  it.each(pairs)('%s is accepted exactly when declared', (pair, state, event) => {
    expect(transition(state, event) !== null).toBe(ACCEPTED.has(pair));
  });
});

describe('apply', () => {
  it.each([
    ['inactive', INACTIVE],
    ['unavailable', UNAVAILABLE]
  ])('from %s starts arming at the apply time', (_name, state) => {
    expect(transition(state, EVENTS.apply)).toEqual({
      next: { state: 'arming', origin: ORIGIN, set: SET, startedAt: 100, previous: state },
      effects: [{ kind: 'arm' }]
    });
  });

  it('from active (re-apply/Reset) keeps start times strictly increasing', () => {
    const later = transition(ACTIVE, {
      ...EVENTS.apply,
      at: ACTIVE.startedAt + 50
    } as SessionEvent);
    expect(later?.next).toMatchObject({
      state: 'arming',
      startedAt: ACTIVE.startedAt + 50,
      previous: ACTIVE
    });
    const sameMs = transition(ACTIVE, { ...EVENTS.apply, at: ACTIVE.startedAt } as SessionEvent);
    expect(sameMs?.next).toMatchObject({ startedAt: ACTIVE.startedAt + 1 });
    const clockBack = transition(ACTIVE, { ...EVENTS.apply, at: 1 } as SessionEvent);
    expect(clockBack?.next).toMatchObject({ startedAt: ACTIVE.startedAt + 1 });
  });
});

describe('arming settles', () => {
  it('armed → active (no document yet): save the set, notify, then reload', () => {
    const active: ActiveExclusionSession = {
      state: 'active',
      origin: ORIGIN,
      set: SET,
      startedAt: 100,
      document: null
    };
    expect(transition(ARMING, EVENTS.armed)).toEqual({
      next: active,
      effects: [
        { kind: 'save-set', origin: ORIGIN, set: SET },
        { kind: 'notify', status: active },
        { kind: 'reload' }
      ]
    });
  });

  it('arm-unavailable → the warning: disarm, store, notify (nothing saved, no reload)', () => {
    const record = { state: 'unavailable', cause: 'infobar-cancelled', at: 7 } as const;
    expect(transition(ARMING, EVENTS['arm-unavailable'])).toEqual({
      next: record,
      effects: [{ kind: 'disarm' }, { kind: 'store', record }, { kind: 'notify', status: record }]
    });
  });

  it('arm-failed → inactive: disarm, clear, notify', () => {
    expect(transition({ ...ARMING, previous: ACTIVE }, EVENTS['arm-failed'])).toEqual({
      next: INACTIVE,
      effects: [{ kind: 'disarm' }, { kind: 'clear' }, { kind: 'notify', status: INACTIVE }]
    });
  });
});

describe('ending a session', () => {
  it.each([
    ['active', ACTIVE],
    ['unavailable', UNAVAILABLE]
  ])('stop from %s → inactive: disarm, clear, notify', (_name, state) => {
    expect(transition(state, EVENTS.stop)).toEqual({
      next: INACTIVE,
      effects: [{ kind: 'disarm' }, { kind: 'clear' }, { kind: 'notify', status: INACTIVE }]
    });
  });

  it('stop from inactive only disarms (leftovers), nothing to clear or notify', () => {
    expect(transition(INACTIVE, EVENTS.stop)).toEqual({
      next: INACTIVE,
      effects: [{ kind: 'disarm' }]
    });
  });

  it.each([
    ['active', ACTIVE],
    ['unavailable', UNAVAILABLE]
  ])('tab-closed from %s → inactive: disarm and clear, no push', (_name, state) => {
    expect(transition(state, EVENTS['tab-closed'])).toEqual({
      next: INACTIVE,
      effects: [{ kind: 'disarm' }, { kind: 'clear' }]
    });
  });

  it('tab-closed from inactive only disarms', () => {
    expect(transition(INACTIVE, EVENTS['tab-closed'])).toEqual({
      next: INACTIVE,
      effects: [{ kind: 'disarm' }]
    });
  });

  it('stale (wake) from active → inactive: disarm, clear, notify', () => {
    expect(transition(ACTIVE, EVENTS.stale)).toEqual({
      next: INACTIVE,
      effects: [{ kind: 'disarm' }, { kind: 'clear' }, { kind: 'notify', status: INACTIVE }]
    });
  });

  it('interception-ended from active → the warning: disarm, store, notify', () => {
    const record = { state: 'unavailable', cause: 'detached', at: 9 } as const;
    expect(transition(ACTIVE, EVENTS['interception-ended'])).toEqual({
      next: record,
      effects: [{ kind: 'disarm' }, { kind: 'store', record }, { kind: 'notify', status: record }]
    });
  });
});

describe('document', () => {
  it('records the outcome on the session it belongs to: store, notify', () => {
    const next = { ...ACTIVE, document: OUTCOME };
    expect(transition(ACTIVE, EVENTS.document)).toEqual({
      next,
      effects: [
        { kind: 'store', record: next },
        { kind: 'notify', status: next }
      ]
    });
  });

  it("ignores a replaced session's late document", () => {
    expect(
      transition(ACTIVE, { ...EVENTS.document, startedAt: ACTIVE.startedAt - 1 } as SessionEvent)
    ).toBeNull();
  });
});

describe('observableStatus', () => {
  it('shows the previous status while arming, else the state itself', () => {
    expect(observableStatus({ ...ARMING, previous: ACTIVE })).toBe(ACTIVE);
    expect(observableStatus(UNAVAILABLE)).toBe(UNAVAILABLE);
  });
});
