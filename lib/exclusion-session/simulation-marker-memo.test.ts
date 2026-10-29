import { describe, expect, it } from 'vitest';
import type { InterceptedDocument } from './backend';
import type { SimulationMarkerEntry } from '../storage/simulation-markers';
import {
  answerSimulationMarkerVerify,
  createMarkerIdSource,
  createMarkerSettler,
  drawSimulationMarkerId
} from './simulation-marker-memo';

const ID = '0123456789abcdef0123456789abcdef';
const ORIGIN = 'https://site.test';

/** A top-frame page sender in tab `tabId` at `url`. */
function pageSender(tabId: number, url = `${ORIGIN}/page`, frameId = 0) {
  return { tab: { id: tabId }, url, frameId };
}

/** An intercepted document of tab `tabId` at `url`. */
function documentAt(tabId: number, url: string): InterceptedDocument {
  return {
    tabId,
    documentUrl: url,
    body: new Uint8Array(),
    contentType: 'text/html',
    status: 200
  } as unknown as InterceptedDocument;
}

/** A memo holding `entries` for tab 1 only. */
function memo(entries: readonly SimulationMarkerEntry[]) {
  return (tabId: number) => Promise.resolve(tabId === 1 ? entries : []);
}

const ENTRY: SimulationMarkerEntry = { markerId: ID, origin: ORIGIN, features: ['delay_js'] };

describe('drawSimulationMarkerId', () => {
  it('spells 128 bits as 32 lowercase hex digits, zero-padded', () => {
    expect(drawSimulationMarkerId((bytes) => bytes.fill(0x0a))).toBe('0a'.repeat(16));
    const sizes: number[] = [];
    drawSimulationMarkerId((bytes) => sizes.push(bytes.length));
    expect(sizes).toEqual([16]);
  });
});

describe('createMarkerIdSource', () => {
  it('remembers the drawn id for the document’s tab and origin before answering it', async () => {
    const calls: string[] = [];
    const source = createMarkerIdSource({
      fill: (bytes) => bytes.fill(0xff),
      remember: (tabId, entry) => {
        calls.push(`remember ${String(tabId)} ${entry.origin} ${entry.markerId}`);
        return Promise.resolve();
      }
    });
    const id = await source(documentAt(4, 'https://site.test:8443/a?b#c'), {
      features: ['delay_js']
    });
    calls.push(`answer ${String(id)}`);
    expect(calls).toEqual([
      `remember 4 https://site.test:8443 ${'ff'.repeat(16)}`,
      `answer ${'ff'.repeat(16)}`
    ]);
  });

  it('rejects when the memo write fails (the document is then served unmodified)', async () => {
    const source = createMarkerIdSource({
      fill: () => undefined,
      remember: () => Promise.reject(new Error('quota'))
    });
    await expect(source(documentAt(4, `${ORIGIN}/`), { features: ['delay_js'] })).rejects.toThrow(
      'quota'
    );
  });

  it('rejects a document without an http(s) origin, writing nothing', async () => {
    let writes = 0;
    const source = createMarkerIdSource({
      fill: () => undefined,
      remember: () => {
        writes++;
        return Promise.resolve();
      }
    });
    for (const url of ['file:///x.html', 'not a url', 'data:text/html,x']) {
      await expect(source(documentAt(4, url), { features: ['delay_js'] }), url).rejects.toThrow(
        /http\(s\) origin/
      );
    }
    expect(writes).toBe(0);
  });
});

describe('answerSimulationMarkerVerify', () => {
  it('vouches for an id the tab remembers for the asking page’s origin', async () => {
    await expect(
      answerSimulationMarkerVerify(pageSender(1), { markerId: ID }, memo([ENTRY]))
    ).resolves.toEqual({ features: ['delay_js'] });
  });

  it('finds an older entry of the tab, not only the newest', async () => {
    const newer = { ...ENTRY, markerId: 'f'.repeat(32) };
    await expect(
      answerSimulationMarkerVerify(pageSender(1), { markerId: ID }, memo([newer, ENTRY]))
    ).resolves.toEqual({ features: ['delay_js'] });
  });

  it('answers unverified for an unknown id, another tab’s id, or another origin', async () => {
    const read = memo([ENTRY]);
    await expect(
      answerSimulationMarkerVerify(pageSender(1), { markerId: 'e'.repeat(32) }, read)
    ).resolves.toEqual({ features: [] });
    await expect(
      answerSimulationMarkerVerify(pageSender(2), { markerId: ID }, read)
    ).resolves.toEqual({ features: [] });
    await expect(
      answerSimulationMarkerVerify(pageSender(1, 'https://other.test/page'), { markerId: ID }, read)
    ).resolves.toEqual({ features: [] });
    await expect(
      answerSimulationMarkerVerify(pageSender(1, 'http://site.test/page'), { markerId: ID }, read)
    ).resolves.toEqual({ features: [] });
  });

  it('answers unverified once the memo forgot the id (tab closed, extension updated)', async () => {
    await expect(
      answerSimulationMarkerVerify(pageSender(1), { markerId: ID }, memo([]))
    ).resolves.toEqual({ features: [] });
  });

  it('refuses a subframe, a tab-less sender and a non-http page (never acting for another document)', async () => {
    const read = memo([ENTRY]);
    for (const sender of [
      pageSender(1, `${ORIGIN}/page`, 3),
      { url: `${ORIGIN}/page` },
      pageSender(1, 'file:///x.html'),
      undefined
    ]) {
      await expect(
        answerSimulationMarkerVerify(sender, { markerId: ID }, read),
        JSON.stringify(sender)
      ).rejects.toThrow(/top-frame page/);
    }
  });

  it('refuses a malformed query without reading the memo', async () => {
    let reads = 0;
    const read = () => {
      reads++;
      return Promise.resolve([ENTRY]);
    };
    for (const data of [
      undefined,
      {},
      { markerId: ID.toUpperCase() },
      { markerId: ID, extra: 1 },
      { markerId: 42 },
      ID
    ]) {
      await expect(
        answerSimulationMarkerVerify(pageSender(1), data, read),
        JSON.stringify(data)
      ).rejects.toThrow(/malformed query/);
    }
    expect(reads).toBe(0);
  });

  it('passes a memo read failure through to the asker', async () => {
    await expect(
      answerSimulationMarkerVerify(pageSender(1), { markerId: ID }, () =>
        Promise.reject(new Error('storage unavailable'))
      )
    ).rejects.toThrow('storage unavailable');
  });
});

describe('createMarkerSettler', () => {
  it('re-remembers the id for the document’s tab and origin with the simulated features only', async () => {
    const written: [number, SimulationMarkerEntry][] = [];
    const settle = createMarkerSettler({
      remember: (tabId, entry) => {
        written.push([tabId, entry]);
        return Promise.resolve();
      }
    });
    await settle(documentAt(4, `${ORIGIN}/a?q=1`), ID, ['delay_js']);
    expect(written).toEqual([[4, { markerId: ID, origin: ORIGIN, features: ['delay_js'] }]]);
  });

  it('rejects a document without an http(s) origin, and passes a failed write through', async () => {
    const settle = createMarkerSettler({ remember: () => Promise.resolve() });
    await expect(settle(documentAt(4, 'file:///x.html'), ID, ['delay_js'])).rejects.toThrow(
      /no http\(s\) origin/
    );
    const failing = createMarkerSettler({ remember: () => Promise.reject(new Error('quota')) });
    await expect(failing(documentAt(4, `${ORIGIN}/a`), ID, ['delay_js'])).rejects.toThrow('quota');
  });
});
