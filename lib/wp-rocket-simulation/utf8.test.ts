/** UTF-8 lengths of decoded text, as `TextEncoder` encodes it. */
import { describe, expect, it } from 'vitest';
import {
  byteLength,
  byteView,
  unitOffsetsOfBytes,
  utf8Length,
  utf8UnitBytes,
  UTF8_MEASURE,
  type ByteMeasure
} from './utf8';

/** A single-byte charset's measure (ISO-8859-1, windows-1252…): one byte per unit. */
const SINGLE_BYTE: ByteMeasure = { unitBytes: () => 1, maxUnitBytes: 1 };

describe('utf8Length', () => {
  it.each(['', 'abc', 'é', '€', '😀', 'a😀é€', '\ud800', 'x\udc00y', '\ud800\ud800'])(
    'agrees with TextEncoder on %j',
    (text) => {
      expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
    }
  );

  it('measures a slice', () => {
    expect(utf8Length('aé€b', 1, 3)).toBe(5);
  });
});

describe('utf8UnitBytes', () => {
  it('splits a pair two and two', () => {
    expect(utf8UnitBytes('😀', 0)).toBe(2);
    expect(utf8UnitBytes('😀', 1)).toBe(2);
  });
});

describe('unitOffsetsOfBytes', () => {
  it('maps byte offsets to code-unit offsets', () => {
    expect(unitOffsetsOfBytes('aé😀b', [0, 1, 3, 7, 8])).toEqual([0, 1, 2, 4, 5]);
  });

  it('rejects an offset inside a character', () => {
    expect(() => unitOffsetsOfBytes('é', [1])).toThrow(/not a character boundary/);
  });

  it('rejects an offset past the end', () => {
    expect(() => unitOffsetsOfBytes('a', [2])).toThrow(/not a character boundary/);
  });
});

describe('byteLength / byteView with a measure', () => {
  it('counts UTF-8 by default and a given measure otherwise', () => {
    expect(byteLength('aé€')).toBe(6);
    expect(byteLength('aé€', 0, 3, SINGLE_BYTE)).toBe(3);
    expect(byteLength('aé€', 1, 2, UTF8_MEASURE)).toBe(2);
  });

  it('writes each non-ASCII character as its bytes of 0x80, ASCII as is', () => {
    expect(byteView('a<é>😀b')).toBe('a<\x80\x80>\x80\x80\x80\x80b');
    expect(byteView('a<é>😀b', SINGLE_BYTE)).toBe('a<\x80>\x80\x80b');
    expect(byteView('')).toBe('');
  });

  it('maps byte offsets under a measure', () => {
    expect(unitOffsetsOfBytes('aéb', [0, 1, 2, 3], SINGLE_BYTE)).toEqual([0, 1, 2, 3]);
    expect(() => unitOffsetsOfBytes('aéb', [2])).toThrow(/not a character boundary/);
  });
});
