/** The machine carries an apply's simulate spec through arming into the record and the save. */
import { describe, expect, it } from 'vitest';
import { validSet } from '../messaging/exclusion-session.fixtures';
import { transition, withSimulate, type ArmingSession } from './machine';

const ORIGIN = 'https://site.test';
const SET = validSet();
const SIMULATE = { features: ['delay_js'] } as const;

describe('withSimulate', () => {
  it('spreads a spec, and nothing when absent', () => {
    expect(withSimulate(SIMULATE)).toEqual({ simulate: SIMULATE });
    expect(withSimulate(undefined)).toEqual({});
  });
});

describe('a simulating apply', () => {
  it('arms with the spec, then stores it on the active session and saves it with the set', () => {
    const arming = transition(
      { state: 'inactive' },
      { type: 'apply', origin: ORIGIN, set: SET, simulate: SIMULATE, at: 100 }
    );
    expect(arming?.next).toMatchObject({ state: 'arming', simulate: SIMULATE });
    const armed = transition(arming?.next as ArmingSession, { type: 'armed' });
    expect(armed?.next).toEqual({
      state: 'active',
      origin: ORIGIN,
      set: SET,
      simulate: SIMULATE,
      startedAt: 100,
      document: null
    });
    expect(armed?.effects[0]).toEqual({
      kind: 'save-set',
      origin: ORIGIN,
      set: SET,
      simulate: SIMULATE
    });
  });

  it('keeps a plain apply exactly as before (no simulate key anywhere)', () => {
    const arming = transition(
      { state: 'inactive' },
      { type: 'apply', origin: ORIGIN, set: SET, at: 100 }
    );
    const armed = transition(arming?.next as ArmingSession, { type: 'armed' });
    expect(arming?.next).not.toHaveProperty('simulate');
    expect(armed?.next).not.toHaveProperty('simulate');
    expect(armed?.effects[0]).not.toHaveProperty('simulate');
  });
});
