/**
 * The toolbar-button namespace seam: a namespace qualifies only with every
 * badge write, and the test build (Manifest V3, as Chromium ships) selects
 * `browser.action` — the Manifest V2 selection is proven on the built bundle.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { describe, expect, it } from 'vitest';
import { asToolbarBadgeApi, toolbarBadgeApi } from './toolbar-action';

/** A namespace shaped like either platform's: the three badge writes. */
function badgeNamespace(): Record<string, () => Promise<void>> {
  const write = (): Promise<void> => Promise.resolve();
  return { setBadgeText: write, setBadgeBackgroundColor: write, setBadgeTextColor: write };
}

describe('asToolbarBadgeApi', () => {
  it('accepts a namespace carrying every badge write, as the same object', () => {
    const namespace = badgeNamespace();
    expect(asToolbarBadgeApi(namespace)).toBe(namespace);
  });

  it.each(['setBadgeText', 'setBadgeBackgroundColor', 'setBadgeTextColor'])(
    'refuses a namespace without %s',
    (missing) => {
      const namespace = Object.fromEntries(
        Object.entries(badgeNamespace()).filter(([name]) => name !== missing)
      );
      expect(asToolbarBadgeApi(namespace)).toBeNull();
    }
  );

  it('refuses a write that is not a function', () => {
    expect(asToolbarBadgeApi({ ...badgeNamespace(), setBadgeText: 'nope' })).toBeNull();
  });

  it.each([undefined, null, 3, 'action'])('refuses the non-namespace %s', (candidate) => {
    expect(asToolbarBadgeApi(candidate)).toBeNull();
  });
});

describe('toolbarBadgeApi', () => {
  it('selects browser.action on a Manifest V3 build', () => {
    // Vitest serves `import.meta.env` defines as strings; builds inline the number.
    expect(String(import.meta.env.MANIFEST_VERSION)).toBe('3');
    expect(toolbarBadgeApi()).toBe(fakeBrowser.action);
  });
});
