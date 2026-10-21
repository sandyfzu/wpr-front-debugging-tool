/**
 * Byte ↔ base64 conversion over the platform's `atob`/`btoa` (the
 * `Uint8Array` base64 methods are not available on every runtime this code
 * runs in). Chunked so multi-megabyte bodies never build one giant
 * argument list.
 */

/** Bytes per `String.fromCharCode` call — far below every engine's argument limit. */
const CHUNK = 0x8000;

/**
 * Encode bytes as standard (padded) base64.
 *
 * @param bytes The bytes.
 * @returns The base64 text (empty for no bytes).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decode standard base64 into bytes.
 *
 * @param text The base64 text.
 * @returns The bytes, or null when `text` is not valid base64.
 */
export function base64ToBytes(text: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    // `atob` throws on characters outside the alphabet and on bad padding:
    // an invalid input, reported as null.
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
