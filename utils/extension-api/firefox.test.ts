import { describe, expect, it } from 'vitest';
import { firefoxExtensionApi } from './firefox';
import { namespace, windowScope } from './scopes.fixtures';

describe('firefoxExtensionApi', () => {
  it('takes the native browser, never the callback-style chrome beside it', () => {
    const browser = namespace();
    const chrome = namespace();
    expect(firefoxExtensionApi(windowScope({ browser, chrome }))).toBe(browser);
  });

  it('takes the native browser wherever the global holds it (no own-property requirement)', () => {
    const browser = namespace();
    expect(firefoxExtensionApi(windowScope({}, { browser }))).toBe(browser);
  });

  it('falls back to chrome when browser is absent or has no runtime id', () => {
    const chrome = namespace();
    expect(firefoxExtensionApi(windowScope({ chrome }))).toBe(chrome);
    expect(firefoxExtensionApi(windowScope({ browser: { runtime: {} }, chrome }))).toBe(chrome);
  });

  it('answers undefined where no extension namespace exists at all (a worker, the page world)', () => {
    expect(firefoxExtensionApi(windowScope({}))).toBeUndefined();
  });
});
