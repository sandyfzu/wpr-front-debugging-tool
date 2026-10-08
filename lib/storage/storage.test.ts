/**
 * Storage contract tests over the fake browser — the fallbacks, the
 * validator, and corrupt-value resilience are the guarantees surfaces rely
 * on; meta book-keeping is verified here too (P2's updater owns writing it).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { getOptions, optionsStore, parseStoredOptions } from './options';
import { KNOWN_CONFLICTS_SEED_LENGTH, knownConflictsStore } from './known-conflicts';
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
  it('seeds from the committed snapshot on fresh storage', async () => {
    const rows = await knownConflictsStore.getValue();
    // Exact-count pin: silently losing rows (a truncated data file, a bad
    // import) would pass shape checks but ship a blind spot in conflict UIs.
    expect(KNOWN_CONFLICTS_SEED_LENGTH).toBe(137);
    expect(rows).toHaveLength(KNOWN_CONFLICTS_SEED_LENGTH);
    // The committed snapshot must pass the shared validator outright — a
    // corrupt seed would corrupt every fresh install.
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

  it('degrades corrupt storage reads to the committed seed (validated access)', async () => {
    await knownConflictsStore.setValue([{ id: 'x', type: 'Plugin' }] as never);
    const { getKnownConflicts } = await import('./known-conflicts');
    const rows = await getKnownConflicts();
    expect(rows).toHaveLength(137);
    // A fresh array is handed out (mutating it locally is safe), and its rows
    // are frozen committed seed objects — a caller-side mutation of a row
    // throws instead of corrupting the shared seed.
    rows.push(rows[0] as (typeof rows)[number]);
    expect(rows).toHaveLength(138);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });

  it('validates wrong-typed rows away (corrupt fetches never store)', () => {
    // A corrupt row (name not a string) is rejected by the shared validator.
    expect(parseKnownConflicts([{ ...(seedJson[0] as { name: string }), name: null }])).toBeNull();
  });
});
