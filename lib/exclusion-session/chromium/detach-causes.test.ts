/** Detach reasons × tab presence → the end cause (or nothing for a closed tab). */
import { describe, expect, it } from 'vitest';
import { endCauseOfDetach, isDebuggerRestrictedUrl, needsTabPresence } from './detach-causes';
import type { TabPresence } from './port';

const PRESENCES: readonly TabPresence[] = ['gone', 'web', 'elsewhere'];

describe('endCauseOfDetach', () => {
  it('reads a cancelled infobar from the reason alone', () => {
    for (const presence of PRESENCES) {
      expect(endCauseOfDetach('canceled_by_user', presence)).toBe('infobar-cancelled');
    }
  });

  it('tells a closed target apart by the tab', () => {
    expect(endCauseOfDetach('target_closed', 'gone')).toBeNull();
    expect(endCauseOfDetach('target_closed', 'elsewhere')).toBe('unsupported-page');
    expect(endCauseOfDetach('target_closed', 'web')).toBe('detached');
  });

  it('treats an unknown reason like a closed target', () => {
    expect(endCauseOfDetach('something_new', 'web')).toBe('detached');
    expect(endCauseOfDetach(undefined, 'gone')).toBeNull();
  });
});

describe('needsTabPresence', () => {
  it('is false only for the infobar cancel', () => {
    expect(needsTabPresence('canceled_by_user')).toBe(false);
    expect(needsTabPresence('target_closed')).toBe(true);
    expect(needsTabPresence(null)).toBe(true);
  });
});

describe('isDebuggerRestrictedUrl', () => {
  it.each([
    'https://chromewebstore.google.com/detail/x/abc',
    'https://chrome.google.com/webstore/category/extensions',
    'https://CHROME.google.com/anything',
    'https://sub.chromewebstore.google.com/'
  ])('restricts the web store: %s', (url) => {
    expect(isDebuggerRestrictedUrl(url)).toBe(true);
  });

  it.each([
    'https://google.com/',
    'https://notchrome.google.com/',
    'https://chromewebstore.google.com.evil.test/',
    'http://127.0.0.1:8493/',
    'not a url'
  ])('leaves other pages alone: %s', (url) => {
    expect(isDebuggerRestrictedUrl(url)).toBe(false);
  });
});
