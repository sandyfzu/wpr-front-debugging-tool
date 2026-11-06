/**
 * The tester form's live checks, pure over the raw configuration: which
 * stylesheet-exclusion lines and replacement patterns do not compile (named
 * by line number / pair, judged exactly as a run compiles them), what each
 * pair will do (an empty replacement deletes; an empty search is skipped),
 * whether the whole configuration can be stored, and the clamp that keeps
 * an edit inside {@link RUCSS_CONFIG_LIMITS} before it is written.
 */
import {
  findRucssTesterConfigProblem,
  RUCSS_CONFIG_BYTE_BUDGET,
  RUCSS_CONFIG_LIMITS,
  type RucssReplacement,
  type RucssTesterConfig
} from './config';
import { cutToUnits } from '../../utils/cap-text';
import { compilePattern } from './run-plan';

/** An exclusion line that does not compile. */
export interface RucssLineProblem {
  /** 1-based line number in the field as typed. */
  readonly lineNumber: number;
  /** The line, trimmed. */
  readonly line: string;
  /** The engine's syntax error. */
  readonly message: string;
}

/**
 * What a pair does on a run:
 * - `replaces` — matches are replaced by the replacement text;
 * - `deletes` — the replacement is empty: matches are removed;
 * - `skipped` — the search is empty: an unfinished row, never applied.
 */
export type RucssPairEffect = 'replaces' | 'deletes' | 'skipped';

/** One pair's live reading. */
export interface RucssPairCheck {
  readonly effect: RucssPairEffect;
  /** The search pattern's syntax error, or null (a skipped pair has none). */
  readonly problem: string | null;
}

/**
 * Check every non-blank line of the exclusion field, as a run compiles it
 * (trimmed, no flags).
 *
 * @param text The field's raw text.
 * @returns The lines that do not compile, in field order.
 */
export function checkExcludeLines(text: string): readonly RucssLineProblem[] {
  const problems: RucssLineProblem[] = [];
  text.split(/\r\n?|\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    const compiled = compilePattern(line, '');
    if (!compiled.ok) problems.push({ lineNumber: index + 1, line, message: compiled.message });
  });
  return problems;
}

/**
 * Read one pair, as a run applies it (search compiled with `g`).
 *
 * @param pair The pair as typed.
 * @returns Its effect and its pattern's problem.
 */
export function checkReplacementPair(pair: RucssReplacement): RucssPairCheck {
  if (pair.search === '') return { effect: 'skipped', problem: null };
  const compiled = compilePattern(pair.search, 'g');
  return {
    effect: pair.replacement === '' ? 'deletes' : 'replaces',
    problem: compiled.ok ? null : compiled.message
  };
}

/** The storage budget in user words (MiB, rounded down). */
const BUDGET_WORDS = `${String(Math.floor(RUCSS_CONFIG_BYTE_BUDGET / (1024 * 1024)))} MiB`;

/**
 * Whether the configuration can be stored as it is, in user words.
 *
 * @param config The form's configuration.
 * @returns Null when storable, else why not (the writer would refuse it).
 */
export function findStoreProblem(config: RucssTesterConfig): string | null {
  const problem = findRucssTesterConfigProblem(config);
  if (problem === null) return null;
  return problem.includes('budget')
    ? `These settings are too large to save (over ${BUDGET_WORDS} as stored). Shorten the longest fields.`
    : `These settings can't be saved: ${problem}.`;
}

/**
 * Keep a configuration inside the field caps (a paste or a restored value
 * can exceed what the fields' own limits hold): text cut to its cap, at
 * most the allowed pairs (first ones).
 *
 * @param config The configuration.
 * @returns A fresh plain configuration within every cap.
 */
export function clampRucssTesterConfig(config: RucssTesterConfig): RucssTesterConfig {
  const { listChars, cssChars, replacements, searchChars, replacementChars } = RUCSS_CONFIG_LIMITS;
  return {
    safelist: cutToUnits(config.safelist, listChars),
    inlinePreserve: cutToUnits(config.inlinePreserve, listChars),
    excludeFiles: cutToUnits(config.excludeFiles, listChars),
    prepend: cutToUnits(config.prepend, cssChars),
    append: cutToUnits(config.append, cssChars),
    replacements: config.replacements.slice(0, replacements).map((pair) => ({
      search: cutToUnits(pair.search, searchChars),
      replacement: cutToUnits(pair.replacement, replacementChars)
    })),
    mobile: config.mobile,
    home: config.home
  };
}
