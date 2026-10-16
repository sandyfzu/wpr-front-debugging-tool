/** Exact-source, hostile-boundary and stale-snapshot regressions for clipboard reads. */
import { describe, expect, it, vi } from 'vitest';
import type { DelayedScriptRecord } from '../wp-rocket/types';
/** Construct one classified script fixture. */
function makeDelayScript(patch: Partial<DelayedScriptRecord>): DelayedScriptRecord {
  return {
    inline: false,
    src: 'x',
    delayed: false,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null,
    ...patch
  };
}
import {
  createScriptSnapshotId,
  isScriptSnapshotId,
  loadScriptSource,
  parseScriptSourceRequest,
  readScriptSourceChunk,
  SCRIPT_SOURCE_CHUNK_CHARS
} from './script-source';

const snapshotId = '12345678123412341234123456789abc';
const request = { snapshotId, scriptIndex: 0, offset: 0 };

describe('script source boundary', () => {
  it('creates fixed-width identities without relying on secure-context-only randomUUID', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('unavailable on HTTP');
    });
    try {
      const random = vi
        .spyOn(crypto, 'getRandomValues')
        .mockReturnValue(new Uint32Array([0, 1, 0xabcdef, 0xffffffff]));
      try {
        expect(createScriptSnapshotId()).toBe('000000000000000100abcdefffffffff');
        expect(isScriptSnapshotId(createScriptSnapshotId())).toBe(true);
      } finally {
        random.mockRestore();
      }
      expect(randomUUID).not.toHaveBeenCalled();
    } finally {
      randomUUID.mockRestore();
    }
  });

  it.each([
    null,
    {},
    { ...request, snapshotId: 'wrong' },
    { ...request, scriptIndex: -1 },
    { ...request, scriptIndex: 5000 },
    { ...request, scriptIndex: 0.5 },
    { ...request, offset: -1 },
    { ...request, offset: Infinity },
    { ...request, offset: '0' }
  ])('rejects invalid request %j', (input) => {
    expect(parseScriptSourceRequest(input)).toBeNull();
  });

  it('rejects stale captures, missing rows and offsets outside the source', () => {
    const scripts = [makeDelayScript({ src: 'exact' })];
    expect(readScriptSourceChunk(scripts, 'different', request)).toEqual({ status: 'unavailable' });
    expect(readScriptSourceChunk([], snapshotId, request)).toEqual({ status: 'unavailable' });
    expect(readScriptSourceChunk(scripts, snapshotId, { ...request, offset: 6 })).toEqual({
      status: 'unavailable'
    });
  });

  it.each(['inline', 'external'] as const)(
    'reconstructs complete %s text beyond inventory caps, preserving Unicode and real ellipses',
    async (kind) => {
      const source =
        'a'.repeat(SCRIPT_SOURCE_CHUNK_CHARS - 1) +
        '🛰️\r\n' +
        'b'.repeat(600_000) +
        '?q=é&x=%20#final...';
      const script = makeDelayScript(
        kind === 'inline' ? { inline: true, content: source, src: undefined } : { src: source }
      );
      const send = vi.fn((input) =>
        Promise.resolve(readScriptSourceChunk([script], snapshotId, input))
      );
      expect(await loadScriptSource({ snapshotId, scriptIndex: 0 }, send)).toBe(source);
      expect(send).toHaveBeenCalledTimes(Math.ceil(source.length / SCRIPT_SOURCE_CHUNK_CHARS));
      for (const call of send.mock.calls) {
        const reply = readScriptSourceChunk([script], snapshotId, call[0]);
        expect(reply.status).toBe('ok');
        if (reply.status === 'ok')
          expect(reply.text.length).toBeLessThanOrEqual(SCRIPT_SOURCE_CHUNK_CHARS);
      }
    }
  );

  it('allows empty sources and a final empty read at the exact length', async () => {
    expect(
      await loadScriptSource({ snapshotId, scriptIndex: 0 }, () =>
        Promise.resolve({ status: 'ok', text: '', total: 0 })
      )
    ).toBe('');
    expect(
      readScriptSourceChunk([makeDelayScript({ src: 'x' })], snapshotId, { ...request, offset: 1 })
    ).toEqual({ status: 'ok', text: '', total: 1 });
  });

  it.each([
    null,
    {},
    { status: 'unavailable' },
    { status: 'ok', text: '', total: 4 },
    { status: 'ok', text: 'abc', total: 2 },
    { status: 'ok', text: 7, total: 1 },
    { status: 'ok', text: '', total: -1 },
    { status: 'ok', text: '', total: NaN }
  ])('rejects malformed/incomplete reply %j', async (reply) => {
    await expect(
      loadScriptSource({ snapshotId, scriptIndex: 0 }, () => Promise.resolve(reply))
    ).rejects.toThrow('Refresh the panel');
  });

  it('rejects a changing total and unavailable later chunks instead of copying a prefix', async () => {
    for (const next of [
      { status: 'ok', text: 'x', total: SCRIPT_SOURCE_CHUNK_CHARS + 2 },
      { status: 'unavailable' }
    ]) {
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          status: 'ok',
          text: 'x'.repeat(SCRIPT_SOURCE_CHUNK_CHARS),
          total: SCRIPT_SOURCE_CHUNK_CHARS + 1
        })
        .mockResolvedValueOnce(next);
      await expect(loadScriptSource({ snapshotId, scriptIndex: 0 }, send)).rejects.toThrow(
        'Refresh the panel'
      );
    }
  });

  it('propagates transport failure and stops after cancellation', async () => {
    await expect(
      loadScriptSource({ snapshotId, scriptIndex: 0 }, () => Promise.reject(new Error('offline')))
    ).rejects.toThrow('offline');
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn();
    await expect(
      loadScriptSource({ snapshotId, scriptIndex: 0 }, send, controller.signal)
    ).rejects.toThrow('cancelled');
    expect(send).not.toHaveBeenCalled();
  });
});
