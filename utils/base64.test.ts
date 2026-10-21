import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './base64';

describe('bytesToBase64 / base64ToBytes', () => {
  it('encodes known vectors (RFC 4648 §10)', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foobar', 'Zm9vYmFy']
    ];
    for (const [plain, encoded] of vectors) {
      const bytes = new TextEncoder().encode(plain);
      expect(bytesToBase64(bytes)).toBe(encoded);
      expect(base64ToBytes(encoded)).toEqual(bytes);
    }
  });

  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('round-trips a body larger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 3 + 7 }, (_, i) => (i * 31) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('answers null for invalid base64', () => {
    expect(base64ToBytes('not base64!')).toBeNull();
    expect(base64ToBytes('Zg=')).toBeNull();
  });
});
