/**
 * The options document's boot over the real storage item: a failed stored
 * appearance read still renders the page on System, releases the paint lock
 * and follows a later write (document + the choice the app reads).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Accessor } from 'solid-js';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { FALLBACK, optionsStore } from '../../lib/storage/options';
import type { Appearance } from '../../utils/theme';

/** What the stubbed app received. */
const app = vi.hoisted(() => ({ storedAppearance: undefined as Accessor<Appearance> | undefined }));

vi.mock('./App', () => ({
  default: (props: { storedAppearance: Accessor<Appearance> }) => {
    // Captured for the test to read (a stub, not a reactive consumer).
    // eslint-disable-next-line solid/reactivity
    app.storedAppearance = props.storedAppearance;
    return null;
  }
}));

beforeEach(() => {
  fakeBrowser.reset();
  app.storedAppearance = undefined;
  document.body.innerHTML = '<div id="root"></div>';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-lock');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('options boot — appearance', () => {
  // One boot per file: the module boots once on import.
  it('a failed read renders on System, releases the lock and follows a later write', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
      manifest_version: 3,
      name: 'WPR FDT',
      version: '1.0.0'
    });
    vi.spyOn(optionsStore, 'getValue').mockRejectedValueOnce(
      new Error('Extension context invalidated')
    );
    await import('./main');
    await vi.waitFor(() => {
      expect(app.storedAppearance).toBeDefined();
    });
    expect(app.storedAppearance?.()).toBe('system');
    expect(document.documentElement.getAttribute('data-theme-lock')).toBe('done');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(
      warn.mock.calls.some((call) => /Stored appearance could not be read/.test(String(call[0])))
    ).toBe(true);
    // Another surface (or this page) writes: the document and the app follow.
    await fakeBrowser.storage.sync.set({ options: { ...FALLBACK, appearance: 'dark' } });
    await vi.waitFor(() => {
      expect(app.storedAppearance?.()).toBe('dark');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
