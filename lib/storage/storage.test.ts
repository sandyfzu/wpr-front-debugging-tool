/**
 * Storage contract tests over the fake browser — the fallbacks, the
 * validator, and corrupt-value resilience are the guarantees surfaces rely
 * on; meta book-keeping is verified here too (the meta updater owns writing it).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cycleAppearanceOption,
  getOptions,
  mutateOptions,
  optionsStore,
  parseStoredOptions,
  setAppearanceOption
} from './options';
import { getKnownConflicts, knownConflictsStore } from './known-conflicts';
import { KNOWN_CONFLICTS_SEED_LENGTH, getKnownConflictsSeed } from './known-conflicts-seed';
import { parseKnownConflicts } from '../messaging/validate';
import seedJson from '../known-conflicts/known-conflicts-db.json';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('optionsStore', () => {
  it('starts from the documented fallback on a fresh install', async () => {
    expect(await optionsStore.getValue()).toEqual({
      improvements: {
        'wp-dashboard-dbugger-entry': true
      },
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

  it('persists written options and reads them back through the validator', async () => {
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': false },
      appearance: 'dark',
      features: {
        toolbarBadge: false,
        sbsScrollSync: true,
        sbsMobileSim: false,
        sbsDesktopWidth: false,
        detectionWidget: true
      }
    });
    expect(await getOptions()).toEqual({
      improvements: { 'wp-dashboard-dbugger-entry': false },
      appearance: 'dark',
      features: {
        toolbarBadge: false,
        sbsScrollSync: true,
        sbsMobileSim: false,
        sbsDesktopWidth: false,
        detectionWidget: true
      }
    });
    // Absence must resolve to defaults, not falsy values.
    await optionsStore.removeValue();
    const reset = await getOptions();
    expect(reset.appearance).toBe('system');
    expect(reset.features.toolbarBadge).toBe(true);
    expect(reset.features.sbsScrollSync).toBe(true);
    expect(reset.features.sbsMobileSim).toBe(false);
    expect(reset.features.sbsDesktopWidth).toBe(true);
    expect(reset.improvements['wp-dashboard-dbugger-entry']).toBe(true);
  });

  it('persists the mobile-simulation choice and honors the written value on read-back', async () => {
    // The overlay's switch writes the whole shape read-modify-write; the
    // written choice must round-trip exactly (default off, written on stays on).
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'system',
      features: {
        toolbarBadge: true,
        sbsScrollSync: true,
        sbsMobileSim: true,
        sbsDesktopWidth: true,
        detectionWidget: true
      }
    });
    const readBack = await getOptions();
    expect(readBack.features.sbsMobileSim).toBe(true);
    await optionsStore.removeValue();
    expect((await getOptions()).features.sbsMobileSim).toBe(false);
  });

  it('persists the desktop-width choice and honors the written value on read-back', async () => {
    // Same seam as the other overlay flags: default on, written off stays off.
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'system',
      features: {
        toolbarBadge: true,
        sbsScrollSync: true,
        sbsMobileSim: false,
        sbsDesktopWidth: false,
        detectionWidget: true
      }
    });
    expect((await getOptions()).features.sbsDesktopWidth).toBe(false);
    await optionsStore.removeValue();
    expect((await getOptions()).features.sbsDesktopWidth).toBe(true);
  });
});

describe('cycleAppearanceOption (the keyboard appearance cycle)', () => {
  it('advances the stored appearance through the registry order, wrapping', async () => {
    await cycleAppearanceOption();
    expect((await getOptions()).appearance).toBe('dark');
    await cycleAppearanceOption();
    expect((await getOptions()).appearance).toBe('light');
    await cycleAppearanceOption();
    expect((await getOptions()).appearance).toBe('system');
  });

  it('preserves every other option slot through the read-modify-write', async () => {
    // A surface's pre-existing flags (including unknown future ids) must
    // survive a later writer that only changes the appearance slot.
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': false, 'future-flag': true },
      appearance: 'dark',
      features: {
        toolbarBadge: false,
        sbsScrollSync: true,
        sbsMobileSim: true,
        sbsDesktopWidth: true,
        detectionWidget: true
      }
    });
    await cycleAppearanceOption();
    const options = await getOptions();
    expect(options.appearance).toBe('light');
    expect(options.improvements).toEqual({
      'wp-dashboard-dbugger-entry': false,
      'future-flag': true
    });
    expect(options.features.toolbarBadge).toBe(false);
    expect(options.features.sbsMobileSim).toBe(true);
  });
});

describe("setAppearanceOption (the options page's choice seam)", () => {
  it('stores the exact choice it is given', async () => {
    await setAppearanceOption('dark');
    expect((await getOptions()).appearance).toBe('dark');
    await setAppearanceOption('light');
    expect((await getOptions()).appearance).toBe('light');
  });

  it('preserves every other option slot through the read-modify-write', async () => {
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': true, 'future-flag': false },
      appearance: 'dark',
      features: {
        toolbarBadge: false,
        sbsScrollSync: false,
        sbsMobileSim: true,
        sbsDesktopWidth: true,
        detectionWidget: true
      }
    });
    await setAppearanceOption('system');
    const options = await getOptions();
    expect(options.appearance).toBe('system');
    expect(options.improvements).toEqual({
      'wp-dashboard-dbugger-entry': true,
      'future-flag': false
    });
    expect(options.features.toolbarBadge).toBe(false);
    expect(options.features.sbsScrollSync).toBe(false);
  });
});

describe('mutateOptions (the whole-shape RMW queue)', () => {
  it("a queued mutation reads the previous mutation's write (interleave-safe)", async () => {
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'dark',
      features: {
        toolbarBadge: true,
        sbsScrollSync: true,
        sbsMobileSim: false,
        sbsDesktopWidth: true,
        detectionWidget: true
      }
    });
    // Two mutations enter the queue before either resolves; both closures run
    // at the same microtask if unsynchronized. Unqueued, the second's read
    // would race the first's write and revert it; serialized, it applies onto
    // the first's shape and returns it as its own write.
    const first = mutateOptions((options) => ({ ...options, appearance: 'light' }));
    const second = mutateOptions((options) => ({
      ...options,
      features: { ...options.features, toolbarBadge: false }
    }));
    const [writtenFirst, writtenSecond] = await Promise.all([first, second]);
    expect(writtenFirst.appearance).toBe('light');
    expect(writtenSecond.appearance).toBe('light');
    expect(writtenSecond.features.toolbarBadge).toBe(false);
    expect((await getOptions()).features.toolbarBadge).toBe(false);
  });

  it('a rejecting mutation propagates to its own caller without stalling the queue', async () => {
    const failing = mutateOptions(() => {
      throw new Error('the write failed');
    });
    await expect(failing).rejects.toThrow('the write failed');
    // The next mutation still runs — and writes through the validator's shape.
    const next = mutateOptions((options) => ({ ...options, appearance: 'dark' }));
    await expect(next).resolves.toMatchObject({ appearance: 'dark' });
    expect((await getOptions()).appearance).toBe('dark');
  });
});

describe('parseStoredOptions', () => {
  it('validates the appearance vocabulary strictly', () => {
    expect(
      parseStoredOptions({ improvements: {}, appearance: 'neon', features: {} })?.appearance
    ).toBe('system');
    expect(
      parseStoredOptions({ improvements: {}, appearance: 'dark', features: {} })?.appearance
    ).toBe('dark');
  });

  it('self-heals improvements to the documented default and keeps unknown boolean ids', () => {
    // Wrong-typed dbugger entry → documented default; unknown future ids
    // (boolean) stay readable — the "tolerant of unknown fields" seam rule.
    const healed = parseStoredOptions({
      improvements: { 'wp-dashboard-dbugger-entry': 'yes', 'future-addition': false },
      appearance: 'light',
      features: { toolbarBadge: false, sbsMobileSim: true }
    });
    expect(healed?.improvements).toEqual({
      'wp-dashboard-dbugger-entry': true,
      'future-addition': false
    });
    // Absent dbugger entry → default true.
    expect(
      parseStoredOptions({ improvements: {}, appearance: 'system', features: {} })?.improvements
    ).toEqual({
      'wp-dashboard-dbugger-entry': true
    });
    // A corrupt improvements slot keeps the rest and self-heals this one.
    expect(
      parseStoredOptions({
        improvements: 'nope',
        appearance: 'light',
        features: { toolbarBadge: false }
      })
    ).toEqual({
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'light',
      features: {
        toolbarBadge: false,
        sbsScrollSync: true,
        sbsMobileSim: false,
        sbsDesktopWidth: true,
        detectionWidget: true
      }
    });
    expect(parseStoredOptions(null)).toBeNull();
    expect(parseStoredOptions('black')).toBeNull();
    expect(parseStoredOptions([])).toBeNull();
  });

  it('validates each feature flag on its own, defaulting the absent or wrong-typed one', () => {
    expect(
      parseStoredOptions({
        improvements: {},
        appearance: 'dark',
        features: {
          toolbarBadge: false,
          sbsScrollSync: true,
          sbsMobileSim: true,
          sbsDesktopWidth: false,
          detectionWidget: true
        }
      })?.features
    ).toEqual({
      toolbarBadge: false,
      sbsScrollSync: true,
      sbsMobileSim: true,
      sbsDesktopWidth: false,
      detectionWidget: true
    });
    // Wrong-typed scroll sync → documented default (on); the sibling flag keeps its value.
    expect(
      parseStoredOptions({
        improvements: {},
        appearance: 'dark',
        features: { toolbarBadge: false, sbsScrollSync: 'off' }
      })?.features
    ).toEqual({
      toolbarBadge: false,
      sbsScrollSync: true,
      sbsMobileSim: false,
      sbsDesktopWidth: true,
      detectionWidget: true
    });
    // Wrong-typed mobile sim → documented default (off); the sibling flags keep theirs.
    expect(
      parseStoredOptions({
        improvements: {},
        appearance: 'dark',
        features: { toolbarBadge: false, sbsScrollSync: true, sbsMobileSim: 'on' }
      })?.features
    ).toEqual({
      toolbarBadge: false,
      sbsScrollSync: true,
      sbsMobileSim: false,
      sbsDesktopWidth: true,
      detectionWidget: true
    });
    // Wrong-typed desktop width → documented default (on); the sibling flags keep theirs.
    expect(
      parseStoredOptions({
        improvements: {},
        appearance: 'dark',
        features: {
          toolbarBadge: false,
          sbsScrollSync: true,
          sbsMobileSim: true,
          sbsDesktopWidth: 'off'
        }
      })?.features
    ).toEqual({
      toolbarBadge: false,
      sbsScrollSync: true,
      sbsMobileSim: true,
      sbsDesktopWidth: true,
      detectionWidget: true
    });
    // A corrupt features slot self-heals all four known flags (the improvements slot's twin rule).
    expect(
      parseStoredOptions({ improvements: {}, appearance: 'dark', features: 'nope' })?.features
    ).toEqual({
      toolbarBadge: true,
      sbsScrollSync: true,
      sbsMobileSim: false,
      sbsDesktopWidth: true,
      detectionWidget: true
    });
  });

  it('keeps future additive boolean feature ids so read-modify-write never erases them', () => {
    // The same seam rule the improvements slot carries: a feature added by a
    // later version must survive the round trip through this validator.
    expect(
      parseStoredOptions({
        improvements: {},
        appearance: 'dark',
        features: {
          toolbarBadge: true,
          sbsScrollSync: false,
          sbsMobileSim: true,
          sbsDesktopWidth: false,
          'future-feature': true
        }
      })?.features
    ).toEqual({
      toolbarBadge: true,
      sbsScrollSync: false,
      sbsMobileSim: true,
      sbsDesktopWidth: false,
      detectionWidget: true,
      'future-feature': true
    });
    // Non-boolean future ids are not engine output — dropped, not trusted,
    // while the known flags take their values (absent → defaults).
    expect(
      parseStoredOptions({
        improvements: {},
        appearance: 'dark',
        features: { 'future-feature': 'yes' }
      })?.features
    ).toEqual({
      toolbarBadge: true,
      sbsScrollSync: true,
      sbsMobileSim: false,
      sbsDesktopWidth: true,
      detectionWidget: true
    });
  });
});

describe('knownConflictsStore', () => {
  it("reads empty on fresh storage — seeding is the background bundle's job", async () => {
    // The committed snapshot ships only in the background bundle (as its own
    // asset); every other surface must see "no usable value" and ask the
    // background, never carry the ~77 KB data file to degrade into.
    expect(await knownConflictsStore.getValue()).toBeNull();
    expect(await getKnownConflicts()).toBeNull();
  });

  it('the committed snapshot stays valid and is pinned at exactly 176 rows', () => {
    // Exact-count pin: silently losing rows (a truncated data file, a bad
    // import) would pass shape checks but ship a blind spot in conflict UIs.
    expect(KNOWN_CONFLICTS_SEED_LENGTH).toBe(176);
    expect(seedJson).toHaveLength(KNOWN_CONFLICTS_SEED_LENGTH);
    // A mutating consumer must not be able to corrupt the shared seed.
    expect(Object.isFrozen(getKnownConflictsSeed())).toBe(true);
    // The committed snapshot must pass the shared validator outright — a
    // corrupt seed would poison every background serve.
    expect(parseKnownConflicts(seedJson)).toHaveLength((seedJson as unknown[]).length);
  });

  it('round-trips a fetched update and keeps meta on the storage item', async () => {
    const updated = [
      {
        id: 'row-1',
        type: 'Plugin',
        name: 'Test Conflict',
        detection_pattern: null,
        summary: 'Breaks things',
        issue_description: '',
        url: 'https://example.com/conflict'
      }
    ];
    await knownConflictsStore.setValue(updated);
    await knownConflictsStore.setMeta({ updatedAt: 1720110000 });
    expect(await knownConflictsStore.getValue()).toEqual(updated);
    expect(await knownConflictsStore.getMeta()).toEqual({ updatedAt: 1720110000 });
  });

  it('degrades corrupt storage reads to null, never to foreign rows (validated access)', async () => {
    await knownConflictsStore.setValue([{ id: 'x', type: 'Plugin' }] as never);
    expect(await getKnownConflicts()).toBeNull();
  });

  it('validates wrong-typed rows away (corrupt fetches never store)', () => {
    // A corrupt row (name not a string) is rejected by the shared validator.
    expect(parseKnownConflicts([{ ...(seedJson[0] as { name: string }), name: null }])).toBeNull();
  });
});
