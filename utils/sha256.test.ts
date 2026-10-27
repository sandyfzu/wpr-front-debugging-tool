import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

/** Node's digest — the independent oracle. */
function oracle(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });

  it('agrees with an independent digest across every padding boundary', () => {
    // 55/56/63/64/65 bytes straddle the one- vs two-block padding split.
    for (let length = 0; length <= 130; length += 1) {
      const text = 'x'.repeat(length);
      expect(sha256Hex(text), `length ${String(length)}`).toBe(oracle(text));
    }
  });

  it('hashes the UTF-8 bytes of non-ASCII text', () => {
    const url = 'https://example.com/café/日本?q=🎉&a=1';
    expect(sha256Hex(url)).toBe(oracle(url));
  });

  it('hashes a multi-kilobyte URL exactly', () => {
    const url = `https://example.com/?${'k=v&'.repeat(4000)}`;
    expect(sha256Hex(url)).toBe(oracle(url));
  });
});
