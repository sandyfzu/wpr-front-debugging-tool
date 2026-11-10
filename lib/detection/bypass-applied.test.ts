import { describe, expect, it } from 'vitest';
import {
  BYPASS_APPLIED_COPY,
  isAppliedDespiteBypass,
  isBypassRender,
  type BypassAppliedRow
} from './bypass-applied';

describe('isBypassRender', () => {
  it.each<[boolean, boolean, boolean]>([
    [true, false, true],
    // A generator meta (readable or degraded) means WP Rocket rendered normally.
    [true, true, false],
    [false, false, false],
    [false, true, false]
  ])('bypass URL %s + generator meta %s → %s', (bypassAttested, generatorMeta, expected) => {
    expect(isBypassRender(bypassAttested, generatorMeta)).toBe(expected);
  });
});

describe('isAppliedDespiteBypass', () => {
  const footprint: BypassAppliedRow = { present: true, source: 'footprint' };

  it('warns on an applied, footprint-decided row of a bypass render', () => {
    expect(isAppliedDespiteBypass(footprint, true)).toBe(true);
  });

  it('never warns off a bypass render', () => {
    expect(isAppliedDespiteBypass(footprint, false)).toBe(false);
  });

  it.each<[string, BypassAppliedRow]>([
    [
      'a meta-decided applied row (a normal render served on the URL)',
      { present: true, source: 'meta' }
    ],
    ['a meta-refuted row', { present: false, source: 'meta' }],
    ['an undecided row (a comment alone counts nothing)', { present: false }],
    ['an applied row with no source', { present: true }],
    ['a footprint-decided absent row', { present: false, source: 'footprint' }],
    ['a verified simulation', { present: true, source: 'footprint', simulation: 'simulated' }],
    [
      'an unverified simulation marker',
      { present: true, source: 'footprint', simulation: 'unverified' }
    ]
  ])('never warns on %s', (_case, row) => {
    expect(isAppliedDespiteBypass(row, true)).toBe(false);
  });
});

describe('BYPASS_APPLIED_COPY', () => {
  it('names the bypass parameter in both renderings', () => {
    expect(BYPASS_APPLIED_COPY).toEqual({
      chip: 'Applied despite ?nowprocket',
      sentence:
        'WP Rocket is not expected to optimize a page loaded with ?nowprocket, yet it applied this feature here.'
    });
  });
});
