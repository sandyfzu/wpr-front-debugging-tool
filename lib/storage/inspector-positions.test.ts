/**
 * The widget-position store: coordinate sanity at the boundary (finite,
 * bounded, integer-normalized), the map validator, corrupt degradations,
 * the ranked write and its least-recent eviction under the byte budget,
 * and the refusal of insane writes.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { itemBytes } from './recency-map';
import {
  INSPECTOR_POSITION_LIMIT,
  INSPECTOR_POSITIONS_BYTE_BUDGET,
  INSPECTOR_POSITIONS_KEY,
  getInspectorPosition,
  inspectorPositionsStore,
  parseInspectorPosition,
  parseInspectorPositions,
  saveInspectorPosition
} from './inspector-positions';
import { INSPECTOR_ORIGINS_KEY } from './inspector-origins';

const BARE_KEY = INSPECTOR_POSITIONS_KEY.slice('sync:'.length);

beforeEach(() => {
  fakeBrowser.reset();
});

describe('parseInspectorPosition', () => {
  it('rounds finite in-range coordinates to integers (and -0 to 0)', () => {
    expect(parseInspectorPosition({ x: -120.4, y: -0.2 })).toEqual({ x: -120, y: 0 });
    expect(Object.is(parseInspectorPosition({ x: -0, y: 1 })?.x, 0)).toBe(true);
    expect(
      parseInspectorPosition({ x: INSPECTOR_POSITION_LIMIT, y: -INSPECTOR_POSITION_LIMIT })
    ).toEqual({ x: INSPECTOR_POSITION_LIMIT, y: -INSPECTOR_POSITION_LIMIT });
  });

  it('refuses non-finite, out-of-range, missing or non-numeric coordinates', () => {
    for (const bad of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Infinity },
      { x: INSPECTOR_POSITION_LIMIT + 1, y: 0 },
      { x: 0, y: -INSPECTOR_POSITION_LIMIT - 1 },
      { x: '1', y: 2 },
      { x: 1 },
      null,
      'x',
      7
    ]) {
      expect(parseInspectorPosition(bad)).toBeNull();
    }
  });
});

describe('parseInspectorPositions', () => {
  it('rejects non-maps wholesale', () => {
    for (const bad of [null, 'x', 1, [], true]) expect(parseInspectorPositions(bad)).toBeNull();
  });

  it('drops insane entries and empty keys; keeps ranks; tolerates unknown fields', () => {
    expect(
      parseInspectorPositions({
        'https://a.com': { x: -10, y: -20, used: 2, later: true },
        'https://b.com': { x: 'no', y: 1 },
        'https://c.com': { x: 1e9, y: 0 },
        'https://d.com': { x: 1, y: 2, used: -4 },
        '': { x: 1, y: 1 }
      })
    ).toEqual({ 'https://a.com': { x: -10, y: -20, used: 2 }, 'https://d.com': { x: 1, y: 2 } });
  });
});

describe('getInspectorPosition', () => {
  it('reads null for none stored and for corrupt storage', async () => {
    expect(await getInspectorPosition('https://a.com')).toBeNull();
    await fakeBrowser.storage.sync.set({ [BARE_KEY]: 'corrupted' });
    expect(await getInspectorPosition('https://a.com')).toBeNull();
    await fakeBrowser.storage.sync.set({ [BARE_KEY]: { 'https://a.com': { x: Infinity, y: 0 } } });
    expect(await getInspectorPosition('https://a.com')).toBeNull();
  });
});

describe('saveInspectorPosition', () => {
  it('round-trips a normalized position, ranked most recent; siblings kept', async () => {
    expect(await saveInspectorPosition('https://a.com', { x: -10.6, y: -20 })).toEqual({
      x: -11,
      y: -20
    });
    await saveInspectorPosition('https://b.com', { x: 5, y: 6 });
    await saveInspectorPosition('https://a.com', { x: -1, y: -2 });
    expect(await inspectorPositionsStore.getValue()).toEqual({
      'https://a.com': { x: -1, y: -2, used: 3 },
      'https://b.com': { x: 5, y: 6, used: 2 }
    });
    expect(await getInspectorPosition('https://a.com')).toEqual({ x: -1, y: -2 });
  });

  it('refuses insane positions and empty origins without writing', async () => {
    await expect(saveInspectorPosition('https://a.com', { x: Number.NaN, y: 0 })).rejects.toThrow(
      RangeError
    );
    await expect(saveInspectorPosition('', { x: 0, y: 0 })).rejects.toThrow(RangeError);
    expect(await inspectorPositionsStore.getValue()).toEqual({});
  });

  it('heals corrupt storage into the fresh valid map', async () => {
    await fakeBrowser.storage.sync.set({ [BARE_KEY]: ['junk'] });
    await saveInspectorPosition('https://a.com', { x: 1, y: 2 });
    expect(await inspectorPositionsStore.getValue()).toEqual({
      'https://a.com': { x: 1, y: 2, used: 1 }
    });
  });

  it('stays under the byte budget across many long origins, evicting least recent', async () => {
    for (let i = 0; i < 120; i += 1) {
      const origin = `https://${String(1_000_000 + i)}${'a'.repeat(246)}`;
      await saveInspectorPosition(origin, { x: -30000, y: -30000 });
    }
    const stored = await inspectorPositionsStore.getValue();
    expect(itemBytes(BARE_KEY, stored)).toBeLessThanOrEqual(INSPECTOR_POSITIONS_BYTE_BUDGET);
    const ranks = Object.values(stored).map((entry) => entry.used ?? 0);
    expect(Math.max(...ranks)).toBe(120);
    expect(Math.min(...ranks)).toBe(120 - ranks.length + 1);
  });

  it('never touches the override item (separate budgets, separate writers)', async () => {
    await saveInspectorPosition('https://a.com', { x: 1, y: 2 });
    const bareOrigins = INSPECTOR_ORIGINS_KEY.slice('sync:'.length);
    expect(await fakeBrowser.storage.sync.get(bareOrigins)).toEqual({});
  });
});
