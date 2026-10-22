/**
 * All-at-once prevalidation: every invalid row of every feature is named
 * (index + reason), never first-error-only; literal rows are never compiled;
 * the typed error carries the full problem list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExclusionValidationError } from './errors';
import { featureRowWarnings, prevalidateExclusionSet } from './validate';
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
    for (const problem of problems.invalid) {
      if (problem.feature === 'delay_js') expect(problem.reason).toMatch(/regular expression/i);
      // Defer JS rows are read as WP Rocket's PCRE reads them.
      else expect(problem).toMatchObject({ problem: 'pcre-invalid', reason: /PCRE rejects/ });
    }
  });

  it('rejects empty and whitespace-only rows — they would match every element', () => {
    const problems = prevalidateExclusionSet(setWith({ delayJs: ['', '   '], lazyload: [' '] }));
    expect(problems.valid).toBe(false);
    expect(problems.invalid).toEqual([
      expect.objectContaining({ feature: 'delay_js', index: 0, row: '' }),
      expect.objectContaining({ feature: 'delay_js', index: 1, row: '   ' }),
      expect.objectContaining({ feature: 'lazyload', index: 0, row: ' ' })
    ]);
    for (const problem of problems.invalid) expect(problem.reason).toMatch(/empty/i);
  });

  it("reads the literal features' empty rows as WP Rocket's runtime does", () => {
    // Lazyload drops '' and "0" (array_filter); a lone ''/"0" lazy-render set is a no-op.
    expect(
      prevalidateExclusionSet(setWith({ lazyload: ['', '0', 'a'], lazyRender: [''] }))
    ).toEqual({ valid: true, invalid: [] });
    expect(prevalidateExclusionSet(setWith({ lazyRender: ['0'] })).valid).toBe(true);
    // Lazy-render rows are any text — whitespace included.
    expect(prevalidateExclusionSet(setWith({ lazyRender: [' ', 'a'] })).valid).toBe(true);
    // …but a whitespace-only one gets a non-blocking warning.
    expect(featureRowWarnings('automatic_lazy_rendering', ['a', ' ', '', '\t'])).toEqual([
      expect.objectContaining({ index: 1, row: ' ' }),
      expect.objectContaining({ index: 3, row: '\t' })
    ]);
    expect(featureRowWarnings('lazyload', [' '])).toEqual([]);
    // Next to other rows an empty lazy-render row is an empty alternative: match-all.
    const problems = prevalidateExclusionSet(setWith({ lazyRender: ['a', '', '0'] }));
    expect(problems.invalid).toEqual([
      {
        feature: 'automatic_lazy_rendering',
        index: 1,
        row: '',
        reason: expect.stringMatching(/every element/) as unknown,
        problem: 'match-all'
      }
    ]);
    expect(prevalidateExclusionSet(setWith({ lazyRender: ['0', ''] })).invalid).toHaveLength(1);
  });

  it('reads emptiness with the settings trim: tab/CR/LF-only rows are empty, a no-break space is text', () => {
    const problems = prevalidateExclusionSet(
      setWith({ deferJs: ['\t\r\n'], lazyload: ['\u00a0'], delayJs: ['\u00a0'] })
    );
    expect(problems.invalid).toEqual([
      expect.objectContaining({ feature: 'defer_all_js', index: 0, row: '\t\r\n' })
    ]);
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

  it('reports an over-deep row as too complex instead of throwing out of prevalidation', () => {
    const deep = `${'('.repeat(1_875)}a${')'.repeat(1_875)}`;
    expect(() => new RegExp(deep)).not.toThrow();
    expect(prevalidateExclusionSet(setWith({ delayJs: [deep] })).invalid).toEqual([
      {
        feature: 'delay_js',
        index: 0,
        row: deep,
        reason: BACKTRACKING_RISK_REASONS['too-complex']
      }
    ]);
    // Defer JS reads it as PCRE does: nested past PCRE's limit, not checked here.
    expect(prevalidateExclusionSet(setWith({ deferJs: [deep] })).invalid).toEqual([
      expect.objectContaining({ feature: 'defer_all_js', index: 0, problem: 'pcre-only' })
    ]);
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
    // Smoke ceiling: running the probe would take seconds (3.6 s measured);
    // refusing it takes about a millisecond — 1 s stays robust under CI coverage.
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('prevalidateExclusionSet — Defer JS rows read joined, as WP Rocket runs them', () => {
  it('names the rows of a set WP Rocket would turn off page-wide', () => {
    const problems = prevalidateExclusionSet(setWith({ deferJs: ['ok', '(?<n>a)x', '(?<n>b)y'] }));
    expect(problems.invalid.map(({ index, problem }) => [index, problem])).toEqual([
      [1, 'joined-page-off'],
      [2, 'joined-page-off']
    ]);
    // Alone, each row is fine.
    expect(prevalidateExclusionSet(setWith({ deferJs: ['(?<n>a)x'] })).valid).toBe(true);
  });

  it('keeps an empty row the editor mistake it is, ahead of the PCRE reading', () => {
    expect(prevalidateExclusionSet(setWith({ deferJs: ['a', ' '] })).invalid).toEqual([
      {
        feature: 'defer_all_js',
        index: 1,
        row: ' ',
        reason: expect.stringMatching(/empty/) as unknown
      }
    ]);
  });

  it('accepts PCRE-only syntax WP Rocket matches (a leading `(?i)` only as the last row: it would leak)', () => {
    expect(
      prevalidateExclusionSet(setWith({ deferJs: ['\\A/a\\.js\\z', '^/a{,2}\\.js$', '(?i)x'] }))
        .valid
    ).toBe(true);
    // The same rows stay JS-validated on a feature without a PCRE reading.
    expect(prevalidateExclusionSet(setWith({ delayJs: ['(?i)x'] })).valid).toBe(false);
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
