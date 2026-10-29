/**
 * The kept latest list over the fake browser: the `local:` area, a round
 * trip, and tolerant reads (each damaged part dropped alone, unknown
 * fields ignored, a copy failing re-validation read as the miss
 * `unreadable` with a refresh due at once).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getLatestListRecord,
  LATEST_EXCLUSION_LIST_KEY,
  parseLatestListRecord,
  setLatestListRecord,
  type LatestListRecord
} from './latest-exclusion-list';

beforeEach(() => {
  fakeBrowser.reset();
});

const SHA = 'a'.repeat(64);
const DEFER = { external: ['jquery.js', 'gtag'], inline: ['lazyLoadOptions'] };
const COPY = { fetchedAt: 1_790_000_000_000, sha256: SHA, rows: ['jquery', 'gtag'], defer: DEFER };

describe('parseLatestListRecord', () => {
  it('reads a whole record', () => {
    const record = { copy: COPY, attemptedAt: 1_790_000_100_000, lastMiss: 'timeout' };
    expect(parseLatestListRecord(record)).toEqual(record);
  });

  it.each([null, undefined, 'x', 3, ['copy']])('reads %j as the empty record', (value) => {
    expect(parseLatestListRecord(value)).toEqual({});
  });

  it('ignores unknown fields', () => {
    expect(parseLatestListRecord({ copy: { ...COPY, extra: 1 }, other: true })).toEqual({
      copy: COPY
    });
  });

  it.each([
    ['a non-count fetch time', { ...COPY, fetchedAt: -1 }],
    ['a fractional fetch time', { ...COPY, fetchedAt: 1.5 }],
    ['an uppercase digest', { ...COPY, sha256: 'A'.repeat(64) }],
    ['a short digest', { ...COPY, sha256: 'a'.repeat(63) }],
    ['no rows', { ...COPY, rows: undefined }],
    ['empty rows', { ...COPY, rows: [] }],
    ['a non-string row', { ...COPY, rows: ['jquery', 1] }],
    ['a row the transform cannot reproduce', { ...COPY, rows: ['(?R)'] }],
    ['not an object', 'copy'],
    ['null', null]
  ])(
    'drops a copy with %s as unreadable, its attempt time dropped (refresh due)',
    (_name, copy) => {
      expect(parseLatestListRecord({ copy, attemptedAt: 5, lastMiss: 'http-error' })).toEqual({
        lastMiss: 'unreadable'
      });
    }
  );

  it('keeps the attempt facts when no copy is stored', () => {
    expect(parseLatestListRecord({ attemptedAt: 5, lastMiss: 'http-error' })).toEqual({
      attemptedAt: 5,
      lastMiss: 'http-error'
    });
  });

  it('drops an unknown miss and a non-count attempt time alone', () => {
    expect(parseLatestListRecord({ copy: COPY, attemptedAt: '5', lastMiss: 'gone' })).toEqual({
      copy: COPY
    });
  });

  it.each(['oversize', 'malformed', 'invalid', 'unreadable', 'never-fetched'] as const)(
    "keeps a copy whose document's Defer JS lists missed (%s)",
    (miss) => {
      const delayOnly = { fetchedAt: COPY.fetchedAt, sha256: COPY.sha256, rows: COPY.rows };
      const copy = { ...delayOnly, deferMiss: miss };
      expect(parseLatestListRecord({ copy })).toEqual({ copy });
    }
  );

  it('reads a copy kept before the Defer JS lists were read (neither field) as never fetched', () => {
    const delayOnly = { fetchedAt: COPY.fetchedAt, sha256: COPY.sha256, rows: COPY.rows };
    expect(parseLatestListRecord({ copy: delayOnly, attemptedAt: 9 })).toEqual({
      copy: { ...delayOnly, deferMiss: 'never-fetched' },
      attemptedAt: 9
    });
  });

  it.each([
    ['an unknown miss', { deferMiss: 'gone' }],
    ['a miss beside lists', { defer: DEFER, deferMiss: 'invalid' }],
    ['non-record lists', { defer: 'x' }],
    ['an empty external list', { defer: { ...DEFER, external: [] } }],
    ['a missing inline list', { defer: { external: DEFER.external } }],
    ['an external row the transform cannot reproduce', { defer: { ...DEFER, external: ['(?R)'] } }]
  ])('reads Defer JS lists with %s as unreadable, keeping the Delay JS copy', (_name, part) => {
    const delayOnly = { fetchedAt: COPY.fetchedAt, sha256: COPY.sha256, rows: COPY.rows };
    expect(parseLatestListRecord({ copy: { ...delayOnly, ...part } })).toEqual({
      copy: { ...delayOnly, deferMiss: 'unreadable' }
    });
  });

  it('never reads fields from the prototype', () => {
    const polluted = Object.create({ copy: COPY, attemptedAt: 5 }) as object;
    expect(parseLatestListRecord(polluted)).toEqual({});
  });
});

describe('getLatestListRecord / setLatestListRecord', () => {
  it('reads the empty record when nothing is kept', async () => {
    await expect(getLatestListRecord()).resolves.toEqual({});
  });

  it('round-trips a record through the local area', async () => {
    const record: LatestListRecord = { copy: COPY, attemptedAt: COPY.fetchedAt };
    await setLatestListRecord(record);
    await expect(getLatestListRecord()).resolves.toEqual(record);
    const raw = await fakeBrowser.storage.local.get(
      LATEST_EXCLUSION_LIST_KEY.slice('local:'.length)
    );
    expect(Object.values(raw)).toEqual([record]);
  });

  it('reads a damaged stored value tolerantly', async () => {
    await fakeBrowser.storage.local.set({
      'latest-exclusion-list': { copy: { ...COPY, rows: 'x' }, lastMiss: 'invalid' }
    });
    await expect(getLatestListRecord()).resolves.toEqual({ lastMiss: 'unreadable' });
  });
});
