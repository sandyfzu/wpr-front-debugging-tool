import { describe, expect, it } from 'vitest';
import { bytesOf } from './byte-set';
import { maxLength, parsePcre, type PatternNode } from './parse';

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
    expect(parsed.names).toEqual(['n', 'm']);
    expect(parsed.allowsDuplicateNames).toBe(false);
  });

  it('notes what lets a pattern repeat a name', () => {
    expect(parsePcre('(?J)(?<n>a)(?<n>b)', false).allowsDuplicateNames).toBe(true);
    expect(parsePcre('(?|(?<n>a)|(?<n>b))', false).allowsDuplicateNames).toBe(true);
    // `J` after `-` turns the option off.
    expect(parsePcre('(?-J)a', false).allowsDuplicateNames).toBe(false);
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
      issues: [{ kind: 'pcre-only', construct: '(?(1)', detail: 'conditional group' }]
    });
  });

  it.each([
    // Recorded as invalid: observed failing on PCRE2 10.44 and 10.49.
    ['a\\', 'invalid', '\\'],
    ['\\c', 'invalid', '\\c'],
    ['\\c\xe9', 'invalid', '\\c\xe9'],
    ['\\x{4g}', 'pcre-only', '\\x{'],
    ['\\x{100', 'invalid', '\\x{100'],
    ['\\o{}', 'invalid', '\\o{}'],
    ['\\g{-1}', 'invalid', '\\g{-1}'],
    ['(?)', 'pcre-only', '(?)'],
    ['(?i-s)', 'pcre-only', '(?i-s)'],
    ['(?^)', 'pcre-only', '(?^)'],
    ['(?s:a)', 'pcre-only', '(?s:'],
    ['(?i.', 'pcre-only', '(?i'],
    ['(?R)', 'pcre-only', '(?R)'],
    ['(?0)', 'pcre-only', '(?0)'],
    ['(a)(?1)', 'pcre-only', '(?1)'],
    ['(?1a)', 'invalid', '(?1'],
    ['(?P>n)(?<n>a)', 'pcre-only', '(?P>n)'],
    ['(?&n', 'invalid', '(?&n'],
    ["(?'n'a)", 'pcre-only', "(?'n'"],
    ["(?'1'a)", 'invalid', "(?'1"],
    ['(?>a)', 'pcre-only', '(?>'],
    ['(?*a)', 'pcre-only', '(?*'],
    ['(*FAIL)', 'pcre-only', '(*FAIL)'],
    ['(?C1)', 'pcre-only', '(?C1)'],
    ['\\N{U+41}', 'pcre-only', '\\N{'],
    ['\\pL', 'pcre-only', '\\pL'],
    ['\\P{L}', 'pcre-only', '\\P{L}'],
    ['\\p{L', 'pcre-only', '\\p{'],
    ['\\X', 'pcre-only', '\\X'],
    ['\\C', 'pcre-only', '\\C'],
    ['\\k<n', 'pcre-only', '\\k<'],
    ['\\k{n}(?<n>a)', 'pcre-only', '\\k{n}'],
    ["\\k'n'(?<n>a)", 'pcre-only', "\\k'n'"],
    ['\\g{n}(?<n>a)', 'pcre-only', '\\g{n}'],
    ['\\g<1>(a)', 'pcre-only', '\\g<1>'],
    ['\\g+1(a)', 'pcre-only', '\\g+1'],
    ['a++', 'pcre-only', '++'],
    ['(?=a)*', 'pcre-only', '*'],
    ['a{ 2 }', 'pcre-only', '{ 2 }'],
    ['[:a]', 'pcre-only', '[:'],
    ['[\\g]', 'pcre-only', '\\g'],
    ['[\\Qa\\E]', 'pcre-only', '\\Q'],
    ['[a-\\x]', 'invalid', '\\x'],
    // `\c]` is a control byte: the class never closes.
    ['[\\cA-\\c]', 'invalid', '[\\cA-\\c]']
  ])('%j → %s %j', (pattern, kind, construct) => {
    expect(firstIssue(pattern)).toEqual([kind, construct]);
  });

  it.each([
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

describe('maxLength', () => {
  /** The longest match of a whole pattern's first alternative. */
  function longest(pattern: string): number {
    const nodes = parsePcre(pattern, false).alternatives[0] ?? [];
    return nodes.reduce((sum, node) => sum + maxLength(node), 0);
  }

  it.each([
    ['abc', 3],
    ['a{2,5}', 5],
    ['\\R', 2],
    ['(?:ab|c)', 2],
    ['^a$\\K(?=xyz)', 1],
    ['(?:)*', 0],
    ['(?i)', 0]
  ])('%s → %d', (pattern, length) => {
    expect(longest(pattern)).toBe(length);
  });

  it('is unbounded for open repeats and unknown for references and opaque atoms', () => {
    expect(longest('a+')).toBe(Infinity);
    expect(longest('(a)\\1')).toBeNaN();
    expect(longest('\\pL*')).toBeNaN();
  });
});
