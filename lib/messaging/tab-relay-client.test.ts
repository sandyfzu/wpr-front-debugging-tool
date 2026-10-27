import { describe, expect, it, vi } from 'vitest';
import { isNoReceiverError } from './no-receiver';
import { TAB_RELAY_FAILURES, type TabRelayRequest } from './tab-relay';
import { relayFailureError, relayTabAsks, type RelaySend } from './tab-relay-client';

const CHUNK = { snapshotId: '0123456789abcdef0123456789abcdef', scriptIndex: 0, offset: 0 };

/** A relay round trip answering `reply`, recording each request. */
function sendAnswering(reply: unknown): RelaySend & { requests: TabRelayRequest[] } {
  const requests: TabRelayRequest[] = [];
  const send = vi.fn((request: TabRelayRequest) => {
    requests.push(request);
    return Promise.resolve(reply);
  });
  return Object.assign(send, { requests });
}

describe('relayTabAsks — requests', () => {
  it('sends one wire request per ask, shaped by the contract', async () => {
    const send = sendAnswering({ ok: true, answer: 'x' });
    const asks = relayTabAsks(send);
    await asks.processPageData(3);
    await asks.getFdtData(3);
    await asks.getScriptSourceChunk(3, CHUNK);
    expect(send.requests).toEqual([
      { tabId: 3, ask: 'processPageData' },
      { tabId: 3, ask: 'getFdtData' },
      { tabId: 3, ask: 'getScriptSourceChunk', payload: CHUNK }
    ]);
  });

  it('fails a missing inspected tab locally as a no-receiver miss (nothing sent)', async () => {
    const send = sendAnswering({ ok: true, answer: 'x' });
    const asks = relayTabAsks(send);
    for (const ask of [asks.getFdtData(undefined), asks.processPageData(undefined)]) {
      const cause = await ask.catch((error: unknown) => error);
      expect(isNoReceiverError(cause)).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });
});

describe('relayTabAsks — replies', () => {
  it('resolves with the content script’s answer, untouched', async () => {
    const answer = { status: 'ok', text: 'a'.repeat(65536), total: 200_000 };
    await expect(
      relayTabAsks(sendAnswering({ ok: true, answer })).getScriptSourceChunk(1, CHUNK)
    ).resolves.toEqual(answer);
    await expect(
      relayTabAsks(sendAnswering({ ok: true, answer: null })).getFdtData(1)
    ).resolves.toBeNull();
  });

  it('maps no-receiver (a closed tab included) onto the direct path’s no-receiver miss', async () => {
    for (const failure of ['no-receiver'] as const) {
      const cause = await relayTabAsks(sendAnswering({ ok: false, failure }))
        .getFdtData(1)
        .catch((error: unknown) => error);
      expect(isNoReceiverError(cause), failure).toBe(true);
    }
  });

  it('maps every other failure onto a real (loud) failure', async () => {
    for (const failure of ['refused', 'invalid-request', 'failed'] as const) {
      const cause = await relayTabAsks(sendAnswering({ ok: false, failure }))
        .getFdtData(1)
        .catch((error: unknown) => error);
      expect(cause).toBeInstanceOf(Error);
      expect(isNoReceiverError(cause), failure).toBe(false);
    }
  });

  it('treats an unreadable reply as a real failure', async () => {
    for (const reply of [undefined, null, { ok: false, failure: 'mystery' }, 'ok']) {
      const cause = await relayTabAsks(sendAnswering(reply))
        .getFdtData(1)
        .catch((error: unknown) => error);
      expect(cause).toBeInstanceOf(Error);
      expect(isNoReceiverError(cause)).toBe(false);
    }
  });

  it('passes a rejected round trip through (no background listener → no-receiver)', async () => {
    const miss = new Error('Could not establish connection. Receiving end does not exist.');
    const send: RelaySend = () => Promise.reject(miss);
    await expect(relayTabAsks(send).getFdtData(1)).rejects.toBe(miss);
  });
});

describe('relayFailureError', () => {
  it('classifies exactly the "nothing answered in the tab" failure as a miss', () => {
    const misses = TAB_RELAY_FAILURES.filter((failure) =>
      isNoReceiverError(relayFailureError(failure, 'getFdtData'))
    );
    expect(misses).toEqual(['no-receiver']);
  });

  it('names the ask and the failure', () => {
    expect(relayFailureError('refused', 'getFdtData').message).toContain('getFdtData');
    expect(relayFailureError('refused', 'getFdtData').message).toContain('refused');
  });
});
