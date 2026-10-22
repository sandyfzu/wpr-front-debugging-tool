/**
 * The row problems the PCRE translator reports instead of matching like WP
 * Rocket — the one declaring site of their ids (the WP Rocket parity table
 * imports them). Leaf module with no imports and erasable syntax only, so the
 * parity dev script can load it under Node's native TypeScript.
 */

/**
 * Why a regex row is not matched here the way WP Rocket matches it:
 * - `pcre-only` — PCRE syntax with no proven JS equivalent (not checked here);
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
 * Every problem id, most decisive first: when a row has several, it reports
 * the earliest (a row WP Rocket drops says so before anything about how it
 * would match).
 */
export const PROBLEM_IDS: readonly ProblemId[] = [
  'pcre-invalid',
  'joined-page-off',
  'match-all',
  'pcre-only',
  'joined-changes-matching',
  'backtracking-risk'
];
