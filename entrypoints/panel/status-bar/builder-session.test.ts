import { describe, expect, it } from 'vitest';
import { activeRecord } from '../../../lib/messaging/exclusion-session.fixtures';
import type { ExclusionSessionStatus } from '../../../lib/messaging/exclusion-session';
import {
  BUILDER_SESSION_CHECKING,
  builderEntryView,
  openFeedback,
  withAnswer,
  withPush,
  type BuilderSessionState
} from './builder-session';

const INACTIVE: ExclusionSessionStatus = { state: 'inactive' };
const UNAVAILABLE: ExclusionSessionStatus = { state: 'unavailable', cause: 'attach-denied', at: 1 };

describe('withAnswer', () => {
  it('takes the ask’s status, or unknown when it got none', () => {
    expect(withAnswer(BUILDER_SESSION_CHECKING, { kind: 'reply', reply: INACTIVE })).toEqual({
      kind: 'known',
      status: INACTIVE
    });
    for (const miss of [
      { kind: 'no-receiver' },
      { kind: 'timeout' },
      { kind: 'invalid-reply' },
      { kind: 'failed', cause: new Error('x') }
    ] as const) {
      expect(withAnswer(BUILDER_SESSION_CHECKING, miss)).toEqual({ kind: 'unknown' });
    }
  });

  it('keeps a push that landed before the answer (the push is newer)', () => {
    const pushed: BuilderSessionState = { kind: 'known', status: UNAVAILABLE };
    expect(withAnswer(pushed, { kind: 'reply', reply: INACTIVE })).toBe(pushed);
    expect(withAnswer(pushed, { kind: 'timeout' })).toBe(pushed);
  });

  it('lets an answer replace an earlier unknown (a retried ask)', () => {
    expect(withAnswer({ kind: 'unknown' }, { kind: 'reply', reply: INACTIVE })).toEqual({
      kind: 'known',
      status: INACTIVE
    });
  });
});

describe('withPush', () => {
  it('takes the background’s push about the inspected tab', () => {
    expect(withPush(BUILDER_SESSION_CHECKING, { tabId: 7, status: UNAVAILABLE }, 7, false)).toEqual(
      { kind: 'known', status: UNAVAILABLE }
    );
  });

  it('drops pushes about other tabs, from a tab, or with no inspected tab', () => {
    const state: BuilderSessionState = { kind: 'known', status: INACTIVE };
    expect(withPush(state, { tabId: 8, status: UNAVAILABLE }, 7, false)).toBe(state);
    expect(withPush(state, { tabId: 7, status: UNAVAILABLE }, 7, true)).toBe(state);
    expect(withPush(state, { tabId: 7, status: UNAVAILABLE }, null, false)).toBe(state);
  });
});

describe('builderEntryView', () => {
  it('words every state with a badge label (never color alone) once known', () => {
    expect(builderEntryView(BUILDER_SESSION_CHECKING)).toEqual({
      badge: null,
      description: 'Checking the exclusion session of this tab.'
    });
    expect(builderEntryView({ kind: 'unknown' }).badge).toBeNull();
    expect(builderEntryView({ kind: 'unknown' }).description).toMatch(/could not be read/);
    expect(builderEntryView({ kind: 'known', status: INACTIVE })).toEqual({
      badge: { kind: 'neutral', label: 'Off' },
      description: 'No exclusions applied in this tab.'
    });
    expect(builderEntryView({ kind: 'known', status: UNAVAILABLE }).badge).toEqual({
      kind: 'error',
      label: 'Unavailable'
    });
  });

  it('says an active session persists for the tab until Stop or close, naming the host', () => {
    const view = builderEntryView({ kind: 'known', status: activeRecord() });
    expect(view.badge).toEqual({ kind: 'ok', label: 'On' });
    expect(view.description).toContain(new URL(activeRecord().origin).host);
    expect(view.description).toMatch(/until Stop or the tab closes/);
    // Honest: whether this page was rewritten is the overlay's to tell.
    expect(view.description).toMatch(/Open the builder to see this page’s result/);
  });
});

describe('openFeedback', () => {
  it('confirms an injected open and names each failure’s remedy', () => {
    expect(openFeedback({ kind: 'reply', reply: 'injected' })).toEqual({
      tone: 'success',
      title: 'Exclusion builder opened on the page'
    });
    expect(openFeedback({ kind: 'reply', reply: 'unsupported-page' })).toMatchObject({
      tone: 'error',
      description: 'Open a regular http or https page in this tab.'
    });
    expect(openFeedback({ kind: 'reply', reply: 'tab-gone' }).description).toBe(
      'The inspected tab is gone.'
    );
    for (const outcome of [
      { kind: 'reply', reply: 'failed' },
      { kind: 'no-receiver' },
      { kind: 'timeout' },
      { kind: 'invalid-reply' },
      { kind: 'failed', cause: 1 }
    ] as const) {
      const feedback = openFeedback(outcome);
      expect(feedback).toMatchObject({ tone: 'error', title: 'The exclusion builder didn’t open' });
      expect(feedback.description).toMatch(/toolbar button’s menu/);
    }
  });
});
