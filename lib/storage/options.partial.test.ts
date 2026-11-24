/**
 * Partial-shape reads: a stored options value holding only `improvements`
 * (no `appearance`, no `features`) keeps every stored choice, defaults the
 * missing slots, and survives a whole-shape write by another slot's writer.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { FALLBACK, getOptions, setAppearanceOption } from './options';

/** An options value with the `improvements` slot only. */
const IMPROVEMENTS_ONLY = { improvements: { 'wp-dashboard-dbugger-entry': false } };

beforeEach(() => {
  fakeBrowser.reset();
});

describe('options stored with the improvements slot only', () => {
  it('keeps the stored improvement and defaults the missing slots', async () => {
    await fakeBrowser.storage.sync.set({ options: IMPROVEMENTS_ONLY });
    expect(await getOptions()).toEqual({
      improvements: { 'wp-dashboard-dbugger-entry': false },
      appearance: FALLBACK.appearance,
      features: { ...FALLBACK.features }
    });
  });

  it('keeps an enabled improvement as stored', async () => {
    await fakeBrowser.storage.sync.set({
      options: { improvements: { 'wp-dashboard-dbugger-entry': true } }
    });
    expect((await getOptions()).improvements).toEqual({ 'wp-dashboard-dbugger-entry': true });
  });

  it('keeps the stored improvement through another slot’s write', async () => {
    await fakeBrowser.storage.sync.set({ options: IMPROVEMENTS_ONLY });
    await setAppearanceOption('dark');
    const { options } = await fakeBrowser.storage.sync.get('options');
    expect(options).toEqual({
      improvements: { 'wp-dashboard-dbugger-entry': false },
      appearance: 'dark',
      features: { ...FALLBACK.features }
    });
  });

  it('leaves unrelated sync keys alone on that write', async () => {
    await fakeBrowser.storage.sync.set({ options: IMPROVEMENTS_ONLY, other: { kept: 1 } });
    await setAppearanceOption('light');
    expect((await fakeBrowser.storage.sync.get('other')).other).toEqual({ kept: 1 });
  });
});
