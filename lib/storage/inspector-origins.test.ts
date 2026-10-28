/**
 * The inspector-origin store: validator matrix (older `{ enabled }` entries,
 * ranks, unknown fields), the serialized-byte bound with least-recent
 * eviction, the corrupt-storage degradations, the entry-over-default
 * resolution against the stored default option (both values × entry
 * on/off/absent), and the toggle's effective-state flip (the one toggling
 * semantics every writer shares) under both defaults.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { FALLBACK, mutateOptions, ON_PAGE_INSPECTOR } from './options';
import {
  INSPECTOR_ORIGINS_BYTE_BUDGET,
  INSPECTOR_ORIGINS_KEY,
  INSPECTOR_ORIGINS_QUOTA_LIMIT,
  getInspectorOrigins,
  inspectorDefaultEnabled,
  inspectorOriginsStore,
  isInspectorOriginEnabled,
  parseInspectorOrigins,
  toggleInspectorOrigin,
  effectiveInspectorEnabled,
  type InspectorOrigins
} from './inspector-origins';

/** The serialized item as the sync area counts it: the bare key + the map's JSON. */
const serialized = (origins: unknown): number =>
  INSPECTOR_ORIGINS_KEY.length - 'sync:'.length + JSON.stringify(origins).length;

/**
 * The worst-possible corpus: the longest origins a real page can produce — a
 * 253-character host (the platform's own limit). The index is carried by the
 * host's leading digits so every key stays 253-hosted and distinct.
 */
function longOrigin(index: number): string {
  const host = `${String(1_000_000 + index)}${'a'.repeat(246)}`;
  return `https://${host}`;
}

/** Store the global default option (the options page's Save). */
async function setDefault(enabled: boolean): Promise<void> {
  await mutateOptions((options) => ({
    ...options,
    features: { ...options.features, [ON_PAGE_INSPECTOR]: enabled }
  }));
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('the byte bound vs the sync quota', () => {
  it('the budget leaves headroom under the 8192-byte per-item quota', () => {
    expect(INSPECTOR_ORIGINS_QUOTA_LIMIT).toBe(8192);
    expect(INSPECTOR_ORIGINS_BYTE_BUDGET).toBeLessThanOrEqual(INSPECTOR_ORIGINS_QUOTA_LIMIT - 1024);
  });

  it('a worst-case corpus of the longest origins trims to the budget, least recent first', () => {
    const corpus: Record<string, { enabled: boolean; used: number }> = {};
    // Ranks run opposite to key order: recency, not map order, decides.
    for (let i = 0; i < 200; i += 1) corpus[longOrigin(i)] = { enabled: true, used: 200 - i };
    const parsed = parseInspectorOrigins(corpus);
    expect(parsed && serialized(parsed)).toBeLessThanOrEqual(INSPECTOR_ORIGINS_BYTE_BUDGET);
    expect(parsed?.[longOrigin(0)]).toEqual({ enabled: true, used: 200 });
    expect(parsed?.[longOrigin(199)]).toBeUndefined();
    // ~24 of the longest possible origins fit (the documented floor).
    expect(Object.keys(parsed ?? {}).length).toBeGreaterThanOrEqual(23);
  });

  it('a typical-origin map holds ~120 ranked overrides (the documented capacity)', () => {
    const corpus: Record<string, { enabled: boolean; used: number }> = {};
    for (let i = 0; i < 300; i += 1) {
      corpus[`https://www.client-site-${String(i).padStart(3, '0')}.com`] = {
        enabled: false,
        used: 100 + i
      };
    }
    const kept = Object.keys(parseInspectorOrigins(corpus) ?? {}).length;
    expect(kept).toBeGreaterThanOrEqual(110);
    expect(kept).toBeLessThanOrEqual(130);
  });

  it('a comfortable middle corpus is not trimmed at all', () => {
    const corpus: Record<string, { enabled: boolean }> = {};
    for (let i = 0; i < 20; i += 1) corpus[`https://example-${String(i)}.test`] = { enabled: true };
    expect(parseInspectorOrigins(corpus)).toEqual(corpus);
  });
});

describe('parseInspectorOrigins', () => {
  it('validates a well-formed map, older `{ enabled }` entries unchanged', () => {
    expect(
      parseInspectorOrigins({
        'https://a.com': { enabled: true },
        'http://127.0.0.1:8493': { enabled: false, used: 4 }
      })
    ).toEqual({
      'https://a.com': { enabled: true },
      'http://127.0.0.1:8493': { enabled: false, used: 4 }
    });
  });

  it('rejects non-map values wholesale (arrays, scalars, null)', () => {
    for (const rejected of [null, 'x', 42, [], true]) {
      expect(parseInspectorOrigins(rejected)).toBeNull();
    }
  });

  it('drops wrong-shaped entries, not the whole map', () => {
    expect(
      parseInspectorOrigins({
        'https://a.com': { enabled: true },
        'https://b.com': { enabled: 'yes' },
        'https://c.com': 'nope',
        '': { enabled: true },
        'https://d.com': null
      })
    ).toEqual({ 'https://a.com': { enabled: true } });
  });

  it('a broken rank demotes the entry (rank dropped), never drops the override', () => {
    for (const used of [-1, 1.5, '3', Number.NaN, Number.MAX_SAFE_INTEGER + 2, null]) {
      expect(parseInspectorOrigins({ 'https://a.com': { enabled: false, used } })).toEqual({
        'https://a.com': { enabled: false }
      });
    }
  });

  it('tolerates unknown fields (a newer writer) without carrying them', () => {
    expect(
      parseInspectorOrigins({ 'https://a.com': { enabled: true, used: 2, later: { x: 1 } } })
    ).toEqual({ 'https://a.com': { enabled: true, used: 2 } });
  });
});

describe('getInspectorOrigins with corrupt storage', () => {
  it('fresh storage reads empty', async () => {
    expect(await getInspectorOrigins()).toEqual({});
  });

  it('a corrupt value degrades to no entries (every origin follows the default)', async () => {
    await fakeBrowser.storage.sync.set({ 'inspector-origins': 'corrupted' });
    expect(await getInspectorOrigins()).toEqual({});
    expect(await isInspectorOriginEnabled('https://example.com')).toBe(true);
    await setDefault(false);
    expect(await isInspectorOriginEnabled('https://example.com')).toBe(false);
    await fakeBrowser.storage.sync.set({ 'inspector-origins': ['not-a-map'] });
    expect(await getInspectorOrigins()).toEqual({});
    // A valid-looking entry survives (keys are `new URL().origin` strings
    // from producers, never re-validated further).
    await fakeBrowser.storage.sync.set({ 'inspector-origins': { a: { enabled: true } } });
    expect(await getInspectorOrigins()).toEqual({ a: { enabled: true } });
  });

  it('round-trips valid writes', async () => {
    const map = {
      'https://example.com': { enabled: true, used: 1 },
      'http://127.0.0.1:8493': { enabled: false }
    };
    await inspectorOriginsStore.setValue(map);
    expect(await getInspectorOrigins()).toEqual(map);
  });
});

describe('the global default option', () => {
  it('defaults on (fresh install, corrupt options)', async () => {
    expect(FALLBACK.features[ON_PAGE_INSPECTOR]).toBe(true);
    expect(await isInspectorOriginEnabled('https://example.com')).toBe(true);
    await fakeBrowser.storage.sync.set({ options: 'corrupted' });
    expect(await isInspectorOriginEnabled('https://example.com')).toBe(true);
  });

  it('inspectorDefaultEnabled reads the stored option', () => {
    expect(inspectorDefaultEnabled(FALLBACK)).toBe(true);
    expect(
      inspectorDefaultEnabled({
        ...FALLBACK,
        features: { ...FALLBACK.features, [ON_PAGE_INSPECTOR]: false }
      })
    ).toBe(false);
  });
});

describe('effectiveInspectorEnabled: default on/off × entry on/off/absent', () => {
  const cases: [boolean, boolean | undefined, boolean][] = [
    [true, undefined, true],
    [false, undefined, false],
    [true, true, true],
    [false, true, true],
    [true, false, false],
    [false, false, false]
  ];
  it.each(cases)('default %s, entry %s → %s', (defaultEnabled, entry, expected) => {
    const origins: InspectorOrigins =
      entry === undefined ? {} : { 'https://a.com': { enabled: entry } };
    expect(effectiveInspectorEnabled(origins, 'https://a.com', defaultEnabled)).toBe(expected);
  });

  it('another origin’s entry never touches this one', () => {
    const origins = { 'https://a.com': { enabled: true } };
    expect(effectiveInspectorEnabled(origins, 'https://b.com', false)).toBe(false);
  });

  it.each(cases)(
    'isInspectorOriginEnabled over storage: default %s, entry %s → %s',
    async (defaultEnabled, entry, expected) => {
      await setDefault(defaultEnabled);
      if (entry !== undefined) {
        await inspectorOriginsStore.setValue({ 'https://a.com': { enabled: entry } });
      }
      expect(await isInspectorOriginEnabled('https://a.com')).toBe(expected);
    }
  );
});

describe('toggleInspectorOrigin (the shared toggle semantics)', () => {
  it('default on: an unconfigured origin flips off (its visible state), ranked', async () => {
    expect(await toggleInspectorOrigin('https://example.com')).toBe(false);
    expect(await getInspectorOrigins()).toEqual({
      'https://example.com': { enabled: false, used: 1 }
    });
  });

  it('default off: an unconfigured origin flips on', async () => {
    await setDefault(false);
    expect(await toggleInspectorOrigin('https://example.com')).toBe(true);
    expect(await getInspectorOrigins()).toEqual({
      'https://example.com': { enabled: true, used: 1 }
    });
  });

  it('cycles off → on → off, each write ranked most recent', async () => {
    expect(await toggleInspectorOrigin('https://example.com')).toBe(false);
    expect(await toggleInspectorOrigin('https://example.com')).toBe(true);
    expect(await toggleInspectorOrigin('https://example.com')).toBe(false);
    expect(await getInspectorOrigins()).toEqual({
      'https://example.com': { enabled: false, used: 3 }
    });
  });

  it('an explicit entry outlives a later default change (both polarities)', async () => {
    expect(await toggleInspectorOrigin('https://off.com')).toBe(false);
    await setDefault(false);
    expect(await toggleInspectorOrigin('https://on.com')).toBe(true);
    await setDefault(true);
    expect(await isInspectorOriginEnabled('https://off.com')).toBe(false);
    await setDefault(false);
    expect(await isInspectorOriginEnabled('https://on.com')).toBe(true);
  });

  it('an entry matching the default still flips off it', async () => {
    await inspectorOriginsStore.setValue({ 'https://example.com': { enabled: true } });
    expect(await toggleInspectorOrigin('https://example.com')).toBe(false);
  });

  it('preserves every sibling origin (older entries untouched) under the bound', async () => {
    const seeded: Record<string, { enabled: boolean }> = {
      'https://a.com': { enabled: true },
      'https://b.com': { enabled: false }
    };
    for (let i = 0; i < 80; i += 1) {
      seeded[`https://filler-${String(i)}.example.com`] = { enabled: i === 0 };
    }
    await inspectorOriginsStore.setValue(seeded);
    expect(await toggleInspectorOrigin('https://new.example.com')).toBe(false);
    const stored = await getInspectorOrigins();
    expect(stored).toEqual({ ...seeded, 'https://new.example.com': { enabled: false, used: 1 } });
    expect(serialized(stored)).toBeLessThanOrEqual(INSPECTOR_ORIGINS_BYTE_BUDGET);
  });

  it('many long-origin toggles stay under the budget, evicting least recent first', async () => {
    for (let i = 0; i < 120; i += 1) {
      expect(await toggleInspectorOrigin(longOrigin(i)), `toggle ${String(i)}`).toBe(false);
    }
    const stored = await getInspectorOrigins();
    expect(serialized(stored)).toBeLessThanOrEqual(INSPECTOR_ORIGINS_BYTE_BUDGET);
    // Survivors are exactly the most recent run, whatever the key order.
    const ranks = Object.values(stored).map((entry) => entry.used ?? 0);
    expect(Math.max(...ranks)).toBe(120);
    expect(Math.min(...ranks)).toBe(120 - ranks.length + 1);
  });

  it('eviction follows recency, not key order (Chromium returns keys sorted)', async () => {
    // A zzz origin written long ago and an aaa one written last: re-sorted
    // keys must not make the recent aaa the eviction victim.
    const map: Record<string, { enabled: boolean; used: number }> = {};
    for (let i = 0; i < 40; i += 1) {
      map[longOrigin(i)] = { enabled: false, used: 10 + i };
    }
    map['https://zzz.example'] = { enabled: false, used: 1 };
    await inspectorOriginsStore.setValue(map);
    await toggleInspectorOrigin('https://aaa.example');
    const stored = await getInspectorOrigins();
    expect(stored['https://aaa.example']).toEqual({ enabled: false, used: 50 });
    expect(stored['https://zzz.example']).toBeUndefined();
  });

  it('an oversized single entry is written anyway: the platform rejection propagates', async () => {
    const huge = `https://${'a'.repeat(INSPECTOR_ORIGINS_QUOTA_LIMIT)}`;
    // fake storage has no quota; the write attempt itself is the pin.
    expect(await toggleInspectorOrigin(huge)).toBe(false);
    expect(Object.keys(await inspectorOriginsStore.getValue())).toEqual([huge]);
  });

  it('a storage write rejection propagates (no fake success)', async () => {
    const original = fakeBrowser.storage.sync.set.bind(fakeBrowser.storage.sync);
    fakeBrowser.storage.sync.set = () => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM'));
    try {
      await expect(toggleInspectorOrigin('https://example.com')).rejects.toThrow(
        'QUOTA_BYTES_PER_ITEM'
      );
    } finally {
      fakeBrowser.storage.sync.set = original;
    }
  });

  it('toggling over corrupt storage writes the fresh valid map (self-healing)', async () => {
    await fakeBrowser.storage.sync.set({ 'inspector-origins': 'corrupted' });
    expect(await toggleInspectorOrigin('https://example.com')).toBe(false);
    expect(await getInspectorOrigins()).toEqual({
      'https://example.com': { enabled: false, used: 1 }
    });
  });
});
