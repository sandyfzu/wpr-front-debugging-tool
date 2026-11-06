import { describe, expect, it, vi } from 'vitest';
import { chromiumExtensionApi, pinChromeNamespace } from './chromium';
import {
  clobberingCollection,
  clobberingForm,
  EXTENSION_ID,
  namespace,
  sendingNamespace,
  windowScope
} from './scopes.fixtures';

describe('chromiumExtensionApi', () => {
  it('takes the genuine native browser (an own global with a runtime id)', () => {
    const browser = namespace();
    const chrome = namespace();
    expect(chromiumExtensionApi(windowScope({ browser, chrome }))).toBe(browser);
  });

  it('takes chrome when the browser has no native browser namespace', () => {
    const chrome = namespace();
    expect(chromiumExtensionApi(windowScope({ chrome }))).toBe(chrome);
    expect(chromiumExtensionApi(windowScope({ browser: undefined, chrome }))).toBe(chrome);
  });

  it('refuses a clobbering form, even one forging the real extension id', () => {
    const chrome = namespace();
    for (const forgedId of ['x', EXTENSION_ID]) {
      const form = clobberingForm(forgedId);
      expect(form.runtime.id).toBe(forgedId);
      expect(chromiumExtensionApi(windowScope({ chrome }, { browser: form }))).toBe(chrome);
    }
  });

  it('refuses the HTMLCollection of two id="browser" elements, though it carries the real id', () => {
    const chrome = namespace();
    const collection = clobberingCollection();
    expect(collection).toBeInstanceOf(HTMLCollection);
    expect(collection.length).toBe(2);
    expect(chromiumExtensionApi(windowScope({ chrome }, { browser: collection }))).toBe(chrome);
  });

  it('refuses an own browser without a runtime id', () => {
    const chrome = namespace();
    for (const browser of [{}, { runtime: {} }, { runtime: { id: '' } }, null, 'browser']) {
      expect(chromiumExtensionApi(windowScope({ browser, chrome }))).toBe(chrome);
    }
  });

  it('returns chrome as is when nothing genuine is left (both names clobbered)', () => {
    const forgedChrome = clobberingForm('y');
    const scope = windowScope({}, { browser: clobberingForm('x'), chrome: forgedChrome });
    expect(chromiumExtensionApi(scope)).toBe(forgedChrome);
  });

  it('answers undefined where no extension namespace exists at all', () => {
    expect(chromiumExtensionApi(windowScope({}))).toBeUndefined();
  });
});

describe('pinChromeNamespace', () => {
  /** The own `chrome` descriptor of a scope, if any. */
  const ownChrome = (scope: object): PropertyDescriptor | undefined =>
    Object.getOwnPropertyDescriptor(scope, 'chrome');

  it('pins the namespace over a named-access chrome (form, collection, root element)', () => {
    for (const forged of [clobberingForm('y'), clobberingCollection(), document.documentElement]) {
      const browser = sendingNamespace();
      const scope = windowScope({ browser }, { chrome: forged });
      expect(pinChromeNamespace(scope, browser)).toBe(browser);
      expect(scope.chrome).toBe(browser);
      // The genuine global's attributes; an own property outranks named access.
      expect(ownChrome(scope)).toEqual({
        value: browser,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  });

  it('pins the namespace where chrome is missing altogether', () => {
    const browser = sendingNamespace();
    const scope = windowScope({ browser });
    pinChromeNamespace(scope, browser);
    expect(scope.chrome).toBe(browser);
  });

  it('leaves an own chrome untouched (service worker, pages, worlds made before parse)', () => {
    const chrome = sendingNamespace();
    const browser = sendingNamespace();
    const scope = windowScope({ browser, chrome });
    expect(pinChromeNamespace(scope, browser)).toBe(browser);
    expect(scope.chrome).toBe(chrome);
  });

  it('pins nothing that cannot send (a forged or missing namespace)', () => {
    for (const candidate of [clobberingForm('y'), namespace(), { runtime: {} }, null, undefined]) {
      const forged = clobberingForm('z');
      const scope = windowScope({}, { chrome: forged });
      expect(pinChromeNamespace(scope, candidate)).toBe(candidate);
      expect(ownChrome(scope)).toBeUndefined();
      expect(scope.chrome).toBe(forged);
    }
  });

  it('pins what the resolver picked: the genuine browser over a forged chrome', () => {
    const browser = sendingNamespace();
    const scope = windowScope({ browser }, { chrome: clobberingForm('y') });
    pinChromeNamespace(scope, chromiumExtensionApi(scope));
    expect(scope.chrome).toBe(browser);
  });

  it('logs and returns the namespace when the global refuses the property', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const browser = sendingNamespace();
    const scope = Object.preventExtensions(windowScope({ browser }));
    expect(pinChromeNamespace(scope, browser)).toBe(browser);
    expect(ownChrome(scope)).toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      '[WPR FDT] Pinning the chrome namespace failed',
      expect.any(TypeError)
    );
    error.mockRestore();
  });
});
