/**
 * The catastrophic-backtracking guard: the risky-shape matrix (each rule,
 * through every group/quantifier/escape form), the must-pass corpus of
 * realistic rows, syntax robustness, and a timing pin that every accepted
 * corpus row stays fast on adversarial inputs.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKTRACKING_RISK_REASONS,
  LOOP_REPEAT_LIMIT,
  REGEX_ANALYSIS_LIMITS,
  regexBacktrackingRisk,
  type BacktrackingRisk
} from './regex-risk';

/** Rows that must be rejected, with the rule that names them. */
const RISKY: readonly (readonly [string, BacktrackingRisk])[] = [
  // 1. nested repetition
  ['(a+)+', 'nested-repetition'],
  ['(a+)+b', 'nested-repetition'],
  ['(a*)*', 'nested-repetition'],
  ['(a+)*', 'nested-repetition'],
  ['(?:a+b?)*', 'nested-repetition'],
  ['(\\w+\\s?)+$', 'nested-repetition'],
  ['^(a+)+$', 'nested-repetition'],
  ['(.*)*', 'nested-repetition'],
  ['(.*a){20}', 'nested-repetition'],
  ['(a{1,3})+', 'nested-repetition'],
  ['(a?a)+', 'nested-repetition'],
  ['(x+x+)+y', 'nested-repetition'],
  ['((ab)+)+', 'nested-repetition'],
  ['(?<n>a+)+', 'nested-repetition'],
  ['(?:(?:a+))+', 'nested-repetition'],
  ['(a+?)+?', 'nested-repetition'],
  ['(a+){11}', 'nested-repetition'],
  ['(a+){2,}', 'nested-repetition'],
  ['([a-z]+)*', 'nested-repetition'],
  ['([^/]+/?)*', 'nested-repetition'],
  ['(\\d+)*\\d', 'nested-repetition'],
  ['(a+|b)+', 'nested-repetition'],
  ['(.*?,)*x', 'nested-repetition'],
  ['(?i:(A+a)+)', 'nested-repetition'],
  ['(\\x41+)+', 'nested-repetition'],
  ['(\\u0041+)+', 'nested-repetition'],
  ['([\\]]+)+', 'nested-repetition'],
  ['(?=x)(a+)+', 'nested-repetition'],
  // 2. overlapping alternation
  ['(a|a)*', 'overlapping-alternation'],
  ['(a|ab)*', 'overlapping-alternation'],
  ['(\\w|\\d)+', 'overlapping-alternation'],
  ['(?:foo|f)+', 'overlapping-alternation'],
  ['(a|b|ab)*', 'overlapping-alternation'],
  ['(.|\\n|x)*', 'overlapping-alternation'],
  ['([a-c]|b)+', 'overlapping-alternation'],
  ['(?:x?a|a)+', 'overlapping-alternation'],
  // Shapes measured hanging the engine (each accepted by the first guard):
  // lookaround bodies, fixed-count loops, case folding past ASCII, `\c` in a class.
  ['(?=(a+)+$)', 'nested-repetition'],
  ['x(?=(\\w+\\d+)+$)', 'nested-repetition'],
  ['(?<=(a+)+)x', 'nested-repetition'],
  ['(?!(a|a)*$)', 'overlapping-alternation'],
  ['(\\w+\\s?){8}$', 'nested-repetition'],
  ['(.*a){10}$', 'nested-repetition'],
  ['(a+){5}b', 'nested-repetition'],
  ['(\\w+){3}x', 'nested-repetition'],
  ['((a+){5}){5}$', 'nested-repetition'],
  ['((a|a){10}){10}$', 'overlapping-alternation'],
  ['(a{1,10}){1,10}$', 'nested-repetition'],
  ['(?:(?:a+){2}){6}$', 'nested-repetition'],
  ['(x+){10}', 'nested-repetition'],
  ['(?i:é|É)+$', 'overlapping-alternation'],
  ['(?i:k|K)+$', 'overlapping-alternation'],
  ['(?:[\\c1]|\\x11)+$', 'overlapping-alternation'],
  ['(?:[\\c_]|\\x1f)+$', 'overlapping-alternation'],
  // Exact character facts decide these (each kills a narrowed or widened set).
  ['(?:[\\w]|_)+', 'overlapping-alternation'],
  ['(?:.|x)+', 'overlapping-alternation'],
  ['(?:\\8|8)+', 'overlapping-alternation'],
  ['(?:\\1|\\x01)+', 'overlapping-alternation'],
  ['(?:\\101|A)+', 'overlapping-alternation'],
  ['(?:\\cJ|\\n)+', 'overlapping-alternation'],
  ['(?:\\ca|\\x01)+', 'overlapping-alternation'],
  ['(?:\\uFFFF|[^a])+', 'overlapping-alternation'],
  ['(?:\\s|\\uFEFF)+', 'overlapping-alternation'],
  ['(?:\\s|\\u1680)+', 'overlapping-alternation'],
  ['(?:\\s|\\v)+', 'overlapping-alternation'],
  ['(?:[a-c]|b)+', 'overlapping-alternation'],
  ['(?:[\\d-z]|-)+', 'overlapping-alternation'],
  ['(?:ab|a)+', 'overlapping-alternation'],
  ['(?:google|goo)+', 'overlapping-alternation'],
  ['(?:a|)+b', 'overlapping-alternation'],
  // `(?s:…)` widens `.` to the line terminators (measured exponential before).
  ['(?s:(?:.|\\r)*)x', 'overlapping-alternation'],
  ['(?:(?s:.)|\\n)*x', 'overlapping-alternation'],
  ['(?s:(?:.|\\n)+)x', 'overlapping-alternation'],
  ['(?:(?s:.)|\\u2028)*y', 'overlapping-alternation'],
  ['(?is:(?:.|\\n)+)x', 'overlapping-alternation'],
  ['(?s:(?i:.)|\\n)+', 'overlapping-alternation'],
  // Alignment is kept only for fixed-length alternations (`a|ab` is not).
  ['(?:(?:a|bd)c|bdc)+', 'overlapping-alternation'],
  ['(?:a{1,2}b|aa)+', 'overlapping-alternation'],
  ['(?:a?b|ab)+', 'overlapping-alternation'],
  ['(?:(?:ab|ac)d|ab)+', 'overlapping-alternation'],
  // Heads compare 32 positions at most: a difference past them counts as overlap.
  [`(?:${'p'.repeat(40)}a|${'p'.repeat(40)}b)+`, 'overlapping-alternation'],
  // 3. back-reference inside a repeated group
  ['(a)(?:\\1b)*', 'repeated-backreference'],
  ['((a)\\2)+', 'repeated-backreference'],
  ['(?<q>x)(?:\\k<q>y)+', 'repeated-backreference']
];

/** Realistic Delay/Defer JS rows that must pass. */
const SAFE_CORPUS: readonly string[] = [
  'jquery',
  'jquery\\.min\\.js',
  'jquery-?\\d*\\.min\\.js',
  'jquery(-migrate)?(\\.min)?\\.js',
  '\\.js$',
  '/wp-content/plugins/contact-form-7/',
  '/wp-includes/js/jquery/jquery\\.js',
  'wp-content/plugins/[^/]+/assets/',
  'google-analytics\\.com',
  'googletagmanager\\.com/gtag/js',
  'gtag\\(',
  '(foo|bar)\\.js',
  '(?:foo|bar|baz)\\.js',
  '(foo|bar)+\\.js',
  'fbevents\\.js',
  'connect\\.facebook\\.net',
  'js\\?ver=[\\d.]+',
  '[a-z]+(-[a-z]+)*\\.js',
  '(\\d+\\.)+\\d+',
  '(?:[^/]+/)*plugin\\.js',
  '(ab+)*',
  '(-[a-z0-9]+)*',
  '^https?://',
  '(?:https?:)?//cdn\\.example\\.com/',
  'elementor(-pro)?/assets/js/.*\\.js',
  'window\\.dataLayer',
  'recaptcha/api\\.js\\?render=[A-Za-z0-9_-]{40}',
  '\\bmatomo\\b',
  '(?<!\\w)hotjar',
  '[\\]\\[]',
  'a{3}b{2,5}',
  '\\d{1,3}(\\.\\d{1,3}){3}',
  '(a|b)*c',
  '(?:\\.min|\\.slim)*\\.js',
  '(?:google|gtag)+',
  '(?:script|style)+',
  '(?:ab|ac)+',
  '(?:a{3}|b)+',
  '(a{3})+',
  '(?:.|\\n)+',
  '(?:.|\\r)+',
  '(?:.|\\u2028)+',
  '(?:\\1|a)+',
  '(?:\\0|a)+',
  '(?:\\cJ|a)+',
  '(?:\\x41|B)+',
  '(?:[a-c]|d)+',
  '(?:[\\d-z]|y)+',
  '(?s:.)+',
  '(?s:(?-s:(?:.|\\n)+))',
  '(?s-i:(?:.|\\n))?',
  '(?m:^(?:a|b)+$)',
  '(?:(?-s:.)|\\n)+',
  // A modifier scope ends at its group.
  '(?s:a)(?:.|\\n)+',
  '(?i:(?-i:(?:a|A)+))',
  // Aligned fixed-length alternations compare past their first position.
  '(?:(?:a|b)(?:c|d)|ae)+',
  '(?:(?:ab|ac)d|aa)+',
  `(?:${'p'.repeat(31)}a|${'p'.repeat(31)}b)+`,
  '(?:[\\c1]|1)+',
  '(?:\\s|x)+',
  '(?:\\uFFFE|\\uFFFF)+',
  '(?i:a|b)+',
  '(a(?=a+))+',
  '(?=a+)\\w',
  '\\u{3}',
  '\\cJ\\c',
  '[\\d-z]',
  '[]',
  '[^]+',
  '\\8\\x4\\u12',
  '(?:a)\\1+',
  '{',
  'a{,5}',
  '(?=.*foo)(?=.*bar)',
  '(?:(?=a)a)+',
  '(?-i:x)+',
  '(?i:abc)'
];

describe('regexBacktrackingRisk — risky shapes', () => {
  it.each(RISKY)('flags %j as %s', (row, risk) => {
    expect(() => new RegExp(row)).not.toThrow();
    expect(regexBacktrackingRisk(row)).toBe(risk);
  });
});

describe('regexBacktrackingRisk — realistic rows pass', () => {
  it.each(SAFE_CORPUS)('accepts %j', (row) => {
    expect(() => new RegExp(row)).not.toThrow();
    expect(regexBacktrackingRisk(row)).toBeNull();
  });

  it('treats any repeat past one as a loop (a fixed count multiplies the ways to match)', () => {
    expect(LOOP_REPEAT_LIMIT).toBe(1);
    expect(regexBacktrackingRisk('(a+){1}')).toBeNull();
    expect(regexBacktrackingRisk('(a+)?')).toBeNull();
    expect(regexBacktrackingRisk('(a+){2}')).toBe('nested-repetition');
    // Unambiguous fixed repeats still pass: the dotted quad.
    expect(regexBacktrackingRisk('\\d{1,3}(\\.\\d{1,3}){3}')).toBeNull();
  });

  it('rejects a row past the analysis limits as too complex, before parsing', () => {
    const deep = `${'('.repeat(REGEX_ANALYSIS_LIMITS.groupDepth + 1)}a${')'.repeat(REGEX_ANALYSIS_LIMITS.groupDepth + 1)}`;
    expect(regexBacktrackingRisk(deep)).toBe('too-complex');
    const atDepth = `${'('.repeat(REGEX_ANALYSIS_LIMITS.groupDepth)}a${')'.repeat(REGEX_ANALYSIS_LIMITS.groupDepth)}`;
    expect(regexBacktrackingRisk(atDepth)).toBeNull();
    expect(regexBacktrackingRisk('a'.repeat(REGEX_ANALYSIS_LIMITS.chars + 1))).toBe('too-complex');
    expect(regexBacktrackingRisk('a'.repeat(REGEX_ANALYSIS_LIMITS.chars))).toBeNull();
    // 1 875 nested groups overflowed the stack inside prevalidation before.
    expect(regexBacktrackingRisk(`${'('.repeat(1_875)}${')'.repeat(1_875)}`)).toBe('too-complex');
  });

  it('accepts a quantified lookaround and a looped body that consumes nothing', () => {
    expect(regexBacktrackingRisk('(?=a)*b')).toBeNull();
    expect(regexBacktrackingRisk('(?:\\b|^)+x')).toBeNull();
  });

  it('reads `\\b` in a class as backspace, not a word boundary', () => {
    expect(regexBacktrackingRisk('(?:[\\b]|\\x08)+')).toBe('overlapping-alternation');
    expect(regexBacktrackingRisk('(?:[\\b]|b)+')).toBeNull();
  });

  it('accepts syntax it does not model rather than rejecting a row falsely', () => {
    expect(regexBacktrackingRisk('(a+')).toBeNull();
    expect(regexBacktrackingRisk('(?P<x>a+)+')).toBeNull();
    expect(regexBacktrackingRisk('[a')).toBeNull();
  });

  it('answers the same verdict from the memo', () => {
    expect(regexBacktrackingRisk('(a+)+')).toBe('nested-repetition');
    expect(regexBacktrackingRisk('(a+)+')).toBe('nested-repetition');
    expect(regexBacktrackingRisk('plain')).toBeNull();
    expect(regexBacktrackingRisk('plain')).toBeNull();
  });

  it('keeps its memo bounded while staying correct', () => {
    for (let i = 0; i < 600; i++) expect(regexBacktrackingRisk(`row${String(i)}`)).toBeNull();
    expect(regexBacktrackingRisk('(a|a)*')).toBe('overlapping-alternation');
  });
});

describe('reasons', () => {
  it('has one printable, bounded reason per risk', () => {
    for (const reason of Object.values(BACKTRACKING_RISK_REASONS)) {
      expect(reason).toMatch(/^Risky regular expression: /);
      expect(reason.length).toBeLessThan(300);
    }
  });
});

describe('robustness', () => {
  it('never throws on any compilable pattern built from the syntax alphabet', () => {
    const alphabet = [
      'a',
      'b',
      '\\',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
      ',',
      '1',
      '?',
      '*',
      '+',
      '|',
      '^',
      '$',
      '.',
      '-',
      '<',
      '>',
      ':',
      '=',
      '!',
      'k',
      'u',
      'x',
      'c',
      'd',
      'w',
      's',
      'B',
      '0'
    ];
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    let compiled = 0;
    for (let i = 0; i < 4_000; i++) {
      let row = '';
      const length = 1 + Math.floor(random() * 12);
      for (let j = 0; j < length; j++)
        row += alphabet[Math.floor(random() * alphabet.length)] ?? '';
      try {
        new RegExp(row);
      } catch {
        continue; // only compilable rows reach the guard
      }
      compiled++;
      expect(() => regexBacktrackingRisk(row), row).not.toThrow();
    }
    expect(compiled).toBeGreaterThan(500);
  });

  it('analyzes worst-case rows within the limits quickly (bounded, near-linear)', () => {
    const depth = REGEX_ANALYSIS_LIMITS.groupDepth;
    const chars = REGEX_ANALYSIS_LIMITS.chars;
    // Deepest allowed nesting of loops whose bodies are unambiguous: each level
    // closes on its own terminator, which nothing inside it consumes.
    let nestedLoops = 'a';
    for (let level = 0; level < depth; level++) {
      nestedLoops = `(?:a${nestedLoops})+${String.fromCharCode(0x100 + level)}`;
    }
    // Many branches, each starting with its own character.
    const branches = Math.floor((chars - 4) / 3);
    const wide = Array.from({ length: branches }, (_, i) => String.fromCharCode(0x100 + i)).join(
      '|'
    );
    // Many branches sharing a long prefix but differing at their last unit (pairwise worst).
    const shared = Array.from(
      { length: 120 },
      (_, i) => `${'p'.repeat(30)}${String.fromCharCode(0x100 + i)}`
    ).join('|');
    const rows = [
      nestedLoops,
      `(?:${wide})+`,
      `(?:${shared})+`,
      'a'.repeat(chars),
      Array.from({ length: chars / 4 }, (_, i) => `[${String.fromCharCode(0x100 + i)}]`).join(''),
      // Case folding over a long scope: `[a-z]+` meets `K` only once folded.
      `(?i:${'[a-z]'.repeat(chars / 6)}+K)+`
    ];
    for (const row of rows) {
      expect(row.length, row.slice(0, 20)).toBeLessThanOrEqual(chars);
      expect(() => new RegExp(row)).not.toThrow();
    }
    const started = performance.now();
    expect(regexBacktrackingRisk(rows[0] as string)).toBeNull();
    expect(regexBacktrackingRisk(rows[1] as string)).toBeNull();
    expect(regexBacktrackingRisk(rows[2] as string)).toBeNull();
    expect(regexBacktrackingRisk(rows[3] as string)).toBeNull();
    expect(regexBacktrackingRisk(rows[4] as string)).toBeNull();
    expect(regexBacktrackingRisk(rows[5] as string)).toBe('nested-repetition');
    expect(regexBacktrackingRisk(`(?:${wide}|\u0100y)+`)).toBe('overlapping-alternation');
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('accepted rows stay fast on adversarial input', () => {
  it('runs every accepted corpus row against hostile subjects in well under a second', () => {
    const subjects = [
      'a'.repeat(5_000),
      `${'a'.repeat(5_000)}!`,
      `${'ab'.repeat(2_500)}!`,
      `${'-a'.repeat(2_500)}!`,
      `${'1.'.repeat(2_500)}x`,
      'x/'.repeat(2_500),
      ' '.repeat(5_000),
      `<script type="rocketlazyloadscript" data-rocket-src="${'a'.repeat(2_000)}">`
    ];
    const started = performance.now();
    for (const row of SAFE_CORPUS) {
      const regex = new RegExp(row);
      for (const subject of subjects) regex.test(subject);
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
