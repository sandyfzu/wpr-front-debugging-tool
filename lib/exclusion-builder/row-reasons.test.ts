import { describe, expect, it } from 'vitest';
import { regexRowProblems } from './pcre/rows';
import type { RegexFeatureId } from './pcre/translate';
import type { BacktrackingRisk } from './regex-risk';
import { ROW_REASONS } from './row-reasons';

const FEATURES: readonly RegexFeatureId[] = ['delay_js', 'defer_all_js'];
const RISKS: readonly BacktrackingRisk[] = [
  'nested-repetition',
  'overlapping-alternation',
  'repeated-backreference',
  'too-complex'
];

/** The backticked example a reason quotes, if any. */
const example = (reason: string): string | null => /\(like `([^`]+)`\)/.exec(reason)?.[1] ?? null;

describe('ROW_REASONS', () => {
  it('words every risk for every feature, short and printable', () => {
    for (const feature of FEATURES) {
      for (const risk of RISKS) {
        const reason = ROW_REASONS.backtracking(feature, risk);
        expect(reason.length).toBeLessThan(300);
        expect(reason, `${feature} ${risk}`).not.toMatch(/[\r\n]/);
      }
    }
  });

  it('gives only the shapes with a clear example one, never the others', () => {
    for (const feature of FEATURES) {
      expect(example(ROW_REASONS.backtracking(feature, 'repeated-backreference'))).toBeNull();
      expect(example(ROW_REASONS.backtracking(feature, 'too-complex'))).toBeNull();
    }
  });

  it('gives every example, exactly as written, its own reason through its feature’s reading', () => {
    let checked = 0;
    for (const feature of FEATURES) {
      for (const risk of RISKS) {
        const quoted = example(ROW_REASONS.backtracking(feature, risk));
        if (quoted === null) continue;
        // The example as a stored row of that feature: no suffix, no anchor added.
        const [problem] = regexRowProblems(feature, [quoted]);
        expect(problem?.problem, `${feature} ${quoted}`).toBe('backtracking-risk');
        expect(problem?.reason, `${feature} ${quoted}`).toBe(
          ROW_REASONS.backtracking(feature, risk)
        );
        checked += 1;
      }
    }
    expect(checked).toBe(4);
  });

  it('names the limits a too-complex row went past', () => {
    expect(ROW_REASONS.backtracking('delay_js', 'too-complex')).toMatch(
      /over \d+ characters, \d+ nested groups, or more work than the check allows/
    );
  });

  it('never shows Delay a `+` or `*` example (Delay reads `+` literally and saves `*` as `(.*)`)', () => {
    for (const risk of RISKS) {
      expect(example(ROW_REASONS.backtracking('delay_js', risk)) ?? '').not.toMatch(/[+*]/);
    }
  });

  it('words a dropped row by its live effect per feature', () => {
    expect(ROW_REASONS.droppedAtSave('delay_js', '`(` (x)')).toMatch(/it never matches$/);
    expect(ROW_REASONS.droppedAtSave('defer_all_js', '`(` (x)')).toMatch(
      /turns Defer JS off on the page$/
    );
  });
});
