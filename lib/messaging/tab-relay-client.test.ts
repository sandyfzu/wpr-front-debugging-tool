import { describe, expect, it, vi } from 'vitest';
import { isNoReceiverError } from './no-receiver';
import { TAB_RELAY_FAILURES, type TabRelayRequest } from './tab-relay';
import {
  isRelayUnavailableError,
  relayFailureError,
  relayTabAsks,
  RelayUnavailableError,
  type RelaySend
} from './tab-relay-client';

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

  it('relays the RUCSS steps with their payloads', async () => {
    const send = sendAnswering({ ok: true, answer: 'x' });
    const asks = relayTabAsks(send);
    const start = { safelist: [], inlinePreserves: ['m'], mobile: false, home: true };
    const apply = { runId: CHUNK.snapshotId, css: '', keepLinks: [] };
    await asks.startRucssTest(2, start);
    await asks.applyRucssTest(2, apply);
    expect(send.requests).toEqual([
      { tabId: 2, ask: 'startRucssTest', payload: start },
      { tabId: 2, ask: 'applyRucssTest', payload: apply }
    ]);
  });

  it('relays the live analysis asks', async () => {
    const send = sendAnswering({ ok: true, answer: 'x' });
    const asks = relayTabAsks(send);
    const config = {
      features: { aboveTheFold: true, lazyRender: false },
      mobile: true,
      widthThreshold: 393,
      heightThreshold: 830,
      lazyRenderThreshold: 1800,
      selectors: ['img']
    };
    await asks.runBeaconTest(2, { config });
    await asks.runLcpAnalysis(2, { highlight: false });
    await asks.getScriptRuntimeStatuses(2);
    await asks.getCurrentVisitVitals(2);
    expect(send.requests).toEqual([
      { tabId: 2, ask: 'runBeaconTest', payload: { config } },
      { tabId: 2, ask: 'runLcpAnalysis', payload: { highlight: false } },
      { tabId: 2, ask: 'getScriptRuntimeStatuses' },
      { tabId: 2, ask: 'getCurrentVisitVitals' }
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

  it('maps a refusal onto the relay’s own unavailable error (never a page miss)', async () => {
    for (const failure of ['refused', 'invalid-request'] as const) {
      const cause = await relayTabAsks(sendAnswering({ ok: false, failure }))
        .getFdtData(1)
        .catch((error: unknown) => error);
      expect(isRelayUnavailableError(cause), failure).toBe(true);
      expect(cause instanceof RelayUnavailableError ? cause.reason : null).toBe(failure);
      expect(isNoReceiverError(cause), failure).toBe(false);
    }
  });

  it('maps a failed forward onto a real (loud, retryable) failure', async () => {
    const cause = await relayTabAsks(sendAnswering({ ok: false, failure: 'failed' }))
      .getFdtData(1)
      .catch((error: unknown) => error);
    expect(cause).toBeInstanceOf(Error);
    expect(isRelayUnavailableError(cause)).toBe(false);
    expect(isNoReceiverError(cause)).toBe(false);
  });

  it('treats an unreadable reply as the relay being unavailable', async () => {
    for (const reply of [undefined, null, { ok: false, failure: 'mystery' }, 'ok']) {
      const cause = await relayTabAsks(sendAnswering(reply))
        .getFdtData(1)
        .catch((error: unknown) => error);
      expect(cause instanceof RelayUnavailableError ? cause.reason : null).toBe('unreadable-reply');
      expect(isNoReceiverError(cause)).toBe(false);
    }
  });

  it('treats a rejected round trip (no background listener) as the relay being unreachable', async () => {
    const miss = new Error('Could not establish connection. Receiving end does not exist.');
    const send: RelaySend = () => Promise.reject(miss);
    for (const ask of [
      relayTabAsks(send).getFdtData(1),
      relayTabAsks(send).processPageData(1),
      relayTabAsks(send).getScriptSourceChunk(1, CHUNK)
    ]) {
      const cause = await ask.catch((error: unknown) => error);
      expect(cause instanceof RelayUnavailableError ? cause.reason : null).toBe('unreachable');
      expect(cause instanceof Error ? cause.cause : null).toBe(miss);
      // The transport's wording rides as `cause` only: no page-miss misfiling.
      expect(isNoReceiverError(cause)).toBe(false);
    }
  });
});

describe('relayFailureError', () => {
  it('classifies exactly the "nothing answered in the tab" failure as a miss', () => {
    const misses = TAB_RELAY_FAILURES.filter((failure) =>
      isNoReceiverError(relayFailureError(failure, 'getFdtData'))
    );
    expect(misses).toEqual(['no-receiver']);
  });

  it('maps exactly the refusals onto the relay’s own error', () => {
    expect(
      TAB_RELAY_FAILURES.filter((failure) =>
        isRelayUnavailableError(relayFailureError(failure, 'getFdtData'))
      )
    ).toEqual(['refused', 'invalid-request']);
    expect(isRelayUnavailableError(new Error('x'))).toBe(false);
    expect(isRelayUnavailableError('refused')).toBe(false);
  });

  it('names the ask and the failure', () => {
    for (const failure of TAB_RELAY_FAILURES) {
      expect(relayFailureError(failure, 'getFdtData').message, failure).toContain('getFdtData');
      expect(relayFailureError(failure, 'getFdtData').message, failure).toContain(failure);
    }
  });
});
