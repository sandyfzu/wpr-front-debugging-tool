/**
 * Boundary contract for sender tab resolution: junk shapes must never pass as
 * a tab reference, and a genuine tab id must come back unchanged.
 */
import { describe, expect, it } from 'vitest';
import { numericTabId, resolveSenderTabId, resolveSenderUrl } from './sender';

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
