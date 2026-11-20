/**
 * The toolbar-button namespace seam: a namespace qualifies only with every
 * display write (badge + tooltip) and a listenable click event, and the test
 * build (Manifest V3, as Chromium ships) selects `browser.action`. Both
 * guards accept Firefox's MV2 `browserAction` shape; the version pick itself
 * is a build-time fold Vitest cannot serve as MV2 (its env defines are
 * strings), so it is proven on the built bundles. The tooltip texts
 * come from the manifest: name, then the button's declared default.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asToolbarClickEvent,
  asToolbarDisplayApi,
  toolbarClickEvent,
  toolbarDisplayApi,
  toolbarTitles,
  toolbarTitlesFrom
} from './toolbar-action';

/** A namespace shaped like either platform's: the four display writes. */
function displayNamespace(): Record<string, () => Promise<void>> {
  const write = (): Promise<void> => Promise.resolve();
  return {
    setBadgeText: write,
    setBadgeBackgroundColor: write,
    setBadgeTextColor: write,
    setTitle: write
  };
}

describe('asToolbarDisplayApi', () => {
  it('accepts a namespace carrying every display write, as the same object', () => {
    const namespace = displayNamespace();
    expect(asToolbarDisplayApi(namespace)).toBe(namespace);
  });

  it.each(['setBadgeText', 'setBadgeBackgroundColor', 'setBadgeTextColor', 'setTitle'])(
    'refuses a namespace without %s',
    (missing) => {
      const namespace = Object.fromEntries(
        Object.entries(displayNamespace()).filter(([name]) => name !== missing)
      );
      expect(asToolbarDisplayApi(namespace)).toBeNull();
    }
  );

  it('refuses a write that is not a function', () => {
    expect(asToolbarDisplayApi({ ...displayNamespace(), setBadgeText: 'nope' })).toBeNull();
    expect(asToolbarDisplayApi({ ...displayNamespace(), setTitle: 'nope' })).toBeNull();
  });

  it.each([undefined, null, 3, 'action'])('refuses the non-namespace %s', (candidate) => {
    expect(asToolbarDisplayApi(candidate)).toBeNull();
  });
});

describe('asToolbarClickEvent', () => {
  it('accepts an onClicked that takes listeners, as the same object', () => {
    const onClicked = { addListener: (): void => undefined };
    expect(asToolbarClickEvent({ onClicked })).toBe(onClicked);
  });

  it.each([
    ['no onClicked', {}],
    ['a null onClicked', { onClicked: null }],
    ['an onClicked without addListener', { onClicked: {} }],
    ['a non-function addListener', { onClicked: { addListener: 'nope' } }]
  ])('refuses a namespace with %s', (_label, namespace) => {
    expect(asToolbarClickEvent(namespace)).toBeNull();
  });

  it.each([undefined, null, 3, 'browserAction'])('refuses the non-namespace %s', (candidate) => {
    expect(asToolbarClickEvent(candidate)).toBeNull();
  });
});

describe("Firefox's Manifest V2 namespace (browser.browserAction)", () => {
  /**
   * `browserAction` as Firefox's MV2 build exposes it (MDN): `action`'s
   * per-tab writes and getters plus `onClicked` — the namespace the MV2
   * bundle hands both guards.
   */
  function browserActionNamespace(): Record<string, unknown> {
    const call = (): Promise<void> => Promise.resolve();
    return {
      ...displayNamespace(),
      getTitle: call,
      getBadgeText: call,
      getBadgeBackgroundColor: call,
      getBadgeTextColor: call,
      setIcon: call,
      setPopup: call,
      getPopup: call,
      openPopup: call,
      enable: call,
      disable: call,
      isEnabled: call,
      onClicked: { addListener: (): void => undefined, removeListener: (): void => undefined }
    };
  }

  it('qualifies as the display API and yields its click event', () => {
    const namespace = browserActionNamespace();
    expect(asToolbarDisplayApi(namespace)).toBe(namespace);
    expect(asToolbarClickEvent(namespace)).toBe(namespace.onClicked);
  });

  it('refuses the display API, never the click, on a browserAction without setBadgeTextColor', () => {
    const namespace = browserActionNamespace();
    delete namespace.setBadgeTextColor;
    // No dot color → no badge at all (never a half-applied one); the click
    // needs only onClicked.
    expect(asToolbarDisplayApi(namespace)).toBeNull();
    expect(asToolbarClickEvent(namespace)).toBe(namespace.onClicked);
  });
});

describe('this build (Manifest V3)', () => {
  it('selects browser.action for the display writes and the click event', () => {
    // Vitest serves `import.meta.env` defines as strings; builds inline the number.
    expect(String(import.meta.env.MANIFEST_VERSION)).toBe('3');
    expect(toolbarDisplayApi()).toBe(fakeBrowser.action);
    expect(toolbarClickEvent()).toBe(fakeBrowser.action.onClicked);
  });
});

describe('toolbarTitlesFrom', () => {
  it('reads the MV3 action default_title next to the name', () => {
    expect(toolbarTitlesFrom({ name: 'Tool', action: { default_title: 'Tool tip' } })).toEqual({
      name: 'Tool',
      defaultTitle: 'Tool tip'
    });
  });

  it('reads the MV2 browser_action default_title', () => {
    expect(
      toolbarTitlesFrom({ name: 'Tool', browser_action: { default_title: 'MV2 tip' } })
    ).toEqual({ name: 'Tool', defaultTitle: 'MV2 tip' });
  });

  it.each([
    ['no button key', { name: 'Tool' }],
    ['an empty default_title', { name: 'Tool', action: { default_title: '' } }],
    ['a non-string default_title', { name: 'Tool', action: { default_title: 7 } }],
    ['a non-object action', { name: 'Tool', action: 'x' }]
  ])('falls back to the name with %s (what the browser shows)', (_label, manifest) => {
    expect(toolbarTitlesFrom(manifest)).toEqual({ name: 'Tool', defaultTitle: 'Tool' });
  });

  it.each([undefined, null, 'manifest', {}, { name: '' }, { name: 4 }])(
    'refuses a manifest without a usable name: %s',
    (manifest) => {
      expect(toolbarTitlesFrom(manifest)).toBeNull();
    }
  );
});

describe('toolbarTitles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the running manifest', () => {
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
      manifest_version: 3,
      name: 'Tool',
      version: '1.0.0',
      action: { default_title: 'Tool tip' }
    });
    expect(toolbarTitles()).toEqual({ name: 'Tool', defaultTitle: 'Tool tip' });
  });

  it('throws on a manifest without a usable name (a broken build)', () => {
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
      manifest_version: 3,
      name: '',
      version: '1.0.0'
    });
    expect(() => toolbarTitles()).toThrow('The extension manifest carries no usable name');
  });
});
