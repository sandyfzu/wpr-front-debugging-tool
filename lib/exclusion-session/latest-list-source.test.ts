/**
 * The simulation's list source: the kept copy for every version while at
 * most 14 days old (`expired` past it), else the bundled rows named by the
 * last miss (`never-fetched` before any), and a
 * failed read degraded to the bundled rows (`unreadable`), never a rejection.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  chooseSimulationList,
  createLatestListSource,
  LATEST_LIST_MAX_AGE_MS
} from './latest-list-source';

const BUNDLED = ['bundled-row'];
const COPY = { fetchedAt: 1_790_000_000_000, sha256: 'a'.repeat(64), rows: ['latest-row'] };
const NOW = COPY.fetchedAt + 1_000;
const clock = (): number => NOW;

describe('chooseSimulationList', () => {
  it('runs the kept copy, with its fetch time', () => {
    expect(
      chooseSimulationList({ copy: COPY, attemptedAt: 9, lastMiss: 'timeout' }, BUNDLED, NOW)
    ).toEqual({ listRows: COPY.rows, listSource: 'latest', listFetchedAt: COPY.fetchedAt });
  });

  it('runs the bundled rows, never fetched, before any refresh', () => {
    expect(chooseSimulationList({}, BUNDLED, NOW)).toEqual({
      listRows: BUNDLED,
      listSource: 'bundled',
      listMiss: 'never-fetched'
    });
  });

  it.each([
    'network-error',
    'timeout',
    'http-error',
    'oversize',
    'malformed',
    'invalid',
    'unreadable'
  ] as const)('runs the bundled rows named by the last miss (%s) when no copy is kept', (miss) => {
    expect(chooseSimulationList({ attemptedAt: 9, lastMiss: miss }, BUNDLED, NOW)).toEqual({
      listRows: BUNDLED,
      listSource: 'bundled',
      listMiss: miss
    });
  });

  it('trusts a copy exactly 14 days old, not one 1 ms older (expired, the bundled rows run)', () => {
    const record = { copy: COPY, attemptedAt: 9, lastMiss: 'timeout' } as const;
    const edge = COPY.fetchedAt + LATEST_LIST_MAX_AGE_MS;
    expect(LATEST_LIST_MAX_AGE_MS).toBe(14 * 86_400_000);
    expect(chooseSimulationList(record, BUNDLED, edge - 1)).toMatchObject({ listSource: 'latest' });
    expect(chooseSimulationList(record, BUNDLED, edge)).toMatchObject({ listSource: 'latest' });
    expect(chooseSimulationList(record, BUNDLED, edge + 1)).toEqual({
      listRows: BUNDLED,
      listSource: 'bundled',
      listMiss: 'expired'
    });
  });

  it('expires a copy dated after now (the clock ran ahead at fetch), trusts one dated now', () => {
    // A future-dated copy never reads as fresh (an earlier version pinned it so).
    expect(chooseSimulationList({ copy: COPY }, BUNDLED, COPY.fetchedAt - 1)).toEqual({
      listRows: BUNDLED,
      listSource: 'bundled',
      listMiss: 'expired'
    });
    expect(chooseSimulationList({ copy: COPY }, BUNDLED, COPY.fetchedAt)).toMatchObject({
      listSource: 'latest'
    });
  });
});

describe('createLatestListSource', () => {
  it('serves the kept record for every version', async () => {
    const source = createLatestListSource(() => Promise.resolve({ copy: COPY }), clock, {
      warn: vi.fn()
    });
    for (const version of ['3.24', '3.23.5.1']) {
      await expect(source(version, BUNDLED)).resolves.toMatchObject({ listSource: 'latest' });
    }
  });

  it('reads the clock per document (a copy expires while the background lives)', async () => {
    let now = NOW;
    const source = createLatestListSource(
      () => Promise.resolve({ copy: COPY }),
      () => now,
      { warn: vi.fn() }
    );
    await expect(source('3.24', BUNDLED)).resolves.toMatchObject({ listSource: 'latest' });
    now = COPY.fetchedAt + LATEST_LIST_MAX_AGE_MS + 1;
    await expect(source('3.24', BUNDLED)).resolves.toMatchObject({ listMiss: 'expired' });
  });

  it('degrades a failed read to the bundled rows (unreadable), logged', async () => {
    const log = { warn: vi.fn() };
    const source = createLatestListSource(
      () => Promise.reject(new Error('storage down')),
      clock,
      log
    );
    await expect(source('3.24', BUNDLED)).resolves.toEqual({
      listRows: BUNDLED,
      listSource: 'bundled',
      listMiss: 'unreadable'
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
