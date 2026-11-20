/** The Refresh control's state table. */
import { describe, expect, it } from 'vitest';
import { makeFdtData } from '../state/fixtures';
import type { DataState } from '../state/fdt-state-machine';
import { REFRESH_LABEL, STALE_REFRESH_TITLE, refreshControl } from './refresh';

describe('refreshControl (data state → action)', () => {
  const data = makeFdtData();
  it.each([
    [{ status: 'ready', data, fetchedAt: 1 }, 'reload'],
    [{ status: 'idle' }, 'busy'],
    [{ status: 'fetching' }, 'busy'],
    [{ status: 'refreshing', data, requestedAt: 1 }, 'busy'],
    [{ status: 'error', cause: 'x', hardReload: false }, 'retry'],
    [{ status: 'unavailable', reason: 'x' }, 'held']
  ] as Array<[DataState, string]>)('%o → %s', (state, kind) => {
    const control = refreshControl(state);
    expect(control.kind).toBe(kind);
    expect(control.title.length).toBeGreaterThan(0);
  });

  it('names the stale data in the ready title, and only there', () => {
    expect(refreshControl({ status: 'ready', data, fetchedAt: 1 }, true)).toEqual({
      kind: 'reload',
      title: STALE_REFRESH_TITLE
    });
    expect(STALE_REFRESH_TITLE).toBe(
      'Page data is older than 10 min — refresh to re-read the page'
    );
    expect(refreshControl({ status: 'ready', data, fetchedAt: 1 }).title).toBe('Refresh page data');
    // A busy or failed read keeps its own words: staleness is the data's, the
    // flight in the air is what the control is doing now.
    expect(refreshControl({ status: 'fetching' }, true).title).toBe('Refreshing page data…');
    expect(refreshControl({ status: 'error', cause: 'x', hardReload: false }, true).title).toBe(
      'Retry reading page data'
    );
  });

  it('keeps one accessible name across states', () => {
    expect(REFRESH_LABEL).toBe('Refresh page data');
  });
});
