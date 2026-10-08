/**
 * Storage contract tests over the fake browser — the fallbacks, the
 * validator, and corrupt-value resilience are the guarantees surfaces rely
 * on; meta book-keeping is verified here too (P2's updater owns writing it).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { getOptions, optionsStore, parseStoredOptions } from './options';
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
        toolbarBadge: true
      }
    });
  });

  it('persists written options and reads them back through the validator', async () => {
    await optionsStore.setValue({
      improvements: { 'wp-dashboard-dbugger-entry': false },
      appearance: 'dark',
      features: { toolbarBadge: false }
    });
    expect(await getOptions()).toEqual({
      improvements: { 'wp-dashboard-dbugger-entry': false },
      appearance: 'dark',
      features: { toolbarBadge: false }
    });
    // Absence must resolve to defaults, not falsy values.
    await optionsStore.removeValue();
    const reset = await getOptions();
    expect(reset.appearance).toBe('system');
    expect(reset.features.toolbarBadge).toBe(true);
    expect(reset.improvements['wp-dashboard-dbugger-entry']).toBe(true);
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
      features: { toolbarBadge: false }
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
      features: { toolbarBadge: false }
    });
    expect(parseStoredOptions(null)).toBeNull();
    expect(parseStoredOptions('black')).toBeNull();
    expect(parseStoredOptions([])).toBeNull();
  });
});

describe('knownConflictsStore', () => {
  it("reads empty on fresh storage — seeding is the background bundle's job", async () => {
    // The committed snapshot ships only in the background bundle (as its own
    // asset); every other surface must see "no usable value" and ask the
    // background, never carry the ~46 KB data file to degrade into.
    expect(await knownConflictsStore.getValue()).toBeNull();
    expect(await getKnownConflicts()).toBeNull();
  });

  it('the committed snapshot stays valid and is pinned at exactly 137 rows', () => {
    // Exact-count pin: silently losing rows (a truncated data file, a bad
    // import) would pass shape checks but ship a blind spot in conflict UIs.
    expect(KNOWN_CONFLICTS_SEED_LENGTH).toBe(137);
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
