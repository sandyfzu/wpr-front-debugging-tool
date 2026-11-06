/** The page's load identity, its settledness, the other-load rule and the ask stamps. */
import { describe, expect, it } from 'vitest';
import { makeFdtData } from './fixtures';
import { isOtherLoad, pageIdOf, pageSettledOf, settleStamp, stampAsk } from './page-identity';

describe('pageIdOf', () => {
  it('reads the capture id while the shell holds data (ready or refreshing)', () => {
    const data = makeFdtData({ scriptSnapshotId: 'load-1' });
    expect(pageIdOf({ status: 'ready', data, fetchedAt: 0 })).toBe('load-1');
    expect(pageIdOf({ status: 'refreshing', data, requestedAt: 0 })).toBe('load-1');
  });

  it('is null without data or without an id', () => {
    expect(pageIdOf({ status: 'fetching' })).toBeNull();
    expect(pageIdOf({ status: 'ready', data: makeFdtData(), fetchedAt: 0 })).toBeNull();
  });
});

describe('pageSettledOf', () => {
  it('is true only while the shell holds fresh data (no refetch in flight)', () => {
    const data = makeFdtData({ scriptSnapshotId: 'load-1' });
    expect(pageSettledOf({ status: 'ready', data, fetchedAt: 0 })).toBe(true);
    expect(pageSettledOf({ status: 'refreshing', data, requestedAt: 0 })).toBe(false);
    expect(pageSettledOf({ status: 'fetching' })).toBe(false);
    expect(pageSettledOf({ status: 'idle' })).toBe(false);
    expect(pageSettledOf({ status: 'error', cause: 'x', hardReload: false })).toBe(false);
  });
});

describe('isOtherLoad', () => {
  it.each<[string | null, string | null, boolean]>([
    ['a', 'b', true],
    ['a', 'a', false],
    [null, 'b', false],
    ['a', null, false],
    [null, null, false]
  ])('measured %j, current %j → %j', (measured, current, other) => {
    expect(isOtherLoad(measured, current)).toBe(other);
  });
});

describe('stampAsk / settleStamp', () => {
  it('stamps a settled shell with its id, and a refetching one provisionally', () => {
    expect(stampAsk('a', true)).toEqual({ page: 'a', provisional: false });
    expect(stampAsk('a', false)).toEqual({ page: null, provisional: true });
  });

  it('settles a provisional stamp on the settled id only, and never moves a settled one', () => {
    const provisional = stampAsk('old', false);
    expect(settleStamp(provisional, 'old', false)).toBe(provisional);
    expect(settleStamp(provisional, 'new', true)).toEqual({ page: 'new', provisional: false });
    const settled = stampAsk('a', true);
    expect(settleStamp(settled, 'b', true)).toBe(settled);
  });
});
