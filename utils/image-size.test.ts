/**
 * Header-only image sizes: PNG and the three WebP forms read from hand-built
 * headers (each field at its spec offset), a real PNG from the repository,
 * and null for anything truncated, foreign or malformed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readImageSize } from './image-size';

/** ASCII bytes of a tag. */
const ascii = (text: string): number[] => Array.from(new TextEncoder().encode(text));

/** `value` as `length` little-endian bytes. */
const le = (value: number, length: number): number[] =>
  Array.from({ length }, (_, index) => Math.floor(value / 256 ** index) % 256);

/** A RIFF/WEBP file whose first chunk is `fourcc` with `payload` (padded to 30 bytes). */
function webp(fourcc: string, payload: number[]): Uint8Array {
  const bytes = [...ascii('RIFF'), ...le(0, 4), ...ascii('WEBP'), ...ascii(fourcc), ...le(0, 4)];
  const file = [...bytes, ...payload];
  while (file.length < 30) file.push(0);
  return Uint8Array.from(file);
}

/** A PNG header with an `IHDR` of `width` × `height`. */
function png(width: number, height: number): Uint8Array {
  const be = (value: number): number[] => le(value, 4).reverse();
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be(13),
    ...ascii('IHDR'),
    ...be(width),
    ...be(height)
  ]);
}

describe('readImageSize', () => {
  it('reads a PNG IHDR (big-endian)', () => {
    expect(readImageSize(png(1280, 800))).toEqual({ width: 1280, height: 800 });
  });

  it('reads a real PNG from the repository', () => {
    const file = readFileSync(path.resolve(import.meta.dirname, '..', 'public', 'icon', '128.png'));
    expect(readImageSize(file)).toEqual({ width: 128, height: 128 });
  });

  it('reads a lossy VP8 frame, ignoring the two scale bits', () => {
    const frame = [0, 0, 0, 0x9d, 0x01, 0x2a, ...le(800 | 0xc000, 2), ...le(500 | 0x4000, 2)];
    expect(readImageSize(webp('VP8 ', frame))).toEqual({ width: 800, height: 500 });
  });

  it('reads a lossless VP8L header (packed width − 1, height − 1)', () => {
    const bits = 800 - 1 + (500 - 1) * 2 ** 14;
    expect(readImageSize(webp('VP8L', [0x2f, ...le(bits, 4)]))).toEqual({
      width: 800,
      height: 500
    });
  });

  it('reads an extended VP8X canvas (24-bit width − 1, height − 1)', () => {
    const payload = [...le(0, 4), ...le(70_000 - 1, 3), ...le(3 - 1, 3)];
    expect(readImageSize(webp('VP8X', payload))).toEqual({ width: 70_000, height: 3 });
  });

  it('is null for truncated, foreign or malformed headers', () => {
    expect(readImageSize(new Uint8Array())).toBeNull();
    expect(readImageSize(png(1, 1).slice(0, 20))).toBeNull();
    expect(readImageSize(Uint8Array.from(ascii('GIF89a').concat(le(0, 30))))).toBeNull();
    // A VP8 chunk without its start code, a VP8L without its signature, an unknown chunk.
    expect(readImageSize(webp('VP8 ', [0, 0, 0, 1, 2, 3]))).toBeNull();
    expect(readImageSize(webp('VP8L', [0x00]))).toBeNull();
    expect(readImageSize(webp('ALPH', []))).toBeNull();
    // A PNG whose first chunk is not IHDR.
    const noIhdr = png(1, 1);
    noIhdr.set(ascii('IDAT'), 12);
    expect(readImageSize(noIhdr)).toBeNull();
  });

  it('reads a header inside a larger buffer view', () => {
    const backing = new Uint8Array(64);
    backing.set(png(16, 32), 8);
    expect(readImageSize(backing.subarray(8))).toEqual({ width: 16, height: 32 });
  });
});
