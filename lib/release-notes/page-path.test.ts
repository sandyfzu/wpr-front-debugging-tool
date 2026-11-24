/**
 * The page address round trip: the background's `since` reaches the page;
 * a missing, empty or malformed value reads as none.
 */
import { describe, expect, it } from 'vitest';
import { readSinceParam, whatsNewPageUrl } from './page-path';

describe('whatsNewPageUrl / readSinceParam', () => {
  it('round-trips the floor', () => {
    const url = whatsNewPageUrl('chrome-extension://id/whats-new.html', '2.2.5');
    expect(url).toBe('chrome-extension://id/whats-new.html?since=2.2.5');
    expect(readSinceParam(new URL(url).search)).toBe('2.2.5');
  });

  it('reads none when absent, empty or not a version', () => {
    for (const search of ['', '?', '?since=', '?since=abc', '?since=3.0.0-beta', '?other=3.0.0']) {
      expect(readSinceParam(search), search).toBeNull();
    }
  });

  it('takes the first value when repeated', () => {
    expect(readSinceParam('?since=3.0.0&since=bad')).toBe('3.0.0');
  });
});
