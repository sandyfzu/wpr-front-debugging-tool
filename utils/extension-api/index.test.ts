import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from './index';

describe('extension-api module', () => {
  it('resolves the Chromium rule over the real global at load (test runner = Chromium build)', () => {
    expect(import.meta.env.BROWSER).toBe('chrome');
    // The test runner stubs both globals (own properties) with the fake browser.
    expect(Object.hasOwn(globalThis, 'browser')).toBe(true);
    expect(browser).toBe(fakeBrowser);
  });
});
