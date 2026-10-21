import { describe, expect, it } from 'vitest';
import type { ExclusionSessionStatus } from '../../../lib/messaging/exclusion-session';
import { EMPTY_EXCLUSION_SET } from '../../../lib/exclusion-builder/set';
import {
  INITIAL_OVERLAY_STATE,
  canStart,
  overlayTransition,
  type OverlayEvent,
  type OverlayState
} from './machine';

const INACTIVE: ExclusionSessionStatus = { state: 'inactive' };
const ACTIVE: ExclusionSessionStatus = {
  state: 'active',
  origin: 'https://example.com',
  set: EMPTY_EXCLUSION_SET,
  startedAt: 10,
  document: null
};
const UNAVAILABLE: ExclusionSessionStatus = { state: 'unavailable', cause: 'attach-denied', at: 5 };

/** A ready state. */
function ready(over: Partial<Extract<OverlayState, { phase: 'ready' }>> = {}): OverlayState {
  return { phase: 'ready', status: INACTIVE, pending: null, notice: null, ...over };
}

/** Every representative state, named. */
const STATES: Record<string, OverlayState> = {
  loading: INITIAL_OVERLAY_STATE,
  loadFailed: { phase: 'load-failed', problem: 'timeout' },
  readyInactive: ready(),
  readyActive: ready({ status: ACTIVE }),
  readyUnavailable: ready({ status: UNAVAILABLE }),
  applying: ready({ pending: 'apply' }),
  resetting: ready({ status: ACTIVE, pending: 'reset' }),
  stopping: ready({ status: ACTIVE, pending: 'stop' }),
  noticed: ready({ notice: { kind: 'invalid', rows: 2 } }),
  reloading: { phase: 'reloading', stalled: false },
  stalled: { phase: 'reloading', stalled: true }
};

/** Every event type, one representative each (several for `request`). */
const EVENTS: Record<string, OverlayEvent> = {
  loaded: { type: 'loaded', status: ACTIVE },
  loadFailed: { type: 'load-failed', problem: 'no-receiver' },
  retryLoad: { type: 'retry-load' },
  requestApply: { type: 'request', action: 'apply' },
  requestReset: { type: 'request', action: 'reset' },
  requestStop: { type: 'request', action: 'stop' },
  applyAnswered: { type: 'apply-answered', reply: { outcome: 'applying' }, at: 99 },
  stopAnswered: { type: 'stop-answered', status: INACTIVE },
  actionFailed: { type: 'action-failed', problem: 'timeout' },
  statusPushed: { type: 'status-pushed', status: UNAVAILABLE },
  reloadStalled: { type: 'reload-stalled' },
  dismissNotice: { type: 'dismiss-notice' }
};

/**
 * The accepted pairs and their next state; every other pair must return the
 * state unchanged (identity).
 */
const ACCEPTED: Record<string, Record<string, OverlayState>> = {
  loading: {
    loaded: ready({ status: ACTIVE }),
    loadFailed: { phase: 'load-failed', problem: 'no-receiver' }
  },
  loadFailed: { retryLoad: INITIAL_OVERLAY_STATE },
  readyInactive: {
    requestApply: ready({ pending: 'apply' }),
    statusPushed: ready({ status: UNAVAILABLE })
  },
  readyActive: {
    requestApply: ready({ status: ACTIVE, pending: 'apply' }),
    requestReset: ready({ status: ACTIVE, pending: 'reset' }),
    requestStop: ready({ status: ACTIVE, pending: 'stop' }),
    statusPushed: ready({ status: UNAVAILABLE })
  },
  readyUnavailable: {
    requestApply: ready({ status: UNAVAILABLE, pending: 'apply' }),
    requestStop: ready({ status: UNAVAILABLE, pending: 'stop' }),
    statusPushed: ready({ status: UNAVAILABLE })
  },
  applying: {
    applyAnswered: { phase: 'reloading', stalled: false },
    actionFailed: ready({
      notice: { kind: 'action-failed', action: 'apply', problem: 'timeout' }
    }),
    statusPushed: ready({ status: UNAVAILABLE, pending: 'apply' })
  },
  resetting: {
    applyAnswered: { phase: 'reloading', stalled: false },
    actionFailed: ready({
      status: ACTIVE,
      notice: { kind: 'action-failed', action: 'reset', problem: 'timeout' }
    }),
    statusPushed: ready({ status: UNAVAILABLE, pending: 'reset' })
  },
  stopping: {
    stopAnswered: ready({ status: INACTIVE, notice: { kind: 'stopped' } }),
    actionFailed: ready({
      status: ACTIVE,
      notice: { kind: 'action-failed', action: 'stop', problem: 'timeout' }
    }),
    statusPushed: ready({ status: UNAVAILABLE, pending: 'stop' })
  },
  noticed: {
    requestApply: ready({ pending: 'apply' }),
    statusPushed: ready({ status: UNAVAILABLE, notice: { kind: 'invalid', rows: 2 } }),
    dismissNotice: ready()
  },
  reloading: {
    reloadStalled: { phase: 'reloading', stalled: true },
    statusPushed: ready({ status: UNAVAILABLE })
  },
  stalled: { statusPushed: ready({ status: UNAVAILABLE }) }
};

describe('overlayTransition — full matrix', () => {
  for (const [stateName, state] of Object.entries(STATES)) {
    for (const [eventName, event] of Object.entries(EVENTS)) {
      const expected = ACCEPTED[stateName]?.[eventName];
      it(`${stateName} × ${eventName} → ${expected === undefined ? 'unchanged' : 'moves'}`, () => {
        const next = overlayTransition(state, event);
        if (expected === undefined) expect(next).toBe(state);
        else expect(next).toEqual(expected);
      });
    }
  }
});

describe('overlayTransition — answer arms', () => {
  it('shows the invalid count and returns to idle', () => {
    const next = overlayTransition(STATES.applying ?? ready(), {
      type: 'apply-answered',
      reply: {
        outcome: 'invalid',
        invalid: [
          { feature: 'delay_js', index: 0, row: '(', reason: 'Invalid regular expression: x' }
        ]
      },
      at: 1
    });
    expect(next).toEqual(ready({ notice: { kind: 'invalid', rows: 1 } }));
  });

  it('turns an unavailable answer into the kept warning, stamped with the answer time', () => {
    const next = overlayTransition(STATES.applying ?? ready(), {
      type: 'apply-answered',
      reply: { outcome: 'unavailable', cause: 'debugging-policy' },
      at: 1234
    });
    expect(next).toEqual(
      ready({ status: { state: 'unavailable', cause: 'debugging-policy', at: 1234 } })
    );
  });

  it('clears a warning on Stop without claiming a page to restore', () => {
    const stopping = ready({ status: UNAVAILABLE, pending: 'stop' });
    expect(overlayTransition(stopping, { type: 'stop-answered', status: INACTIVE })).toEqual(
      ready()
    );
  });

  it('keeps reloading through a pushed active status (the reload is coming)', () => {
    const reloading = STATES.reloading ?? ready();
    expect(overlayTransition(reloading, { type: 'status-pushed', status: ACTIVE })).toBe(reloading);
  });
});

describe('canStart', () => {
  it('allows one action at a time, Stop only with something to stop, Reset only when active', () => {
    expect(canStart(ready(), 'apply')).toBe(true);
    expect(canStart(ready(), 'stop')).toBe(false);
    expect(canStart(ready(), 'reset')).toBe(false);
    expect(canStart(ready({ status: UNAVAILABLE }), 'stop')).toBe(true);
    expect(canStart(ready({ status: UNAVAILABLE }), 'reset')).toBe(false);
    expect(canStart(ready({ status: ACTIVE }), 'reset')).toBe(true);
    expect(canStart(ready({ pending: 'apply' }), 'apply')).toBe(false);
    expect(canStart(INITIAL_OVERLAY_STATE, 'apply')).toBe(false);
  });
});
