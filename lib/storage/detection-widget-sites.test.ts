/**
 * The detection widget's per-site store: validator matrix (older
 * `{ enabled }` entries, ranks, carried unknown fields, unstorable keys), the
 * serialized-byte bound with least-recent
 * eviction, the corrupt-storage degradations, the entry-over-default
 * resolution against the stored default option (both values × entry
 * on/off/absent), and the toggle's effective-state flip (the one toggling
 * semantics every writer shares) under both defaults, serialized within one
 * context.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK, mutateOptions, DETECTION_WIDGET } from './options';
import {
  DETECTION_WIDGET_SITES_BYTE_BUDGET,
  DETECTION_WIDGET_SITES_KEY,
  DETECTION_WIDGET_SITES_QUOTA_LIMIT,
  getDetectionWidgetSites,
  detectionWidgetDefaultEnabled,
  detectionWidgetSitesStore,
  isDetectionWidgetSiteEnabled,
  parseDetectionWidgetSites,
  toggleDetectionWidgetSite,
  effectiveDetectionWidgetEnabled,
  type DetectionWidgetSites
} from './detection-widget-sites';

/** The serialized item as the sync area counts it: the bare key + the map's JSON. */
const serialized = (origins: unknown): number =>
  DETECTION_WIDGET_SITES_KEY.length - 'sync:'.length + JSON.stringify(origins).length;

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
    features: { ...options.features, [DETECTION_WIDGET]: enabled }
  }));
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the byte bound vs the sync quota', () => {
  it('the budget leaves headroom under the 8192-byte per-item quota', () => {
    expect(DETECTION_WIDGET_SITES_QUOTA_LIMIT).toBe(8192);
    expect(DETECTION_WIDGET_SITES_BYTE_BUDGET).toBeLessThanOrEqual(
      DETECTION_WIDGET_SITES_QUOTA_LIMIT - 1024
    );
  });

  it('a worst-case corpus of the longest origins trims to the budget, least recent first', () => {
    const corpus: Record<string, { enabled: boolean; used: number }> = {};
    // Ranks run opposite to key order: recency, not map order, decides.
    for (let i = 0; i < 200; i += 1) corpus[longOrigin(i)] = { enabled: true, used: 200 - i };
    const parsed = parseDetectionWidgetSites(corpus);
    expect(parsed && serialized(parsed)).toBeLessThanOrEqual(DETECTION_WIDGET_SITES_BYTE_BUDGET);
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
    const kept = Object.keys(parseDetectionWidgetSites(corpus) ?? {}).length;
    expect(kept).toBeGreaterThanOrEqual(110);
    expect(kept).toBeLessThanOrEqual(130);
  });

  it('a comfortable middle corpus is not trimmed at all', () => {
    const corpus: Record<string, { enabled: boolean }> = {};
    for (let i = 0; i < 20; i += 1) corpus[`https://example-${String(i)}.test`] = { enabled: true };
    expect(parseDetectionWidgetSites(corpus)).toEqual(corpus);
  });
});

describe('parseDetectionWidgetSites', () => {
  it('validates a well-formed map, older `{ enabled }` entries unchanged', () => {
    expect(
      parseDetectionWidgetSites({
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
      expect(parseDetectionWidgetSites(rejected)).toBeNull();
    }
  });

  it('drops wrong-shaped entries, not the whole map', () => {
    expect(
      parseDetectionWidgetSites({
        'https://a.com': { enabled: true },
        'https://b.com': { enabled: 'yes' },
        'https://c.com': 'nope',
        '': { enabled: true },
        'https://d.com': null,
        'https://e.com': [true]
      })
    ).toEqual({ 'https://a.com': { enabled: true } });
  });

  it('a broken rank demotes the entry (rank dropped), never drops the override', () => {
    for (const used of [-1, 1.5, '3', Number.NaN, Number.MAX_SAFE_INTEGER + 2, null]) {
      expect(parseDetectionWidgetSites({ 'https://a.com': { enabled: false, used } })).toEqual({
        'https://a.com': { enabled: false }
      });
    }
  });

  it('carries unknown fields (a newer synced writer) through the validator', () => {
    expect(
      parseDetectionWidgetSites({ 'https://a.com': { enabled: true, used: 2, later: { x: 1 } } })
    ).toEqual({ 'https://a.com': { enabled: true, used: 2, later: { x: 1 } } });
  });

  it('skips a `__proto__` key instead of setting the map prototype', () => {
    const parsed = parseDetectionWidgetSites(
      JSON.parse('{"__proto__":{"enabled":true},"https://a.com":{"enabled":false}}')
    );
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.keys(parsed ?? {})).toEqual(['https://a.com']);
  });
});

describe('getDetectionWidgetSites with corrupt storage', () => {
  it('fresh storage reads empty', async () => {
    expect(await getDetectionWidgetSites()).toEqual({});
  });

  it('a corrupt value degrades to no entries (every origin follows the default)', async () => {
    await fakeBrowser.storage.sync.set({ 'detection-widget-sites': 'corrupted' });
    expect(await getDetectionWidgetSites()).toEqual({});
    expect(await isDetectionWidgetSiteEnabled('https://example.com')).toBe(true);
    await setDefault(false);
    expect(await isDetectionWidgetSiteEnabled('https://example.com')).toBe(false);
    await fakeBrowser.storage.sync.set({ 'detection-widget-sites': ['not-a-map'] });
    expect(await getDetectionWidgetSites()).toEqual({});
    // A valid-looking entry survives (keys are `new URL().origin` strings
    // from producers, never re-validated further).
    await fakeBrowser.storage.sync.set({ 'detection-widget-sites': { a: { enabled: true } } });
    expect(await getDetectionWidgetSites()).toEqual({ a: { enabled: true } });
  });

  it('round-trips valid writes', async () => {
    const map = {
      'https://example.com': { enabled: true, used: 1 },
      'http://127.0.0.1:8493': { enabled: false }
    };
    await detectionWidgetSitesStore.setValue(map);
    expect(await getDetectionWidgetSites()).toEqual(map);
  });
});

describe('the global default option', () => {
  it('defaults on (fresh install, corrupt options)', async () => {
    expect(FALLBACK.features[DETECTION_WIDGET]).toBe(true);
    expect(await isDetectionWidgetSiteEnabled('https://example.com')).toBe(true);
    await fakeBrowser.storage.sync.set({ options: 'corrupted' });
    expect(await isDetectionWidgetSiteEnabled('https://example.com')).toBe(true);
  });

  it('detectionWidgetDefaultEnabled reads the stored option', () => {
    expect(detectionWidgetDefaultEnabled(FALLBACK)).toBe(true);
    expect(
      detectionWidgetDefaultEnabled({
        ...FALLBACK,
        features: { ...FALLBACK.features, [DETECTION_WIDGET]: false }
      })
    ).toBe(false);
  });
});

describe('effectiveDetectionWidgetEnabled: default on/off × entry on/off/absent', () => {
  const cases: [boolean, boolean | undefined, boolean][] = [
    [true, undefined, true],
    [false, undefined, false],
    [true, true, true],
    [false, true, true],
    [true, false, false],
    [false, false, false]
  ];
  it.each(cases)('default %s, entry %s → %s', (defaultEnabled, entry, expected) => {
    const origins: DetectionWidgetSites =
      entry === undefined ? {} : { 'https://a.com': { enabled: entry } };
    expect(effectiveDetectionWidgetEnabled(origins, 'https://a.com', defaultEnabled)).toBe(
      expected
    );
  });

  it('another origin’s entry never touches this one', () => {
    const origins = { 'https://a.com': { enabled: true } };
    expect(effectiveDetectionWidgetEnabled(origins, 'https://b.com', false)).toBe(false);
  });

  it.each(cases)(
    'isDetectionWidgetSiteEnabled over storage: default %s, entry %s → %s',
    async (defaultEnabled, entry, expected) => {
      await setDefault(defaultEnabled);
      if (entry !== undefined) {
        await detectionWidgetSitesStore.setValue({ 'https://a.com': { enabled: entry } });
      }
      expect(await isDetectionWidgetSiteEnabled('https://a.com')).toBe(expected);
    }
  );
});

describe('toggleDetectionWidgetSite (the shared toggle semantics)', () => {
  it('default on: an unconfigured origin flips off (its visible state), ranked', async () => {
    expect(await toggleDetectionWidgetSite('https://example.com')).toBe(false);
    expect(await getDetectionWidgetSites()).toEqual({
      'https://example.com': { enabled: false, used: 1 }
    });
  });

  it('default off: an unconfigured origin flips on', async () => {
    await setDefault(false);
    expect(await toggleDetectionWidgetSite('https://example.com')).toBe(true);
    expect(await getDetectionWidgetSites()).toEqual({
      'https://example.com': { enabled: true, used: 1 }
    });
  });

  it('cycles off → on → off, each write ranked most recent', async () => {
    expect(await toggleDetectionWidgetSite('https://example.com')).toBe(false);
    expect(await toggleDetectionWidgetSite('https://example.com')).toBe(true);
    expect(await toggleDetectionWidgetSite('https://example.com')).toBe(false);
    expect(await getDetectionWidgetSites()).toEqual({
      'https://example.com': { enabled: false, used: 3 }
    });
  });

  it('an explicit entry outlives a later default change (both polarities)', async () => {
    expect(await toggleDetectionWidgetSite('https://off.com')).toBe(false);
    await setDefault(false);
    expect(await toggleDetectionWidgetSite('https://on.com')).toBe(true);
    await setDefault(true);
    expect(await isDetectionWidgetSiteEnabled('https://off.com')).toBe(false);
    await setDefault(false);
    expect(await isDetectionWidgetSiteEnabled('https://on.com')).toBe(true);
  });

  it('an entry matching the default still flips off it', async () => {
    await detectionWidgetSitesStore.setValue({ 'https://example.com': { enabled: true } });
    expect(await toggleDetectionWidgetSite('https://example.com')).toBe(false);
  });

  it('preserves every sibling origin (older entries untouched) under the bound', async () => {
    const seeded: Record<string, { enabled: boolean }> = {
      'https://a.com': { enabled: true },
      'https://b.com': { enabled: false }
    };
    for (let i = 0; i < 80; i += 1) {
      seeded[`https://filler-${String(i)}.example.com`] = { enabled: i === 0 };
    }
    await detectionWidgetSitesStore.setValue(seeded);
    expect(await toggleDetectionWidgetSite('https://new.example.com')).toBe(false);
    const stored = await getDetectionWidgetSites();
    expect(stored).toEqual({ ...seeded, 'https://new.example.com': { enabled: false, used: 1 } });
    expect(serialized(stored)).toBeLessThanOrEqual(DETECTION_WIDGET_SITES_BYTE_BUDGET);
  });

  it('many long-origin toggles stay under the budget, evicting least recent first', async () => {
    for (let i = 0; i < 120; i += 1) {
      expect(await toggleDetectionWidgetSite(longOrigin(i)), `toggle ${String(i)}`).toBe(false);
    }
    const stored = await getDetectionWidgetSites();
    expect(serialized(stored)).toBeLessThanOrEqual(DETECTION_WIDGET_SITES_BYTE_BUDGET);
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
    await detectionWidgetSitesStore.setValue(map);
    await toggleDetectionWidgetSite('https://aaa.example');
    const stored = await getDetectionWidgetSites();
    expect(stored['https://aaa.example']).toEqual({ enabled: false, used: 50 });
    expect(stored['https://zzz.example']).toBeUndefined();
  });

  it('an oversized single entry is written anyway: the platform rejection propagates', async () => {
    const huge = `https://${'a'.repeat(DETECTION_WIDGET_SITES_QUOTA_LIMIT)}`;
    // fake storage has no quota; the write attempt itself is the pin.
    expect(await toggleDetectionWidgetSite(huge)).toBe(false);
    expect(Object.keys(await detectionWidgetSitesStore.getValue())).toEqual([huge]);
  });

  it('a storage write rejection propagates (no fake success)', async () => {
    const original = fakeBrowser.storage.sync.set.bind(fakeBrowser.storage.sync);
    fakeBrowser.storage.sync.set = () => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM'));
    try {
      await expect(toggleDetectionWidgetSite('https://example.com')).rejects.toThrow(
        'QUOTA_BYTES_PER_ITEM'
      );
    } finally {
      fakeBrowser.storage.sync.set = original;
    }
  });

  it('concurrent toggles in one context are serialized: both land', async () => {
    await Promise.all([
      toggleDetectionWidgetSite('https://a.com'),
      toggleDetectionWidgetSite('https://b.com')
    ]);
    expect(await getDetectionWidgetSites()).toEqual({
      'https://a.com': { enabled: false, used: 1 },
      'https://b.com': { enabled: false, used: 2 }
    });
  });

  it('concurrent toggles of one origin flip twice, never once', async () => {
    const results = await Promise.all([
      toggleDetectionWidgetSite('https://a.com'),
      toggleDetectionWidgetSite('https://a.com')
    ]);
    expect(results).toEqual([false, true]);
    expect(await getDetectionWidgetSites()).toEqual({
      'https://a.com': { enabled: true, used: 2 }
    });
  });

  it('a rejected toggle does not stall the next one', async () => {
    vi.spyOn(fakeBrowser.storage.sync, 'set').mockRejectedValueOnce(new Error('quota'));
    const failing = toggleDetectionWidgetSite('https://a.com');
    const next = toggleDetectionWidgetSite('https://b.com');
    await expect(failing).rejects.toThrow('quota');
    await expect(next).resolves.toBe(false);
  });

  it('keeps the toggled entry’s and its siblings’ unknown fields', async () => {
    await fakeBrowser.storage.sync.set({
      'detection-widget-sites': {
        'https://a.com': { enabled: true, used: 1, later: 'a' },
        'https://b.com': { enabled: true, used: 2, later: 'b' }
      }
    });
    await toggleDetectionWidgetSite('https://a.com');
    expect(await detectionWidgetSitesStore.getValue()).toEqual({
      'https://a.com': { enabled: false, used: 3, later: 'a' },
      'https://b.com': { enabled: true, used: 2, later: 'b' }
    });
  });

  it('refuses an unstorable origin without writing', async () => {
    for (const origin of ['', '__proto__']) {
      await expect(toggleDetectionWidgetSite(origin)).rejects.toThrow(RangeError);
    }
    expect(await detectionWidgetSitesStore.getValue()).toEqual({});
  });

  it('toggling over corrupt storage writes the fresh valid map (self-healing)', async () => {
    await fakeBrowser.storage.sync.set({ 'detection-widget-sites': 'corrupted' });
    expect(await toggleDetectionWidgetSite('https://example.com')).toBe(false);
    expect(await getDetectionWidgetSites()).toEqual({
      'https://example.com': { enabled: false, used: 1 }
    });
  });
});
