import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SERVED_DOCUMENT_LIMITS } from '../messaging/exclusion-session';
import { servedUrl } from './served-url';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

describe('servedUrl', () => {
  it('keeps origin + path, never the query, and digests the whole URL without its fragment', async () => {
    await expect(servedUrl('https://shop.test/cart?email=a%40b.c#top')).resolves.toEqual({
      urlPath: 'https://shop.test/cart',
      urlDigest: sha256('https://shop.test/cart?email=a%40b.c')
    });
  });

  it('digests the platform serialization (what location.href gives)', async () => {
    const result = await servedUrl('HTTPS://Shop.TEST:443/a b');
    expect(result).toEqual({
      urlPath: 'https://shop.test/a%20b',
      urlDigest: sha256('https://shop.test/a%20b')
    });
  });

  it('cuts an over-long path, the digest staying exact', async () => {
    const long = `https://s.test/${'p'.repeat(SERVED_DOCUMENT_LIMITS.urlPathChars)}`;
    const result = await servedUrl(long);
    expect(result?.urlPath).toHaveLength(SERVED_DOCUMENT_LIMITS.urlPathChars);
    expect(result?.urlDigest).toBe(sha256(long));
  });

  it('answers null for a non-URL', async () => {
    await expect(servedUrl('not a url')).resolves.toBeNull();
  });
});
