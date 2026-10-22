import { describe, expect, it } from 'vitest';
import { translateRegexRows } from './pcre/rows';
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

  it.each([
    ['delay_js', 'nested-repetition'],
    ['delay_js', 'overlapping-alternation'],
    ['defer_all_js', 'nested-repetition'],
    ['defer_all_js', 'overlapping-alternation']
  ] as const)('gives %s an example its own reading flags as %s', (feature, risk) => {
    const quoted = example(ROW_REASONS.backtracking(feature, risk));
    expect(quoted).not.toBeNull();
    // The example, as a stored row of that feature, carries that very risk.
    const [row] = translateRegexRows(feature, [`${quoted ?? ''}b$`]).rows;
    expect(row?.problem?.problem).toBe('backtracking-risk');
    expect(row?.problem?.reason).toBe(ROW_REASONS.backtracking(feature, risk));
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
