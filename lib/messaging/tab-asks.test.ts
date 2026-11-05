import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({
  // Typed variadic so `mock.calls` records the full argument lists.
  sendMessage: vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve('answer'))
}));
vi.mock('./index', () => ({ sendMessage }));

const { DIRECT_TAB_ASKS, selectTabAsks } = await import('./tab-asks');
type TabAsks = typeof DIRECT_TAB_ASKS;

const CHUNK = { snapshotId: '0123456789abcdef0123456789abcdef', scriptIndex: 1, offset: 0 };
const TABS_API = {
  tabs: { sendMessage: () => undefined },
  runtime: { sendMessage: () => undefined }
};
const DEVTOOLS_PAGE_API = { runtime: { sendMessage: () => undefined }, devtools: {} };

beforeEach(() => {
  sendMessage.mockClear();
});

describe('the direct transport (the Chromium path)', () => {
  it('sends exactly the established tab messages', async () => {
    await DIRECT_TAB_ASKS.processPageData(12);
    await DIRECT_TAB_ASKS.getFdtData(12);
    await DIRECT_TAB_ASKS.getScriptSourceChunk(12, CHUNK);
    expect(sendMessage.mock.calls).toEqual([
      ['processPageData', undefined, 12],
      ['getFdtData', undefined, 12],
      // Top frame only: the capture lives in the main frame's hub.
      ['getScriptSourceChunk', CHUNK, { tabId: 12, frameId: 0 }]
    ]);
  });

  it('sends the RUCSS steps to the top frame only', async () => {
    const start = { safelist: [], inlinePreserves: [], mobile: false, home: false };
    const apply = { runId: CHUNK.snapshotId, css: 'a{}', keepLinks: [0] };
    await DIRECT_TAB_ASKS.startRucssTest(12, start);
    await DIRECT_TAB_ASKS.applyRucssTest(12, apply);
    expect(sendMessage.mock.calls).toEqual([
      ['startRucssTest', start, { tabId: 12, frameId: 0 }],
      ['applyRucssTest', apply, { tabId: 12, frameId: 0 }]
    ]);
  });

  it('forwards an absent tab as-is (the send fails as the no-receiver case)', async () => {
    await DIRECT_TAB_ASKS.getFdtData(undefined);
    expect(sendMessage.mock.calls).toEqual([['getFdtData', undefined, undefined]]);
  });

  it('resolves and rejects with the transport, untouched', async () => {
    await expect(DIRECT_TAB_ASKS.getFdtData(1)).resolves.toBe('answer');
    const miss = new Error('No response');
    sendMessage.mockRejectedValueOnce(miss);
    await expect(DIRECT_TAB_ASKS.getFdtData(1)).rejects.toBe(miss);
  });
});

describe('selectTabAsks — the one transport choice', () => {
  /** Doubles whose identity the choice returns. */
  function transports(): { direct: TabAsks; relayed: TabAsks; relay: () => TabAsks } {
    const relayed = { ...DIRECT_TAB_ASKS };
    return { direct: { ...DIRECT_TAB_ASKS }, relayed, relay: vi.fn(() => relayed) };
  }

  it('picks direct whenever the tabs API exists — the relay is never built', () => {
    const t = transports();
    expect(selectTabAsks(TABS_API, t)).toBe(t.direct);
    expect(t.relay).not.toHaveBeenCalled();
  });

  it('picks the relay when only the runtime send exists (a Firefox DevTools page)', () => {
    const t = transports();
    expect(selectTabAsks(DEVTOOLS_PAGE_API, t)).toBe(t.relayed);
  });

  it('picks nothing when neither exists', () => {
    const t = transports();
    expect(selectTabAsks({ devtools: {} }, t)).toBeNull();
    expect(selectTabAsks(undefined, t)).toBeNull();
    expect(t.relay).not.toHaveBeenCalled();
  });

  it('defaults to the production direct transport', () => {
    expect(selectTabAsks(TABS_API)).toBe(DIRECT_TAB_ASKS);
  });

  it('defaults to a relay that sends relayTabAsk over the runtime and unwraps its reply', async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, answer: { from: 'tab' } });
    const asks = selectTabAsks(DEVTOOLS_PAGE_API);
    expect(asks).not.toBe(DIRECT_TAB_ASKS);
    await expect(asks?.getFdtData(8)).resolves.toEqual({ from: 'tab' });
    expect(sendMessage.mock.calls).toEqual([['relayTabAsk', { tabId: 8, ask: 'getFdtData' }]]);
  });
});
