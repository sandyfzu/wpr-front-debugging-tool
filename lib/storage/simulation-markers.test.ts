/**
 * Simulation-marker memo over the fake browser: the `session:` area, the
 * per-tab cap (newest first, oldest dropped, repeats collapsed), other tabs
 * untouched, the global cap (oldest written evicted across tabs), tolerant
 * reads (malformed entries dropped one by one), tab and global clears, and
 * serialized writes.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { EXCLUSION_SET_LIMITS } from '../messaging/exclusion-session';
import {
  clearAllSimulationMarkers,
  clearSimulationMarkersForTab,
  getSimulationMarkers,
  getTabSimulationMarkers,
  parseSimulationMarkerEntry,
  parseSimulationMarkers,
  rememberSimulationMarker,
  SIMULATION_MARKERS_KEY,
  SIMULATION_MARKERS_PER_TAB,
  SIMULATION_MARKERS_TOTAL,
  simulationMarkersStore,
  withinMarkerTotal,
  withSafeNextSeq,
  type SimulationMarkerEntry
} from './simulation-markers';

beforeEach(() => {
  fakeBrowser.reset();
});

/** The `n`-th marker of an origin (distinct ids per `n`). */
function marker(n: number, origin = 'https://example.com'): SimulationMarkerEntry {
  return { markerId: n.toString(16).padStart(32, '0'), origin, features: ['delay_js'] };
}

/** The `n`-th marker as stored, with its write order. */
function stored(n: number, seq = n): SimulationMarkerEntry & { seq: number } {
  return { ...marker(n), seq };
}

describe('simulation-markers store', () => {
  it('lives in the session area and starts empty', async () => {
    expect(SIMULATION_MARKERS_KEY.startsWith('session:')).toBe(true);
    expect(await getTabSimulationMarkers(1)).toEqual([]);
    await rememberSimulationMarker(1, marker(1));
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
  });

  it('keeps the newest first, at most the cap per tab; other tabs untouched', async () => {
    await rememberSimulationMarker(2, marker(999));
    for (let n = 1; n <= SIMULATION_MARKERS_PER_TAB + 2; n++) {
      await rememberSimulationMarker(1, marker(n));
    }
    const tab = await getTabSimulationMarkers(1);
    expect(tab).toHaveLength(SIMULATION_MARKERS_PER_TAB);
    expect(tab[0]).toEqual(marker(SIMULATION_MARKERS_PER_TAB + 2));
    expect(tab.at(-1)).toEqual(marker(3));
    expect(await getTabSimulationMarkers(2)).toEqual([marker(999)]);
  });

  it('moves a re-remembered id to the front, never twice', async () => {
    await rememberSimulationMarker(1, marker(1));
    await rememberSimulationMarker(1, marker(2));
    expect(await rememberSimulationMarker(1, marker(1))).toEqual([marker(1), marker(2)]);
  });

  it('serializes concurrent writes (none lost)', async () => {
    await Promise.all([1, 2, 3].map((n) => rememberSimulationMarker(1, marker(n))));
    expect(await getTabSimulationMarkers(1)).toEqual([marker(3), marker(2), marker(1)]);
  });

  it('clears one tab, then everything', async () => {
    await rememberSimulationMarker(1, marker(1));
    await rememberSimulationMarker(2, marker(2));
    await clearSimulationMarkersForTab(1);
    await clearSimulationMarkersForTab(77);
    await clearSimulationMarkersForTab(-1);
    expect(await getSimulationMarkers()).toEqual({ '2': [marker(2)] });
    await clearAllSimulationMarkers();
    expect(await simulationMarkersStore.getValue()).toEqual({});
  });

  it('refuses a bad tab id or entry, touching nothing', async () => {
    await expect(rememberSimulationMarker(-1, marker(1))).rejects.toThrow(/not a tab id/);
    await expect(rememberSimulationMarker(1.5, marker(1))).rejects.toThrow(/not a tab id/);
    await expect(
      rememberSimulationMarker(1, { ...marker(1), origin: 'https://example.com/path' })
    ).rejects.toThrow(/malformed/);
    expect(await simulationMarkersStore.getValue()).toEqual({});
  });

  it('holds the whole map to the global cap, evicting the oldest written across tabs', async () => {
    const tabs = SIMULATION_MARKERS_TOTAL / SIMULATION_MARKERS_PER_TAB + 1;
    for (let tab = 1; tab <= tabs; tab++) {
      for (let n = 0; n < SIMULATION_MARKERS_PER_TAB; n++) {
        await rememberSimulationMarker(tab, marker(tab * 100 + n));
      }
    }
    const markers = await getSimulationMarkers();
    expect(Object.values(markers).flat()).toHaveLength(SIMULATION_MARKERS_TOTAL);
    // Tab 1 was written first: all of it went, and every later tab is whole.
    expect(markers['1']).toBeUndefined();
    expect(await getTabSimulationMarkers(2)).toHaveLength(SIMULATION_MARKERS_PER_TAB);
    // A new write evicts the single oldest entry (tab 2's first), never itself.
    await rememberSimulationMarker(1, marker(1));
    expect(await getTabSimulationMarkers(1)).toEqual([marker(1)]);
    const tab2 = await getTabSimulationMarkers(2);
    expect(tab2).toHaveLength(SIMULATION_MARKERS_PER_TAB - 1);
    expect(tab2).not.toContainEqual(marker(200));
  });

  it('answers an unknown or malformed tab id with no entries', async () => {
    await rememberSimulationMarker(1, marker(1));
    expect(await getTabSimulationMarkers(3)).toEqual([]);
    expect(await getTabSimulationMarkers(-1)).toEqual([]);
  });
});

describe('parseSimulationMarkerEntry', () => {
  it('accepts a well-formed entry, ignoring unknown fields', () => {
    expect(parseSimulationMarkerEntry({ ...marker(1), at: 5 })).toEqual(marker(1));
  });

  it.each([
    ['an upper-case id', { ...marker(1), markerId: 'A'.repeat(32) }],
    ['a short id', { ...marker(1), markerId: 'a'.repeat(31) }],
    ['a non-origin', { ...marker(1), origin: 'https://example.com/' }],
    ['a non-http origin', { ...marker(1), origin: 'ftp://example.com' }],
    [
      'an over-cap origin',
      { ...marker(1), origin: `https://${'a'.repeat(EXCLUSION_SET_LIMITS.originChars)}.com` }
    ],
    ['no features', { markerId: marker(1).markerId, origin: 'https://example.com' }],
    ['empty features', { ...marker(1), features: [] }],
    ['an unknown feature', { ...marker(1), features: ['x'] }],
    ['a non-record', 'x']
  ])('drops %s', (_label, value) => {
    expect(parseSimulationMarkerEntry(value)).toBeNull();
  });
});

describe('parseSimulationMarkers (tolerant reads)', () => {
  it('drops malformed entries one by one, bad keys, non-lists and emptied tabs', () => {
    const parsed = parseSimulationMarkers({
      '1': [stored(1), { markerId: 'bad' }, stored(2), stored(1)],
      '01': [stored(3)],
      x: [stored(4)],
      '2': 'not a list',
      '3': [{ markerId: 'bad' }],
      '4': [marker(5), { ...marker(6), seq: -1 }, { ...marker(7), seq: 1.5 }]
    });
    expect(parsed).toEqual({ '1': [stored(1), stored(2)] });
  });

  it('holds a stored over-long list to the cap (the newest kept)', () => {
    const list = Array.from({ length: SIMULATION_MARKERS_PER_TAB + 4 }, (_, n) => stored(n + 1));
    expect(parseSimulationMarkers({ '1': list })?.['1']).toEqual(
      list.slice(0, SIMULATION_MARKERS_PER_TAB)
    );
  });

  it('holds a stored over-full map to the global cap, the highest write orders kept', () => {
    const tabs = SIMULATION_MARKERS_TOTAL / SIMULATION_MARKERS_PER_TAB + 1;
    const raw: Record<string, ReturnType<typeof stored>[]> = {};
    for (let tab = 1; tab <= tabs; tab++) {
      raw[String(tab)] = Array.from({ length: SIMULATION_MARKERS_PER_TAB }, (_, n) =>
        stored(tab * 100 + n, tabs * 100 - tab * 100 + n)
      );
    }
    const parsed = parseSimulationMarkers(raw) ?? {};
    expect(Object.values(parsed).flat()).toHaveLength(SIMULATION_MARKERS_TOTAL);
    // The last tab carries the lowest orders: it is the one evicted.
    expect(parsed[String(tabs)]).toBeUndefined();
  });

  it('never overshoots the global cap on equal write orders (a corrupt store)', () => {
    const raw: Record<string, ReturnType<typeof stored>[]> = {};
    for (let tab = 1; tab <= SIMULATION_MARKERS_TOTAL / SIMULATION_MARKERS_PER_TAB + 1; tab++) {
      raw[String(tab)] = Array.from({ length: SIMULATION_MARKERS_PER_TAB }, (_, n) =>
        stored(tab * 100 + n, 7)
      );
    }
    const capped = withinMarkerTotal(raw);
    expect(Object.values(capped).flat()).toHaveLength(SIMULATION_MARKERS_TOTAL);
    const small = { '1': [stored(1)] };
    expect(withinMarkerTotal(small)).toBe(small);
  });

  it('degrades a non-map to null and reads it as no markers', async () => {
    expect(parseSimulationMarkers([])).toBeNull();
    expect(parseSimulationMarkers(null)).toBeNull();
    await fakeBrowser.storage.session.set({ 'simulation-markers': 'corrupt' });
    expect(await getSimulationMarkers()).toEqual({});
  });

  it('renumbers write orders densely when a corrupt one leaves no safe next order', async () => {
    await simulationMarkersStore.setValue({
      '1': [stored(1, Number.MAX_SAFE_INTEGER), stored(2, 5)],
      '2': [stored(3, 3)]
    });
    expect(await rememberSimulationMarker(1, marker(9))).toEqual([marker(9), marker(1), marker(2)]);
    // The new entry survives a read (an unsafe order would drop it), write order kept.
    expect(await getTabSimulationMarkers(1)).toEqual([marker(9), marker(1), marker(2)]);
    expect(await simulationMarkersStore.getValue()).toEqual({
      '1': [stored(9, 4), stored(1, 3), stored(2, 2)],
      '2': [stored(3, 1)]
    });
    const roomy = { '1': [stored(1, Number.MAX_SAFE_INTEGER - 1)] };
    expect(withSafeNextSeq(roomy)).toBe(roomy);
  });

  it('writes over a corrupt store as if empty', async () => {
    await fakeBrowser.storage.session.set({ 'simulation-markers': 'corrupt' });
    expect(await rememberSimulationMarker(1, marker(1))).toEqual([marker(1)]);
    await fakeBrowser.storage.session.set({ 'simulation-markers': 'corrupt' });
    await clearSimulationMarkersForTab(1);
    expect(await simulationMarkersStore.getValue()).toEqual({});
  });
});
