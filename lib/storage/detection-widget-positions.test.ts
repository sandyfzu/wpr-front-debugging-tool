/**
 * The widget-position store (local area): coordinate sanity at the boundary
 * (finite, bounded, integer-normalized, never an array), the map validator
 * (carried unknown fields, unstorable keys), corrupt degradations, the ranked
 * write and its least-recent eviction under the byte budget, same-context
 * serialization, and the refusal of insane writes.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemBytes } from './recency-map';
import {
  DETECTION_WIDGET_POSITION_LIMIT,
  DETECTION_WIDGET_POSITIONS_BYTE_BUDGET,
  DETECTION_WIDGET_POSITIONS_KEY,
  getDetectionWidgetPosition,
  detectionWidgetPositionsStore,
  parseDetectionWidgetPosition,
  parseDetectionWidgetPositions,
  saveDetectionWidgetPosition
} from './detection-widget-positions';

const BARE_KEY = DETECTION_WIDGET_POSITIONS_KEY.slice('local:'.length);

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseDetectionWidgetPosition', () => {
  it('rounds finite in-range coordinates to integers (and -0 to 0)', () => {
    expect(parseDetectionWidgetPosition({ x: -120.4, y: -0.2 })).toEqual({ x: -120, y: 0 });
    expect(Object.is(parseDetectionWidgetPosition({ x: -0, y: 1 })?.x, 0)).toBe(true);
    expect(
      parseDetectionWidgetPosition({
        x: DETECTION_WIDGET_POSITION_LIMIT,
        y: -DETECTION_WIDGET_POSITION_LIMIT
      })
    ).toEqual({ x: DETECTION_WIDGET_POSITION_LIMIT, y: -DETECTION_WIDGET_POSITION_LIMIT });
  });

  it('refuses non-finite, out-of-range, missing or non-numeric coordinates', () => {
    for (const bad of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Infinity },
      { x: DETECTION_WIDGET_POSITION_LIMIT + 1, y: 0 },
      { x: 0, y: -DETECTION_WIDGET_POSITION_LIMIT - 1 },
      { x: '1', y: 2 },
      { x: 1 },
      null,
      'x',
      7,
      Object.assign([], { x: 1, y: 2 })
    ]) {
      expect(parseDetectionWidgetPosition(bad)).toBeNull();
    }
  });
});

describe('parseDetectionWidgetPositions', () => {
  it('rejects non-maps wholesale', () => {
    for (const bad of [null, 'x', 1, [], true])
      expect(parseDetectionWidgetPositions(bad)).toBeNull();
  });

  it('drops insane entries and unstorable keys; keeps ranks; carries unknown fields', () => {
    expect(
      parseDetectionWidgetPositions({
        'https://a.com': { x: -10, y: -20, used: 2, later: true },
        'https://b.com': { x: 'no', y: 1 },
        'https://c.com': { x: 1e9, y: 0 },
        'https://d.com': { x: 1, y: 2, used: -4 },
        '': { x: 1, y: 1 },
        'https://e.com': Object.assign([], { x: 1, y: 1 })
      })
    ).toEqual({
      'https://a.com': { x: -10, y: -20, used: 2, later: true },
      'https://d.com': { x: 1, y: 2 }
    });
  });

  it('skips a `__proto__` key instead of setting the map prototype', () => {
    const parsed = parseDetectionWidgetPositions(
      JSON.parse('{"__proto__":{"x":1,"y":2},"https://a.com":{"x":3,"y":4}}')
    );
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parsed).toEqual({ 'https://a.com': { x: 3, y: 4 } });
  });
});

describe('getDetectionWidgetPosition', () => {
  it('reads null for none stored and for corrupt storage', async () => {
    expect(await getDetectionWidgetPosition('https://a.com')).toBeNull();
    await fakeBrowser.storage.local.set({ [BARE_KEY]: 'corrupted' });
    expect(await getDetectionWidgetPosition('https://a.com')).toBeNull();
    await fakeBrowser.storage.local.set({ [BARE_KEY]: { 'https://a.com': { x: Infinity, y: 0 } } });
    expect(await getDetectionWidgetPosition('https://a.com')).toBeNull();
  });
});

describe('saveDetectionWidgetPosition', () => {
  it('round-trips a normalized position, ranked most recent; siblings kept', async () => {
    expect(await saveDetectionWidgetPosition('https://a.com', { x: -10.6, y: -20 })).toEqual({
      x: -11,
      y: -20
    });
    await saveDetectionWidgetPosition('https://b.com', { x: 5, y: 6 });
    await saveDetectionWidgetPosition('https://a.com', { x: -1, y: -2 });
    expect(await detectionWidgetPositionsStore.getValue()).toEqual({
      'https://a.com': { x: -1, y: -2, used: 3 },
      'https://b.com': { x: 5, y: 6, used: 2 }
    });
    expect(await getDetectionWidgetPosition('https://a.com')).toEqual({ x: -1, y: -2 });
  });

  it('refuses insane positions and unstorable origins without writing', async () => {
    await expect(
      saveDetectionWidgetPosition('https://a.com', { x: Number.NaN, y: 0 })
    ).rejects.toThrow(RangeError);
    for (const origin of ['', '__proto__']) {
      await expect(saveDetectionWidgetPosition(origin, { x: 0, y: 0 })).rejects.toThrow(RangeError);
    }
    expect(await detectionWidgetPositionsStore.getValue()).toEqual({});
  });

  it('heals corrupt storage into the fresh valid map', async () => {
    await fakeBrowser.storage.local.set({ [BARE_KEY]: ['junk'] });
    await saveDetectionWidgetPosition('https://a.com', { x: 1, y: 2 });
    expect(await detectionWidgetPositionsStore.getValue()).toEqual({
      'https://a.com': { x: 1, y: 2, used: 1 }
    });
  });

  it('concurrent saves in one context are serialized: both land', async () => {
    await Promise.all([
      saveDetectionWidgetPosition('https://a.com', { x: 1, y: 2 }),
      saveDetectionWidgetPosition('https://b.com', { x: 3, y: 4 })
    ]);
    expect(await detectionWidgetPositionsStore.getValue()).toEqual({
      'https://a.com': { x: 1, y: 2, used: 1 },
      'https://b.com': { x: 3, y: 4, used: 2 }
    });
  });

  it('a rejected save does not stall the next one', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('quota'));
    const failing = saveDetectionWidgetPosition('https://a.com', { x: 1, y: 2 });
    const next = saveDetectionWidgetPosition('https://b.com', { x: 3, y: 4 });
    await expect(failing).rejects.toThrow('quota');
    await expect(next).resolves.toEqual({ x: 3, y: 4 });
    expect(await getDetectionWidgetPosition('https://b.com')).toEqual({ x: 3, y: 4 });
  });

  it('keeps the saved entry’s unknown fields', async () => {
    await fakeBrowser.storage.local.set({
      [BARE_KEY]: { 'https://a.com': { x: 1, y: 2, used: 4, later: 'a' } }
    });
    await saveDetectionWidgetPosition('https://a.com', { x: 5, y: 6 });
    expect(await detectionWidgetPositionsStore.getValue()).toEqual({
      'https://a.com': { x: 5, y: 6, used: 5, later: 'a' }
    });
  });

  it('stays under the byte budget across many long origins, evicting least recent', async () => {
    const saves = 200;
    for (let i = 0; i < saves; i += 1) {
      const origin = `https://${String(1_000_000 + i)}${'a'.repeat(246)}`;
      await saveDetectionWidgetPosition(origin, { x: -30000, y: -30000 });
    }
    const stored = await detectionWidgetPositionsStore.getValue();
    expect(itemBytes(BARE_KEY, stored)).toBeLessThanOrEqual(DETECTION_WIDGET_POSITIONS_BYTE_BUDGET);
    const ranks = Object.values(stored).map((entry) => entry.used ?? 0);
    expect(ranks.length).toBeLessThan(saves);
    expect(Math.max(...ranks)).toBe(saves);
    expect(Math.min(...ranks)).toBe(saves - ranks.length + 1);
  });

  it('the documented capacity: ~500 typical origins fit the budget', () => {
    const map: Record<string, { x: number; y: number; used: number }> = {};
    for (let i = 0; i < 500; i += 1) {
      map[`https://site-${String(1000 + i)}.example.com`] = { x: -1234, y: -567, used: 100 + i };
    }
    expect(itemBytes(BARE_KEY, map)).toBeLessThanOrEqual(DETECTION_WIDGET_POSITIONS_BYTE_BUDGET);
    expect(parseDetectionWidgetPositions(map)).toEqual(map); // nothing trimmed
  });

  it('lives in the local area only: nothing reaches sync (per device, no sync write quota)', async () => {
    expect(DETECTION_WIDGET_POSITIONS_KEY.startsWith('local:')).toBe(true);
    await saveDetectionWidgetPosition('https://a.com', { x: 1, y: 2 });
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual([BARE_KEY]);
  });
});
