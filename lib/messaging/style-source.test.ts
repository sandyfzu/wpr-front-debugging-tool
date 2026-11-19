/**
 * The style-source contract: request and reply guards (exact keys, caps),
 * the kept-source cut and chunking, and the panel's full read (chunk join,
 * consistency, every failure as a result — never a throw).
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { PAGE_STYLE_LIMITS } from './page-styles';
import {
  STYLE_SOURCE_CHUNK_CHARS,
  STYLE_SOURCE_MAX_CHARS,
  keepStyleSource,
  loadStyleSource,
  parseStyleSourceReply,
  parseStyleSourceRequest,
  styleSourceChunk,
  type StyleSourceRequest
} from './style-source';

const ID = '0123456789abcdef0123456789abcdef';
const REQUEST: StyleSourceRequest = { snapshotId: ID, styleIndex: 3, offset: 0 };

/** A logger double. */
function logDouble(): { warn: Mock<(...args: unknown[]) => void> } {
  return { warn: vi.fn<(...args: unknown[]) => void>() };
}

/**
 * A page double answering chunk reads of one text, recording the offsets.
 *
 * @param text The style's CSS.
 * @param truncated Whether the page cut it.
 */
function pageOf(text: string, truncated = false) {
  const offsets: number[] = [];
  const send = vi.fn((request: StyleSourceRequest) => {
    offsets.push(request.offset);
    return Promise.resolve(styleSourceChunk({ text, truncated }, request.offset));
  });
  return { send, offsets };
}

describe('parseStyleSourceRequest', () => {
  it('rebuilds a valid request from its three fields', () => {
    const request = parseStyleSourceRequest({ ...REQUEST });
    expect(request).toEqual(REQUEST);
    expect(parseStyleSourceRequest({ ...REQUEST, offset: STYLE_SOURCE_MAX_CHARS })).not.toBeNull();
    expect(
      parseStyleSourceRequest({ ...REQUEST, styleIndex: PAGE_STYLE_LIMITS.count - 1 })
    ).not.toBeNull();
  });

  it.each([
    ['null', null],
    ['an array', [ID, 0, 0]],
    ['an extra key', { ...REQUEST, extra: 1 }],
    ['a missing offset', { snapshotId: ID, styleIndex: 0 }],
    ['a malformed id', { ...REQUEST, snapshotId: 'ABC' }],
    ['a negative index', { ...REQUEST, styleIndex: -1 }],
    ['an index past the list cap', { ...REQUEST, styleIndex: PAGE_STYLE_LIMITS.count }],
    ['a fractional offset', { ...REQUEST, offset: 0.5 }],
    ['an offset past the cap', { ...REQUEST, offset: STYLE_SOURCE_MAX_CHARS + 1 }],
    ['a string index', { ...REQUEST, styleIndex: '1' }],
    ['NaN', { ...REQUEST, offset: Number.NaN }]
  ])('refuses %s', (_name, input) => {
    expect(parseStyleSourceRequest(input)).toBeNull();
  });
});

describe('keepStyleSource + styleSourceChunk', () => {
  it('keeps a style within the cap whole', () => {
    expect(keepStyleSource('a{}')).toEqual({ text: 'a{}', truncated: false });
    const exact = 'x'.repeat(STYLE_SOURCE_MAX_CHARS);
    expect(keepStyleSource(exact)).toEqual({ text: exact, truncated: false });
  });

  it('cuts past the cap, never inside a surrogate pair', () => {
    const kept = keepStyleSource(`${'x'.repeat(STYLE_SOURCE_MAX_CHARS - 1)}😀tail`);
    expect(kept.truncated).toBe(true);
    // The pair would straddle the cap: it is dropped whole.
    expect(kept.text).toHaveLength(STYLE_SOURCE_MAX_CHARS - 1);
  });

  it('serves chunks of the chunk size and the rest, and refuses an offset past the end', () => {
    const source = { text: 'a'.repeat(STYLE_SOURCE_CHUNK_CHARS + 3), truncated: false };
    expect(styleSourceChunk(source, 0)).toMatchObject({
      status: 'ok',
      total: STYLE_SOURCE_CHUNK_CHARS + 3
    });
    expect(styleSourceChunk(source, STYLE_SOURCE_CHUNK_CHARS)).toEqual({
      status: 'ok',
      text: 'aaa',
      total: STYLE_SOURCE_CHUNK_CHARS + 3,
      truncated: false
    });
    expect(styleSourceChunk(source, source.text.length)).toMatchObject({ status: 'ok', text: '' });
    expect(styleSourceChunk(source, source.text.length + 1)).toEqual({
      status: 'error',
      reason: 'invalid-request'
    });
  });
});

describe('parseStyleSourceReply', () => {
  it('accepts each status in its exact shape', () => {
    const ok = { status: 'ok', text: 'a{}', total: 3, truncated: false };
    expect(parseStyleSourceReply(ok)).toEqual(ok);
    expect(parseStyleSourceReply({ status: 'gone' })).toEqual({ status: 'gone' });
    expect(parseStyleSourceReply({ status: 'error', reason: 'not-inline' })).toEqual({
      status: 'error',
      reason: 'not-inline'
    });
  });

  it.each([
    ['null', null],
    ['an unknown status', { status: 'maybe' }],
    ['gone with extra keys', { status: 'gone', text: '' }],
    ['an unknown reason', { status: 'error', reason: 'unreachable' }],
    ['an error with extra keys', { status: 'error', reason: 'not-inline', x: 1 }],
    [
      'an oversize chunk',
      { status: 'ok', text: 'x'.repeat(STYLE_SOURCE_CHUNK_CHARS + 1), total: 1, truncated: false }
    ],
    [
      'a total past the cap',
      { status: 'ok', text: '', total: STYLE_SOURCE_MAX_CHARS + 1, truncated: true }
    ],
    ['a negative total', { status: 'ok', text: '', total: -1, truncated: false }],
    ['a non-boolean truncated', { status: 'ok', text: '', total: 0, truncated: 'no' }],
    ['a missing text', { status: 'ok', total: 0, truncated: false }],
    ['ok with extra keys', { status: 'ok', text: '', total: 0, truncated: false, more: 1 }]
  ])('refuses %s', (_name, input) => {
    expect(parseStyleSourceReply(input)).toBeNull();
  });
});

describe('loadStyleSource', () => {
  it('reads a small style in one chunk', async () => {
    const page = pageOf('a>b{}');
    await expect(loadStyleSource(REQUEST, page.send, logDouble())).resolves.toEqual({
      status: 'ok',
      text: 'a>b{}',
      truncated: false
    });
    expect(page.offsets).toEqual([0]);
  });

  it('reads an empty style as empty text', async () => {
    const page = pageOf('');
    await expect(loadStyleSource(REQUEST, page.send, logDouble())).resolves.toEqual({
      status: 'ok',
      text: '',
      truncated: false
    });
  });

  it('joins chunks exactly, a surrogate pair split between two included', async () => {
    const text = `${'x'.repeat(STYLE_SOURCE_CHUNK_CHARS - 1)}😀${'y'.repeat(STYLE_SOURCE_CHUNK_CHARS)}`;
    const page = pageOf(text);
    const result = await loadStyleSource(REQUEST, page.send, logDouble());
    expect(result).toEqual({ status: 'ok', text, truncated: false });
    expect(page.offsets).toEqual([0, STYLE_SOURCE_CHUNK_CHARS, 2 * STYLE_SOURCE_CHUNK_CHARS]);
  });

  it('carries the page’s cut flag', async () => {
    const page = pageOf('a{}', true);
    await expect(loadStyleSource(REQUEST, page.send, logDouble())).resolves.toMatchObject({
      truncated: true
    });
  });

  it('passes the page’s gone and refusals through, unlogged', async () => {
    const log = logDouble();
    for (const answer of [{ status: 'gone' }, { status: 'error', reason: 'not-inline' }]) {
      await expect(loadStyleSource(REQUEST, () => Promise.resolve(answer), log)).resolves.toEqual(
        answer
      );
    }
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('turns a gone mid-read (element removed between chunks) into gone', async () => {
    const full = 'a'.repeat(STYLE_SOURCE_CHUNK_CHARS + 1);
    const send = vi.fn((request: StyleSourceRequest) =>
      Promise.resolve(
        request.offset === 0
          ? styleSourceChunk({ text: full, truncated: false }, 0)
          : { status: 'gone' }
      )
    );
    await expect(loadStyleSource(REQUEST, send, logDouble())).resolves.toEqual({ status: 'gone' });
  });

  it('is unreachable (logged) when the send rejects', async () => {
    const log = logDouble();
    await expect(
      loadStyleSource(REQUEST, () => Promise.reject(new Error('no receiver')), log)
    ).resolves.toEqual({ status: 'error', reason: 'unreachable' });
    expect(log.warn).toHaveBeenCalledWith('Reading the style source failed', 'no receiver');
  });

  /**
   * Expect a read to end unreadable, logged.
   *
   * @param send The page double.
   */
  async function expectUnreadable(send: (request: StyleSourceRequest) => Promise<unknown>) {
    const log = logDouble();
    await expect(loadStyleSource(REQUEST, send, log)).resolves.toEqual({
      status: 'error',
      reason: 'unreadable'
    });
    expect(log.warn).toHaveBeenCalledWith(
      'The style source reply broke its contract; it was ignored'
    );
  }

  it('is unreadable (logged) on a broken reply', async () => {
    await expectUnreadable(() => Promise.resolve({ status: 'ok', text: 1 }));
  });

  it('is unreadable on a chunk shorter than the rest it announces', async () => {
    await expectUnreadable(() =>
      Promise.resolve({ status: 'ok', text: 'ab', total: 5, truncated: false })
    );
  });

  it('is unreadable when a continuation announces a total below its offset', async () => {
    const first = styleSourceChunk(
      { text: 'a'.repeat(STYLE_SOURCE_CHUNK_CHARS + 2), truncated: false },
      0
    );
    await expectUnreadable((request) =>
      Promise.resolve(
        request.offset === 0 ? first : { status: 'ok', text: '', total: 1, truncated: false }
      )
    );
  });

  it('is unreadable when the total changes between chunks', async () => {
    const send = vi.fn((request: StyleSourceRequest) =>
      Promise.resolve(
        styleSourceChunk(
          {
            text: 'a'.repeat(STYLE_SOURCE_CHUNK_CHARS + (request.offset === 0 ? 5 : 9)),
            truncated: false
          },
          request.offset
        )
      )
    );
    await expect(loadStyleSource(REQUEST, send, logDouble())).resolves.toEqual({
      status: 'error',
      reason: 'unreadable'
    });
  });

  it('stops between chunks once aborted', async () => {
    const controller = new AbortController();
    const send = vi.fn((request: StyleSourceRequest) => {
      controller.abort();
      return Promise.resolve(
        styleSourceChunk(
          { text: 'a'.repeat(STYLE_SOURCE_CHUNK_CHARS + 1), truncated: false },
          request.offset
        )
      );
    });
    await expect(loadStyleSource(REQUEST, send, logDouble(), controller.signal)).resolves.toEqual({
      status: 'error',
      reason: 'unreachable'
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
