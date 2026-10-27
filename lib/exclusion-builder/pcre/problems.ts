/**
 * The row problems the PCRE translator reports instead of matching like WP
 * Rocket — the one declaring site of their ids (the WP Rocket parity table
 * imports them). Leaf module with no imports and erasable syntax only, so the
 * parity dev script can load it under Node's native TypeScript.
 */

/**
 * Why a regex row is not matched here the way WP Rocket matches it:
 * - `pcre-only` — PCRE syntax with no proven JS equivalent, or whose fate at
 *   save is not modeled, or a row too long to check (not checked here);
 * - `pcre-invalid` — PCRE rejects the row (WP Rocket drops it at save);
 * - `match-all` — the row matches every subject;
 * - `joined-page-off` — Defer JS: with the other rows, WP Rocket's joined
 *   pattern fails its pre-check and nothing is deferred on the page;
 * - `joined-changes-matching` — Defer JS: joined, the row changes what it or
 *   the other rows match;
 * - `backtracking-risk` — a catastrophic-backtracking shape.
 */
export type ProblemId =
  | 'pcre-only'
  | 'pcre-invalid'
  | 'match-all'
  | 'joined-page-off'
  | 'joined-changes-matching'
  | 'backtracking-risk';

/**
 * Every problem id, for validating authored data. (Which one a row reports
 * when several apply is the translator's call, not this order.)
 */
export const PROBLEM_IDS: readonly ProblemId[] = [
  'pcre-invalid',
  'joined-page-off',
  'match-all',
  'pcre-only',
  'joined-changes-matching',
  'backtracking-risk'
];

/**
 * The problems that warn instead of blocking: WP Rocket applies the row as
 * stored and the engine reproduces that outcome exactly — `match-all` (the
 * row excludes every candidate) and `joined-page-off` (Defer JS defers no
 * script on the page). Every other problem blocks: the engine cannot apply
 * the row the way WP Rocket does.
 */
export const NON_BLOCKING_PROBLEMS: ReadonlySet<ProblemId> = new Set<ProblemId>([
  'match-all',
  'joined-page-off'
]);
