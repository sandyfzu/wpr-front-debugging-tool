import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import { isNoReceiverError } from '../../lib/messaging/no-receiver';
import type { TabAsks } from '../../lib/messaging/tab-asks';
import { relayTabAsks } from '../../lib/messaging/tab-relay-client';

const { onMessage } = vi.hoisted(() => ({ onMessage: vi.fn() }));
vi.mock('../../lib/messaging', () => ({ onMessage }));

const { answerTabRelay, registerTabRelay } = await import('./tab-relay');
type Deps = Parameters<typeof answerTabRelay>[2];

const ID = 'own-extension-id';
const ROOT = 'moz-extension://5f1d2c3b-aaaa-bbbb-cccc-123456789abc/';
const PANEL = { id: ID, url: `${ROOT}panel.html` };
const CHUNK = { snapshotId: '0123456789abcdef0123456789abcdef', scriptIndex: 0, offset: 65536 };

/** A logger double (no console noise; calls assertable). */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

/**
 * Deps over a direct-transport double whose asks answer `answer`; `asks`
 * overrides single asks, the rest of `overrides` whole deps.
 */
function deps(
  overrides: Partial<Omit<Deps, 'asks' | 'log'>> = {},
  answer: unknown = { data: 1 },
  asks: Partial<TabAsks> = {}
) {
  const log = logDouble();
  const tabAsks = {
    processPageData: vi.fn(() => Promise.resolve(answer)),
    getFdtData: vi.fn(() => Promise.resolve(answer)),
    getScriptSourceChunk: vi.fn(() => Promise.resolve(answer)),
    startRucssTest: vi.fn(() => Promise.resolve(answer)),
    applyRucssTest: vi.fn(() => Promise.resolve(answer)),
    runBeaconTest: vi.fn(() => Promise.resolve(answer)),
    runLcpAnalysis: vi.fn(() => Promise.resolve(answer)),
    getScriptRuntimeStatuses: vi.fn(() => Promise.resolve(answer)),
    getCurrentVisitVitals: vi.fn(() => Promise.resolve(answer)),
    listPageStyles: vi.fn(() => Promise.resolve(answer)),
    ...asks
  };
  return {
    extensionId: ID,
    extensionRootUrl: ROOT,
    asks: tabAsks,
    log,
    ...overrides
  };
}

describe('answerTabRelay — the typed answers', () => {
  it('forwards an allowed ask to the named tab and returns the answer', async () => {
    const d = deps({}, { status: 'ok', text: 'x'.repeat(65536), total: 140_000 });
    const reply = await answerTabRelay(
      PANEL,
      { tabId: 5, ask: 'getScriptSourceChunk', payload: CHUNK },
      d
    );
    expect(reply).toEqual({
      ok: true,
      answer: { status: 'ok', text: 'x'.repeat(65536), total: 140_000 }
    });
    expect(d.asks.getScriptSourceChunk).toHaveBeenCalledWith(5, CHUNK);
  });

  it('refuses a foreign sender before reading the request or touching a tab', async () => {
    const d = deps();
    const reply = await answerTabRelay(
      { tab: { id: 2 }, id: ID, url: 'https://site.test/' },
      { tabId: 5, ask: 'getFdtData' },
      d
    );
    expect(reply).toEqual({ ok: false, failure: 'refused' });
    expect(d.asks.getFdtData).not.toHaveBeenCalled();
    expect(d.log.warn).toHaveBeenCalledOnce();
  });

  it('answers invalid-request for a malformed request, never forwarding', async () => {
    const d = deps();
    for (const data of [
      { tabId: 5, ask: 'getWprDetections' },
      { tabId: -5, ask: 'getFdtData' },
      { tabId: 5, ask: 'getFdtData', payload: 1 },
      null
    ]) {
      expect(await answerTabRelay(PANEL, data, d)).toEqual({
        ok: false,
        failure: 'invalid-request'
      });
    }
    expect(d.asks.getFdtData).not.toHaveBeenCalled();
    expect(d.asks.processPageData).not.toHaveBeenCalled();
  });

  it('answers a closed tab as no-receiver — the miss the asking page needs, no probe first', async () => {
    // Firefox 158, observed: a tab send to a closed tab calls back empty with
    // "Could not establish connection…", which the transport folds into "No response".
    const d = deps({}, undefined, {
      getFdtData: vi.fn(() => Promise.reject(new Error('No response')))
    });
    const reply = await answerTabRelay(PANEL, { tabId: 99_999, ask: 'getFdtData' }, d);
    expect(reply).toEqual({ ok: false, failure: 'no-receiver' });
    expect(d.asks.getFdtData).toHaveBeenCalledWith(99_999);
    const cause = await relayTabAsks(() => Promise.resolve(reply))
      .getFdtData(99_999)
      .catch((error: unknown) => error);
    expect(isNoReceiverError(cause)).toBe(true);
    expect(d.log.warn).not.toHaveBeenCalled();
  });

  it('answers no-receiver for the transport’s expected misses', async () => {
    for (const message of [
      'No response',
      'Could not establish connection. Receiving end does not exist.'
    ]) {
      const d = deps({}, undefined, {
        getFdtData: vi.fn(() => Promise.reject(new Error(message)))
      });
      expect(await answerTabRelay(PANEL, { tabId: 5, ask: 'getFdtData' }, d)).toEqual({
        ok: false,
        failure: 'no-receiver'
      });
      expect(d.log.warn).not.toHaveBeenCalled();
    }
  });

  it('answers failed (and warns) for any other forward failure', async () => {
    const d = deps({}, undefined, {
      processPageData: vi.fn(() => Promise.reject(new Error('boom')))
    });
    expect(await answerTabRelay(PANEL, { tabId: 5, ask: 'processPageData' }, d)).toEqual({
      ok: false,
      failure: 'failed'
    });
    expect(d.log.warn).toHaveBeenCalledOnce();
  });
});

describe('registerTabRelay', () => {
  it('registers the relayTabAsk channel, answering a typed reply (a page sender is refused)', async () => {
    onMessage.mockClear();
    registerTabRelay();
    expect(onMessage).toHaveBeenCalledOnce();
    const [channel, handler] = onMessage.mock.calls[0] as [
      string,
      (message: { sender: unknown; data: unknown }) => Promise<unknown>
    ];
    expect(channel).toBe('relayTabAsk');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      handler({ sender: { tab: { id: 1 } }, data: { tabId: 1, ask: 'getFdtData' } })
    ).resolves.toEqual({ ok: false, failure: 'refused' });
  });
});
