/**
 * SHA-256 through Web Crypto — native, for secure contexts (extension
 * pages, the background), where `crypto.subtle` is guaranteed. Contexts
 * that may lack it (a content script on a plain `http:` page) use the
 * synchronous `sha256Hex` (`./sha256`).
 */

/**
 * Lowercase hex of bytes.
 *
 * @param bytes The bytes.
 */
function hexOf(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 of a string's UTF-8 encoding.
 *
 * @param text The input.
 * @returns The 64-character lowercase hex digest.
 */
export async function webSha256Hex(text: string): Promise<string> {
  return hexOf(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
