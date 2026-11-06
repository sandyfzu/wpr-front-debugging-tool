import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TabAsks } from '../../../../lib/messaging/tab-asks';
import { relayTabAsks } from '../../../../lib/messaging/tab-relay-client';
import { SOURCE_CHUNK_TIMEOUT_MS, createSourceChunkReader } from './source-chunk-reader';

const REQUEST = { snapshotId: '0123456789abcdef0123456789abcdef', scriptIndex: 1, offset: 0 };

/** Asks double whose chunk read answers `answer`. */
function asksAnswering(answer: Promise<unknown>): TabAsks {
  return {
    processPageData: vi.fn(() => Promise.resolve(true)),
    getFdtData: vi.fn(() => Promise.resolve(null)),
    getScriptSourceChunk: vi.fn(() => answer),
    startRucssTest: vi.fn(() => Promise.resolve(null)),
    applyRucssTest: vi.fn(() => Promise.resolve(null)),
    runBeaconTest: vi.fn(() => Promise.resolve(null)),
    runLcpAnalysis: vi.fn(() => Promise.resolve(null)),
    getScriptRuntimeStatuses: vi.fn(() => Promise.resolve(null)),
    getCurrentVisitVitals: vi.fn(() => Promise.resolve(null))
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createSourceChunkReader', () => {
  it('reads from the inspected tab over the given asks', async () => {
    const asks = asksAnswering(Promise.resolve({ status: 'unavailable' }));
    const read = createSourceChunkReader({ asks: () => asks, inspectedTabId: () => 6 });
    await expect(read(REQUEST)).resolves.toEqual({ status: 'unavailable' });
    expect(asks.getScriptSourceChunk).toHaveBeenCalledWith(6, REQUEST);
  });

  it('reads over the relay too, sending the chunk request as its payload', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true, answer: { status: 'unavailable' } }));
    const read = createSourceChunkReader({
      asks: () => relayTabAsks(send),
      inspectedTabId: () => 6
    });
    await expect(read(REQUEST)).resolves.toEqual({ status: 'unavailable' });
    expect(send).toHaveBeenCalledWith({ tabId: 6, ask: 'getScriptSourceChunk', payload: REQUEST });
  });

  it('fails without a transport or an inspected tab, asking nothing', async () => {
    const asks = asksAnswering(Promise.resolve(null));
    await expect(
      createSourceChunkReader({ asks: () => null, inspectedTabId: () => 6 })(REQUEST)
    ).rejects.toThrow('cannot reach the page');
    await expect(
      createSourceChunkReader({ asks: () => asks, inspectedTabId: () => null })(REQUEST)
    ).rejects.toThrow('No inspected tab for script copy.');
    expect(asks.getScriptSourceChunk).not.toHaveBeenCalled();
  });

  it('times a read out at the bound (default 5 s) and passes failures through', async () => {
    vi.useFakeTimers();
    expect(SOURCE_CHUNK_TIMEOUT_MS).toBe(5000);
    const never = createSourceChunkReader({
      asks: () => asksAnswering(new Promise(() => undefined)),
      inspectedTabId: () => 6
    })(REQUEST);
    let done = false;
    const settled = never.catch((error: unknown) => {
      done = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(SOURCE_CHUNK_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toEqual(new Error('Script source read timed out.'));
    const miss = new Error('No response');
    await expect(
      createSourceChunkReader({
        asks: () => asksAnswering(Promise.reject(miss)),
        inspectedTabId: () => 6
      })(REQUEST)
    ).rejects.toBe(miss);
    expect(vi.getTimerCount()).toBe(0);
  });
});
