import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TabAsks } from '../../../../lib/messaging/tab-asks';
import { relayTabAsks } from '../../../../lib/messaging/tab-relay-client';
import { SOURCE_CHUNK_TIMEOUT_MS } from '../resource-list/top-frame-reader';
import { createServedTagReader, createSourceChunkReader } from './source-chunk-reader';

const REQUEST = { snapshotId: '0123456789abcdef0123456789abcdef', scriptIndex: 1, offset: 0 };

/** Asks double whose chunk read answers `answer`. */
function asksAnswering(answer: Promise<unknown>): TabAsks {
  return {
    processPageData: vi.fn(() => Promise.resolve(true)),
    getFdtData: vi.fn(() => Promise.resolve(null)),
    getScriptSourceChunk: vi.fn(() => answer),
    getServedScriptTag: vi.fn(() => answer),
    startRucssTest: vi.fn(() => Promise.resolve(null)),
    applyRucssTest: vi.fn(() => Promise.resolve(null)),
    runBeaconTest: vi.fn(() => Promise.resolve(null)),
    runLcpAnalysis: vi.fn(() => Promise.resolve(null)),
    getScriptRuntimeStatuses: vi.fn(() => Promise.resolve(null)),
    getCurrentVisitVitals: vi.fn(() => Promise.resolve(null)),
    listPageStyles: vi.fn(() => Promise.resolve(null)),
    listPageStylesheets: vi.fn(() => Promise.resolve(null)),
    getStyleSourceChunk: vi.fn(() => Promise.resolve(null))
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

describe('createServedTagReader', () => {
  const TAG = { snapshotId: REQUEST.snapshotId, scriptIndex: 2 };

  it('asks the served tag from the inspected tab, directly and over the relay', async () => {
    const asks = asksAnswering(Promise.resolve({ status: 'gone' }));
    const read = createServedTagReader({ asks: () => asks, inspectedTabId: () => 6 });
    await expect(read(TAG)).resolves.toEqual({ status: 'gone' });
    expect(asks.getServedScriptTag).toHaveBeenCalledWith(6, TAG);
    expect(asks.getScriptSourceChunk).not.toHaveBeenCalled();
    const send = vi.fn(() => Promise.resolve({ ok: true, answer: { status: 'gone' } }));
    await createServedTagReader({ asks: () => relayTabAsks(send), inspectedTabId: () => 6 })(TAG);
    expect(send).toHaveBeenCalledWith({ tabId: 6, ask: 'getServedScriptTag', payload: TAG });
  });

  it('names its own action when it cannot read or times out', async () => {
    vi.useFakeTimers();
    await expect(
      createServedTagReader({ asks: () => null, inspectedTabId: () => 6 })(TAG)
    ).rejects.toThrow('This panel cannot reach the page for the served tag.');
    await expect(
      createServedTagReader({
        asks: () => asksAnswering(Promise.resolve(null)),
        inspectedTabId: () => null
      })(TAG)
    ).rejects.toThrow('No inspected tab for the served tag.');
    const never = createServedTagReader({
      asks: () => asksAnswering(new Promise(() => undefined)),
      inspectedTabId: () => 6,
      timeoutMs: 10
    })(TAG).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await never).toEqual(new Error('Served tag read timed out.'));
  });
});
