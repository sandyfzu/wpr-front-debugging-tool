import { describe, expect, it, vi } from 'vitest';
import type { TabAsks } from './tab-asks';
import {
  TAB_RELAY_ASKS,
  TAB_RELAY_FAILURES,
  isTabRelayAsk,
  parseTabRelayReply,
  parseTabRelayRequest
} from './tab-relay';

const SNAPSHOT = '0123456789abcdef0123456789abcdef';
const CHUNK = { snapshotId: SNAPSHOT, scriptIndex: 2, offset: 65536 };

/** A direct-transport double recording every forwarded call. */
function asksDouble(): TabAsks & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    processPageData: vi.fn((tabId: number | undefined) => {
      calls.push(['processPageData', tabId]);
      return Promise.resolve(true);
    }),
    getFdtData: vi.fn((tabId: number | undefined) => {
      calls.push(['getFdtData', tabId]);
      return Promise.resolve({ data: 1 });
    }),
    getScriptSourceChunk: vi.fn((tabId: number, request: unknown) => {
      calls.push(['getScriptSourceChunk', tabId, request]);
      return Promise.resolve({ status: 'unavailable' });
    }),
    startRucssTest: vi.fn((tabId: number, request: unknown) => {
      calls.push(['startRucssTest', tabId, request]);
      return Promise.resolve({ ok: false, failure: { kind: 'refused' } });
    }),
    applyRucssTest: vi.fn((tabId: number, request: unknown) => {
      calls.push(['applyRucssTest', tabId, request]);
      return Promise.resolve({ ok: false, failure: 'stale-run' });
    })
  };
}

describe('the relayable asks registry', () => {
  it('is the closed list of the five panel→tab asks', () => {
    expect(Object.keys(TAB_RELAY_ASKS).sort()).toEqual([
      'applyRucssTest',
      'getFdtData',
      'getScriptSourceChunk',
      'processPageData',
      'startRucssTest'
    ]);
  });

  it('names only its own rows — never another channel, the relay itself or a prototype key', () => {
    expect(isTabRelayAsk('getFdtData')).toBe(true);
    for (const name of [
      'getWprDetections',
      'openSideBySide',
      'relayTabAsk',
      'toString',
      '__proto__',
      'constructor',
      '',
      7,
      null,
      undefined
    ]) {
      expect(isTabRelayAsk(name), String(name)).toBe(false);
    }
  });
});

describe('parseTabRelayRequest', () => {
  it('binds each ask to its own direct send with the validated tab and payload', async () => {
    const asks = asksDouble();
    for (const input of [
      { tabId: 4, ask: 'processPageData' },
      { tabId: 4, ask: 'getFdtData' },
      { tabId: 4, ask: 'getScriptSourceChunk', payload: CHUNK }
    ]) {
      const request = parseTabRelayRequest(input);
      expect(request?.ask).toBe(input.ask);
      expect(request?.tabId).toBe(4);
      await request?.forward(asks);
    }
    expect(asks.calls).toEqual([
      ['processPageData', 4],
      ['getFdtData', 4],
      ['getScriptSourceChunk', 4, CHUNK]
    ]);
  });

  it('passes the forward’s answer and rejection through untouched', async () => {
    const answer = { big: 'x'.repeat(70_000) };
    const ok = parseTabRelayRequest({ tabId: 1, ask: 'getFdtData' });
    await expect(
      ok?.forward({ ...asksDouble(), getFdtData: () => Promise.resolve(answer) })
    ).resolves.toBe(answer);
    const failure = new Error('No response');
    await expect(
      ok?.forward({ ...asksDouble(), getFdtData: () => Promise.reject(failure) })
    ).rejects.toBe(failure);
  });

  it('rebuilds the chunk payload from its known fields only', async () => {
    const asks = asksDouble();
    await parseTabRelayRequest({
      tabId: 9,
      ask: 'getScriptSourceChunk',
      payload: { ...CHUNK, extra: 'smuggled' }
    })?.forward(asks);
    expect(asks.calls).toEqual([['getScriptSourceChunk', 9, CHUNK]]);
  });

  it('forwards the RUCSS steps with their payloads rebuilt, and refuses broken ones', async () => {
    const asks = asksDouble();
    const start = { safelist: ['a'], inlinePreserves: ['b'], mobile: true, home: false };
    const apply = { runId: SNAPSHOT, css: 'a{}', keepLinks: [1] };
    await parseTabRelayRequest({
      tabId: 3,
      ask: 'startRucssTest',
      payload: start
    })?.forward(asks);
    await parseTabRelayRequest({ tabId: 3, ask: 'applyRucssTest', payload: apply })?.forward(asks);
    expect(asks.calls).toEqual([
      ['startRucssTest', 3, start],
      ['applyRucssTest', 3, apply]
    ]);
    expect(
      parseTabRelayRequest({ tabId: 3, ask: 'startRucssTest', payload: { ...start, x: 1 } })
    ).toBeNull();
    expect(
      parseTabRelayRequest({ tabId: 3, ask: 'applyRucssTest', payload: { ...apply, runId: 'x' } })
    ).toBeNull();
    expect(parseTabRelayRequest({ tabId: 3, ask: 'startRucssTest' })).toBeNull();
  });

  it('refuses junk tab ids with the shared guard', () => {
    for (const tabId of [-1, 1.5, '3', Number.NaN, 2 ** 53, null, undefined, {}]) {
      expect(parseTabRelayRequest({ tabId, ask: 'getFdtData' }), JSON.stringify(tabId)).toBeNull();
    }
    expect(parseTabRelayRequest({ tabId: 0, ask: 'getFdtData' })?.tabId).toBe(0);
  });

  it('refuses asks outside the registry (no generic forwarding)', () => {
    for (const ask of ['getWprDetections', 'relayTabAsk', 'toString', 7, undefined]) {
      expect(parseTabRelayRequest({ tabId: 1, ask }), String(ask)).toBeNull();
    }
  });

  it('refuses a payload on an ask that takes none, and a broken chunk payload', () => {
    expect(parseTabRelayRequest({ tabId: 1, ask: 'getFdtData', payload: null })).toBeNull();
    expect(parseTabRelayRequest({ tabId: 1, ask: 'processPageData', payload: {} })).toBeNull();
    expect(parseTabRelayRequest({ tabId: 1, ask: 'getScriptSourceChunk' })).toBeNull();
    for (const payload of [
      { ...CHUNK, snapshotId: 'nope' },
      { ...CHUNK, scriptIndex: -1 },
      { ...CHUNK, offset: 0.5 },
      'chunk'
    ]) {
      expect(parseTabRelayRequest({ tabId: 1, ask: 'getScriptSourceChunk', payload })).toBeNull();
    }
  });

  it('refuses non-records, extra keys and inherited fields', () => {
    for (const input of [null, undefined, 'x', [1, 'getFdtData'], 4]) {
      expect(parseTabRelayRequest(input)).toBeNull();
    }
    expect(parseTabRelayRequest({ tabId: 1, ask: 'getFdtData', frameId: 3 })).toBeNull();
    const inherited = Object.create({ tabId: 1, ask: 'getFdtData' }) as Record<string, unknown>;
    expect(parseTabRelayRequest(inherited)).toBeNull();
  });
});

describe('parseTabRelayReply', () => {
  it('reads an answer, an absent answer included', () => {
    expect(parseTabRelayReply({ ok: true, answer: { a: 1 } })).toEqual({
      ok: true,
      answer: { a: 1 }
    });
    // A content script answering `undefined`/`null` survives as-is.
    expect(parseTabRelayReply({ ok: true })).toEqual({ ok: true, answer: undefined });
    expect(parseTabRelayReply({ ok: true, answer: null })).toEqual({ ok: true, answer: null });
  });

  it('reads every declared failure', () => {
    for (const failure of TAB_RELAY_FAILURES) {
      expect(parseTabRelayReply({ ok: false, failure })).toEqual({ ok: false, failure });
    }
  });

  it('refuses unknown failures, mixed shapes and junk', () => {
    for (const input of [
      { ok: false, failure: 'timeout' },
      { ok: false },
      { ok: true, answer: 1, failure: 'failed' },
      { ok: false, failure: 'failed', answer: 1 },
      { ok: 'true', answer: 1 },
      null,
      'ok',
      []
    ]) {
      expect(parseTabRelayReply(input), JSON.stringify(input)).toBeNull();
    }
  });
});
