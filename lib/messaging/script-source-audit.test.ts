/** Independent adversarial checks for exact source chunking and cancellation. */
import { describe, expect, it, vi } from 'vitest';
import type { DelayedScriptRecord } from '../wp-rocket/types';
import {
  loadScriptSource,
  parseScriptSourceRequest,
  readScriptSourceChunk,
  SCRIPT_SOURCE_CHUNK_CHARS
} from './script-source';

/** One immutable inventory identity used only by these independent tests. */
const snapshotId = '0123456789abcdef0123456789abcdef';

/**
 * Build an inline source record without transforming its source.
 * @param content The exact text to retain.
 * @returns A classified inline script fixture.
 */
function inline(content: string): DelayedScriptRecord {
  return {
    inline: true,
    content,
    delayed: false,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null
  };
}

describe('independent complete source adversarial audit', () => {
  it('round-trips control characters and surrogate halves through JSON transport at every boundary', async () => {
    for (const length of [
      0,
      1,
      SCRIPT_SOURCE_CHUNK_CHARS - 1,
      SCRIPT_SOURCE_CHUNK_CHARS,
      SCRIPT_SOURCE_CHUNK_CHARS + 1
    ]) {
      const source = 'a'.repeat(length) + '\ud83d\ude80\ud800\udfff\0\r\n\t... ';
      const scripts = [inline(source)];
      const result = await loadScriptSource({ snapshotId, scriptIndex: 0 }, (request) =>
        Promise.resolve(
          JSON.parse(JSON.stringify(readScriptSourceChunk(scripts, snapshotId, request))) as unknown
        )
      );
      expect(result).toBe(source);
      expect(scripts[0]?.content).toBe(source);
    }
  });

  it.each([-Infinity, NaN, 0.1, Number.MAX_SAFE_INTEGER + 1, '0', null])(
    'rejects hostile offset %j',
    (offset) => {
      expect(parseScriptSourceRequest({ snapshotId, scriptIndex: 0, offset })).toBeNull();
    }
  );

  it('accepts the last exposed inventory row but never reads a row outside the inventory cap', () => {
    const scripts = Array.from({ length: 5001 }, (_, index) => inline(String(index)));
    expect(
      readScriptSourceChunk(scripts, snapshotId, { snapshotId, scriptIndex: 4999, offset: 0 })
    ).toEqual({ status: 'ok', text: '4999', total: 4 });
    expect(
      readScriptSourceChunk(scripts, snapshotId, { snapshotId, scriptIndex: 5000, offset: 0 })
    ).toEqual({ status: 'unavailable' });
  });

  it.each([
    {
      status: 'ok',
      text: 'x'.repeat(SCRIPT_SOURCE_CHUNK_CHARS + 1),
      total: SCRIPT_SOURCE_CHUNK_CHARS + 1
    },
    { status: 'ok', text: 'x', total: Infinity },
    { status: 'ok', text: 'x', total: 1.5 },
    { status: 'ok', text: 'x', total: Number.MAX_SAFE_INTEGER + 1 },
    { status: 'ok', text: 'x', total: -1 },
    { status: 'ok', text: '', total: 1 }
  ])('rejects a hostile first segment without accepting a copied prefix', async (reply) => {
    const send = vi.fn(() => Promise.resolve(reply));
    await expect(loadScriptSource({ snapshotId, scriptIndex: 0 }, send)).rejects.toThrow(
      'Refresh the panel'
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stops before requesting another segment after disposal during the first reply', async () => {
    const controller = new AbortController();
    const send = vi.fn(() => {
      controller.abort();
      return Promise.resolve({
        status: 'ok',
        text: 'x'.repeat(SCRIPT_SOURCE_CHUNK_CHARS),
        total: SCRIPT_SOURCE_CHUNK_CHARS + 1
      });
    });
    await expect(
      loadScriptSource({ snapshotId, scriptIndex: 0 }, send, controller.signal)
    ).rejects.toThrow('cancelled');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
