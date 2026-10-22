/**
 * All-at-once prevalidation: every invalid row of every feature is named
 * (index + reason), never first-error-only; literal rows are never compiled;
 * the typed error carries the full problem list.
 */
import { describe, expect, it } from 'vitest';
import { ExclusionValidationError } from './errors';
import { featureRowWarnings, prevalidateExclusionSet } from './validate';
import { deferJsTransform } from './defer-js';
import { compileDelayRows } from './delay-js-match';
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
    // Delay JS rows are read as WP Rocket reads them: PCRE rejects both, so
    // its save drops them; Defer JS stores them and its runtime PCRE rejects them.
    const dropped = expect.stringMatching(/^WP Rocket drops this row when saving/) as unknown;
    const pcreRejects = expect.stringMatching(/PCRE rejects/) as unknown;
    expect(problems.invalid).toEqual([
      {
        feature: 'delay_js',
        index: 1,
        row: '(unclosed[',
        reason: dropped,
        problem: 'pcre-invalid'
      },
      { feature: 'delay_js', index: 2, row: 'also-bad[', reason: dropped, problem: 'pcre-invalid' },
      {
        feature: 'defer_all_js',
        index: 0,
        row: '[a-',
        reason: pcreRejects,
        problem: 'pcre-invalid'
      },
      {
        feature: 'defer_all_js',
        index: 1,
        row: '+bad+[',
        reason: pcreRejects,
        problem: 'pcre-invalid'
      }
    ]);
  });

  it('rejects empty and whitespace-only rows — they would match every element', () => {
    const problems = prevalidateExclusionSet(setWith({ delayJs: ['', '   '], lazyload: [' '] }));
    expect(problems.valid).toBe(false);
    expect(problems.invalid).toEqual([
      // Only the exact `''` is WP Rocket's match-everything Delay JS row.
      expect.objectContaining({ feature: 'delay_js', index: 0, row: '', problem: 'match-all' }),
      expect.objectContaining({ feature: 'delay_js', index: 1, row: '   ' }),
      expect.objectContaining({ feature: 'lazyload', index: 0, row: ' ' })
    ]);
    expect(problems.invalid[1]).not.toHaveProperty('problem');
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
  /** A hostile subject: 27 `a`s that the probe row cannot finish matching. */
  const PROBE = `<script type="rocketlazyloadscript" data-rocket-src="${'a'.repeat(27)}"></script>`;

  /**
   * The exponential probe, spelled to survive WP Rocket's Delay JS escapes
   * (it turns every `+` literal: `(a+)+b` is a plain text row there).
   */
  const RISKY_DELAY_ROW = '(a{1,}){1,}b';

  it('rejects the exponential probe row at prevalidation, named like an invalid pattern', () => {
    const problems = prevalidateExclusionSet(
      setWith({ delayJs: ['ok\\.js', RISKY_DELAY_ROW, '(a+)+b'], deferJs: ['(a+)+b'] })
    );
    expect(problems).toEqual({
      valid: false,
      invalid: [
        {
          feature: 'delay_js',
          index: 1,
          row: RISKY_DELAY_ROW,
          reason: BACKTRACKING_RISK_REASONS['nested-repetition'],
          problem: 'backtracking-risk'
        },
        {
          feature: 'defer_all_js',
          index: 0,
          row: '(a+)+b',
          reason: BACKTRACKING_RISK_REASONS['nested-repetition'],
          problem: 'backtracking-risk'
        }
      ]
    });
  });

  it('reports an over-deep row as too complex instead of throwing out of prevalidation', () => {
    const deep = `${'('.repeat(1_875)}a${')'.repeat(1_875)}`;
    expect(() => new RegExp(deep)).not.toThrow();
    // Both features read it as PCRE does: nested past PCRE's limit, not checked here.
    expect(prevalidateExclusionSet(setWith({ delayJs: [deep], deferJs: [deep] })).invalid).toEqual([
      expect.objectContaining({ feature: 'delay_js', index: 0, problem: 'pcre-only' }),
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
    expect(() => deferJsTransform('', setWith({ deferJs: ['(a+)+b'] }))).toThrow(
      ExclusionValidationError
    );
    expect(() => compileDelayRows([RISKY_DELAY_ROW])).toThrow(ExclusionValidationError);
    const started = performance.now();
    expect(() => applyPipeline(PROBE, setWith({ delayJs: [RISKY_DELAY_ROW] }))).toThrow(
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
    // Delay JS tests each row alone: a leading `(?i)` leaks nowhere.
    expect(prevalidateExclusionSet(setWith({ delayJs: ['(?i)x', 'y'] })).valid).toBe(true);
  });
});

describe('prevalidateExclusionSet — invalid-pattern reason wording', () => {
  /** The single reason a one-row set of `feature` yields. */
  function reasonFor(feature: 'delayJs' | 'deferJs', row: string): string | undefined {
    return prevalidateExclusionSet(setWith({ [feature]: [row] })).invalid[0]?.reason;
  }

  it("names PCRE's own complaint and WP Rocket's outcome, per feature", () => {
    expect(reasonFor('delayJs', '(')).toMatch(
      /^WP Rocket drops this row when saving: PCRE rejects `\(` .*it never matches$/
    );
    expect(reasonFor('deferJs', '(')).toMatch(
      /^WP Rocket drops this row when saving: PCRE rejects `\(` .*turns Defer JS off on the page$/
    );
  });

  it('keeps the reason short however long the broken row is, for both features', () => {
    for (const feature of ['delayJs', 'deferJs'] as const) {
      for (const row of [
        `(${'a'.repeat(2047)}`,
        `${'a'.repeat(2046)}[`,
        `a{2}${'b'.repeat(2040)}{2}+`
      ]) {
        const reason = reasonFor(feature, row) ?? '';
        expect(reason.length, `${feature} ${row.slice(0, 8)}`).toBeLessThanOrEqual(240);
      }
    }
  });
});

describe('ExclusionValidationError', () => {
  it('carries every problem and a message naming feature, index, row and reason', () => {
    const problems = prevalidateExclusionSet(setWith({ delayJs: ['(bad[', ''] }));
    expect(problems.invalid.length).toBe(2);
    // The throw sites are the transforms and `applyPipeline`; here the class
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
