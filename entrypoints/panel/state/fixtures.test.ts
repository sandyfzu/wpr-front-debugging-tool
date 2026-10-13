/**
 * The fixture's own invariant, pinned: a factory-built payload — base and
 * per-test-override variants alike — is genuine `FdtData` under the boundary
 * validator and loses nothing on the round trip. Pinning it here means a
 * validator that *tightens* cannot silently invalidate every fixture-based
 * expectation in the data-layer and shell tests — they would fail loudly on
 * this one row instead of in dozens of scattered places.
 */
import { describe, expect, it } from 'vitest';
import { parseFdtData } from '../../../lib/messaging/validate';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { makeFdtData } from './fixtures';

describe('makeFdtData', () => {
  it('survives parseFdtData unchanged (the base payload is contract-genuine)', () => {
    const payload: FdtData = makeFdtData();
    expect(parseFdtData(payload)).toEqual(payload);
  });

  it('survives parseFdtData unchanged with overrides merged in', () => {
    const payload: FdtData = makeFdtData({
      allScriptsLoaded: true,
      undefinedReferencesOnPage: ['jQuery', '$'],
      pageHeaders: null
    });
    expect(parseFdtData(payload)).toEqual(payload);
  });
});
