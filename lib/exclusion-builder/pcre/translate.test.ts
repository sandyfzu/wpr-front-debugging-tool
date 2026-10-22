import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeRow, emitRow, isEmitted, saveRejection, toByteString } from './translate';

const D = 'delay_js';
const F = 'defer_all_js';

/**
 * Translation equality per PCRE↔JS construct: `[feature, stored row,
 * [[subject, preg_match result]]]`. Every expected boolean was produced by
 * the real `preg_match('#' . escaped . '#i', subject)` on PHP 8.1.34 /
 * PCRE2 10.49 and re-checked on PHP 8.4.27 / PCRE2 10.44 (identical).
 */
const MATCH_CASES: readonly (readonly [
  typeof D | typeof F,
  string,
  readonly (readonly [string, boolean])[]
])[] = [
  [
    D,
    'a#b',
    [
      ['a#b', true],
      ['ab', false]
    ]
  ],
  [
    F,
    'a#b',
    [
      ['a#b', true],
      ['ab', false]
    ]
  ],
  [
    D,
    'a+b',
    [
      ['a+b', true],
      ['aab', false]
    ]
  ],
  [
    F,
    'a+b',
    [
      ['a+b', false],
      ['aab', true]
    ]
  ],
  [
    D,
    'a\\+b',
    [
      ['a\\b', true],
      ['a\\\\b', true],
      ['a+b', false]
    ]
  ],
  [
    D,
    'x.js?ver=1',
    [
      ['x.js?ver=1', true],
      ['x.jver=1', false]
    ]
  ],
  [
    D,
    'x\\?ver',
    [
      ['x\\ver', true],
      ['x\\\\ver', false],
      ['x?ver', false]
    ]
  ],
  [
    D,
    'x.js?VER=1',
    [
      ['x.jsVER=1', true],
      ['x.js?VER=1', false],
      ['x.jVER=1', true]
    ]
  ],
  [
    D,
    'a++',
    [
      ['a++', true],
      ['aa', false]
    ]
  ],
  [
    D,
    'SCRIPT\\s+defer',
    [
      ['<script defer', false],
      ['<script +defer', true]
    ]
  ],
  [
    D,
    'été',
    [
      ['ÉTÉ', false],
      ['éTé', true],
      ['ÉtÉ', false]
    ]
  ],
  [
    F,
    'FOO',
    [
      ['foo', true],
      ['FoO', true]
    ]
  ],
  [
    F,
    'k',
    [
      ['K', true],
      ['\u212a', false]
    ]
  ],
  [
    F,
    's',
    [
      ['\u017f', false],
      ['S', true]
    ]
  ],
  [
    F,
    '^a.b$',
    [
      ['aéb', false],
      ['axb', true]
    ]
  ],
  [F, '^a..b$', [['aéb', true]]],
  [F, '^é{2}$', [['éé', false]]],
  [F, '^[é]$', [['é', false]]],
  [
    F,
    '[é]',
    [
      ['é', true],
      ['e', false]
    ]
  ],
  [
    F,
    '^[^x]$',
    [
      ['é', false],
      ['y', true]
    ]
  ],
  [F, '^.$', [['😀', false]]],
  [F, '^....$', [['😀', true]]],
  [F, '^[à-ÿ]$', [['é', false]]],
  [
    F,
    '[à-ÿ]',
    [
      ['é', true],
      ['z', false]
    ]
  ],
  [
    F,
    '^[a-é]+$',
    [
      ['abc', true],
      ['é', true]
    ]
  ],
  [
    F,
    '\\xE9',
    [
      ['é', false],
      ['É', false]
    ]
  ],
  [F, '\\xC3\\xA9', [['é', true]]],
  [F, '\\x{e9}', [['é', false]]],
  [
    F,
    'a.b',
    [
      ['a\rb', true],
      ['a\nb', false]
    ]
  ],
  [F, 'a...b', [['a\u2028b', true]]],
  [
    F,
    'ab$',
    [
      ['ab\n', true],
      ['ab\n\n', false],
      ['ab', true]
    ]
  ],
  [
    F,
    'ab\\z',
    [
      ['ab\n', false],
      ['ab', true]
    ]
  ],
  [
    F,
    'ab\\Z',
    [
      ['ab\n', true],
      ['ab\n\n', false]
    ]
  ],
  [
    F,
    'a\\sb',
    [
      ['a\u00a0b', false],
      ['a\u000bb', true],
      ['a\fb', true]
    ]
  ],
  [F, 'a.\\sb', [['a\u00a0b', false]]],
  [
    F,
    'a\\hb',
    [
      ['a b', true],
      ['a\u00a0b', false],
      ['a\tb', true]
    ]
  ],
  [F, 'a.\\hb', [['a\u00a0b', true]]],
  [
    F,
    'a\\vb',
    [
      ['a\nb', true],
      ['a\u000bb', true],
      ['a b', false]
    ]
  ],
  [F, 'a.\\vb', [['a\u0085b', true]]],
  [
    F,
    '^a\\Rb$',
    [
      ['a\r\nb', true],
      ['a\rb', true],
      ['a\nb', true],
      ['a\r\n\nb', false]
    ]
  ],
  [F, '^\\R\\n$', [['\r\n', false]]],
  [
    F,
    '\\A/a',
    [
      ['/a', true],
      ['x/a', false],
      ['A/a', false]
    ]
  ],
  [
    F,
    '\\G/a',
    [
      ['/a', true],
      ['x/a', false]
    ]
  ],
  [
    F,
    '\\Q/a.b\\E',
    [
      ['/a.b', true],
      ['/axb', false]
    ]
  ],
  [
    F,
    '\\Qa\\E+',
    [
      ['aaa', true],
      ['b', false]
    ]
  ],
  [F, 'a\\eb', [['a\u001bb', true]]],
  [F, 'a\\cIb', [['a\tb', true]]],
  [F, 'a\\cab', [['a\u0001b', true]]],
  [
    F,
    '/\\101\\.js',
    [
      ['/a.js', true],
      ['/A.js', true]
    ]
  ],
  [F, '/\\x41\\.js', [['/a.js', true]]],
  [
    F,
    '\\0',
    [
      ['\u0000', true],
      ['0', false]
    ]
  ],
  [F, '\\o{101}', [['a', true]]],
  [
    F,
    '^[[:alpha:]]+$',
    [
      ['abC', true],
      ['ab1', false]
    ]
  ],
  [
    F,
    '^[[:^digit:]]$',
    [
      ['a', true],
      ['1', false]
    ]
  ],
  [F, '^[[:lower:]]$', [['A', true]]],
  [
    F,
    '^[^[:lower:]]$',
    [
      ['A', false],
      ['1', true]
    ]
  ],
  [
    F,
    '^[]a]$',
    [
      [']', true],
      ['a', true],
      ['b', false]
    ]
  ],
  [
    F,
    '^[^]a]$',
    [
      ['b', true],
      [']', false],
      ['A', false]
    ]
  ],
  [
    F,
    '^a{,2}$',
    [
      ['aa', true],
      ['', true],
      ['a{,2}', false]
    ]
  ],
  [F, '^a{x}$', [['a{x}', true]]],
  [
    F,
    'a\\Nb',
    [
      ['axb', true],
      ['a\nb', false]
    ]
  ],
  [F, 'a\\Kb', [['ab', true]]],
  [
    F,
    '(a)\\g{-1}',
    [
      ['aA', true],
      ['ab', false]
    ]
  ],
  [
    D,
    '(a)\\1',
    [
      ['aA', true],
      ['aa', true],
      ['ab', false]
    ]
  ],
  [D, '(?<n>x)\\1', [['xX', true]]],
  [F, '(?i)/A\\.JS', [['/a.js', true]]],
  [F, '(?i:A)b', [['aB', true]]],
  [
    F,
    'a(?=b)',
    [
      ['ab', true],
      ['ac', false]
    ]
  ],
  [
    F,
    'a(?!b)',
    [
      ['ab', false],
      ['ac', true]
    ]
  ],
  [
    F,
    '(?<=a)b',
    [
      ['ab', true],
      ['cb', false]
    ]
  ],
  [
    F,
    '(?<!a)b',
    [
      ['ab', false],
      ['cb', true]
    ]
  ],
  [
    F,
    '\\bfoo\\b',
    [
      ['a foo b', true],
      ['afoob', false],
      ['é foo', true]
    ]
  ],
  [
    F,
    'a\\Bb',
    [
      ['ab', true],
      ['a b', false]
    ]
  ],
  [
    F,
    'a\\.',
    [
      ['a.', true],
      ['ab', false]
    ]
  ],
  [F, '\\é', [['é', true]]],
  [F, 'a*?b', [['aab', true]]],
  [
    F,
    '^a{2,3}?$',
    [
      ['aaa', true],
      ['a', false]
    ]
  ],
  [F, 'a|', [['zzz', true]]],
  [
    F,
    '^/(?:\\d+|x)\\.js$',
    [
      ['/12.js', true],
      ['/x.js', true],
      ['/a.js', false]
    ]
  ],
  [
    D,
    'foo(.*)bar',
    [
      ['foo\nbar', false],
      ['foo x bar', true]
    ]
  ]
];

describe('emitRow: JS over the byte string matches exactly when PCRE does', () => {
  it.each(MATCH_CASES)('%s %j', (feature, row, subjects) => {
    const emitted = emitRow(feature, row);
    if (!isEmitted(emitted)) throw new Error(`not translated: ${emitted.detail}`);
    const regex = new RegExp(emitted.source);
    for (const [subject, expected] of subjects) {
      expect({ subject, matched: regex.test(toByteString(subject)) }).toEqual({
        subject,
        matched: expected
      });
    }
  });

  it('never uses the JS i flag: Latin-1 bytes keep their case', () => {
    const emitted = emitRow(F, 'é');
    expect(isEmitted(emitted) && emitted.source).toBe('\\xc3\\xa9');
  });

  it('keeps JS capture numbers in step with PCRE (named groups count)', () => {
    const emitted = emitRow(D, '(?<n>a)(b)\\2');
    expect(isEmitted(emitted) && emitted.source).toBe('([Aa])([Bb])(?i:\\2)');
  });

  it('emits replace mode: \\G at the scan offset, \\K as marker groups', () => {
    const emitted = emitRow(F, '\\Ga\\Kb(c)\\1', { searchStart: 3 });
    expect(emitted).toEqual({
      source: '(?<=^[\\s\\S]{3})[Aa]()[Bb]([Cc])(?i:\\2)',
      keepGroups: [1]
    });
    const atStart = emitRow(F, '\\Ga', { searchStart: 0 });
    expect(isEmitted(atStart) && atStart.source).toBe('^[Aa]');
  });

  it('names what blocks a translation', () => {
    expect(emitRow(F, '(?>a)')).toEqual({ construct: '(?>', detail: 'atomic group' });
    expect(emitRow(D, 'a\\#b')).toEqual({ construct: '\\#', detail: '`#` ends the pattern early' });
    expect(emitRow(D, 'a\\')).toEqual({
      construct: '\\',
      detail: 'a trailing `\\` escapes the closing delimiter'
    });
    expect(emitRow(F, 'a\0b')).toEqual({
      construct: '\\0',
      detail: 'NUL byte (PHP-version dependent)'
    });
    expect(emitRow(F, '(*FAIL)|b')).toEqual({
      construct: '(*FAIL)',
      detail: 'backtracking verb or alpha assertion'
    });
    expect(emitRow(F, 'a(?C1)b')).toEqual({ construct: '(?C1)', detail: 'callout' });
    // A far `)` is not part of the name: three characters stand for it.
    expect(emitRow(F, `(?C"${'x'.repeat(20)}")`)).toEqual({ construct: '(?C', detail: 'callout' });
  });

  it.each([
    ['\\1(a)', 'back-reference to a group that may be unset'],
    ['(a)?\\1', 'back-reference to a group that may be unset'],
    ['(a\\1)', 'back-reference to a group that may be unset'],
    ['(?:(a))\\1', 'back-reference to a group that may be unset'],
    ['(é)\\1', 'caseless back-reference to non-ASCII text'],
    ['(.)\\1', 'caseless back-reference to non-ASCII text'],
    ['(?<=(a))b', 'lookbehind holding a group, back-reference or \\K'],
    ['(?<=a\\K)b', 'lookbehind holding a group, back-reference or \\K']
  ])('fails closed on %s (%s)', (row, detail) => {
    const emitted = emitRow(F, row);
    expect(isEmitted(emitted) ? null : emitted.detail).toBe(detail);
  });
});

describe('toByteString', () => {
  it('maps each UTF-8 byte to one unit', () => {
    expect(toByteString('aé€')).toBe('a\xc3\xa9\xe2\x82\xac');
    expect(toByteString('')).toBe('');
  });

  it('handles text longer than one chunk', () => {
    const text = 'é'.repeat(40_000);
    expect(toByteString(text)).toBe('\xc3\xa9'.repeat(40_000));
  });
});

/** The parity table, for its stored rows. */
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'wp-rocket-parity.fixtures.json'
);

describe('saveRejection: rows WP Rocket drops at save', () => {
  // The stored forms of every typed line the K.2 save fixtures drop as
  // `invalid-pattern` (the save's sanitizing steps applied by hand), plus
  // shapes observed failing on PCRE2 10.44 and 10.49.
  it.each([
    ['(?#c)', '(?\\'],
    ['\\i', '\\i'],
    ['\\u0041', '\\u'],
    ['\\1', '\\1'],
    ['a{2}{2}', '{2}'],
    ['\\#', '\\#'],
    ['(', '('],
    ['\\x{100}', '\\x{100}'],
    ['[é-a]', '[é-a'],
    ['x\\', '\\'],
    ['(?Pa)', '(?P'],
    ['(?&lt;=a)b', '(?&lt;'],
    ['(?&lt;!a)b', '(?&lt;'],
    ['\\k', '\\k'],
    ['[^]+x', '[^]+x'],
    ['[a-z]{2,}*', '*'],
    ['*', '*'],
    ['(*)', '(*)'],
    ['\\(.*)', ')'],
    ['/\\(.*) c \\(.*)/ var q = 1;', ')'],
    ['(?+1)x', '(?+1)'],
    [')', ')'],
    ['a**', '*'],
    ['a+?+', '+'],
    ['a++*', '*'],
    ['^*', '*'],
    ['\\b*', '*'],
    ['(?i)*', '*'],
    ['\\K*', '*'],
    ['\\E*', '*'],
    ['a{3,2}', '{3,2}'],
    ['a{65536}', '{65536}'],
    ['\\x', '\\x'],
    ['\\xZ', '\\x'],
    ['\\x{}', '\\x{}'],
    ['\\x{41', '\\x{41'],
    ['\\o', '\\o'],
    ['\\o{8}', '\\o{8}'],
    ['\\o{400}', '\\o{400}'],
    ['\\c', '\\c'],
    ['\\400', '\\400'],
    ['\\81', '\\81'],
    ['\\g', '\\g'],
    ['\\g0', '\\g0'],
    ['\\g{-2}(a)', '\\g{-2}'],
    ['\\g{m}(?<n>a)', '\\g{m}'],
    ['\\k<m>(?<n>a)', '\\k<m>'],
    ['(?P=m)', '(?P=m)'],
    ['(?&n)', '(?&n)'],
    ['(?2)(a)', '(?2)'],
    ['(?-1)', '(?-1)'],
    ['(?<1n>a)', '(?<1'],
    ['(?<n', '(?<n'],
    ['(?<n>a)(?<n>b)', 'n'],
    ['(?<n>a)|(?P<n>b)', 'n'],
    ['(?', '(?'],
    ['(?i', '(?i'],
    ['(a', '(a'],
    ['(?+a)', '(?+'],
    ['(?;)', '(?;'],
    ['[a', '[a'],
    ['[]', '[]'],
    ['[a-\\d]', '[a-\\d'],
    ['[\\d-z]', '[\\d-'],
    ['[[:alpha:]-z]', '[[:alpha:]-'],
    ['[[:foo:]]', '[:foo:]'],
    ['[[:ASCII:]]', '[:ASCII:]'],
    ['[[.a.]]', '[.a.]'],
    ['[\\N]', '\\N'],
    ['[\\400]', '\\400'],
    ['(?<=a+)b', '(?<=a+)'],
    ['(?<=a{0,256})b', '(?<=a{0,256})']
  ])('%s is rejected (%s)', (row, construct) => {
    expect(saveRejection(row)?.construct).toBe(construct);
  });

  it.each([
    ['(?a)'],
    ['(?+1)(x)'],
    ['\\1(a)'],
    ['a{,2}'],
    ['a{x}'],
    ['a{2}+'],
    ['(?=a)*'],
    ['\\10'],
    ['(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\\10'],
    ['[\\8]'],
    ['[[:alpha]'],
    ['[[:a]b:]]'],
    ['(?J)(?<n>a)(?<n>b)'],
    ['(?|(?<n>a)|(?<n>b))'],
    ['(?<=\\R)x'],
    ['(?<=a{0,255})x'],
    ['a\\E*'],
    ['a{2,}\\E?'],
    ['a\0b'],
    // Unknown to this parser: kept rather than claimed (fail closed).
    ['(?Q)'],
    ['a{ 2 }'],
    ['\\p'],
    ['(?R)']
  ])('%s is kept', (row) => {
    expect(saveRejection(row)).toBeNull();
  });

  it('keeps every row the K.2 save fixtures store', () => {
    const table = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      rows: { kind: string; feature: string; stored?: string[] }[];
    };
    const stored = table.rows.flatMap((row) =>
      row.kind === 'save' && row.feature !== 'lazyload' ? (row.stored ?? []) : []
    );
    expect(stored.length).toBeGreaterThan(50);
    expect(stored.filter((row) => saveRejection(row) !== null)).toEqual([]);
  });
});

describe('analyzeRow', () => {
  it('reports the facts the joined checks need', () => {
    expect(analyzeRow(F, '(?s)(?<n>a)\\1')).toMatchObject({
      invalidAtSave: null,
      pcreOnly: { construct: '(?s)', detail: 'option setting' },
      matchesAll: false,
      source: null,
      risk: null,
      topLevelOption: { construct: '(?s)', detail: 'option setting' },
      absoluteBackreference: { construct: '\\1', detail: 'numbered back-reference' },
      names: ['n'],
      allowsDuplicateNames: false,
      breaksJoin: false
    });
  });

  it.each([
    ['', true],
    ['a|', true],
    ['a*', true],
    ['(a?)', true],
    ['(?:a|)', true],
    ['a{0,3}', true],
    ['\\K', true],
    ['(?i)', true],
    ['(?a)', true],
    ['a', false],
    ['^', false],
    ['$', false],
    ['(?=a)', false],
    ['\\b', false],
    ['(?>a?)', false],
    ['a+', false],
    ['(?<n>a)\\1', false]
  ])('%j matches every subject: %s', (row, all) => {
    expect(analyzeRow(F, row).matchesAll).toBe(all);
  });

  it('runs the backtracking guard on the translated source', () => {
    expect(analyzeRow(F, '(a+)+$').risk).toBe('nested-repetition');
    // Delay escapes `+`: the same row is a literal there.
    expect(analyzeRow(D, '(a+)+$').risk).toBeNull();
    // Polynomial shapes stay accepted.
    expect(analyzeRow(F, 'a*a*a*a*a*c').risk).toBeNull();
  });

  it('marks a row whose \\Q runs to the end', () => {
    expect(analyzeRow(F, 'a\\Qb').breaksJoin).toBe(true);
    expect(analyzeRow(F, 'a\\Qb\\E').breaksJoin).toBe(false);
  });
});
