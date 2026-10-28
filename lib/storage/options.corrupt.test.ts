/**
 * Corrupt-storage resilience: reads that come back structurally broken never
 * reach surfaces — the validator resets them to documented defaults.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { getOptions, parseStoredOptions, storedOptionsOrFallback } from './options';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('getOptions with corrupt storage', () => {
  it('resets a corrupted value to the shipped defaults', async () => {
    await fakeBrowser.storage.sync.set({ options: { improvements: 'x' } });
    const options = await getOptions();
    expect(options).toEqual({
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'system',
      features: {
        toolbarBadge: true,
        sbsScrollSync: true,
        sbsMobileSim: false,
        sbsDesktopWidth: true,
        detectionWidget: true
      }
    });
  });

  it('drops non-boolean feature flags instead of trusting them', async () => {
    await fakeBrowser.storage.sync.set({
      options: {
        improvements: {},
        appearance: 'dark',
        features: {
          toolbarBadge: 'yes',
          sbsScrollSync: 'on',
          sbsMobileSim: 'yes',
          sbsDesktopWidth: 'off'
        }
      }
    });
    const options = await getOptions();
    expect(options.appearance).toBe('dark');
    expect(options.features.toolbarBadge).toBe(true);
    expect(options.features.sbsScrollSync).toBe(true);
    expect(options.features.sbsMobileSim).toBe(false);
    expect(options.features.sbsDesktopWidth).toBe(true);
    // And the empty improvements slot self-heals its documented entry.
    expect(options.improvements['wp-dashboard-dbugger-entry']).toBe(true);
  });

  it('resets a non-object storage value to the defaults', async () => {
    await fakeBrowser.storage.sync.set({ options: 'corrupted' });
    const options = await getOptions();
    expect(options).toEqual({
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'system',
      features: {
        toolbarBadge: true,
        sbsScrollSync: true,
        sbsMobileSim: false,
        sbsDesktopWidth: true,
        detectionWidget: true
      }
    });
  });

  it('accepts every legal appearance value', () => {
    for (const appearance of ['system', 'dark', 'light'] as const) {
      expect(parseStoredOptions({ improvements: {}, appearance, features: {} })?.appearance).toBe(
        appearance
      );
    }
  });
});

describe('storedOptionsOrFallback', () => {
  it('returns the validated value unchanged when it parses', () => {
    const parsed = parseStoredOptions({ improvements: {}, appearance: 'dark', features: {} });
    expect(parsed).not.toBeNull();
    expect(storedOptionsOrFallback({ improvements: {}, appearance: 'dark', features: {} })).toEqual(
      parsed
    );
  });

  it('degrades every rejected value to the documented defaults', () => {
    for (const rejected of [null, 'corrupted', 42, [], { appearance: 'blueprint' }]) {
      expect(storedOptionsOrFallback(rejected)).toEqual({
        improvements: { 'wp-dashboard-dbugger-entry': true },
        appearance: 'system',
        features: {
          toolbarBadge: true,
          sbsScrollSync: true,
          sbsMobileSim: false,
          sbsDesktopWidth: true,
          detectionWidget: true
        }
      });
    }
  });

  it('hands out fresh copies — mutating a result never corrupts the defaults', () => {
    const degraded = storedOptionsOrFallback('corrupted');
    degraded.features.toolbarBadge = false;
    degraded.improvements['wp-dashboard-dbugger-entry'] = false;
    const fresh = storedOptionsOrFallback('corrupted');
    expect(fresh.features.toolbarBadge).toBe(true);
    expect(fresh.improvements['wp-dashboard-dbugger-entry']).toBe(true);
  });
});
