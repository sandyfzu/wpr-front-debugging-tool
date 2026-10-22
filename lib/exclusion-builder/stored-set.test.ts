import { describe, expect, it } from 'vitest';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';
import { prevalidateStoredForm, storedExclusionSet } from './stored-set';

/** A set with the given rows (other lanes empty, no disables). */
function set(rows: Partial<ExclusionSet['rows']>): ExclusionSet {
  return { rows: { ...EMPTY_EXCLUSION_SET.rows, ...rows }, disable: EMPTY_EXCLUSION_SET.disable };
}

describe('storedExclusionSet', () => {
  it('stores every lane as WP Rocket would, mapping stored rows back to typed ones', () => {
    const typed: ExclusionSet = {
      rows: {
        delayJs: ['0', 'a*', 'a*', '('],
        deferJs: ['x%41', ''],
        lazyload: [' img '],
        lazyRender: [' div ']
      },
      disable: { delayJs: true, deferJs: false, lazyRender: false }
    };
    expect(storedExclusionSet(typed)).toEqual({
      set: {
        rows: { delayJs: ['a(.*)'], deferJs: ['x'], lazyload: ['img'], lazyRender: [' div '] },
        disable: typed.disable
      },
      typedIndex: {
        delay_js: [1],
        defer_all_js: [0],
        lazyload: [0],
        automatic_lazy_rendering: [0]
      }
    });
  });
});

describe('prevalidateStoredForm', () => {
  it('validates the stored rows and names each problem by its typed row', () => {
    // `(?<n>a)` is stored as `(?a)` (stored row 1, typed row 2), which JS rejects.
    const result = prevalidateStoredForm(set({ deferJs: ['<b></b>', 'ok', '(?<n>a)'] }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]).toMatchObject({ feature: 'defer_all_js', index: 2, row: '(?a)' });
  });

  it('is valid when every stored row is, rows the save drops included', () => {
    expect(prevalidateStoredForm(set({ delayJs: ['(', 'gtag'], lazyload: ['0'] }))).toEqual({
      valid: true,
      invalid: []
    });
  });
});
