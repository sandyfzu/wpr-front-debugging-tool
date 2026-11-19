/**
 * The virtual list's key snapshot: a new identity exactly when the keys
 * change (the core's re-key trigger), the same object otherwise.
 */
import { describe, expect, it } from 'vitest';
import { snapshotKeys } from './virtual-list-keys';

/** A key function over a fixed list (`missing-i` past its end). */
function keysOf(list: readonly string[]): (index: number) => string {
  return (index) => list[index] ?? `missing-${String(index)}`;
}

describe('snapshotKeys', () => {
  it('takes the keys over the count and serves them, the caller past the end', () => {
    const snapshot = snapshotKeys(undefined, keysOf(['a', 'b', 'c']), 2);
    expect(snapshot.keys).toEqual(['a', 'b']);
    expect(snapshot.at(1)).toBe('b');
    expect(snapshot.at(2)).toBe('c');
  });

  it('keeps the same snapshot while the caller and its keys are unchanged', () => {
    const keyOf = keysOf(['a', 'b']);
    const first = snapshotKeys(undefined, keyOf, 2);
    expect(snapshotKeys(first, keyOf, 2)).toBe(first);
  });

  it('re-issues when the keys change at an equal count (rows swapped by a search)', () => {
    let rows = ['md-19'];
    const keyOf = (index: number): string => rows[index] ?? '';
    const first = snapshotKeys(undefined, keyOf, 1);
    rows = ['md-07'];
    const next = snapshotKeys(first, keyOf, 1);
    expect(next).not.toBe(first);
    expect(next.at).not.toBe(first.at);
    expect(next.at(0)).toBe('md-07');
    // The old snapshot keeps its own keys (the core may still hold it).
    expect(first.at(0)).toBe('md-19');
  });

  it('re-issues when the count or the caller changes, or a key moves', () => {
    const keyOf = keysOf(['a', 'b']);
    const first = snapshotKeys(undefined, keyOf, 2);
    expect(snapshotKeys(first, keyOf, 1)).not.toBe(first);
    expect(snapshotKeys(first, keysOf(['a', 'b']), 2)).not.toBe(first);
    expect(snapshotKeys(first, keysOf(['b', 'a']), 2).keys).toEqual(['b', 'a']);
  });

  it('takes no keys for an empty or negative count', () => {
    expect(snapshotKeys(undefined, keysOf(['a']), 0).keys).toEqual([]);
    expect(snapshotKeys(undefined, keysOf(['a']), -1).keys).toEqual([]);
  });

  it('keeps numeric keys apart from their string forms', () => {
    const first = snapshotKeys(undefined, (index) => index, 2);
    expect(snapshotKeys(first, first.keyOf, 2)).toBe(first);
    const strings = snapshotKeys(first, (index) => String(index), 2);
    expect(strings).not.toBe(first);
  });
});
