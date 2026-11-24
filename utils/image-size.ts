/**
 * An image's pixel size, read from its file header alone (no decoding): PNG
 * (`IHDR`) and WebP in its three bitstream forms (`VP8 ` lossy, `VP8L`
 * lossless, `VP8X` extended). Lets a check compare a file with the size a
 * page reserves for it.
 */

/** Width × height in pixels. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** The PNG signature, then the first chunk's length + type (`IHDR` is always first). */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** A lossy frame's start code (after its 3-byte frame tag). */
const VP8_START_CODE = [0x9d, 0x01, 0x2a] as const;

/** A lossless bitstream's signature byte. */
const VP8L_SIGNATURE = 0x2f;

/** The 14-bit mask of a VP8/VP8L dimension. */
const DIMENSION_14 = 0x3fff;

/**
 * Whether `bytes` holds `expected` at `offset`.
 *
 * @param bytes The file.
 * @param offset Where to look.
 * @param expected Byte values, or an ASCII tag.
 */
function hasAt(bytes: Uint8Array, offset: number, expected: string | readonly number[]): boolean {
  // Tags are ASCII: their UTF-8 bytes are their character codes.
  const values = typeof expected === 'string' ? new TextEncoder().encode(expected) : expected;
  return values.every((value, index) => bytes[offset + index] === value);
}

/**
 * A little-endian unsigned integer of `length` bytes.
 *
 * @param bytes The file (long enough: the caller checked).
 * @param offset The first byte.
 * @param length 2, 3 or 4.
 */
function readLittleEndian(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let index = length - 1; index >= 0; index -= 1) {
    value = value * 256 + (bytes[offset + index] ?? 0);
  }
  return value;
}

/**
 * A PNG's size, from its `IHDR` chunk (big-endian width then height).
 *
 * @param bytes The file.
 * @returns The size, or null when this is not a PNG header.
 */
function pngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24 || !hasAt(bytes, 0, PNG_SIGNATURE) || !hasAt(bytes, 12, 'IHDR')) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * A WebP's size, from the first chunk after the RIFF header.
 *
 * @param bytes The file.
 * @returns The size, or null when this is not a WebP header this reader knows.
 */
function webpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30 || !hasAt(bytes, 0, 'RIFF') || !hasAt(bytes, 8, 'WEBP')) return null;
  // Lossy: frame tag (3 bytes) + start code, then two 14-bit dimensions (2 scale bits above).
  if (hasAt(bytes, 12, 'VP8 ') && hasAt(bytes, 23, VP8_START_CODE)) {
    return {
      width: readLittleEndian(bytes, 26, 2) & DIMENSION_14,
      height: readLittleEndian(bytes, 28, 2) & DIMENSION_14
    };
  }
  // Lossless: signature byte, then width − 1 and height − 1 as packed 14-bit fields.
  if (hasAt(bytes, 12, 'VP8L') && bytes[20] === VP8L_SIGNATURE) {
    const bits = readLittleEndian(bytes, 21, 4);
    return {
      width: (bits & DIMENSION_14) + 1,
      height: (Math.floor(bits / 2 ** 14) & DIMENSION_14) + 1
    };
  }
  // Extended: flags (4 bytes), then canvas width − 1 and height − 1, 24 bits each.
  if (hasAt(bytes, 12, 'VP8X')) {
    return {
      width: readLittleEndian(bytes, 24, 3) + 1,
      height: readLittleEndian(bytes, 27, 3) + 1
    };
  }
  return null;
}

/**
 * Read an image's pixel size from its header.
 *
 * @param bytes The file's bytes (the first 30 are enough).
 * @returns The size, or null for a truncated file or a format other than PNG/WebP.
 */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  return pngSize(bytes) ?? webpSize(bytes);
}
