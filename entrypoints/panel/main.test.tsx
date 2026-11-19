/**
 * The panel document's boot over the real storage item: a failed stored
 * appearance read still renders the shell on System, releases the paint
 * lock and follows a later write (document + the menu's value).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Accessor } from 'solid-js';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { FALLBACK, optionsStore } from '../../lib/storage/options';
import type { Appearance } from '../../utils/theme';

/** What the stubbed shell received. */
const app = vi.hoisted(() => ({ appearance: undefined as Accessor<Appearance> | undefined }));

vi.mock('./App', () => ({
  default: (props: { appearance: Accessor<Appearance> }) => {
    // Captured for the test to read (a stub, not a reactive consumer).
    // eslint-disable-next-line solid/reactivity
    app.appearance = props.appearance;
    return null;
  }
}));

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = '<div id="root"></div>';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-lock');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('panel boot — appearance', () => {
  // One boot per file: the module boots once on import.
  it('a failed read renders on System, releases the lock and follows a later write', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(optionsStore, 'getValue').mockRejectedValueOnce(
      new Error('Extension context invalidated')
    );
    await import('./main');
    await vi.waitFor(() => {
      expect(app.appearance).toBeDefined();
    });
    expect(app.appearance?.()).toBe('system');
    expect(document.documentElement.getAttribute('data-theme-lock')).toBe('done');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(
      warn.mock.calls.some((call) => /Stored appearance could not be read/.test(String(call[0])))
    ).toBe(true);
    // The menu's own pick (or the options page) writes: document and menu follow.
    await fakeBrowser.storage.sync.set({ options: { ...FALLBACK, appearance: 'light' } });
    await vi.waitFor(() => {
      expect(app.appearance?.()).toBe('light');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
