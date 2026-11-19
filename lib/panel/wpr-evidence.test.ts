/**
 * The WP Rocket footprints read off the payload, and the sentence naming them.
 */
import { describe, expect, it } from 'vitest';
import type { FdtData, WprDetections } from '../wp-rocket/types';
import { makeReportData } from './support-report.fixtures';
import { wprEvidence, wprEvidenceSentence, type WprEvidence } from './wpr-evidence';

/**
 * A payload with a plugin row and payload-level overrides.
 *
 * @param wpr The plugin row's overrides.
 * @param extra Payload overrides (e.g. the generator meta flag).
 */
function data(wpr: Partial<WprDetections['wpr']>, extra?: Partial<FdtData>): FdtData {
  const base = makeReportData();
  return makeReportData({
    wprDetections: { ...base.wprDetections, wpr: { ...base.wprDetections.wpr, ...wpr } },
    ...extra
  });
}

describe('wprEvidence', () => {
  it('names nothing when WP Rocket was not detected, whatever else the payload carries', () => {
    expect(wprEvidence(data({}))).toEqual([]);
    // A stray flag never turns absence into evidence.
    expect(
      wprEvidence(data({ cacheMarkerFound: true, version: '3.1' }, { wprGeneratorMeta: true }))
    ).toEqual([]);
  });

  it.each<[string, Partial<WprDetections['wpr']>, Partial<FdtData>, readonly WprEvidence[]]>([
    ['a versioned generator tag', { version: '3.20.1' }, {}, ['generator-tag']],
    ['a version-less feature declaration', {}, { wprGeneratorMeta: true }, ['generator-tag']],
    [
      'both forms of the tag (one footprint)',
      { version: '3.20.1' },
      { wprGeneratorMeta: true },
      ['generator-tag']
    ],
    ['the cache signature alone', { cacheMarkerFound: true }, {}, ['cache-signature']],
    [
      'the tag and the signature, in sentence order',
      { version: '3.20.1', cacheMarkerFound: true, cached: true },
      {},
      ['generator-tag', 'cache-signature']
    ],
    ['neither (presence inferred from optimizations)', {}, {}, ['optimizations']]
  ])('%s', (_name, wpr, extra, expected) => {
    expect(wprEvidence(data({ present: true, ...wpr }, extra))).toEqual(expected);
  });
});

describe('wprEvidenceSentence', () => {
  it.each<[readonly WprEvidence[], string | null]>([
    [[], null],
    [['generator-tag'], 'Detected by the generator tag'],
    [['cache-signature'], 'Detected by the cache signature'],
    [['generator-tag', 'cache-signature'], 'Detected by the generator tag and the cache signature'],
    [['optimizations'], 'Detected by its optimizations on this page']
  ])('%o → %s', (evidence, sentence) => {
    expect(wprEvidenceSentence(evidence)).toBe(sentence);
  });
});
