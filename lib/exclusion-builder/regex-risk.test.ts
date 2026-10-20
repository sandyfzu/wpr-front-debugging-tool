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
  '(x+){10}',
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

  it(`treats a fixed repeat up to ${String(LOOP_REPEAT_LIMIT)} as bounded, past it as a loop`, () => {
    expect(regexBacktrackingRisk(`(a+){${String(LOOP_REPEAT_LIMIT)}}`)).toBeNull();
    expect(regexBacktrackingRisk(`(a+){${String(LOOP_REPEAT_LIMIT + 1)}}`)).toBe(
      'nested-repetition'
    );
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

  it('analyzes a maximal-length nested pattern quickly', () => {
    const deep = `${'(?:a'.repeat(400)}${')'.repeat(400)}`;
    // 400 branches, each starting with its own character.
    const wide = Array.from({ length: 400 }, (_, i) => `${String.fromCharCode(0x100 + i)}z`).join(
      '|'
    );
    const started = performance.now();
    expect(regexBacktrackingRisk(deep)).toBeNull();
    expect(regexBacktrackingRisk(`(${wide})+`)).toBeNull();
    expect(regexBacktrackingRisk(`(${wide}|\u0100y)+`)).toBe('overlapping-alternation');
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
