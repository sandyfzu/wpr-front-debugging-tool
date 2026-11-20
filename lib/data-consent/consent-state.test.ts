import { describe, expect, it } from 'vitest';
import {
  dataConsentStep,
  INITIAL_DATA_CONSENT_STATE,
  type DataConsentEvent,
  type DataConsentState
} from './consent-state';

/** Run events from the initial state. */
function run(...events: DataConsentEvent[]): DataConsentState {
  return events.reduce(dataConsentStep, INITIAL_DATA_CONSENT_STATE);
}

describe('dataConsentStep', () => {
  it('starts unknown, and a check decides granted or asking', () => {
    expect(INITIAL_DATA_CONSENT_STATE).toEqual({ status: 'unknown' });
    expect(run({ type: 'checked', granted: true })).toEqual({ status: 'granted' });
    expect(run({ type: 'checked', granted: false })).toEqual({ status: 'asking' });
  });

  it('asking → requesting → granted or declined', () => {
    const asking: DataConsentEvent[] = [{ type: 'checked', granted: false }, { type: 'request' }];
    expect(run(...asking)).toEqual({ status: 'requesting' });
    expect(run(...asking, { type: 'answered', granted: true })).toEqual({ status: 'granted' });
    expect(run(...asking, { type: 'answered', granted: false })).toEqual({ status: 'declined' });
  });

  it('a rejected request fails with its message; Ask again requests anew', () => {
    const failed = run(
      { type: 'checked', granted: false },
      { type: 'request' },
      { type: 'request-failed', message: 'no user input' }
    );
    expect(failed).toEqual({ status: 'failed', message: 'no user input' });
    expect(dataConsentStep(failed, { type: 'request' })).toEqual({ status: 'requesting' });
  });

  it('Not now declines without the prompt; Ask again from declined requests', () => {
    const declined = run({ type: 'checked', granted: false }, { type: 'dismissed' });
    expect(declined).toEqual({ status: 'declined' });
    expect(dataConsentStep(declined, { type: 'request' })).toEqual({ status: 'requesting' });
  });

  it('a grant from elsewhere settles every waiting state, never an open prompt', () => {
    const declined = run({ type: 'checked', granted: false }, { type: 'dismissed' });
    expect(dataConsentStep(declined, { type: 'granted-elsewhere' })).toEqual({ status: 'granted' });
    expect(run({ type: 'checked', granted: false }, { type: 'granted-elsewhere' })).toEqual({
      status: 'granted'
    });
    const requesting: DataConsentState = { status: 'requesting' };
    expect(dataConsentStep(requesting, { type: 'granted-elsewhere' })).toBe(requesting);
  });

  it('a revoked grant asks again', () => {
    expect(run({ type: 'checked', granted: true }, { type: 'revoked' })).toEqual({
      status: 'asking'
    });
  });

  it('ignores events that do not apply (same object back)', () => {
    const states: DataConsentState[] = [
      { status: 'unknown' },
      { status: 'asking' },
      { status: 'requesting' },
      { status: 'granted' },
      { status: 'declined' },
      { status: 'failed', message: 'x' }
    ];
    const applies: Record<DataConsentEvent['type'], DataConsentState['status'][]> = {
      checked: ['unknown'],
      request: ['asking', 'declined', 'failed'],
      answered: ['requesting'],
      'request-failed': ['requesting'],
      dismissed: ['asking'],
      revoked: ['granted'],
      'granted-elsewhere': ['asking', 'declined', 'failed']
    };
    const events: DataConsentEvent[] = [
      { type: 'checked', granted: true },
      { type: 'request' },
      { type: 'answered', granted: true },
      { type: 'request-failed', message: 'm' },
      { type: 'dismissed' },
      { type: 'revoked' },
      { type: 'granted-elsewhere' }
    ];
    for (const state of states) {
      for (const event of events) {
        const next = dataConsentStep(state, event);
        if (applies[event.type].includes(state.status)) expect(next).not.toBe(state);
        else expect(next).toBe(state);
      }
    }
  });

  it('a second click while the prompt is up starts no second request', () => {
    const requesting: DataConsentState = { status: 'requesting' };
    expect(dataConsentStep(requesting, { type: 'request' })).toBe(requesting);
  });
});
