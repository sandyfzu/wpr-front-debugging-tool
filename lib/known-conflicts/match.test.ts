/**
 * Known-conflict matching: exact word-boundary semantics for the HelpScout
 * page, loose `includes` for the WP-admin page, regex escaping for conflict
 * names carrying metacharacters (real DB rows exist for both cases), and
 * skipping of rows that cannot match or cannot be opened.
 */
import { describe, expect, it } from 'vitest';
import { findKnownConflicts } from './match';
import type { KnownConflict } from '../storage/known-conflicts';

function conflict(overrides: Partial<KnownConflict> = {}): KnownConflict {
  return {
    id: 'row-1',
    type: 'Plugin',
    name: 'ACME Cacher',
    detection_pattern: null,
    summary: 'Breaks caching',
    issue_description: '',
    url: 'https://example.com/acme',
    ...overrides
  };
}

const ACME = conflict();

describe('wp-admin mode', () => {
  it('matches the name anywhere in the concatenated text', () => {
    expect(findKnownConflicts('ACME CacHER  broken', [ACME], 'wp-admin')).toEqual([ACME]);
    expect(findKnownConflicts('SomethingAcme Cacher Something', [ACME], 'wp-admin')).toEqual([
      ACME
    ]);
    expect(findKnownConflicts('Unrelated text', [ACME], 'wp-admin')).toEqual([]);
  });

  it('honors surrounding whitespace trimming on the scan text', () => {
    expect(findKnownConflicts('  \n ACME CACHER \n ', [ACME], 'wp-admin')).toEqual([ACME]);
  });

  it('returns a padded row (a no-break space, as a real server row has) with its name trimmed', () => {
    const padded = conflict({ name: ' ACME Cacher ' });
    const found = findKnownConflicts('acme cacher', [padded], 'wp-admin');
    expect(found).toEqual([{ ...padded, name: 'ACME Cacher' }]);
    expect(padded.name, 'the stored row is never mutated').toBe(' ACME Cacher ');
  });
});

describe('helpscout mode, padded names', () => {
  it('matches and returns the trimmed name', () => {
    const padded = conflict({ name: ' ACME Cacher' });
    expect(findKnownConflicts('dlv - acme cacher', [padded], 'helpscout')).toEqual([
      { ...padded, name: 'ACME Cacher' }
    ]);
  });
});

describe('helpscout mode', () => {
  it('requires word-ish boundaries: "- name -" or wrap at text ends', () => {
    expect(findKnownConflicts('dlv - acme cacher - footer', [ACME], 'helpscout')).toEqual([ACME]);
    expect(findKnownConflicts('acme cacher - footer', [ACME], 'helpscout')).toEqual([ACME]);
    expect(findKnownConflicts('dlv - acme cacher', [ACME], 'helpscout')).toEqual([ACME]);
    expect(findKnownConflicts('foo acme cacher bar - x', [ACME], 'helpscout')).toEqual([]);
  });

  it('does not match name substrings inside larger words', () => {
    expect(findKnownConflicts('the acme cachermenu plugin', [ACME], 'helpscout')).toEqual([]);
    expect(findKnownConflicts('WooCommerce Acme Cacher works', [ACME], 'helpscout')).toEqual([]);
  });
});

describe('names with regex metacharacters', () => {
  const star = conflict({ name: 'Pre* Party Resource Hints' });
  const parens = conflict({ name: 'Beaver Builder Plugin (Lite Version)' });
  const plusPlus = conflict({ name: 'C++ Plugin' });
  const pipe = conflict({ name: 'iubenda | Compliance' });

  it('matches rows the unescaped interpolation would miss (regression)', () => {
    for (const [entry] of [[star], [parens], [plusPlus], [pipe]] as const) {
      const text = `- ${entry.name} -`;
      expect(findKnownConflicts(text, [entry], 'helpscout')).toEqual([entry]);
    }
    expect(findKnownConflicts('pre* party resource hints', [star], 'wp-admin')).toEqual([star]);
  });

  it('keeps their regex power inside the pattern, not outside', () => {
    // `.*` etc. from the NAME must stay literal.
    expect(findKnownConflicts('prex party resource hints', [star], 'helpscout')).toEqual([]);
    expect(findKnownConflicts('czz plugin', [plusPlus], 'helpscout')).toEqual([]);
  });
});

describe('row filtering', () => {
  it('skips rows without a name or url', () => {
    const rows = [conflict({ name: '' }), conflict({ name: '   ' }), conflict({ url: '' })];
    expect(findKnownConflicts('anything at all', rows, 'wp-admin')).toEqual([]);
  });

  it('skips malformed rows without crashing (corrupt storage)', () => {
    const rows = [
      null,
      42,
      { id: 'x' }, // name/url missing
      ACME
    ] as unknown as KnownConflict[];
    expect(findKnownConflicts('acme cacher is here', rows, 'wp-admin')).toEqual([ACME]);
  });

  it('reports a row at most once per call', () => {
    expect(findKnownConflicts('acme cacher and acme cacher', [ACME], 'wp-admin')).toEqual([ACME]);
  });

  it('keeps the DB order across matches', () => {
    const a = conflict({ name: 'aaa', url: 'https://a' });
    const b = conflict({ name: 'bbb', url: 'https://b' });
    const db = [b, a];
    expect(findKnownConflicts('bbb - and again - aaa -', db, 'wp-admin')).toEqual([b, a]);
  });
});

describe('hostile scan text', () => {
  it('survives regex-shaped inputs', () => {
    const evil = '^[$()|*+?{}[].*?)/ - acme cacher - $^';
    expect(findKnownConflicts(evil, [ACME], 'helpscout')).toEqual([ACME]);
  });

  it('caps absurdly long inputs instead of scanning forever', () => {
    const enormous = 'a'.repeat(3_000_000) + ' - acme cacher -';
    // Beyond the cap the text is truncated, so the tail no longer matches.
    expect(findKnownConflicts(enormous, [ACME], 'helpscout')).toEqual([]);
  });
});
