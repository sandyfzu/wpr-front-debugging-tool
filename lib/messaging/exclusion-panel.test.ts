import { describe, expect, it } from 'vitest';
import { activeRecord } from './exclusion-session.fixtures';
import {
  EXCLUSION_OVERLAY_OPEN_OUTCOMES,
  parseExclusionOverlayOpenOutcome,
  parseExclusionSessionSummary,
  parseExclusionSessionTabSummary
} from './exclusion-panel';

describe('parseExclusionOverlayOpenOutcome', () => {
  it('parses every open outcome and nothing else', () => {
    for (const outcome of EXCLUSION_OVERLAY_OPEN_OUTCOMES) {
      expect(parseExclusionOverlayOpenOutcome(outcome)).toBe(outcome);
    }
    for (const input of ['opened', 'INJECTED', '', null, undefined, 1, { outcome: 'injected' }]) {
      expect(parseExclusionOverlayOpenOutcome(input)).toBeNull();
    }
  });
});

describe('parseExclusionSessionSummary', () => {
  it('reads the state, and an active session’s origin, ignoring every other field', () => {
    expect(parseExclusionSessionSummary({ state: 'inactive' })).toEqual({ state: 'inactive' });
    expect(
      parseExclusionSessionSummary({ state: 'unavailable', cause: 'attach-denied', at: 1 })
    ).toEqual({ state: 'unavailable' });
    expect(parseExclusionSessionSummary(activeRecord())).toEqual({
      state: 'active',
      origin: activeRecord().origin
    });
    expect(parseExclusionSessionSummary({ state: 'inactive', future: true })).toEqual({
      state: 'inactive'
    });
  });

  it('refuses unknown states, non-objects and active sessions without an http(s) origin', () => {
    for (const input of [
      null,
      'inactive',
      [],
      { state: 'gone' },
      {},
      Object.create({ state: 'inactive' }),
      { state: 'active' },
      { state: 'active', origin: 'chrome://settings' },
      { state: 'active', origin: 'https://example.com/path' },
      { state: 'active', origin: 7 }
    ]) {
      expect(parseExclusionSessionSummary(input)).toBeNull();
    }
  });
});

describe('parseExclusionSessionTabSummary', () => {
  it('reads a push: a tab id plus a summarized status', () => {
    expect(parseExclusionSessionTabSummary({ tabId: 3, status: activeRecord() })).toEqual({
      tabId: 3,
      summary: { state: 'active', origin: activeRecord().origin }
    });
  });

  it('refuses a push without a numeric tab id or a known status', () => {
    for (const input of [
      { tabId: '3', status: { state: 'inactive' } },
      { tabId: -1, status: { state: 'inactive' } },
      { tabId: 3, status: { state: 'gone' } },
      { status: { state: 'inactive' } },
      null
    ]) {
      expect(parseExclusionSessionTabSummary(input)).toBeNull();
    }
  });
});
