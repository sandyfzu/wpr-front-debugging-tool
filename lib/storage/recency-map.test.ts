/**
 * The bounded-map primitives: key and rank validation, the next rank, the
 * most-recent stamp (renumbering at the safe-integer ceiling), the area's
 * per-item byte measure, and the least-recent-first trim (exact incremental
 * accounting, map-order ties, the never-empty last survivor).
 */
import { describe, expect, it } from 'vitest';
import {
  isStorableKey,
  itemBytes,
  nextRecency,
  parseRecency,
  trimToByteBudget,
  withMostRecent
} from './recency-map';

describe('isStorableKey', () => {
  it('refuses only the empty key and `__proto__`', () => {
    expect(isStorableKey('https://a.com')).toBe(true);
    expect(isStorableKey('constructor')).toBe(true);
    expect(isStorableKey('')).toBe(false);
    expect(isStorableKey('__proto__')).toBe(false);
  });
});

describe('parseRecency', () => {
  it('keeps non-negative safe integers only', () => {
    expect(parseRecency(0)).toBe(0);
    expect(parseRecency(42)).toBe(42);
    for (const bad of [-1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 2, '3', null]) {
      expect(parseRecency(bad)).toBeUndefined();
    }
  });
});

describe('nextRecency', () => {
  it('is one above the highest rank; unranked entries count as 0', () => {
    expect(nextRecency({})).toBe(1);
    expect(nextRecency({ a: {}, b: {} })).toBe(1);
    expect(nextRecency({ a: { used: 7 }, b: {}, c: { used: 3 } })).toBe(8);
  });
});

describe('withMostRecent', () => {
  it('stamps the entry above every rank, keeps its fields, leaves the input alone', () => {
    const map: Record<string, { used?: number; v: number }> = { a: { used: 2, v: 1 }, b: { v: 2 } };
    expect(withMostRecent<{ used?: number; v: number }>(map, 'b', { v: 3, used: 99 })).toEqual({
      a: { used: 2, v: 1 },
      b: { v: 3, used: 3 }
    });
    expect(map).toEqual({ a: { used: 2, v: 1 }, b: { v: 2 } });
  });

  it('at the safe-integer ceiling renumbers 1…n in order (ties in map order), stamp newest', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const map: Record<string, { used?: number }> = {
      a: { used: max },
      e: {},
      b: { used: 5 },
      c: {}
    };
    const next = withMostRecent<{ used?: number }>(map, 'd', {});
    expect(next).toEqual({
      a: { used: 4 },
      e: { used: 1 },
      b: { used: 3 },
      c: { used: 2 },
      d: { used: 5 }
    });
    // Every rank survives the next read, and the newest still ranks highest.
    for (const entry of Object.values(next)) expect(parseRecency(entry.used)).toBe(entry.used);
    expect(trimToByteBudget('k', next, itemBytes('k', { d: next.d }))).toEqual({ d: { used: 5 } });
  });
});

describe('itemBytes', () => {
  it('is the bare key length plus the JSON length', () => {
    expect(itemBytes('k', { a: 1 })).toBe(1 + '{"a":1}'.length);
  });
});

describe('trimToByteBudget', () => {
  const map = { 'https://c.com': { used: 3 }, 'https://a.com': { used: 1 }, 'https://b.com': {} };

  it('returns the same map when it fits (no copy)', () => {
    expect(trimToByteBudget('k', map, itemBytes('k', map))).toBe(map);
  });

  it('returns an empty map unchanged', () => {
    const empty = {};
    expect(trimToByteBudget('k', empty, 0)).toBe(empty);
  });

  it('evicts least recent first (unranked = 0), survivors in map order, exact accounting', () => {
    // One byte short of the full map: exactly the unranked b.com goes.
    const trimmed = trimToByteBudget('k', map, itemBytes('k', map) - 1);
    expect(trimmed).toEqual({ 'https://c.com': { used: 3 }, 'https://a.com': { used: 1 } });
    expect(Object.keys(trimmed)).toEqual(['https://c.com', 'https://a.com']);
    // The incremental count matches a real serialization at the boundary.
    expect(trimToByteBudget('k', map, itemBytes('k', trimmed))).toEqual(trimmed);
    expect(Object.keys(trimToByteBudget('k', map, itemBytes('k', trimmed) - 1))).toEqual([
      'https://c.com'
    ]);
  });

  it('ties break in map order (earlier first)', () => {
    const tied = { x: { used: 1 }, y: { used: 1 }, z: { used: 1 } };
    expect(Object.keys(trimToByteBudget('k', tied, itemBytes('k', tied) - 1))).toEqual(['y', 'z']);
  });

  it('never evicts the last entry, even over budget (the platform rejects instead)', () => {
    expect(trimToByteBudget('k', map, 0)).toEqual({ 'https://c.com': { used: 3 } });
  });

  it('every trim result fits the budget whenever more than one entry survives', () => {
    // Unique ranks (a bijection of 0…299 — 7 is coprime to 300) in scrambled
    // map order, so the eviction order is fully determined and checked.
    const big: Record<string, { used: number }> = {};
    for (let i = 0; i < 300; i += 1)
      big[`https://site-${String(i)}.example`] = { used: (i * 7) % 300 };
    for (const budget of [100, 1000, 4096, 7168]) {
      const trimmed = trimToByteBudget('detection-widget-sites', big, budget);
      expect(itemBytes('detection-widget-sites', trimmed)).toBeLessThanOrEqual(budget);
      const ranks = Object.values(trimmed).map((entry) => entry.used);
      const evicted = Object.values(big)
        .map((entry) => entry.used)
        .filter((rank) => !ranks.includes(rank));
      // Every survivor is more recent than every evicted entry: exactly the
      // top ranks survive, and each entry is either kept or evicted.
      expect(Math.min(...ranks)).toBeGreaterThan(Math.max(...evicted));
      expect(ranks.length + evicted.length).toBe(300);
      expect([...ranks].sort((x, y) => x - y)).toEqual(
        Array.from({ length: ranks.length }, (_, k) => 300 - ranks.length + k)
      );
    }
  });
});
