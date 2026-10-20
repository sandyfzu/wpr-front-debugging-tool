/**
 * All-at-once prevalidation: every invalid row of every feature is named
 * (index + reason), never first-error-only; literal rows are never compiled;
 * the typed error carries the full problem list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExclusionValidationError } from './errors';
import { prevalidateExclusionSet } from './validate';
import { compilePatternRows } from './compile';
import { BACKTRACKING_RISK_REASONS } from './regex-risk';
import { applyPipeline } from './pipeline';
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
        deferJs: ['[a-', '+bad+['],
        lazyRender: ['ok-tag', '(also-fine[']
      })
    );
    expect(problems.valid).toBe(false);
    expect(problems.invalid).toEqual([
      expect.objectContaining({ feature: 'delay_js', index: 1, row: '(unclosed[' }),
      expect.objectContaining({ feature: 'delay_js', index: 2, row: 'also-bad[' }),
      expect.objectContaining({ feature: 'defer_all_js', index: 0, row: '[a-' }),
      expect.objectContaining({ feature: 'defer_all_js', index: 1, row: '+bad+[' })
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

  it('never compiles literal rows — regex metacharacters are valid for the literal features', () => {
    const problems = prevalidateExclusionSet(
      setWith({ lazyload: ['[a-z]+("webp")'], lazyRender: ['(pagination|[class='] })
    );
    expect(problems).toEqual({ valid: true, invalid: [] });
  });
});

describe('prevalidateExclusionSet — catastrophic-backtracking guard', () => {
  /** A hostile subject: 27 `a`s that `(a+)+b` cannot finish matching. */
  const PROBE = `<script type="rocketlazyloadscript" data-rocket-src="${'a'.repeat(27)}"></script>`;

  it('rejects the exponential probe row at prevalidation, named like an invalid pattern', () => {
    const problems = prevalidateExclusionSet(setWith({ delayJs: ['ok\\.js', '(a+)+b'] }));
    expect(problems).toEqual({
      valid: false,
      invalid: [
        {
          feature: 'delay_js',
          index: 1,
          row: '(a+)+b',
          reason: BACKTRACKING_RISK_REASONS['nested-repetition']
        }
      ]
    });
  });

  it('guards both pattern features, and never the literal ones', () => {
    const risky = '(a|ab)*';
    const problems = prevalidateExclusionSet(
      setWith({ delayJs: [risky], deferJs: [risky], lazyload: [risky], lazyRender: [risky] })
    );
    expect(problems.invalid.map((problem) => problem.feature)).toEqual([
      'delay_js',
      'defer_all_js'
    ]);
  });

  it('refuses the probe on the compile path too, so the engine never runs it', () => {
    expect(() => compilePatternRows(['(a+)+b'], 'delay_js')).toThrow(ExclusionValidationError);
    const started = performance.now();
    expect(() => applyPipeline(PROBE, setWith({ delayJs: ['(a+)+b'] }))).toThrow(
      ExclusionValidationError
    );
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('prevalidateExclusionSet — invalid-pattern reason wording', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The single reason a one-row Delay JS set yields. */
  function reasonFor(row: string): string | undefined {
    return prevalidateExclusionSet(setWith({ delayJs: [row] })).invalid[0]?.reason;
  }

  it('states the lead once and never echoes the row (V8 messages repeat the pattern)', () => {
    expect(reasonFor('(')).toBe('Invalid regular expression: Unterminated group');
    // A row holding the echo's own separators (`/`, `: `) is stripped exactly.
    expect(reasonFor('a/: b(')).toBe('Invalid regular expression: Unterminated group');
    expect(reasonFor('[')).toBe('Invalid regular expression: Unterminated character class');
  });

  it('keeps the reason short however long the broken row is', () => {
    const row = `(${'a'.repeat(2047)}`;
    expect(reasonFor(row)).toBe('Invalid regular expression: Unterminated group');
  });

  it('prefixes a bare engine detail (SpiderMonkey shape) and non-Error throws', () => {
    vi.stubGlobal('RegExp', function throwsBareDetail(): never {
      throw new SyntaxError('unterminated parenthetical');
    });
    expect(reasonFor('(')).toBe('Invalid regular expression: unterminated parenthetical');
    vi.stubGlobal('RegExp', function throwsLeadWithoutEcho(): never {
      throw new SyntaxError('Invalid regular expression: odd shape');
    });
    expect(reasonFor('(')).toBe('Invalid regular expression: odd shape');
    vi.stubGlobal('RegExp', function throwsNonError(): never {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the non-Error arm under test
      throw 'odd';
    });
    expect(reasonFor('(')).toBe('Invalid regular expression: odd');
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
