import { describe, expect, it, vi } from 'vitest';
import { createBoundedMemo, detachedString, stringBytes } from './bounded-memo';

describe('createBoundedMemo', () => {
  it('builds once per key and serves the kept value after', () => {
    const memo = createBoundedMemo<number>({ maxEntries: 4 });
    const build = vi.fn(() => 7);
    expect(memo.get('a', build)).toBe(7);
    expect(memo.get('a', build)).toBe(7);
    expect(build).toHaveBeenCalledTimes(1);
    expect(memo.size).toBe(1);
  });

  it('evicts the oldest inserted entry past the entry bound', () => {
    const memo = createBoundedMemo<string>({ maxEntries: 2 });
    memo.get('a', () => 'A');
    memo.get('b', () => 'B');
    memo.get('c', () => 'C');
    expect(memo.size).toBe(2);
    const rebuilt = vi.fn(() => 'A2');
    expect(memo.get('a', rebuilt)).toBe('A2');
    expect(rebuilt).toHaveBeenCalledTimes(1);
    // `c` evicted `a`; `a`'s rebuild evicted `b`; `c` is still kept.
    const c = vi.fn(() => 'C2');
    expect(memo.get('c', c)).toBe('C');
    expect(c).not.toHaveBeenCalled();
  });

  it('keeps the total weight within the bound, evicting as many old entries as needed', () => {
    const memo = createBoundedMemo<string>({
      maxEntries: 100,
      maxWeight: 10,
      weigh: (key, value) => key.length + value.length
    });
    memo.get('a', () => 'xxxx'); // 5
    memo.get('b', () => 'yyyy'); // 5 → 10
    expect(memo.weight).toBe(10);
    memo.get('c', () => 'zzzzzzz'); // 8: evicts a and b
    expect(memo.size).toBe(1);
    expect(memo.weight).toBe(8);
  });

  it('returns but never keeps a value heavier than the whole bound', () => {
    const memo = createBoundedMemo<string>({
      maxEntries: 10,
      maxWeight: 3,
      weigh: (_key, value) => value.length
    });
    memo.get('small', () => 'ab');
    expect(memo.get('huge', () => 'abcdef')).toBe('abcdef');
    expect(memo.size).toBe(1);
    expect(memo.weight).toBe(2);
    const again = vi.fn(() => 'abcdef');
    memo.get('huge', again);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('refuses impossible bounds', () => {
    expect(() => createBoundedMemo({ maxEntries: 0 })).toThrow(RangeError);
    expect(() => createBoundedMemo({ maxEntries: 1, maxWeight: -1 })).toThrow(RangeError);
  });

  it('keeps a key that equals the asked one (a detached copy)', () => {
    const memo = createBoundedMemo<number>({ maxEntries: 2 });
    const parent = `${'p'.repeat(64)}key-one${'q'.repeat(64)}`;
    memo.get(parent.slice(64, 71), () => 1);
    const again = vi.fn(() => 2);
    expect(memo.get('key-one', again)).toBe(1);
    expect(again).not.toHaveBeenCalled();
  });
});

describe('stringBytes', () => {
  it('counts one byte per character up to U+00FF, else two', () => {
    expect(stringBytes('')).toBe(0);
    expect(stringBytes('abcÿ')).toBe(4);
    expect(stringBytes('abĀ')).toBe(6);
    expect(stringBytes('😀')).toBe(4);
    expect(stringBytes('a\ud800')).toBe(4);
  });
});

describe('detachedString', () => {
  it('returns an equal string, lone surrogates and controls included', () => {
    for (const text of ['', 'abc', 'a\ud800b\udfff', '"\\\n\u0000 ', 'é漢😀']) {
      expect(detachedString(text)).toBe(text);
    }
    const parent = 'x'.repeat(10_000) + 'tail-of-the-parent';
    expect(detachedString(parent.slice(10_000))).toBe('tail-of-the-parent');
  });
});
