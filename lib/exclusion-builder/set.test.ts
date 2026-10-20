/**
 * The exclusion set's declaring-site contract: the four features and their
 * row kinds (patterns vs literals), exactly three disable toggles (no
 * Lazyload toggle), and the empty-set default every surface starts from.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_EXCLUSION_SET, EXCLUSION_FEATURES } from './set';

describe('EXCLUSION_FEATURES', () => {
  it("declares the four features in the pipeline's execution order", () => {
    expect(EXCLUSION_FEATURES.map((feature) => feature.id)).toEqual([
      'delay_js',
      'defer_all_js',
      'lazyload',
      'automatic_lazy_rendering'
    ]);
  });

  it("declares each feature's row kind — patterns everywhere except Lazyload's literals", () => {
    expect(EXCLUSION_FEATURES.map((feature) => feature.rowKind)).toEqual([
      'pattern',
      'pattern',
      'literal',
      'pattern'
    ]);
  });

  it('maps every feature to its rows key in the set', () => {
    expect(EXCLUSION_FEATURES.map((feature) => feature.rowsKey)).toEqual([
      'delayJs',
      'deferJs',
      'lazyload',
      'lazyRender'
    ]);
  });

  it('has exactly three disable toggles — Image Lazyload deliberately has none', () => {
    expect(EXCLUSION_FEATURES.map((feature) => feature.toggleKey)).toEqual([
      'delayJs',
      'deferJs',
      null,
      'lazyRender'
    ]);
  });
});

describe('EMPTY_EXCLUSION_SET', () => {
  it('carries no rows and disables nothing', () => {
    expect(EMPTY_EXCLUSION_SET).toEqual({
      rows: { delayJs: [], deferJs: [], lazyload: [], lazyRender: [] },
      disable: { delayJs: false, deferJs: false, lazyRender: false }
    });
  });
});
