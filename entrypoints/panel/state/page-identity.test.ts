/** The page's load identity: the payload's capture id while data is shown, else null. */
import { describe, expect, it } from 'vitest';
import { makeFdtData } from './fixtures';
import { pageIdOf } from './page-identity';

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
