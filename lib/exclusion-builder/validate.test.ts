/**
 * All-at-once prevalidation: every invalid row of every feature is named
 * (index + reason), never first-error-only, split into blocking problems and
 * non-blocking warnings; literal rows are never compiled; the typed error
 * carries the full problem list.
 */
import { describe, expect, it } from 'vitest';
import {
  ExclusionValidationError,
  isBlockingProblem,
  matchAllRows,
  throwIfBlocking
} from './errors';
import { NON_BLOCKING_PROBLEMS, PROBLEM_IDS } from './pcre/problems';
import { featureRowReading, featureRowWarnings, prevalidateExclusionSet } from './validate';
import { deferJsTransform } from './defer-js';
import { compileDelayRows } from './delay-js-match';
import { ROW_REASONS } from './row-reasons';
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
    expect(prevalidateExclusionSet(EMPTY_EXCLUSION_SET)).toEqual({
      valid: true,
      invalid: [],
      warnings: []
    });
    const valid = setWith({
      delayJs: ['wp-content/plugins/x.js', 'a[0-9]+b'],
      deferJs: ['/js/main.js'],
      lazyload: ['city.webp', 'class="slider'],
      lazyRender: ['data-wpr-lazyrender="1" class="pagination']
    });
    expect(prevalidateExclusionSet(valid)).toEqual({ valid: true, invalid: [], warnings: [] });
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

  it("rejects whitespace-only rows and warns on the exact `''` — both would match every element", () => {
    const problems = prevalidateExclusionSet(setWith({ delayJs: ['', '   '], lazyload: [' '] }));
    expect(problems.valid).toBe(false);
    expect(problems.invalid).toEqual([
      expect.objectContaining({ feature: 'delay_js', index: 1, row: '   ' }),
      expect.objectContaining({ feature: 'lazyload', index: 0, row: ' ' })
    ]);
    for (const problem of problems.invalid) expect(problem).not.toHaveProperty('problem');
    // Only the exact `''` is WP Rocket's match-everything Delay JS row: applied, so a warning.
    expect(problems.warnings).toEqual([
      expect.objectContaining({ feature: 'delay_js', index: 0, row: '', problem: 'match-all' })
    ]);
    for (const problem of [...problems.invalid, ...problems.warnings])
      expect(problem.reason).toMatch(/empty/i);
  });

  it("reads the literal features' empty rows as WP Rocket's runtime does", () => {
    // Lazyload drops '' and "0" (array_filter); a lone ''/"0" lazy-render set is a no-op.
    expect(
      prevalidateExclusionSet(setWith({ lazyload: ['', '0', 'a'], lazyRender: [''] }))
    ).toEqual({ valid: true, invalid: [], warnings: [] });
    expect(prevalidateExclusionSet(setWith({ lazyRender: ['0'] })).valid).toBe(true);
    // Lazy-render rows are any text — whitespace included.
    expect(prevalidateExclusionSet(setWith({ lazyRender: [' ', 'a'] })).valid).toBe(true);
    // …but a whitespace-only one gets a non-blocking warning.
    // …but a whitespace-only one gets a non-blocking warning, in row order
    // with the set's other warnings (the empty row next to them: match-all).
    expect(featureRowWarnings('automatic_lazy_rendering', 'literal', ['a', ' ', '', '\t'])).toEqual(
      [
        expect.objectContaining({ index: 1, row: ' ' }),
        expect.objectContaining({ index: 2, row: '', problem: 'match-all' }),
        expect.objectContaining({ index: 3, row: '\t' })
      ]
    );
    expect(featureRowWarnings('lazyload', 'literal', [' '])).toEqual([]);
    // Next to other rows an empty lazy-render row is an empty alternative:
    // match-all, applied as WP Rocket applies it — a warning, never a block.
    const problems = prevalidateExclusionSet(setWith({ lazyRender: ['a', '', '0'] }));
    expect(problems.invalid).toEqual([]);
    expect(problems.warnings).toEqual([
      {
        feature: 'automatic_lazy_rendering',
        index: 1,
        row: '',
        reason: expect.stringMatching(/every element/) as unknown,
        problem: 'match-all'
      }
    ]);
    expect(prevalidateExclusionSet(setWith({ lazyRender: ['0', ''] })).warnings).toHaveLength(1);
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
    expect(problems).toEqual({ valid: true, invalid: [], warnings: [] });
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
          // Delay's example is in Delay's own syntax (its `+` is literal).
          reason: expect.stringContaining('(like `(a{1,}){1,}`)') as unknown,
          problem: 'backtracking-risk'
        },
        {
          feature: 'defer_all_js',
          index: 0,
          row: '(a+)+b',
          reason: ROW_REASONS.backtracking('defer_all_js', 'nested-repetition'),
          problem: 'backtracking-risk'
        }
      ],
      warnings: []
    });
  });

  it('reports an over-deep row as too complex instead of throwing out of prevalidation', () => {
    const deep = `${'('.repeat(1_875)}a${')'.repeat(1_875)}`;
    expect(() => new RegExp(deep)).not.toThrow();
    // Nested past PCRE's limit, its save is not modeled: unverified — no
    // problem, never blocking, and no matcher (it matches nothing).
    expect(prevalidateExclusionSet(setWith({ delayJs: [deep], deferJs: [deep] })).invalid).toEqual(
      []
    );
  });

  it('guards both pattern features, and never the literal ones', () => {
    // Each feature's own spelling of the overlapping-alternation shape.
    const delayRisky = '(a|ab){1,}';
    const deferRisky = '(a|ab)*c';
    const problems = prevalidateExclusionSet(
      setWith({
        delayJs: [delayRisky],
        deferJs: [deferRisky],
        lazyload: [delayRisky, deferRisky],
        lazyRender: [delayRisky, deferRisky]
      })
    );
    expect(problems.invalid.map(({ feature, problem }) => [feature, problem])).toEqual([
      ['delay_js', 'backtracking-risk'],
      ['defer_all_js', 'backtracking-risk']
    ]);
    // `(a|ab)*` alone matches empty text: it matches every script, a warning.
    const matchAll = prevalidateExclusionSet(
      setWith({ delayJs: ['(a|ab)*'], deferJs: ['(a|ab)*'] })
    );
    expect(matchAll.invalid).toEqual([]);
    expect(matchAll.warnings.map(({ feature, problem }) => [feature, problem])).toEqual([
      ['delay_js', 'match-all'],
      ['defer_all_js', 'match-all']
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
  it('warns on the rows of a set WP Rocket would turn off page-wide, without blocking it', () => {
    const problems = prevalidateExclusionSet(setWith({ deferJs: ['ok', '(?<n>a)x', '(?<n>b)y'] }));
    expect(problems.valid).toBe(true);
    expect(problems.invalid).toEqual([]);
    expect(problems.warnings.map(({ index, problem }) => [index, problem])).toEqual([
      [1, 'joined-page-off'],
      [2, 'joined-page-off']
    ]);
    // Alone, each row is fine.
    expect(prevalidateExclusionSet(setWith({ deferJs: ['(?<n>a)x'] }))).toEqual({
      valid: true,
      invalid: [],
      warnings: []
    });
  });

  it('names an unverified row behind a page-off as a warning (the page state is read from the rows as given)', () => {
    const problems = prevalidateExclusionSet(setWith({ deferJs: ['a\\.js', '\\p{L}\\Qab'] }));
    expect(problems.valid).toBe(true);
    expect(problems.warnings.map(({ index, problem }) => [index, problem])).toEqual([
      [1, 'joined-page-off']
    ]);
  });

  it('keeps blocking rows that match differently joined (the engine cannot replay them)', () => {
    const problems = prevalidateExclusionSet(setWith({ deferJs: ['(?-i)zzz', 'A.JS'] }));
    expect(problems.valid).toBe(false);
    expect(problems.invalid.map(({ index, problem }) => [index, problem])).toEqual([
      [0, 'joined-changes-matching']
    ]);
    expect(problems.warnings).toEqual([]);
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
    const problems = prevalidateExclusionSet(setWith({ delayJs: ['(bad[', ' '] }));
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

describe('featureRowReading', () => {
  it('splits one reading into blocking problems and warnings, both in row order', () => {
    const reading = featureRowReading('defer_all_js', 'pattern', ['(a+)+b', '(?a)', '[a-', 'zzz|']);
    expect(reading.problems.map(({ index, problem }) => [index, problem])).toEqual([
      [0, 'backtracking-risk'],
      [2, 'pcre-invalid']
    ]);
    expect(reading.warnings.map(({ index, problem }) => [index, problem])).toEqual([
      [1, 'match-all'],
      [3, 'match-all']
    ]);
  });

  it('blocks nothing on rows WP Rocket applies as given', () => {
    expect(featureRowReading('delay_js', 'pattern', ['a\\.js', 'b'])).toEqual({
      problems: [],
      warnings: []
    });
  });
});

describe('blocking vs warning', () => {
  it('warns only on rows the engine applies exactly as WP Rocket does', () => {
    expect([...NON_BLOCKING_PROBLEMS].sort()).toEqual(['joined-page-off', 'match-all']);
    const blocking = PROBLEM_IDS.filter((problem) => isBlockingProblem({ problem }));
    expect(blocking.sort()).toEqual([
      'backtracking-risk',
      'joined-changes-matching',
      'pcre-invalid',
      'pcre-only'
    ]);
    // An entry without an id (an empty row, a wire cap) always blocks.
    expect(isBlockingProblem({})).toBe(true);
  });

  it('throws only for the blocking entries, naming them all', () => {
    const entry = (index: number, problem?: 'match-all' | 'pcre-only') => ({
      feature: 'delay_js' as const,
      index,
      row: String(index),
      reason: 'r',
      ...(problem === undefined ? {} : { problem })
    });
    expect(() => {
      throwIfBlocking([entry(0, 'match-all')]);
    }).not.toThrow();
    expect(() => {
      throwIfBlocking([]);
    }).not.toThrow();
    try {
      throwIfBlocking([entry(0, 'match-all'), entry(1, 'pcre-only'), entry(2)]);
      expect.unreachable('blocking rows');
    } catch (error) {
      expect((error as ExclusionValidationError).invalid.map(({ index }) => index)).toEqual([1, 2]);
    }
    expect(
      matchAllRows([entry(0, 'match-all'), entry(1, 'pcre-only'), entry(3, 'match-all')])
    ).toEqual(['0', '3']);
  });
});
