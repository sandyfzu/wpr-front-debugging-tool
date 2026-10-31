/** The Web Crypto digest: the standard vectors, and equal to the synchronous digest. */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';
import { webSha256Hex } from './web-sha256';

describe('webSha256Hex', () => {
  it('matches the standard vectors', async () => {
    await expect(webSha256Hex('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    await expect(webSha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('hashes the UTF-8 bytes, like the synchronous digest (leading zero bytes kept)', async () => {
    for (const text of ['é', '😀', 'a'.repeat(1000), '\u0000', 'x\ny']) {
      const digest = await webSha256Hex(text);
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(digest).toBe(sha256Hex(text));
    }
  });
});
