import { describe, expect, it } from 'vitest';
import { bytesOf } from './byte-set';
import { parsePcre, sequenceLength, type PatternNode } from './parse';

/** The first issue of a pattern as `[kind, construct]`, or `null`. */
function firstIssue(pattern: string): [string, string] | null {
  const issue = parsePcre(pattern, false).issues[0];
  return issue === undefined ? null : [issue.kind, issue.construct];
}

describe('parsePcre', () => {
  it('builds sets, assertions and groups', () => {
    const parsed = parsePcre('^a(?:b|c)$', false);
    expect(parsed.issues).toEqual([]);
    expect(parsed.complete).toBe(true);
    expect(parsed.alternatives).toEqual([
      [
        { type: 'assert', assertion: 'subject-start' },
        { type: 'set', set: bytesOf(0x61) },
        {
          type: 'group',
          kind: 'group',
          capture: null,
          alternatives: [
            [{ type: 'set', set: bytesOf(0x62) }],
            [{ type: 'set', set: bytesOf(0x63) }]
          ]
        },
        { type: 'assert', assertion: 'end-or-final-newline' }
      ]
    ]);
  });

  it('folds ASCII case into literals and classes when caseless, before negating', () => {
    const [[literal, negated]] = parsePcre('a[^b]', true).alternatives as [PatternNode[]];
    expect(literal).toEqual({ type: 'set', set: bytesOf(0x41, 0x61) });
    expect(
      negated?.type === 'set' && [negated.set[0x42], negated.set[0x62], negated.set[0x63]]
    ).toEqual([0, 0, 1]);
  });

  it('counts groups and records names', () => {
    const parsed = parsePcre('(a)(?<n>b)(?P<m>c)(?:d)', false);
    expect(parsed.groupCount).toBe(3);
    expect(parsed.names).toEqual([
      { name: 'n', duplicatesAllowed: null },
      { name: 'm', duplicatesAllowed: null }
    ]);
    expect(parsed.duplicatesAllowedAtEnd).toBeNull();
  });

  it('tracks the J option (duplicate names) per group scope', () => {
    const parsed = parsePcre('(?<a>x)(?J)(?<b>x)((?-J)(?<c>x))(?<d>x)(?^)', false);
    expect(parsed.names.map(({ duplicatesAllowed }) => duplicatesAllowed)).toEqual([
      null,
      true,
      false,
      true
    ]);
    // `(?^)` resets every option.
    expect(parsed.duplicatesAllowedAtEnd).toBe(false);
    expect(parsePcre('(?J:(?<a>x))', false).names[0]?.duplicatesAllowed).toBe(true);
    expect(parsePcre('(?J:x)', false).duplicatesAllowedAtEnd).toBeNull();
    expect(parsePcre('(?^J)', false).duplicatesAllowedAtEnd).toBe(true);
  });

  it('rejects a repeated name unless J is on at the repeat', () => {
    expect(firstIssue('(?<n>a)(?<n>b)')).toEqual(['invalid', 'n']);
    expect(parsePcre('(?J)(?<n>a)(?<n>b)', false).issues).toEqual([]);
    // Inside a branch reset names share numbers: not modeled.
    expect(firstIssue('(?|(?<n>a)|(?<n>b))')).toEqual(['untranslated', '(?|']);
    expect(parsePcre('(?|(?<n>a))', false).issues.map(({ kind }) => kind)).toEqual([
      'untranslated',
      'unknown'
    ]);
  });

  it('applies a quantifier across \\E and empty \\Q\\E markers', () => {
    const [[node]] = parsePcre('a{2,}\\E?', false).alternatives as [PatternNode[]];
    expect(node).toMatchObject({ type: 'repeat', min: 2, max: null, lazy: true });
    expect(parsePcre('a*\\Q\\E?', false).issues).toEqual([]);
  });

  it('reads a \\Q run to the end and flags it as open', () => {
    expect(parsePcre('a\\Q)|', false)).toMatchObject({ unterminatedQuote: true, issues: [] });
  });

  it('stops at constructs of unknown extent, naming them', () => {
    expect(parsePcre('a(?(1)b|c)', false)).toMatchObject({
      complete: false,
      issues: [{ kind: 'unknown', construct: '(?(1)', detail: 'conditional group' }]
    });
  });

  it.each([
    // `invalid`: observed failing on PCRE2 10.44 and 10.49; `untranslated`:
    // observed accepted on both; `unknown`: validity not modeled.
    ['a\\', 'invalid', '\\'],
    ['\\c', 'invalid', '\\c'],
    ['\\c\xe9', 'invalid', '\\c\xe9'],
    ['\\x', 'unknown', '\\x'],
    ['a\\xZ', 'unknown', '\\x'],
    ['\\x{4g}', 'unknown', '\\x{'],
    ['\\x{100', 'invalid', '\\x{100'],
    ['\\o{}', 'invalid', '\\o{}'],
    ['\\g{-1}', 'invalid', '\\g{-1}'],
    ['(?)', 'untranslated', '(?)'],
    ['(?i-s)', 'untranslated', '(?i-s)'],
    ['(?^)', 'untranslated', '(?^)'],
    ['(?aD)', 'untranslated', '(?aD)'],
    ['(?s:a)', 'untranslated', '(?s:'],
    ['(?x)a b', 'unknown', '(?x)'],
    ['(?n)(a)', 'unknown', '(?n)'],
    ['(?i.', 'invalid', '(?i.'],
    ['(?ver=1)', 'invalid', '(?ver='],
    ['(?Q)', 'invalid', '(?Q)'],
    ['(?aDS)', 'invalid', '(?aDS)'],
    ['(?^-i)', 'invalid', '(?^-i)'],
    ['(?R)', 'unknown', '(?R)'],
    ['(?0)', 'unknown', '(?0)'],
    ['(a)(?1)', 'unknown', '(?1)'],
    ['(?1a)', 'invalid', '(?1'],
    ['(?P>n)(?<n>a)', 'unknown', '(?P>n)'],
    ['(?P=n)(?<n>a)', 'untranslated', '(?P=n)'],
    ['(?&n', 'invalid', '(?&n'],
    ["(?'n'a)", 'untranslated', "(?'n'"],
    ["(?'1'a)", 'invalid', "(?'1"],
    ['(?>a)', 'untranslated', '(?>'],
    ['(?*a)', 'untranslated', '(?*'],
    ['(*FAIL)', 'unknown', '(*FAIL)'],
    ['(?C1)', 'unknown', '(?C1)'],
    ['\\N{U+41}', 'invalid', '\\N{U+41}'],
    ['\\pL', 'unknown', '\\pL'],
    ['\\P{L}', 'unknown', '\\P{L}'],
    ['\\p{L', 'invalid', '\\p{L'],
    ['\\p', 'invalid', '\\p'],
    ['\\p1', 'invalid', '\\p'],
    ['\\X', 'untranslated', '\\X'],
    ['\\C', 'untranslated', '\\C'],
    ['\\k<n', 'unknown', '\\k<'],
    ['\\k{n}(?<n>a)', 'untranslated', '\\k{n}'],
    ["\\k'n'(?<n>a)", 'untranslated', "\\k'n'"],
    ['\\g{n}(?<n>a)', 'untranslated', '\\g{n}'],
    ['\\g<1>(a)', 'unknown', '\\g<1>'],
    ['\\g+1(a)', 'unknown', '\\g+1'],
    ['a++', 'untranslated', '++'],
    ['(?=a)*', 'untranslated', '*'],
    ['a{ 2 }', 'untranslated', '{ 2 }'],
    ['[:a]', 'unknown', '[:'],
    ['[\\g]', 'unknown', '\\g'],
    ['[\\Qa-z\\E]', 'unknown', '[\\Qa-'],
    ['[a-\\x]', 'unknown', '\\x'],
    // `\c]` is a control byte: the class never closes.
    ['[\\cA-\\c]', 'invalid', '[\\cA-\\c]'],
    // Lookbehind limits (observed): fixed branches up to 65 535, 255 once one varies.
    ['(?<=a{65535}b)', 'invalid', '(?<=a{65535}b)'],
    ['(?<=a{256}|b{1,2})', 'invalid', '(?<=a{256}|b{1,2})'],
    ['(?<=(?:a|bc){200})', 'invalid', '(?<=(?:a|bc){200})'],
    ['(?<=a+)', 'invalid', '(?<=a+)'],
    ['(?<=\\1)(a)', 'unknown', '(?<=\\1)']
  ])('%j → %s %j', (pattern, kind, construct) => {
    expect(firstIssue(pattern)).toEqual([kind, construct]);
  });

  it.each([
    ['(?<=a{256})', '(?<=a|b{300})', '(?<=(?:ab){200})', '(?<=.{65535})', '(?<=a{0,255})'],
    ['(?<=x(?:a|bc))', '(?<=(?<=a{300})b)', '(?<=\\R)']
  ])('accepts the lookbehinds PCRE2 accepts: %s', (...patterns) => {
    for (const pattern of patterns) expect(parsePcre(pattern, false).issues).toEqual([]);
  });

  it.each([
    ['[\\Qa]\\E]', [0x5d, 0x61]],
    ['[\\E]a]', [0x5d, 0x61]],
    ['[\\1]', [0x01]],
    ['[\\18]', [0x01, 0x38]],
    ['[\\8\\9]', [0x38, 0x39]],
    ['[\\b]', [0x08]],
    ['[\\x41-\\x43]', [0x41, 0x42, 0x43]],
    ['[\\o{101}]', [0x41]],
    ['[\\]]', [0x5d]],
    ['[a-]', [0x2d, 0x61]],
    ['[[a]', [0x5b, 0x61]]
  ])('class %s holds exactly %j', (pattern, bytes) => {
    const [[node]] = parsePcre(pattern, false).alternatives as [PatternNode[]];
    expect(node).toEqual({ type: 'set', set: bytesOf(...bytes) });
  });

  it.each([
    ['\\10', 0x08],
    ['\\1000', 0x40],
    ['\\012', 0x0a],
    ['\\0', 0x00]
  ])('reads %s as an octal byte when no such group precedes it', (pattern, byte) => {
    const [[node]] = parsePcre(pattern, false).alternatives as [PatternNode[]];
    expect(node).toEqual({ type: 'set', set: bytesOf(byte) });
  });

  it('reads \\N as a back-reference when enough groups precede it, or N < 10', () => {
    const tenGroups = '(a)'.repeat(10);
    const parsed = parsePcre(`${tenGroups}\\10\\2`, false);
    expect(parsed.alternatives[0]?.slice(10)).toEqual([
      { type: 'backref', group: 10, absolute: true },
      { type: 'backref', group: 2, absolute: true }
    ]);
    expect(parsePcre('(a)\\g-1', false).alternatives[0]?.[1]).toEqual({
      type: 'backref',
      group: 1,
      absolute: false
    });
  });
});

describe('sequenceLength', () => {
  /** The length of a whole pattern's first alternative. */
  function length(pattern: string): { min: number; max: number } {
    return sequenceLength(parsePcre(pattern, false).alternatives[0] ?? []);
  }

  it.each([
    ['abc', 3, 3],
    ['a{2,5}', 2, 5],
    ['\\R', 1, 2],
    ['(?:ab|c)', 1, 2],
    ['^a$\\K(?=xyz)', 1, 1],
    ['(?:)*', 0, 0],
    ['(?i)', 0, 0],
    ['a++', 1, Infinity]
  ])('%s → %d..%d', (pattern, min, max) => {
    expect(length(pattern)).toEqual({ min, max });
  });

  it('is unknown for back-references and opaque atoms', () => {
    expect(length('(a)\\1').max).toBeNaN();
    expect(length('\\pL*').max).toBeNaN();
  });
});
