/**
 * Capped body reads: the text within the cap, `oversize` past it (declared
 * or streamed — the stream cancelled), `not-utf8` on invalid bytes, and a
 * stream failure rethrown.
 */
import { describe, expect, it, vi } from 'vitest';
import { readCappedText } from './read-capped-text';

/** A response streaming `chunks`, without a declared length. */
function streamed(chunks: readonly Uint8Array[], onCancel = vi.fn()): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    cancel: onCancel
  });
  return new Response(body);
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('readCappedText', () => {
  it('reads a body within the cap, across chunks and multi-byte characters', async () => {
    const all = bytes('{"a":"é😀"}');
    const response = streamed([all.slice(0, 7), all.slice(7)]);
    await expect(readCappedText(response, all.byteLength)).resolves.toEqual({
      ok: true,
      text: '{"a":"é😀"}'
    });
  });

  it('reads an empty body', async () => {
    await expect(readCappedText(new Response(null), 10)).resolves.toEqual({ ok: true, text: '' });
  });

  it('stops at the first byte past the cap and cancels the stream', async () => {
    const onCancel = vi.fn();
    const response = streamed([bytes('12345'), bytes('6'), bytes('never read')], onCancel);
    await expect(readCappedText(response, 5)).resolves.toEqual({ ok: false, problem: 'oversize' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('refuses a declared length over the cap before reading', async () => {
    const response = new Response('x', { headers: { 'content-length': '11' } });
    await expect(readCappedText(response, 10)).resolves.toEqual({
      ok: false,
      problem: 'oversize'
    });
  });

  it('refuses invalid UTF-8', async () => {
    const response = streamed([new Uint8Array([0x7b, 0xff, 0x7d])]);
    await expect(readCappedText(response, 10)).resolves.toEqual({
      ok: false,
      problem: 'not-utf8'
    });
  });

  it('rethrows a stream failure', async () => {
    const failure = new DOMException('timed out', 'TimeoutError');
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      }
    });
    await expect(readCappedText(new Response(body), 10)).rejects.toBe(failure);
  });
});
