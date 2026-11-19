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
    getServedScriptTag: vi.fn((tabId: number, request: unknown) => {
      calls.push(['getServedScriptTag', tabId, request]);
      return Promise.resolve({ status: 'gone' });
    }),
    startRucssTest: vi.fn((tabId: number, request: unknown) => {
      calls.push(['startRucssTest', tabId, request]);
      return Promise.resolve({ ok: false, failure: { kind: 'refused' } });
    }),
    applyRucssTest: vi.fn((tabId: number, request: unknown) => {
      calls.push(['applyRucssTest', tabId, request]);
      return Promise.resolve({ ok: false, failure: 'stale-run' });
    }),
    runBeaconTest: vi.fn((tabId: number, request: unknown) => {
      calls.push(['runBeaconTest', tabId, request]);
      return Promise.resolve({ kind: 'busy' });
    }),
    runLcpAnalysis: vi.fn((tabId: number, request: unknown) => {
      calls.push(['runLcpAnalysis', tabId, request]);
      return Promise.resolve({ kind: 'unsupported' });
    }),
    getScriptRuntimeStatuses: vi.fn((tabId: number) => {
      calls.push(['getScriptRuntimeStatuses', tabId]);
      return Promise.resolve({ scripts: [], total: 0 });
    }),
    getCurrentVisitVitals: vi.fn((tabId: number) => {
      calls.push(['getCurrentVisitVitals', tabId]);
      return Promise.resolve(null);
    }),
    listPageStyles: vi.fn((tabId: number) => {
      calls.push(['listPageStyles', tabId]);
      return Promise.resolve({ styles: [], total: 0 });
    }),
    listPageStylesheets: vi.fn((tabId: number) => {
      calls.push(['listPageStylesheets', tabId]);
      return Promise.resolve({ styles: [], total: 0 });
    }),
    getStyleSourceChunk: vi.fn((tabId: number, request: unknown) => {
      calls.push(['getStyleSourceChunk', tabId, request]);
      return Promise.resolve({ status: 'gone' });
    })
  };
}

describe('the relayable asks registry', () => {
  it('is the closed list of the thirteen panel→tab asks', () => {
    expect(Object.keys(TAB_RELAY_ASKS).sort()).toEqual([
      'applyRucssTest',
      'getCurrentVisitVitals',
      'getFdtData',
      'getScriptRuntimeStatuses',
      'getScriptSourceChunk',
      'getServedScriptTag',
      'getStyleSourceChunk',
      'listPageStyles',
      'listPageStylesheets',
      'processPageData',
      'runBeaconTest',
      'runLcpAnalysis',
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

  it('forwards a served-tag ask rebuilt from its two fields and refuses a malformed one', async () => {
    const asks = asksDouble();
    const tag = { snapshotId: CHUNK.snapshotId, scriptIndex: 3 };
    await parseTabRelayRequest({ tabId: 9, ask: 'getServedScriptTag', payload: tag })?.forward(
      asks
    );
    expect(asks.calls).toEqual([['getServedScriptTag', 9, tag]]);
    for (const payload of [
      { ...tag, extra: 'smuggled' },
      { ...tag, scriptIndex: -1 },
      { snapshotId: 'not-an-id', scriptIndex: 0 },
      undefined
    ]) {
      expect(
        parseTabRelayRequest({ tabId: 9, ask: 'getServedScriptTag', payload }),
        JSON.stringify(payload)
      ).toBeNull();
    }
  });

  it('forwards a style-source ask rebuilt from its three fields and refuses any other shape', async () => {
    const asks = asksDouble();
    const read = { snapshotId: CHUNK.snapshotId, styleIndex: 4, offset: 65_536 };
    await parseTabRelayRequest({ tabId: 9, ask: 'getStyleSourceChunk', payload: read })?.forward(
      asks
    );
    expect(asks.calls).toEqual([['getStyleSourceChunk', 9, read]]);
    expect(asks.calls[0]?.[2]).not.toBe(read);
    for (const payload of [
      { ...read, extra: 'smuggled' },
      { ...read, styleIndex: -1 },
      { ...read, offset: 1.5 },
      { snapshotId: 'not-an-id', styleIndex: 0, offset: 0 },
      { snapshotId: read.snapshotId, styleIndex: 0 },
      undefined
    ]) {
      expect(
        parseTabRelayRequest({ tabId: 9, ask: 'getStyleSourceChunk', payload }),
        JSON.stringify(payload)
      ).toBeNull();
    }
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

  it('forwards the live analysis asks with their payloads rebuilt, and refuses broken ones', async () => {
    const asks = asksDouble();
    const config = {
      features: { aboveTheFold: false, lazyRender: true },
      mobile: false,
      widthThreshold: 1600,
      heightThreshold: 700,
      lazyRenderThreshold: 1800,
      selectors: []
    };
    for (const request of [
      { tabId: 3, ask: 'runBeaconTest', payload: { config } },
      { tabId: 3, ask: 'runLcpAnalysis', payload: { highlight: true } },
      { tabId: 3, ask: 'getScriptRuntimeStatuses' },
      { tabId: 3, ask: 'getCurrentVisitVitals' }
    ]) {
      await parseTabRelayRequest(request)?.forward(asks);
    }
    expect(asks.calls).toEqual([
      ['runBeaconTest', 3, { config }],
      ['runLcpAnalysis', 3, { highlight: true }],
      ['getScriptRuntimeStatuses', 3],
      ['getCurrentVisitVitals', 3]
    ]);
    for (const broken of [
      { tabId: 3, ask: 'runBeaconTest', payload: { config: { ...config, mobile: 1 } } },
      { tabId: 3, ask: 'runBeaconTest', payload: { config, x: 1 } },
      { tabId: 3, ask: 'runLcpAnalysis', payload: { highlight: 'yes' } },
      { tabId: 3, ask: 'getScriptRuntimeStatuses', payload: {} },
      { tabId: 3, ask: 'getCurrentVisitVitals', payload: null }
    ]) {
      expect(parseTabRelayRequest(broken), JSON.stringify(broken)).toBeNull();
    }
  });

  it('forwards the page-style inventory and refuses one carrying a payload', async () => {
    const asks = asksDouble();
    await parseTabRelayRequest({ tabId: 8, ask: 'listPageStyles' })?.forward(asks);
    expect(asks.calls).toEqual([['listPageStyles', 8]]);
    expect(parseTabRelayRequest({ tabId: 8, ask: 'listPageStyles', payload: {} })).toBeNull();
  });

  it('forwards the stylesheet inventory and refuses one carrying a payload', async () => {
    const asks = asksDouble();
    await parseTabRelayRequest({ tabId: 8, ask: 'listPageStylesheets' })?.forward(asks);
    expect(asks.calls).toEqual([['listPageStylesheets', 8]]);
    expect(parseTabRelayRequest({ tabId: 8, ask: 'listPageStylesheets', payload: {} })).toBeNull();
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
