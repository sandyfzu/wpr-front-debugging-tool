import { describe, expect, it } from 'vitest';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import { laneCounts, laneReport, rowMatches } from './counts';

const DELAY: TransformReport = {
  feature: 'delay_js',
  featureWide: false,
  candidates: 9,
  rewritten: 3,
  regionRemovals: 0,
  matchedRows: [{ row: 'gtag', rowKind: 'pattern', matches: 3 }],
  unmatchedRows: ['nothing']
};
const ALR_WIDE: TransformReport = {
  feature: 'automatic_lazy_rendering',
  featureWide: true,
  candidates: 4,
  rewritten: 4,
  regionRemovals: 1,
  matchedRows: [],
  unmatchedRows: []
};

describe('laneReport / laneCounts', () => {
  it('finds a lane by its feature', () => {
    expect(laneReport([ALR_WIDE, DELAY], 'delayJs')).toBe(DELAY);
    expect(laneReport([DELAY], 'lazyload')).toBeUndefined();
  });

  it('reads the counts, null without a report', () => {
    // Changed in K.5a.2: the counts now carry what the engine could not tell.
    expect(laneCounts(DELAY)).toEqual({
      candidates: 9,
      rewritten: 3,
      featureWide: false,
      undetermined: 0,
      approximate: 0,
      inlineUnknown: false,
      bestEffort: false
    });
    expect(laneCounts(undefined)).toBeNull();
  });

  it('splits the inline-jQuery share out of the undetermined count', () => {
    const defer: TransformReport = {
      ...DELAY,
      feature: 'defer_all_js',
      undetermined: 5,
      inlineUndetermined: 3,
      approximate: 2,
      rowCountsBestEffort: true
    };
    expect(laneCounts(defer)).toMatchObject({
      undetermined: 2,
      approximate: 2,
      inlineUnknown: true,
      bestEffort: true
    });
    expect(laneCounts({ ...defer, undetermined: 3 })).toMatchObject({
      undetermined: 0,
      inlineUnknown: true
    });
  });
});

describe('rowMatches', () => {
  it('counts matched rows and names unmatched ones with 0', () => {
    expect(rowMatches(DELAY, 'gtag')).toBe(3);
    expect(rowMatches(DELAY, 'nothing')).toBe(0);
  });

  it('finds a row still carrying surrounding whitespace by its applied (trimmed) form', () => {
    expect(rowMatches(DELAY, ' gtag\t')).toBe(3);
    expect(rowMatches(DELAY, 'nothing  ')).toBe(0);
  });

  it('is unknown for rows outside the applied set, a feature-wide run, or no report', () => {
    expect(rowMatches(DELAY, 'new row')).toBeNull();
    expect(rowMatches(ALR_WIDE, 'x')).toBeNull();
    expect(rowMatches(undefined, 'gtag')).toBeNull();
  });
});
