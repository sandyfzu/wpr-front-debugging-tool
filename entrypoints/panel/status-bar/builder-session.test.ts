import { describe, expect, it } from 'vitest';
import type { ExclusionSessionSummary } from '../../../lib/messaging/exclusion-panel';
import {
  BUILDER_SESSION_CHECKING,
  builderEntryView,
  openFeedback,
  withAnswer,
  withPush,
  type BuilderSessionState
} from './builder-session';

const INACTIVE: ExclusionSessionSummary = { state: 'inactive' };
const UNAVAILABLE: ExclusionSessionSummary = { state: 'unavailable' };
const ACTIVE: ExclusionSessionSummary = { state: 'active', origin: 'https://example.com:8443' };

describe('withAnswer', () => {
  it('takes the ask’s status, or unknown when it got none', () => {
    expect(withAnswer(BUILDER_SESSION_CHECKING, { kind: 'reply', reply: INACTIVE })).toEqual({
      kind: 'known',
      summary: INACTIVE
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
    const pushed: BuilderSessionState = { kind: 'known', summary: UNAVAILABLE };
    expect(withAnswer(pushed, { kind: 'reply', reply: INACTIVE })).toBe(pushed);
    expect(withAnswer(pushed, { kind: 'timeout' })).toBe(pushed);
  });

  it('takes only the first answer (the entry asks once)', () => {
    const unknown: BuilderSessionState = { kind: 'unknown' };
    expect(withAnswer(unknown, { kind: 'reply', reply: INACTIVE })).toBe(unknown);
  });
});

describe('withPush', () => {
  it('takes the background’s push about the inspected tab', () => {
    expect(
      withPush(BUILDER_SESSION_CHECKING, { tabId: 7, summary: UNAVAILABLE }, 7, false)
    ).toEqual({ kind: 'known', summary: UNAVAILABLE });
  });

  it('drops pushes about other tabs, from a tab, or with no inspected tab', () => {
    const state: BuilderSessionState = { kind: 'known', summary: INACTIVE };
    expect(withPush(state, { tabId: 8, summary: UNAVAILABLE }, 7, false)).toBe(state);
    expect(withPush(state, { tabId: 7, summary: UNAVAILABLE }, 7, true)).toBe(state);
    expect(withPush(state, { tabId: 7, summary: UNAVAILABLE }, null, false)).toBe(state);
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
    expect(builderEntryView({ kind: 'known', summary: INACTIVE })).toEqual({
      badge: { kind: 'neutral', label: 'Off' },
      description: 'No exclusions applied in this tab.'
    });
    expect(builderEntryView({ kind: 'known', summary: UNAVAILABLE }).badge).toEqual({
      kind: 'error',
      label: 'Unavailable'
    });
  });

  it('says an active session persists for the tab until Stop or close, naming the host', () => {
    const view = builderEntryView({ kind: 'known', summary: ACTIVE });
    expect(view.badge).toEqual({ kind: 'ok', label: 'On' });
    expect(view.description).toContain('example.com:8443');
    expect(view.description).not.toContain('https://');
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
    expect(openFeedback({ kind: 'reply', reply: 'revealed' })).toEqual({
      tone: 'success',
      title: 'Exclusion builder shown on the page'
    });
    expect(openFeedback({ kind: 'reply', reply: 'unsupported-page' })).toMatchObject({
      tone: 'error',
      description: 'Open a regular http or https page in this tab.'
    });
    expect(openFeedback({ kind: 'reply', reply: 'not-html' })).toMatchObject({
      tone: 'error',
      description: 'The exclusion builder works on HTML pages, not on images, feeds or other files.'
    });
    expect(openFeedback({ kind: 'reply', reply: 'tab-gone' }).description).toBe(
      'The inspected tab is gone.'
    );
    // The on-page UI gate is off: both ways back are named, the open is not retried blindly.
    expect(openFeedback({ kind: 'reply', reply: 'page-ui-off' })).toEqual({
      tone: 'error',
      title: 'On-page UI is off',
      description:
        'The builder lives on the page. Turn on-page UI back on from the page’s right-click menu (“Turn on all on-page UI”) or the extension’s options (“Show on-page UI”), then open it again.'
    });
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
