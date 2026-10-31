/**
 * Read a response body as UTF-8 text without ever holding more than a cap:
 * the stream is cancelled as soon as it passes it, so an oversized or
 * endless answer costs at most `maxBytes` of memory.
 */

/** A capped read's answer: the text, or why there is none. */
export type CappedTextRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problem: 'oversize' | 'not-utf8' };

/**
 * Read a response's body as UTF-8 text, at most `maxBytes` bytes. A
 * declared `Content-Length` over the cap is refused before any byte is read.
 *
 * @param response The response (its body unread).
 * @param maxBytes The cap in bytes.
 * @returns The text, `oversize` past the cap, `not-utf8` on an invalid byte sequence.
 * @throws The stream's own failure (a network error or an abort while reading).
 */
export async function readCappedText(
  response: Response,
  maxBytes: number
): Promise<CappedTextRead> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (declared > maxBytes) {
    await response.body?.cancel();
    return { ok: false, problem: 'oversize' };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body !== null) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, problem: 'oversize' };
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    // `fatal` decoding throws only on an invalid sequence: the answer is not UTF-8 text.
    return { ok: false, problem: 'not-utf8' };
  }
}
