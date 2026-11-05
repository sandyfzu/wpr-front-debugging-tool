/** Run preparation (compile once, all problems), style decisions, and the CSS build. */
import { describe, expect, it, vi } from 'vitest';
import { LAZY_RENDER_INLINE_CSS_ID } from '../wp-rocket/constants';
import { DEFAULT_RUCSS_TESTER_CONFIG, type RucssTesterConfig } from './config';
import {
  DEFAULT_INLINE_PRESERVES,
  RUCSS_RESULT_CSS_MAX_CHARS,
  RUCSS_RESULT_STYLE_ID,
  RUCSS_STRIP_SELECTOR,
  buildRucssCss,
  compilePattern,
  decideLinkStyle,
  decideRucssStyle,
  prepareRucssRun,
  type RucssRunPlan
} from './run-plan';

/** A configuration over the defaults. */
function config(overrides: Partial<RucssTesterConfig>): RucssTesterConfig {
  return { ...DEFAULT_RUCSS_TESTER_CONFIG, ...overrides };
}

/** Prepare a configuration that must be valid. */
function plan(overrides: Partial<RucssTesterConfig> = {}): RucssRunPlan {
  const result = prepareRucssRun(config(overrides));
  if (!result.ok) throw new Error(`unexpected problems: ${JSON.stringify(result.problems)}`);
  return result.plan;
}

describe('constants', () => {
  it('pin the result style id, the strip selector and the default markers', () => {
    expect(RUCSS_RESULT_STYLE_ID).toBe('rucss_test_result_style');
    expect(RUCSS_STRIP_SELECTOR).toBe('style,link[rel="stylesheet"]');
    expect(DEFAULT_INLINE_PRESERVES).toEqual([
      '#wpcb-quick-actions-menu',
      'wpr_rucss_style',
      'admin-bar.min.css',
      'dashicons.min.css',
      'rocket-lazyrender-inline-css'
    ]);
    // The lazy-render marker is WP Rocket's own id, read from its single declaring site.
    expect(DEFAULT_INLINE_PRESERVES).toContain(LAZY_RENDER_INLINE_CSS_ID);
  });
});

describe('compilePattern', () => {
  it('compiles with the given flags', () => {
    const result = compilePattern('a+', 'g');
    expect(result.ok && result.pattern.flags).toBe('g');
  });

  it('reports the engine message for a bad source', () => {
    const result = compilePattern('(', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Invalid regular expression/);
  });
});

describe('prepareRucssRun', () => {
  it('reads the defaults alone when every field is empty', () => {
    expect(plan()).toEqual({
      safelist: [],
      inlinePreserves: [...DEFAULT_INLINE_PRESERVES],
      excludeFilePatterns: [],
      prepend: '',
      append: '',
      replacements: [],
      mobile: false,
      home: false
    });
  });

  it('adds user preserve lines after the defaults (trimmed, deduped, defaults never lost)', () => {
    expect(
      plan({ inlinePreserve: ' mine \n\nwpr_rucss_style\nmine\r\nother' }).inlinePreserves
    ).toEqual([...DEFAULT_INLINE_PRESERVES, 'mine', 'other']);
  });

  it('parses the safelist as a line list and carries the flags and CSS text', () => {
    const prepared = plan({
      safelist: '.a, .b\n\n .c \n.a, .b',
      prepend: ' pre ',
      append: 'post\n',
      mobile: true,
      home: true
    });
    expect(prepared.safelist).toEqual(['.a, .b', '.c']);
    expect([prepared.prepend, prepared.append, prepared.mobile, prepared.home]).toEqual([
      ' pre ',
      'post\n',
      true,
      true
    ]);
  });

  it('compiles exclusion lines as raw, flagless patterns (a wildcard is plain regex)', () => {
    const prepared = plan({ excludeFiles: 'theme(.*)\\.css\n  style.css  ' });
    expect(
      prepared.excludeFilePatterns.map(({ line, pattern }) => [line, pattern.source, pattern.flags])
    ).toEqual([
      ['theme(.*)\\.css', 'theme(.*)\\.css', ''],
      ['style.css', 'style.css', '']
    ]);
  });

  it('compiles pairs as global patterns, skipping empty searches but keeping config indices', () => {
    const prepared = plan({
      replacements: [
        { search: '', replacement: 'unfinished' },
        { search: 'a', replacement: '' },
        { search: ' b ', replacement: 'c' }
      ]
    });
    expect(
      prepared.replacements.map((pair) => [
        pair.index,
        pair.pattern.source,
        pair.pattern.flags,
        pair.replacement
      ])
    ).toEqual([
      [1, 'a', 'g', ''],
      [2, ' b ', 'g', 'c']
    ]);
  });

  it('refuses the run with every invalid pattern, exclusions first', () => {
    const result = prepareRucssRun(
      config({
        excludeFiles: 'ok\n*.css\n(',
        replacements: [
          { search: '[', replacement: 'x' },
          { search: 'fine', replacement: 'x' },
          { search: '+', replacement: 'x' }
        ]
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.problems.map((problem) =>
        problem.kind === 'exclude-pattern' ? problem.line : problem.index
      )
    ).toEqual(['*.css', '(', 0, 2]);
    expect(result.problems[2]).toMatchObject({ kind: 'replacement-pattern', search: '[' });
    for (const problem of result.problems) expect(problem.message).not.toBe('');
  });
});

describe('decideRucssStyle', () => {
  const prepared = plan({ inlinePreserve: 'keep-me', excludeFiles: 'fonts\\.css$\nTheme' });

  it('removes a plain inline style', () => {
    expect(
      decideRucssStyle({ kind: 'inline', id: 'x', markup: '<style id="x">a{}</style>' }, prepared)
    ).toBe('remove');
  });

  it('preserves an inline style whose markup holds a default or user marker (id, attribute or content)', () => {
    for (const markup of [
      '<style id="rocket-lazyrender-inline-css">x{}</style>',
      '<style data-x="keep-me"></style>',
      '<style>/* keep-me */</style>',
      '<style>@import "dashicons.min.css";</style>'
    ]) {
      expect(decideRucssStyle({ kind: 'inline', id: '', markup }, prepared)).toBe('preserved');
    }
  });

  it('always removes WP Rocket used CSS, even when its markup holds a marker', () => {
    expect(
      decideRucssStyle(
        {
          kind: 'inline',
          id: 'wpr-usedcss',
          markup: '<style id="wpr-usedcss">keep-me wpr_rucss_style</style>'
        },
        prepared
      )
    ).toBe('remove');
  });

  it('keeps a stylesheet whose URL matches an exclusion pattern (case-sensitive), removes the rest', () => {
    expect(decideRucssStyle({ kind: 'link', href: 'https://a.test/fonts.css' }, prepared)).toBe(
      'excluded'
    );
    expect(decideRucssStyle({ kind: 'link', href: 'https://a.test/Theme/x.css' }, prepared)).toBe(
      'excluded'
    );
    expect(decideRucssStyle({ kind: 'link', href: 'https://a.test/theme/x.css' }, prepared)).toBe(
      'remove'
    );
    expect(decideRucssStyle({ kind: 'link', href: 'https://a.test/fonts.css?v=1' }, prepared)).toBe(
      'remove'
    );
  });

  it('never preserves a stylesheet by inline marker, and removes a link without URL', () => {
    const markers = plan({ inlinePreserve: 'admin-bar', excludeFiles: '.*' });
    expect(decideRucssStyle({ kind: 'link', href: '' }, markers)).toBe('remove');
    expect(
      decideRucssStyle({ kind: 'link', href: 'https://a.test/admin-bar.min.css' }, plan())
    ).toBe('remove');
  });
});

describe('decideLinkStyle', () => {
  it('names the exclusion line whose pattern the engine gives up on, trying none after it', () => {
    const boom = /boom/;
    vi.spyOn(boom, 'test').mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });
    const afterPattern = /after/;
    const after = vi.spyOn(afterPattern, 'test');
    const exclusions = [
      { line: 'never', pattern: /never/ },
      { line: 'boom', pattern: boom },
      { line: 'after', pattern: afterPattern }
    ];
    expect(decideLinkStyle('https://a.test/x.css', exclusions)).toEqual({
      ok: false,
      problem: 'exclusion-failed',
      line: 'boom',
      message: 'Maximum call stack size exceeded'
    });
    expect(after).not.toHaveBeenCalled();
    // A link without a URL never runs a pattern.
    expect(decideLinkStyle('', exclusions)).toBe('remove');
  });
});

describe('buildRucssCss', () => {
  it('wraps the CSS in prepend and append (replacements never touch them)', () => {
    const result = buildRucssCss(
      'a{}',
      plan({
        prepend: 'a/*p*/',
        append: '/*a*/a',
        replacements: [{ search: 'a', replacement: 'b' }]
      })
    );
    expect(result).toEqual({ ok: true, css: 'a/*p*/b{}/*a*/a', applied: [{ index: 0, count: 1 }] });
  });

  it('applies pairs in order, each on the previous output, with per-pair counts', () => {
    const result = buildRucssCss(
      'red red blue',
      plan({
        replacements: [
          { search: 'red', replacement: 'blue' },
          { search: 'blue', replacement: 'green' },
          { search: 'zzz', replacement: 'x' }
        ]
      })
    );
    expect(result).toEqual({
      ok: true,
      css: 'green green green',
      applied: [
        { index: 0, count: 2 },
        { index: 1, count: 3 },
        { index: 2, count: 0 }
      ]
    });
  });

  it('honors substitution patterns and empty replacements', () => {
    const result = buildRucssCss(
      'url(a.png) url(b.png) /*x*/',
      plan({
        replacements: [
          { search: 'url\\((\\w+)\\.png\\)', replacement: 'url($1.webp)' },
          { search: '/\\*x\\*/', replacement: '' }
        ]
      })
    );
    expect(result.ok && result.css).toBe('url(a.webp) url(b.webp) ');
  });

  it('counts empty matches the way replace substitutes them', () => {
    const result = buildRucssCss(
      'ab',
      plan({ replacements: [{ search: 'x*', replacement: '-' }] })
    );
    expect(result).toEqual({ ok: true, css: '-a-b-', applied: [{ index: 0, count: 3 }] });
  });

  it('is repeatable with the same plan (global pattern state never leaks)', () => {
    const prepared = plan({ replacements: [{ search: 'a', replacement: 'b' }] });
    expect(buildRucssCss('aa', prepared)).toEqual(buildRucssCss('aa', prepared));
  });

  it('returns the CSS untouched with no pairs', () => {
    expect(buildRucssCss('', plan())).toEqual({ ok: true, css: '', applied: [] });
  });

  it('refuses a pair whose output passes the cap, naming it', () => {
    // Exactly at the cap; the second pair adds one character.
    const atCap = `x${'z'.repeat(RUCSS_RESULT_CSS_MAX_CHARS - 1)}`;
    const result = buildRucssCss(
      atCap,
      plan({
        replacements: [
          { search: 'q', replacement: '' },
          { search: 'x', replacement: 'yy' }
        ]
      })
    );
    expect(result).toEqual({ ok: false, problem: 'oversize', index: 1 });
  });

  it('refuses prepend + CSS + append past the cap', () => {
    const css = 'x'.repeat(RUCSS_RESULT_CSS_MAX_CHARS);
    expect(buildRucssCss(css, plan({ append: 'y' }))).toEqual({ ok: false, problem: 'oversize' });
    expect(buildRucssCss(css, plan()).ok).toBe(true);
  });

  it('counts the cap against a custom limit too (exact for a $-free template)', () => {
    const pairs = plan({ replacements: [{ search: 'a', replacement: 'bb' }] });
    // 'aaa' → 'bbbbbb' (6): at the cap passes, one under refuses.
    expect(buildRucssCss('aaa', pairs, 6)).toEqual({
      ok: true,
      css: 'bbbbbb',
      applied: [{ index: 0, count: 3 }]
    });
    expect(buildRucssCss('aaa', pairs, 5)).toEqual({ ok: false, problem: 'oversize', index: 0 });
  });

  it('refuses a shrinking pair never (the bound subtracts what each match removes)', () => {
    const pairs = plan({ replacements: [{ search: 'abc', replacement: '' }] });
    expect(buildRucssCss('abcabcx', pairs, 7)).toEqual({
      ok: true,
      css: 'x',
      applied: [{ index: 0, count: 2 }]
    });
  });

  it('refuses before building the output, so a huge expansion never allocates', () => {
    // Native replace would build 1 MiB × 1 MiB characters (past the engine's string limit).
    const css = 'a'.repeat(1024 * 1024);
    const started = performance.now();
    const result = buildRucssCss(
      css,
      plan({ replacements: [{ search: 'a', replacement: 'x'.repeat(1024 * 1024) }] })
    );
    expect(result).toEqual({ ok: false, problem: 'oversize', index: 0 });
    // Counting only: far below the time a 1 Ti-character build would take.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it.each([
    ['$&$&', 'ab', 'abab'],
    ['[$`]', 'ab', '[x]'],
    ["[$']", 'ab', '[y]'],
    ['$$&', 'ab', '$&'],
    ['$$$&', 'ab', '$ab'],
    ['a$x$', 'ab', 'a$x$']
  ])(
    'measures the %s template exactly (fits at its length, refused one under)',
    (template, search, out) => {
      const css = 'xaby';
      const expected = css.replace(new RegExp(search, 'g'), template);
      expect(expected).toBe(`x${out}y`);
      const pairs = plan({ replacements: [{ search, replacement: template }] });
      expect(buildRucssCss(css, pairs, expected.length)).toEqual({
        ok: true,
        css: expected,
        applied: [{ index: 0, count: 1 }]
      });
      expect(buildRucssCss(css, pairs, expected.length - 1)).toEqual({
        ok: false,
        problem: 'oversize',
        index: 0
      });
    }
  );

  it.each([
    ['$1$1', '(a)b', 'aa'],
    ['$<g>$<g>', '(?<g>a)b', 'aa'],
    ['$9', '(a)b', '$9'],
    ['$<g>', 'ab', '$<g>'],
    ['$2', '(a)|(b)', '']
  ])(
    'bounds the capture template %s from above (literal fallback included)',
    (template, search, out) => {
      const css = 'xaby';
      const expected = css.replace(new RegExp(search, 'g'), template);
      expect(expected.startsWith(`x${out}`)).toBe(true);
      const pairs = plan({ replacements: [{ search, replacement: template }] });
      // Never accepted past the cap; accepted once the cap leaves the bound's slack.
      expect(buildRucssCss(css, pairs, expected.length - 1).ok).toBe(false);
      expect(buildRucssCss(css, pairs, expected.length + 8)).toMatchObject({
        ok: true,
        css: expected
      });
    }
  );

  it('keeps the post-build check as a backstop when the output outgrows the measure', () => {
    /** A pattern that matches nothing yet replaces with long text (a bound defect stand-in). */
    class GrowingPattern extends RegExp {
      override [Symbol.replace](): string {
        return 'z'.repeat(11);
      }
    }
    const grown = plan();
    const result = buildRucssCss(
      'a',
      {
        ...grown,
        replacements: [{ index: 3, pattern: new GrowingPattern('q', 'g'), replacement: '' }]
      },
      10
    );
    expect(result).toEqual({ ok: false, problem: 'oversize', index: 3 });
  });

  it.each([
    ['counting', Symbol.matchAll],
    ['replacing', Symbol.replace]
  ] as const)(
    'reports an engine failure while %s as pattern-failed, naming the pair',
    (_, hook) => {
      // The engine throws this on a backtracking stack overflow (e.g. `((a|b))*$` over a few MiB).
      const failing = new RegExp('a', 'g');
      Object.defineProperty(failing, hook, {
        value: () => {
          throw new RangeError('Maximum call stack size exceeded');
        }
      });
      const result = buildRucssCss('a', {
        ...plan(),
        replacements: [{ index: 2, pattern: failing, replacement: 'b' }]
      });
      expect(result).toEqual({
        ok: false,
        problem: 'pattern-failed',
        index: 2,
        message: 'Maximum call stack size exceeded'
      });
    }
  );

  it('reports a non-Error throw by its string form', () => {
    const failing = new RegExp('a', 'g');
    Object.defineProperty(failing, Symbol.replace, {
      value: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the non-Error branch under test
        throw 'engine gave up';
      }
    });
    expect(
      buildRucssCss('a', {
        ...plan(),
        replacements: [{ index: 0, pattern: failing, replacement: '' }]
      })
    ).toEqual({ ok: false, problem: 'pattern-failed', index: 0, message: 'engine gave up' });
  });
});
