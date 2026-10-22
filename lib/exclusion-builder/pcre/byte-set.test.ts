import { describe, expect, it } from 'vitest';
import {
  ANY_BYTE,
  ESCAPE_SETS,
  POSIX_SETS,
  byteRanges,
  bytesOf,
  complementOf,
  foldAsciiCase,
  intersects,
  setSource,
  unionOf
} from './byte-set';

/** The members of a set. */
function members(set: Uint8Array): number[] {
  return [...set.keys()].filter((byte) => set[byte] === 1);
}

describe('byte sets', () => {
  it('build from ranges and bytes, combine and complement', () => {
    expect(members(byteRanges([0x41, 0x43], [0x61, 0x61]))).toEqual([0x41, 0x42, 0x43, 0x61]);
    expect(members(unionOf(bytesOf(1), bytesOf(3)))).toEqual([1, 3]);
    expect(members(complementOf(byteRanges([0x01, 0xff])))).toEqual([0]);
    expect(intersects(bytesOf(1, 2), bytesOf(2))).toBe(true);
    expect(intersects(bytesOf(1), bytesOf(2))).toBe(false);
  });

  it('fold ASCII letters only (PCRE caseless without UTF)', () => {
    expect(members(foldAsciiCase(bytesOf(0x61, 0x5a, 0x31, 0xe9)))).toEqual([
      0x31, 0x41, 0x5a, 0x61, 0x7a, 0xe9
    ]);
  });

  it('hold the observed PCRE2 default-table members', () => {
    expect(members(ESCAPE_SETS.s ?? new Uint8Array())).toEqual([
      0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20
    ]);
    expect(members(ESCAPE_SETS.h ?? new Uint8Array())).toEqual([0x09, 0x20, 0xa0]);
    expect(members(ESCAPE_SETS.v ?? new Uint8Array())).toEqual([0x0a, 0x0b, 0x0c, 0x0d, 0x85]);
    expect(members(POSIX_SETS.punct ?? new Uint8Array())).toHaveLength(32);
    expect(members(POSIX_SETS.xdigit ?? new Uint8Array())).toHaveLength(22);
  });
});

describe('setSource', () => {
  it.each([
    [ANY_BYTE, '[\\s\\S]'],
    [new Uint8Array(256), '[^\\s\\S]'],
    [bytesOf(0x61), 'a'],
    [bytesOf(0x2e), '\\x2e'],
    [bytesOf(0x41, 0x61), '[Aa]'],
    [byteRanges([0x30, 0x39], [0x5f, 0x5f]), '[0-9_]'],
    [complementOf(bytesOf(0x0a)), '[^\\x0a]'],
    [byteRanges([0x00, 0x7f]), '[\\x00-\\x7f]']
  ])('emits the shortest exact form (%#)', (set, source) => {
    expect(setSource(set)).toBe(source);
  });

  it('matches exactly its members among all 256 units', () => {
    const set = unionOf(ESCAPE_SETS.w ?? new Uint8Array(), bytesOf(0x2d, 0xe9));
    const regex = new RegExp(`^${setSource(set)}$`);
    const matched = [...Array(256).keys()].filter((byte) => regex.test(String.fromCharCode(byte)));
    expect(matched).toEqual(members(set));
  });
});
