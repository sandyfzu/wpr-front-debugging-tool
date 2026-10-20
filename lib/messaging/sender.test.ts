/**
 * Boundary contract for sender tab resolution: junk shapes must never pass as
 * a tab reference, and a genuine tab id must come back unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  isExtensionPageSender,
  numericTabId,
  resolveSenderTabId,
  resolveSenderUrl,
  resolveTopFrameSender
} from './sender';

describe('resolveSenderTabId', () => {
  it('returns the numeric tab id of a page-originated sender', () => {
    expect(resolveSenderTabId({ tab: { id: 17 } })).toBe(17);
  });

  it('yields null for senders without a tab', () => {
    // Extension pages (panel, popup, options) and internal sends have none.
    expect(resolveSenderTabId(undefined)).toBeNull();
    expect(resolveSenderTabId({})).toBeNull();
    expect(resolveSenderTabId({ tab: undefined })).toBeNull();
    expect(resolveSenderTabId({ tab: {} })).toBeNull();
  });
});

describe('numericTabId', () => {
  it('accepts only non-negative integers', () => {
    // A malformed or hand-crafted tab reference must be ignored, never
    // trusted with per-tab data lookups.
    expect(numericTabId(17)).toBe(17);
    expect(numericTabId(0)).toBe(0);
    expect(numericTabId('12')).toBeNull();
    expect(numericTabId(1.5)).toBeNull();
    expect(numericTabId(-1)).toBeNull();
    expect(numericTabId(Number.NaN)).toBeNull();
    expect(numericTabId(null)).toBeNull();
    expect(numericTabId(undefined)).toBeNull();
  });

  it('rejects integers past the safe range — they no longer round-trip as ids', () => {
    expect(numericTabId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(numericTabId(2 ** 60)).toBeNull();
    expect(numericTabId(1e21)).toBeNull();
    expect(numericTabId(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('backs the sender-level lookup with the same rules', () => {
    expect(resolveSenderTabId({ tab: { id: '12' } })).toBeNull();
    expect(resolveSenderTabId({ tab: { id: -1 } })).toBeNull();
  });
});

describe('resolveSenderUrl', () => {
  it('parses the sending frame URL of a content-script sender', () => {
    const url = resolveSenderUrl({ url: 'https://example.dev/page?x=1' });
    expect(url?.host).toBe('example.dev');
    expect(url?.pathname).toBe('/page');
  });

  it('yields null for senders without a usable URL', () => {
    // Extension surfaces (no URL), and page senders with a junk or absent one:
    // callers refuse these, they never guess a host.
    expect(resolveSenderUrl(undefined)).toBeNull();
    expect(resolveSenderUrl({})).toBeNull();
    expect(resolveSenderUrl({ url: undefined })).toBeNull();
    expect(resolveSenderUrl({ url: 42 })).toBeNull();
    expect(resolveSenderUrl({ url: 'not-a-url' })).toBeNull();
  });
});

describe('resolveTopFrameSender', () => {
  const top = { tab: { id: 7 }, frameId: 0, url: 'https://Example.dev:443/a/b?q=1#h' };

  it('resolves a top-frame http(s) content script to its tab and canonical origin', () => {
    expect(resolveTopFrameSender(top)).toEqual({ tabId: 7, origin: 'https://example.dev' });
    expect(resolveTopFrameSender({ ...top, url: 'http://127.0.0.1:8080/' })).toEqual({
      tabId: 7,
      origin: 'http://127.0.0.1:8080'
    });
  });

  it('refuses subframes, missing or junk frame ids', () => {
    for (const frameId of [1, undefined, '0', null, -0.5]) {
      expect(resolveTopFrameSender({ ...top, frameId }), String(frameId)).toBeNull();
    }
  });

  it('refuses senders without a usable tab', () => {
    expect(resolveTopFrameSender(undefined)).toBeNull();
    expect(resolveTopFrameSender({ ...top, tab: undefined })).toBeNull();
    expect(resolveTopFrameSender({ ...top, tab: { id: '7' } })).toBeNull();
  });

  it('refuses non-http(s) pages and junk URLs', () => {
    for (const url of [
      'chrome://settings/',
      'about:blank',
      'file:///tmp/a.html',
      'data:text/html,x',
      'not-a-url',
      undefined,
      5
    ]) {
      expect(resolveTopFrameSender({ ...top, url }), String(url)).toBeNull();
    }
  });
});

describe('isExtensionPageSender', () => {
  const ours = 'abcdefghijklmnopabcdefghijklmnop';

  it('accepts a tab-less sender carrying our extension id', () => {
    expect(isExtensionPageSender({ id: ours }, ours)).toBe(true);
    expect(isExtensionPageSender({ id: ours, tab: undefined }, ours)).toBe(true);
  });

  it('refuses tab senders, foreign or missing ids, and no sender', () => {
    expect(isExtensionPageSender({ id: ours, tab: { id: 3 } }, ours)).toBe(false);
    expect(isExtensionPageSender({ id: 'other' }, ours)).toBe(false);
    expect(isExtensionPageSender({}, ours)).toBe(false);
    expect(isExtensionPageSender(undefined, ours)).toBe(false);
  });
});
