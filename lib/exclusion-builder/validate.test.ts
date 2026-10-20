/**
 * All-at-once prevalidation: every invalid row of every feature is named
 * (index + reason), never first-error-only; literal rows are never compiled;
 * the typed error carries the full problem list.
 */
import { describe, expect, it } from 'vitest';
import { ExclusionValidationError } from './errors';
import { prevalidateExclusionSet } from './validate';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';

/** A set with one feature's rows replaced (spread keeps the others empty). */
function setWith(
  rows: Partial<ExclusionSet['rows']>,
  disable?: Partial<ExclusionSet['disable']>
): ExclusionSet {
  return {
    rows: { ...EMPTY_EXCLUSION_SET.rows, ...rows },
    disable: { ...EMPTY_EXCLUSION_SET.disable, ...disable }
  };
}

describe('prevalidateExclusionSet', () => {
  it('accepts the empty set and any set with valid rows', () => {
    expect(prevalidateExclusionSet(EMPTY_EXCLUSION_SET)).toEqual({ valid: true, invalid: [] });
    const valid = setWith({
      delayJs: ['wp-content/plugins/x.js', 'a[0-9]+b'],
      deferJs: ['/js/main.js'],
      lazyload: ['city.webp', 'class="slider'],
      lazyRender: ['data-wpr-lazyrender="1" class="pagination']
    });
    expect(prevalidateExclusionSet(valid)).toEqual({ valid: true, invalid: [] });
  });

  it('names every invalid row across every feature, with index and reason', () => {
    const problems = prevalidateExclusionSet(
      setWith({
        delayJs: ['valid.js', '(unclosed[', 'also-bad['],
        deferJs: ['[a-'],
        lazyRender: ['ok-tag', '+bad+[']
      })
    );
    expect(problems.valid).toBe(false);
    expect(problems.invalid).toEqual([
      expect.objectContaining({ feature: 'delay_js', index: 1, row: '(unclosed[' }),
      expect.objectContaining({ feature: 'delay_js', index: 2, row: 'also-bad[' }),
      expect.objectContaining({ feature: 'defer_all_js', index: 0, row: '[a-' }),
      expect.objectContaining({ feature: 'automatic_lazy_rendering', index: 1, row: '+bad+[' })
    ]);
    for (const problem of problems.invalid) expect(problem.reason).toMatch(/regular expression/i);
  });

  it('rejects empty and whitespace-only rows — they would match every element', () => {
    const problems = prevalidateExclusionSet(setWith({ delayJs: ['', '   '], lazyload: [''] }));
    expect(problems.valid).toBe(false);
    expect(problems.invalid).toEqual([
      expect.objectContaining({ feature: 'delay_js', index: 0, row: '' }),
      expect.objectContaining({ feature: 'delay_js', index: 1, row: '   ' }),
      expect.objectContaining({ feature: 'lazyload', index: 0, row: '' })
    ]);
    for (const problem of problems.invalid) expect(problem.reason).toMatch(/empty/i);
  });

  it('never compiles literal rows — regex-looking Lazyload rows stay valid literals', () => {
    const problems = prevalidateExclusionSet(setWith({ lazyload: ['[a-z]+("webp")'] }));
    expect(problems).toEqual({ valid: true, invalid: [] });
  });
});

describe('ExclusionValidationError', () => {
  it('carries every problem and a message naming feature, index, row and reason', () => {
    const problems = prevalidateExclusionSet(setWith({ delayJs: ['(bad[', ''] }));
    expect(problems.invalid.length).toBe(2);
    // The throw site is `compilePatternRows`/`applyPipeline`; here the class
    // contract is pinned directly over the prevalidator's own output.
    const error = new ExclusionValidationError(problems.invalid);
    expect(error.name).toBe('ExclusionValidationError');
    expect(error.invalid).toEqual(problems.invalid);
    expect(error.message).toContain('delay_js[0]');
    expect(error.message).toContain('(bad[');
    expect(error.message).toContain('delay_js[1]');
    expect(error.message).toMatch(/empty/i);
  });

  it('is an Error — catch sites branch on instanceof as usual', () => {
    const problems = prevalidateExclusionSet(setWith({ deferJs: ['[a-'] }));
    expect(problems.invalid.length).toBe(1);
    expect(new ExclusionValidationError(problems.invalid)).toBeInstanceOf(Error);
  });

  it('refuses to exist without a problem — an empty list is a broken caller', () => {
    expect(() => new ExclusionValidationError([])).toThrow(/at least one invalid row/);
  });
});
