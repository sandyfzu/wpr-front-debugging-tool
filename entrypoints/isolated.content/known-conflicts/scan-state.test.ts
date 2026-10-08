/**
 * Scan-state decisions: accumulation with first-seen determinism, the DB
 * bootstrap verdict, the empty state's settlement gates (including the
 * plugins screen's between-passes race), the loading copy's retention and
 * the surface-change comparison.
 */
import { describe, expect, it } from 'vitest';
import {
  dbRowsUsable,
  emptyStateVisible,
  loadingCopyVisible,
  mergeFindings,
  passSettled,
  surfaceChanged
} from './scan-state';
import type { KnownConflict } from '../../../lib/storage/known-conflicts';

function row(id: string, name = `Row ${id}`): KnownConflict {
  return {
    id,
    type: 'Plugin',
    name,
    detection_pattern: null,
    summary: null,
    issue_description: '',
    url: `https://conflict.test/${id}`
  };
}

describe('mergeFindings', () => {
  it('accumulates rows in first-seen DB order, deduplicating by id', () => {
    expect(mergeFindings([row('a'), row('b')], [row('b', 'dup'), row('c')])).toEqual([
      row('a'),
      row('b'),
      row('c')
    ]);
  });

  it('does not mutate the accumulated list', () => {
    const accumulated = [row('a')];
    mergeFindings(accumulated, [row('z')]);
    expect(accumulated).toHaveLength(1);
  });

  it('keeps same-name rows that are distinct DB rows', () => {
    const first = { ...row('a'), name: 'Same Name' };
    const second = { ...row('b'), name: 'Same Name' };
    expect(mergeFindings([first], [second])).toEqual([first, second]);
  });
});

describe('dbRowsUsable', () => {
  it('a non-empty row set retires the loading state (a usable DB verdict)', () => {
    expect(dbRowsUsable([row('a')])).toBe(true);
    expect(dbRowsUsable([row('a'), row('b')])).toBe(true);
  });

  it('zero rows keep loading: an unserved DB is not a scan verdict', () => {
    expect(dbRowsUsable([])).toBe(false);
  });

  it('an unserved/unusable verdict (no array) keeps loading', () => {
    expect(dbRowsUsable(null)).toBe(false);
    expect(dbRowsUsable(undefined)).toBe(false);
    // A corrupted partial write could surface as any non-array shape.
    expect(dbRowsUsable('rows')).toBe(false);
    expect(dbRowsUsable({ rows: [row('a')] })).toBe(false);
  });
});

describe('passSettled', () => {
  it('HelpScout passes settle on completion', () => {
    expect(passSettled('helpscout', false)).toBe(true);
    expect(passSettled('helpscout', true)).toBe(true);
  });

  it('the plugins screen settles only once its late pass has run', () => {
    // Scheduled-but-not-run: a DB write in that window must not present a
    // final zero verdict before the late pass had its chance.
    expect(passSettled('wp-admin', false)).toBe(false);
    expect(passSettled('wp-admin', true)).toBe(true);
  });
});

describe('emptyStateVisible', () => {
  it('gates the empty state until zero findings are final', () => {
    expect(emptyStateVisible([], true, false)).toBe(true);
    expect(emptyStateVisible([], false, false)).toBe(false);
    expect(emptyStateVisible([{}], true, false)).toBe(false);
  });

  it('never renders over an unresolved database', () => {
    // The late-pass race shape: settled pass, zero findings, DB still
    // loading — "no conflicts" must wait for a served database.
    expect(emptyStateVisible([], true, true)).toBe(false);
  });
});

describe('loadingCopyVisible', () => {
  it('shows while the DB is unresolved and nothing contradicts it', () => {
    expect(loadingCopyVisible(true, [])).toBe(true);
  });

  it('yields to findings and never survives past the DB verdict', () => {
    expect(loadingCopyVisible(true, [{}])).toBe(false);
    expect(loadingCopyVisible(false, [])).toBe(false);
    expect(loadingCopyVisible(false, [{}])).toBe(false);
  });
});

describe('surfaceChanged', () => {
  it('treats pathname changes as a new surface, queries as the same one', () => {
    expect(surfaceChanged('/conversation/1/2', '/conversation/3/4')).toBe(true);
    expect(surfaceChanged('/conversation/1/2', '/conversation/1/2')).toBe(false);
  });
});
