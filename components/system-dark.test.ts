/** The OS dark-preference signal: initial read, live changes, cleanup, no `matchMedia`. */
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemDark, PREFERS_DARK_QUERY } from './system-dark';
import { fakeScheme } from './system-dark.fake';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSystemDark', () => {
  it('reads the preference, follows changes, and drops its listener on cleanup', () => {
    const scheme = fakeScheme(true);
    createRoot((dispose) => {
      const dark = createSystemDark(scheme);
      expect(dark()).toBe(true);
      expect(scheme.listeners()).toBe(1);
      scheme.flip(false);
      expect(dark()).toBe(false);
      dispose();
    });
    expect(scheme.listeners()).toBe(0);
  });

  it('answers light where there is no query', () => {
    createRoot((dispose) => {
      expect(createSystemDark(null)()).toBe(false);
      dispose();
    });
  });

  it('defaults to the window query for the OS dark preference', () => {
    const scheme = fakeScheme(true);
    const matchMedia = vi.fn(() => scheme);
    vi.stubGlobal('matchMedia', matchMedia);
    createRoot((dispose) => {
      expect(createSystemDark()()).toBe(true);
      dispose();
    });
    expect(matchMedia).toHaveBeenCalledWith(PREFERS_DARK_QUERY);
    expect(PREFERS_DARK_QUERY).toBe('(prefers-color-scheme: dark)');
  });

  it('answers light where the window has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    createRoot((dispose) => {
      expect(createSystemDark()()).toBe(false);
      dispose();
    });
  });
});
