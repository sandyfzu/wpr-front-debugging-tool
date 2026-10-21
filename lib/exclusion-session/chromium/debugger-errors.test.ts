/**
 * Attach-error mapping: every message Chromium answers (its own constants,
 * with the ids/URLs it fills in) maps to its cause; "already attached" is
 * this extension's own session; anything unknown is retryable.
 */
import { describe, expect, it } from 'vitest';
import { classifyAttachError, errorMessage, isNotAttachedError } from './debugger-errors';

describe('classifyAttachError', () => {
  it.each([
    ['Cannot attach to this target.', 'debugging-policy'],
    ['This page cannot be scripted due to an ExtensionsSettings policy.', 'debugging-policy'],
    ['Host access is restricted by policy.', 'debugging-policy'],
    ['Screenshot capture is restricted by policy.', 'debugging-policy'],
    ['Screenshot capture is restricted on this target.', 'debugging-policy'],
    ['Cannot access a chrome:// URL', 'unsupported-page'],
    ['Cannot access a chrome-extension:// URL of different extension', 'unsupported-page'],
    [
      'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
      'unsupported-page'
    ],
    ['Cannot access contents of url "file:///x". Extension manifest must…', 'unsupported-page'],
    ['The extensions gallery cannot be scripted.', 'unsupported-page'],
    ['The New Tab Page cannot be scripted.', 'unsupported-page'],
    ['Cannot navigate to a file URL without local file access.', 'unsupported-page'],
    ['No tab with given id 999999.', 'detached']
  ])('maps %j to %s', (message, cause) => {
    expect(classifyAttachError(new Error(message))).toEqual({
      kind: 'unavailable',
      cause,
      known: true
    });
  });

  it('reads "already attached" (observed text) as this extension’s own session', () => {
    expect(
      classifyAttachError(new Error('Another debugger is already attached to the tab with id: 7.'))
    ).toEqual({ kind: 'already-attached' });
  });

  it('maps an unknown failure to the retryable attach-denied, flagged unknown', () => {
    expect(classifyAttachError(new Error('Something new'))).toEqual({
      kind: 'unavailable',
      cause: 'attach-denied',
      known: false
    });
    expect(classifyAttachError('not an error')).toMatchObject({ cause: 'attach-denied' });
  });

  it('never matches a message that merely contains a rule’s text', () => {
    expect(classifyAttachError(new Error('x Cannot attach to this target.'))).toMatchObject({
      known: false
    });
  });
});

describe('isNotAttachedError', () => {
  it('recognizes the no-session and gone-tab failures only', () => {
    expect(isNotAttachedError(new Error('Debugger is not attached to the tab with id: 3.'))).toBe(
      true
    );
    expect(isNotAttachedError(new Error('No tab with given id 3.'))).toBe(true);
    expect(isNotAttachedError(new Error('Detached while handling command.'))).toBe(false);
    expect(isNotAttachedError(undefined)).toBe(false);
  });
});

describe('errorMessage', () => {
  it('reads an Error’s message and stringifies anything else', () => {
    expect(errorMessage(new Error('m'))).toBe('m');
    expect(errorMessage(42)).toBe('42');
  });
});
