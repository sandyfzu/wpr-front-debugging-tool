/**
 * The form's live checks: exclusion lines judged as a run compiles them
 * (with their typed line numbers), each pair's effect and syntax error, the
 * store gate in user words, and the clamp to every cap.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUCSS_TESTER_CONFIG, RUCSS_CONFIG_LIMITS, type RucssTesterConfig } from './config';
import {
  checkExcludeLines,
  checkReplacementPair,
  clampRucssTesterConfig,
  countInvalidPatterns,
  findStoreProblem
} from './form-check';
import { prepareRucssRun } from './run-plan';
import { parseLineList } from '../../utils/line-list';

const BASE: RucssTesterConfig = { ...DEFAULT_RUCSS_TESTER_CONFIG, replacements: [] };

describe('checkExcludeLines', () => {
  it('passes valid and blank lines, and names each invalid one by its typed line number', () => {
    expect(checkExcludeLines('')).toEqual([]);
    expect(checkExcludeLines('theme\\.css\n\n  plugin/.*\\.css  ')).toEqual([]);
    const problems = checkExcludeLines('ok\n\n  (broken  \r\nalso[\nfine');
    expect(problems.map((problem) => [problem.lineNumber, problem.line])).toEqual([
      [3, '(broken'],
      [4, 'also[']
    ]);
    expect(problems[0]?.message).toMatch(/Invalid regular expression/);
  });

  it('agrees with the run: a line the check passes compiles in the plan, and the reverse', () => {
    for (const text of ['a.css', '(x', 'x{1,3}', '[', '\\']) {
      const run = prepareRucssRun({ ...BASE, excludeFiles: text });
      expect(checkExcludeLines(text).length === 0, text).toBe(run.ok);
    }
  });
});

describe('countInvalidPatterns', () => {
  it('counts each distinct invalid line once, as the field pattern count does', () => {
    expect(countInvalidPatterns([])).toBe(0);
    expect(countInvalidPatterns(checkExcludeLines('(\n(\n  (  '))).toBe(1);
    expect(countInvalidPatterns(checkExcludeLines('(\n[\n(\nok'))).toBe(2);
  });

  it('agrees with the deduped pattern count on the same field', () => {
    const text = '(\n(';
    expect(countInvalidPatterns(checkExcludeLines(text))).toBe(parseLineList(text).length);
  });
});

describe('checkReplacementPair', () => {
  it('reads each effect: replaces, deletes (empty replacement), skipped (empty search)', () => {
    expect(checkReplacementPair({ search: 'a', replacement: 'b' })).toEqual({
      effect: 'replaces',
      problem: null
    });
    expect(checkReplacementPair({ search: 'a', replacement: '' })).toEqual({
      effect: 'deletes',
      problem: null
    });
    expect(checkReplacementPair({ search: '', replacement: 'b' })).toEqual({
      effect: 'skipped',
      problem: null
    });
  });

  it('names a pattern that does not compile, keeping its effect', () => {
    const check = checkReplacementPair({ search: '(', replacement: '' });
    expect(check.effect).toBe('deletes');
    expect(check.problem).toMatch(/Invalid regular expression/);
  });
});

describe('findStoreProblem', () => {
  it('passes a storable configuration', () => {
    expect(findStoreProblem(BASE)).toBeNull();
  });

  it('names the byte budget in user words', () => {
    // Control characters escape six-fold in JSON: at the caps they pass 1 MiB.
    const heavy = '\u0001'.repeat(RUCSS_CONFIG_LIMITS.cssChars);
    expect(findStoreProblem({ ...BASE, prepend: heavy, append: heavy })).toBe(
      'These settings are too large to save (over 1 MiB as stored). Shorten the longest fields.'
    );
  });

  it('names any other refusal with the writer’s reason', () => {
    const over = 'x'.repeat(RUCSS_CONFIG_LIMITS.listChars + 1);
    expect(findStoreProblem({ ...BASE, safelist: over })).toMatch(
      /^These settings can't be saved: safelist must be a string/
    );
  });
});

describe('clampRucssTesterConfig', () => {
  it('cuts every field to its cap and keeps the first pairs', () => {
    const long = (n: number): string => 'x'.repeat(n + 5);
    const pairs = Array.from({ length: RUCSS_CONFIG_LIMITS.replacements + 3 }, (_, index) => ({
      search: index === 0 ? long(RUCSS_CONFIG_LIMITS.searchChars) : `s${String(index)}`,
      replacement: index === 0 ? long(RUCSS_CONFIG_LIMITS.replacementChars) : ''
    }));
    const clamped = clampRucssTesterConfig({
      safelist: long(RUCSS_CONFIG_LIMITS.listChars),
      inlinePreserve: long(RUCSS_CONFIG_LIMITS.listChars),
      excludeFiles: long(RUCSS_CONFIG_LIMITS.listChars),
      prepend: long(RUCSS_CONFIG_LIMITS.cssChars),
      append: long(RUCSS_CONFIG_LIMITS.cssChars),
      replacements: pairs,
      mobile: true,
      home: true
    });
    expect(clamped.safelist).toHaveLength(RUCSS_CONFIG_LIMITS.listChars);
    expect(clamped.inlinePreserve).toHaveLength(RUCSS_CONFIG_LIMITS.listChars);
    expect(clamped.excludeFiles).toHaveLength(RUCSS_CONFIG_LIMITS.listChars);
    expect(clamped.prepend).toHaveLength(RUCSS_CONFIG_LIMITS.cssChars);
    expect(clamped.append).toHaveLength(RUCSS_CONFIG_LIMITS.cssChars);
    expect(clamped.replacements).toHaveLength(RUCSS_CONFIG_LIMITS.replacements);
    expect(clamped.replacements[0]?.search).toHaveLength(RUCSS_CONFIG_LIMITS.searchChars);
    expect(clamped.replacements[0]?.replacement).toHaveLength(RUCSS_CONFIG_LIMITS.replacementChars);
    expect(clamped.replacements[1]).toEqual({ search: 's1', replacement: '' });
    expect([clamped.mobile, clamped.home]).toEqual([true, true]);
    expect(findStoreProblem(clamped)).toBeNull();
  });

  it('returns fresh plain data equal to an in-cap input', () => {
    const input: RucssTesterConfig = {
      ...BASE,
      safelist: 'a',
      replacements: [{ search: 'b', replacement: 'c' }]
    };
    const clamped = clampRucssTesterConfig(input);
    expect(clamped).toEqual(input);
    expect(clamped.replacements).not.toBe(input.replacements);
  });
});
