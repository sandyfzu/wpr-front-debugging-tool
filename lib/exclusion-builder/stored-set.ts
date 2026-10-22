/**
 * A typed exclusion set (as the editor sends, saves and reopens it) turned
 * into the set WP Rocket would store — what a session validates and
 * applies, so the page is rewritten with the rows the live site would use.
 */
import type { InvalidExclusionRow } from './errors';
import { saveExclusionRows } from './field-text';
import { EXCLUSION_FEATURES, type ExclusionFeatureId, type ExclusionSet } from './set';
import { prevalidateExclusionSet, type ExclusionSetProblems } from './validate';

/** A stored set, with the way back to the typed rows. */
export interface StoredExclusionSet {
  /** The rows WP Rocket stores, per feature; disables unchanged. */
  readonly set: ExclusionSet;
  /** Per feature, the typed row index of each stored row (stored order). */
  readonly typedIndex: Readonly<Record<ExclusionFeatureId, readonly number[]>>;
}

/**
 * The set WP Rocket stores for a typed set (safe mode unknown: its patterns
 * are kept, as the save keeps them when the setting is off).
 *
 * @param typed The set as typed.
 */
export function storedExclusionSet(typed: ExclusionSet): StoredExclusionSet {
  const rows = { ...typed.rows };
  const typedIndex = {} as Record<ExclusionFeatureId, number[]>;
  for (const feature of EXCLUSION_FEATURES) {
    const saved = saveExclusionRows(feature.id, typed.rows[feature.rowsKey]);
    rows[feature.rowsKey] = [...saved.rows];
    const indexes: number[] = [];
    saved.diffs.forEach((diff, index) => {
      if (diff.state !== 'dropped') indexes[diff.index] = index;
    });
    typedIndex[feature.id] = indexes;
  }
  return { set: { rows, disable: typed.disable }, typedIndex };
}

/**
 * Prevalidate a typed set as WP Rocket stores it: every problem of the
 * stored rows, each naming its typed row (`index` into the typed rows) and
 * the stored text it is about (`row`).
 *
 * @param typed The set as typed.
 */
export function prevalidateStoredForm(typed: ExclusionSet): ExclusionSetProblems {
  const stored = storedExclusionSet(typed);
  const problems = prevalidateExclusionSet(stored.set);
  if (problems.valid) return problems;
  const invalid = problems.invalid.map((problem): InvalidExclusionRow => {
    const index = stored.typedIndex[problem.feature][problem.index];
    if (index === undefined) {
      throw new Error(`No typed row behind stored ${problem.feature} row ${String(problem.index)}`);
    }
    return { ...problem, index };
  });
  return { valid: false, invalid };
}
