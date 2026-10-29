/** The cached forward searches: exact for any call order, linear for forward scans. */
import { describe, expect, it } from 'vitest';
import { linearScaling } from '../vitest.shared';
import { cachedForwardSearch, nextOccurrenceFinder } from './next-occurrence';

/**
 * A deterministic pseudo-random sequence (LCG), for reproducible call orders.
 *
 * @param seed The start value.
 */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 48_271) % 2_147_483_647;
    return state / 2_147_483_647;
  };
}

describe('nextOccurrenceFinder', () => {
  it('answers like indexOf for every offset, in any call order', () => {
    const text = 'a-->b--!>c-->-->';
    const offsets = [0, 3, 1, 1, 9, 2, 14, 16, 20, -3, 5, 4, 13, 12];
    for (const needle of ['-->', '--!>', 'x', 'c']) {
      const find = nextOccurrenceFinder(text, needle);
      for (const from of offsets) expect(find(from)).toBe(text.indexOf(needle, from));
    }
  });

  it('answers like indexOf on random texts and random call orders', () => {
    const next = random(7);
    for (let round = 0; round < 200; round++) {
      const text = Array.from({ length: 40 }, () => (next() < 0.2 ? '>' : 'a')).join('');
      const find = nextOccurrenceFinder(text, 'a>');
      for (let call = 0; call < 30; call++) {
        const from = Math.floor(next() * 46) - 3;
        expect(find(from)).toBe(text.indexOf('a>', from));
      }
    }
  });

  it('remembers an absent needle for later offsets', () => {
    const find = nextOccurrenceFinder('aaaa', 'b');
    expect([find(0), find(2), find(4), find(1)]).toEqual([-1, -1, -1, -1]);
  });

  it('reads a far needle once across forward calls (linear scan, 1 → 4 MiB)', () => {
    // A fresh indexOf per call would read ~1.2e12 characters at 4 MiB.
    const scaling = linearScaling(
      (bytes) => 'x'.repeat(bytes) + '>',
      (text) => {
        const find = nextOccurrenceFinder(text, '>');
        for (let from = 0; from < text.length; from += 7) find(from);
        return find(0) === text.length - 1;
      }
    );
    expect(scaling.violation).toBeUndefined();
    expect(scaling.output).toBe(true);
  });

  it('refuses an empty needle', () => {
    expect(() => nextOccurrenceFinder('a', '')).toThrow(/non-empty needle/);
  });
});

describe('cachedForwardSearch', () => {
  it('searches only the gap before a proven stretch on a step back', () => {
    const text = 'aaaaaaaaab';
    const reads: [number, number][] = [];
    const find = cachedForwardSearch((from, to) => {
      reads.push([from, to]);
      for (let at = Math.max(from, 0); at < Math.min(to, text.length); at++) {
        if (text[at] === 'b') return at;
      }
      return -1;
    });
    expect([find(4), find(2), find(3), find(9), find(10)]).toEqual([9, 9, 9, 9, -1]);
    expect(reads).toEqual([
      [4, Number.POSITIVE_INFINITY],
      [2, 4],
      [10, Number.POSITIVE_INFINITY]
    ]);
  });

  it('takes a hit found in the gap', () => {
    const text = 'ab-aaaab';
    const find = cachedForwardSearch((from, to) => {
      const at = text.indexOf('b', from);
      return at !== -1 && at < to ? at : -1;
    });
    expect([find(3), find(0), find(2), find(1)]).toEqual([7, 1, 7, 1]);
  });
});
