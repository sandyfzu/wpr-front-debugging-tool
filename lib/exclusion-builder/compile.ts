/**
 * Compiled matchers. Each pattern compiles once and is reused across calls
 * (a bounded in-memory cache — transforms re-derive their compiled rows
 * per call, so the cache is what keeps repeated pipelines cheap); the
 * compiled regex carries no flags: case-sensitive like the plugin's own
 * matching, and stateless (no `lastIndex` to drift between tests).
 */
import { ExclusionValidationError } from './errors';
import { featureRowProblems } from './validate';
import type { ExclusionFeatureId } from './set';

/** The cache's entry bound — oldest-inserted patterns evicted first. */
export const PATTERN_CACHE_LIMIT = 512;

/** The memo cache: pattern text → compiled matcher. */
const patternCache = new Map<string, RegExp>();

/**
 * Compile one pattern, reusing the cached matcher when the text was
 * compiled before. No flags: the matcher is case-sensitive and stateless,
 * so sharing one instance across callers is safe.
 *
 * @param pattern The regex-source row.
 * @returns The compiled matcher.
 * @throws {@link SyntaxError} when the pattern is not a valid regular
 *   expression — the compiler's own message, untouched.
 */
export function compilePattern(pattern: string): RegExp {
  const cached = patternCache.get(pattern);
  if (cached !== undefined) return cached;
  const compiled = new RegExp(pattern);
  if (patternCache.size >= PATTERN_CACHE_LIMIT) {
    const oldest = patternCache.keys().next();
    if (oldest.done !== true) patternCache.delete(oldest.value);
  }
  patternCache.set(pattern, compiled);
  return compiled;
}

/** One compiled pattern row: the row as given, plus its matcher. */
export interface CompiledPatternRow {
  readonly row: string;
  readonly regex: RegExp;
}

/**
 * Compile a feature's pattern rows for matching, throwing the typed error
 * when any of them is invalid — with every failing row named (the same
 * all-at-once contract as the prevalidator, scoped to one feature).
 *
 * @param rows The pattern rows as given.
 * @param feature The owning feature (names the problem rows).
 * @returns One compiled row per input row, in list order.
 * @throws {@link ExclusionValidationError} naming every invalid row.
 */
export function compilePatternRows(
  rows: readonly string[],
  feature: ExclusionFeatureId
): readonly CompiledPatternRow[] {
  const problems = featureRowProblems(feature, 'pattern', rows);
  if (problems.length > 0) throw new ExclusionValidationError(problems);
  return rows.map((row) => ({ row, regex: compilePattern(row) }));
}
