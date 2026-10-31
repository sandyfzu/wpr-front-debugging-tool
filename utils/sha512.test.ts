import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha384Hex, sha512Hex } from './sha512';

/** Node's digest of a string's UTF-8 bytes (the reference). */
const reference = (algorithm: 'sha384' | 'sha512', text: string): string =>
  createHash(algorithm).update(text, 'utf8').digest('hex');

describe('sha512Hex / sha384Hex', () => {
  it('matches the FIPS 180-4 "abc" vectors', () => {
    expect(sha512Hex('abc')).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
    );
    expect(sha384Hex('abc')).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7'
    );
  });

  it('matches the reference at every padding boundary and on multi-block input', () => {
    // 111/112 bytes straddle the one-block limit; 239/240 the two-block one.
    for (const length of [0, 1, 111, 112, 127, 128, 129, 239, 240, 1000]) {
      const text = 'a'.repeat(length);
      expect(sha512Hex(text)).toBe(reference('sha512', text));
      expect(sha384Hex(text)).toBe(reference('sha384', text));
    }
  });

  it('digests the UTF-8 bytes, lone surrogates as U+FFFD', () => {
    for (const text of ['é漢😀', '\r\n\0', 'x\ud800y']) {
      expect(sha512Hex(text)).toBe(reference('sha512', text.replace(/\ud800/, '�')));
      expect(sha384Hex(text)).toBe(reference('sha384', text.replace(/\ud800/, '�')));
    }
  });
});
