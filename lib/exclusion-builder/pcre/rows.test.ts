import { describe, expect, it } from 'vitest';
import { BACKTRACKING_RISK_REASONS } from '../regex-risk';
import { compileMatcher, regexRowProblems, translateRegexRows } from './rows';

/** The problem id per row (`null` = none). */
function problemIds(
  feature: 'delay_js' | 'defer_all_js',
  rows: readonly string[]
): (string | null)[] {
  return translateRegexRows(feature, rows).rows.map((row) => row.problem?.problem ?? null);
}

describe('translateRegexRows', () => {
  it('translates clean rows into flagless matchers, with no problem', () => {
    const result = translateRegexRows('delay_js', ['jquery', 'a+b']);
    expect(result.page).toBe('on');
    expect(result.rows).toEqual([
      { row: 'jquery', matcher: { source: '[Jj][Qq][Uu][Ee][Rr][Yy]', flags: '' }, problem: null },
      { row: 'a+b', matcher: { source: '[Aa]\\x2b[Bb]', flags: '' }, problem: null }
    ]);
  });

  it('returns no rows for an empty set', () => {
    expect(translateRegexRows('defer_all_js', [])).toEqual({ rows: [], page: 'on' });
  });

  it('compiles a matcher that encodes the subject itself', () => {
    const [row] = translateRegexRows('defer_all_js', ['^/.\\.js$']).rows;
    if (row?.matcher == null) throw new Error('no matcher');
    const test = compileMatcher(row.matcher);
    // `é` is two bytes: PCRE's `.` (no UTF) sees one of them.
    expect([test('/a.js'), test('/é.js'), test('/A.JS')]).toEqual([true, false, true]);
  });

  it('keeps the matcher of a match-all row (it really matches everything)', () => {
    const [row] = translateRegexRows('defer_all_js', ['zzz|']).rows;
    expect(row?.problem?.problem).toBe('match-all');
    expect(row?.problem?.reason).toBe('WP Rocket stores this and it excludes every script');
    expect(row?.matcher).not.toBeNull();
  });

  it('withholds the matcher of PCRE-only, rejected and risky rows', () => {
    const rows = translateRegexRows('defer_all_js', ['(?>a)', '(', '(a+)+$']).rows;
    expect(rows.map((row) => [row.problem?.problem, row.matcher])).toEqual([
      ['pcre-only', null],
      ['pcre-invalid', null],
      ['backtracking-risk', null]
    ]);
  });

  it('names the construct and the cause in each reason', () => {
    const [invalid, only, risky] = translateRegexRows('delay_js', [
      '\\i',
      '\\p{L}',
      '(a{1,}){1,}$'
    ]).rows;
    expect(invalid?.problem).toEqual({
      problem: 'pcre-invalid',
      construct: '\\i',
      reason:
        'WP Rocket drops this row when saving: PCRE rejects `\\i` (unrecognized escape \\i); added through a filter, it never matches'
    });
    expect(only?.problem).toEqual({
      problem: 'pcre-only',
      construct: '\\p{L}',
      reason:
        'PCRE-only syntax: `\\p{L}` (Unicode property) — not checked here, and WP Rocket may drop this row when saving'
    });
    expect(risky?.problem).toEqual({
      problem: 'backtracking-risk',
      construct: null,
      reason: BACKTRACKING_RISK_REASONS['nested-repetition']
    });
  });

  it('words a Defer row WP Rocket drops by its live effect', () => {
    const [row] = translateRegexRows('defer_all_js', ['(']).rows;
    expect(row?.problem?.reason).toBe(
      'WP Rocket drops this row when saving: PCRE rejects `(` (missing closing parenthesis); added through a filter, it turns Defer JS off on the page'
    );
  });

  it('claims nothing about storing a row whose save is not modeled', () => {
    // Subroutine calls can recurse forever: `(?+1)(x)` is not modeled (WP Rocket keeps it,
    // and Delay's `+` escape then breaks it at runtime).
    const [row] = translateRegexRows('delay_js', ['(?+1)(x)']).rows;
    expect(row?.problem).toMatchObject({ problem: 'pcre-only', construct: '(?+1)' });
    // `(?R)*?` would match every script, but PHP drops it at save: no `match-all`
    // claim. (`[\E]*?` is modeled: `\E` vanishes, so the class never closes.)
    expect(problemIds('defer_all_js', ['(?R)*?', '[\\E]*?'])).toEqual([
      'pcre-only',
      'pcre-invalid'
    ]);
  });

  it('reports a too-long row in terms of the row', () => {
    const [long, nested] = translateRegexRows('defer_all_js', [
      'a'.repeat(9000),
      'a'.repeat(1500)
    ]).rows;
    expect(long?.problem?.reason).toBe('This row is not checked here (longer than 8192 bytes)');
    // 1 500 letters fit, but their translation (`[Aa]` each) is past the backtracking guard's cap.
    expect(nested?.problem?.reason).toBe(
      'This row is too long or too deeply nested to check for slow matching — shorten it'
    );
  });

  it('reports one problem per row, the most decisive', () => {
    // `(?a)` is PCRE-only syntax but matches every script: match-all wins.
    expect(problemIds('defer_all_js', ['(?a)'])).toEqual(['match-all']);
    // `\.*` both matches everything and joins fine.
    expect(problemIds('defer_all_js', ['\\.*'])).toEqual(['match-all']);
    // A save rejection wins over everything.
    expect(problemIds('defer_all_js', ['(?>a)('])).toEqual(['pcre-invalid']);
  });
});

describe('Defer JS joined checks', () => {
  it.each([
    [['dummy-string'], [true]],
    [
      ['.*', 'zzz'],
      [true, false]
    ],
    [
      ['dummy', '-string'],
      [true, true]
    ],
    [
      ['[a-z]+', '-'],
      [true, true]
    ],
    [
      ['x*', '[^q]'],
      [false, true]
    ],
    [['\\G.'], [true]],
    [['DUMMY-STRING'], [true]],
    [['^.*$'], [true]],
    [['.{12}'], [true]],
    [['(?=d).*'], [true]],
    [['\\bdummy-string\\b'], [true]],
    [['dummy-s(?<n>tring)'], [true]]
  ])('%j consumes all of dummy-string: WP Rocket defers nothing', (rows, off) => {
    const result = translateRegexRows('defer_all_js', rows);
    expect(result.page).toBe('off');
    expect(result.rows.map((row) => row.problem?.problem === 'joined-page-off')).toEqual(off);
  });

  it.each([
    ['dummy'],
    ['-'],
    ['d\\K.*'],
    ['\\G[a-z]'],
    ['[^-]+'],
    ['\\w*'],
    ['y?'],
    ['\\K'],
    ['zzz|'],
    ['.{13}']
  ])('%s leaves part of dummy-string: the pre-check passes', (row) => {
    expect(translateRegexRows('defer_all_js', [row]).page).toBe('on');
  });

  it('turns the page off when two rows declare the same group name', () => {
    expect(problemIds('defer_all_js', ["(?'n'a)x", "(?'n'b)y", 'c'])).toEqual([
      'joined-page-off',
      'joined-page-off',
      null
    ]);
    expect(translateRegexRows('defer_all_js', ['(?<n>a)x', '(?P<n>b)y']).page).toBe('off');
  });

  it.each([
    // Observed in PHP: a later `(?J)` or a branch reset licenses nothing across rows.
    [['(?<n>a)', '(?<n>b)', '(?|x)'], 'off'],
    [['(?<n>a)', '(?<n>b)', '(?J)x'], 'off'],
    [['(?|(?<n>a)|(?<n>b))', '(?<n>c)'], 'off'],
    // `J` left on at a row's top level leaks forward through the wrapper group.
    [['(?<n>a)', '(?J)x', '(?<n>b)'], 'on'],
    [['(?J)(?<n>a)', '(?<n>b)'], 'on'],
    [['(?J:(?<n>a))', '(?<n>b)'], 'off'],
    [['(?J)(?<n>a)', '(?-J)(?<n>b)'], 'off']
  ])('%j: repeated names → page %s', (rows, page) => {
    expect(translateRegexRows('defer_all_js', rows).page).toBe(page);
  });

  it('turns the page off for a row whose \\Q quotes the joined wrapper', () => {
    expect(problemIds('defer_all_js', ['a\\Qb', 'c'])).toEqual(['joined-page-off', null]);
    // Delay tests rows alone: an open \Q is harmless there.
    expect(problemIds('delay_js', ['a\\Qb'])).toEqual([null]);
  });

  it('turns the page off for a stored row PCRE rejects, and checks the kept rows', () => {
    // Fixture `match-defer-bad-row`: a filter-delivered `(` breaks the joined pattern.
    expect(translateRegexRows('defer_all_js', ['(', 'a.js'])).toMatchObject({
      page: 'off',
      rows: [{ problem: { problem: 'pcre-invalid' } }, { problem: null }]
    });
    expect(problemIds('defer_all_js', ['(', 'dummy-string'])).toEqual([
      'pcre-invalid',
      'joined-page-off'
    ]);
    expect(problemIds('defer_all_js', ['(?<n>a)', '(?<n>b)', '('])).toEqual([
      'joined-page-off',
      'joined-page-off',
      'pcre-invalid'
    ]);
  });

  it('says unknown when a row cannot be replayed exactly', () => {
    for (const rows of [
      ['(?>x)', '.*'],
      ['(a+)+$', 'zzz'],
      ['(a)\\1', 'zzz'],
      ['(?-i)zzz', 'a'],
      ['(?R)', 'a']
    ]) {
      expect({ rows, page: translateRegexRows('defer_all_js', rows).page }).toEqual({
        rows,
        page: 'unknown'
      });
    }
    // Off evidence still wins over an unknown row.
    expect(translateRegexRows('defer_all_js', ['(?>x)', '(?<n>a)', '(?<n>b)']).page).toBe('off');
  });

  it('flags an unscoped option leaking into later rows, not from the last row', () => {
    expect(problemIds('defer_all_js', ['(?-i)zzz', 'A.JS'])).toEqual([
      'joined-changes-matching',
      null
    ]);
    expect(problemIds('defer_all_js', ['A.JS', '(?-i)zzz'])).toEqual([null, 'pcre-only']);
    // A bare `(?i)` changes nothing: Defer already matches caselessly.
    expect(problemIds('defer_all_js', ['(?i)a', 'b'])).toEqual([null, null]);
    // Inside a group the option ends with the group.
    expect(problemIds('defer_all_js', ['(a(?s)b)', 'c'])).toEqual(['pcre-only', null]);
  });

  it('flags numbered back-references, which count the joined wrapper group', () => {
    expect(problemIds('defer_all_js', ['(a)\\1'])).toEqual(['joined-changes-matching']);
    expect(problemIds('defer_all_js', ['(a)\\g1'])).toEqual(['joined-changes-matching']);
    // Relative references are unaffected.
    expect(problemIds('defer_all_js', ['(a)\\g{-1}'])).toEqual([null]);
    // PCRE-only syntax outranks it.
    expect(problemIds('defer_all_js', ['(?|(a)|(b))\\1'])).toEqual(['pcre-only']);
  });

  it('runs no joined check on Delay JS rows (each runs alone)', () => {
    expect(problemIds('delay_js', ['(a)\\1', '(?-i)zzz', 'b'])).toEqual([null, 'pcre-only', null]);
    expect(translateRegexRows('delay_js', ['.*', '(?<n>a)', '(?<n>b)']).page).toBe('on');
  });

  it('reasons name the joined effect', () => {
    const [leak] = translateRegexRows('defer_all_js', ['(?s)a', 'b']).rows;
    expect(leak?.problem).toEqual({
      problem: 'joined-changes-matching',
      construct: '(?s)',
      reason:
        'Joined with the other Defer JS rows, `(?s)` (option setting) matches differently on WP Rocket'
    });
    const [off] = translateRegexRows('defer_all_js', ['.*']).rows;
    expect(off?.problem?.reason).toBe(
      'Joined with the other rows, WP Rocket’s Defer JS check fails on this row: it would defer no script on the page'
    );
  });
});

describe('Defer JS rows the save drops, joined', () => {
  // Each page verified against `preg_replace('#(r1|r2…)#i', '', 'dummy-string')`
  // on PCRE2 10.49 and 10.44 (identical).
  it.each([
    // A missing group: joined, `\1`/`\g1`/`(?-1)` find the wrapper group → PHP: on.
    [['\\g1'], 'unknown'],
    [['0', '\\1', 'string'], 'unknown'],
    [['_(?-1)'], 'unknown'],
    // Parentheses the other rows balance → PHP: on.
    [['(', ')'], 'unknown'],
    [['a)(b'], 'unknown'],
    // A construct open at the row's end, completed by what follows → PHP: on.
    [['x\\', '*'], 'unknown'],
    [['[a', 'b]'], 'unknown'],
    [['.)\\Q{1, 2}'], 'unknown'],
    // A repeated name after an earlier row's `J` → PHP: on.
    [['(?J)x', '(?<n>a)(?<n>b)'], 'unknown'],
    // An open `\\Q` a later row's `\\E` closes → PHP: on.
    [['a\\Qb', 'c\\E'], 'unknown'],
    [['a\\Qb', 'x', 'c\\E'], 'unknown'],
    [['\\Qdummy-string', '\\E'], 'unknown'],
    [['a\\Qb', '\\\\E'], 'unknown'],
    // …and one nothing closes → PHP: off.
    [['a\\Qb', 'c'], 'off'],
    [['\\Q', 'x'], 'off'],
    // Errors no join repairs → PHP: off.
    [['(', 'a.js'], 'off'],
    [['*', 'x\\'], 'off'],
    [['(?<n>a)(?<n>b)'], 'off'],
    [['a{2}{2}', 'x'], 'off'],
    [['x(?<=x(?:)*)'], 'off']
  ])('%j → page %s', (rows, page) => {
    expect(translateRegexRows('defer_all_js', rows).page).toBe(page);
  });

  it('still flags the kept rows behind an off page', () => {
    expect(problemIds('defer_all_js', ['(', 'dummy-string'])).toEqual([
      'pcre-invalid',
      'joined-page-off'
    ]);
  });

  it('withholds the matcher of a row that matches differently joined', () => {
    const [row] = translateRegexRows('defer_all_js', ['(a)\\1']).rows;
    expect(row).toMatchObject({ problem: { problem: 'joined-changes-matching' }, matcher: null });
    // Delay runs it alone: its matcher is exact there.
    expect(translateRegexRows('delay_js', ['(a)\\1']).rows[0]?.matcher).not.toBeNull();
  });
});

describe('work bounds', () => {
  it('does not check rows past the set byte budget, and says so', () => {
    const big = 'a'.repeat(8000);
    const rows = Array.from({ length: 70 }, () => big);
    const result = translateRegexRows('defer_all_js', rows);
    expect(result.page).toBe('unknown');
    expect(result.rows.at(-1)?.problem).toEqual({
      problem: 'pcre-only',
      construct: null,
      reason: 'This row is not checked here (past the 524288-byte set budget)'
    });
    // An over-long row is rejected before being encoded.
    expect(translateRegexRows('delay_js', ['é'.repeat(9000)]).rows[0]?.problem?.reason).toBe(
      'This row is not checked here (longer than 8192 bytes)'
    );
  });

  it('answers unknown once the dummy-string replay passes its execution budget', () => {
    // Each row only ever matches empty: the non-empty retry tries every row at
    // every position — 13 × 16 000 executions, past the 200 000 budget.
    const rows: string[] = Array.from({ length: 16_000 }, () => 'x*');
    expect(translateRegexRows('defer_all_js', rows).page).toBe('unknown');
  });

  it('smoke: a wire-cap-sized set (500 rows, 64 KiB) translates far inside the prevalidation bound', () => {
    // Wall clock is not the gate (the byte and execution bounds are): this only
    // catches a gross regression. Measured ≈ 20–40 ms on the development machine.
    const rows = Array.from({ length: 500 }, (_, i) =>
      `é${String(i)}`.padEnd(131, 'éàü€[a-z]x*').slice(0, 131)
    );
    const started = performance.now();
    translateRegexRows('defer_all_js', rows);
    translateRegexRows('delay_js', rows);
    expect(performance.now() - started).toBeLessThan(1_600);
  });
});

describe('regexRowProblems', () => {
  it('lists every row with a problem as a validation entry carrying its id', () => {
    expect(regexRowProblems('defer_all_js', ['a.js', '(?>a)', ''])).toEqual([
      {
        feature: 'defer_all_js',
        index: 1,
        row: '(?>a)',
        reason: 'PCRE-only syntax: `(?>` (atomic group) — not checked here',
        problem: 'pcre-only'
      },
      {
        feature: 'defer_all_js',
        index: 2,
        row: '',
        reason: 'WP Rocket stores this and it excludes every script',
        problem: 'match-all'
      }
    ]);
  });

  it('is empty for clean rows', () => {
    expect(regexRowProblems('delay_js', ['jquery', 'a\\.js'])).toEqual([]);
  });
});
