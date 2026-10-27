/**
 * The command palette's command matcher — pure, deterministic, unit-tested,
 * shared by every surface that mounts `./command-palette` (it is that
 * primitive's `filter` seam, so palettes rank alike wherever they render).
 *
 * The model is substring token scoring, not subsequence fuzzy matching: the
 * query splits into whitespace tokens; every token must match somewhere in
 * the label or the keywords (AND); a token's score prefers word-boundary
 * hits over mid-word ones, earlier positions over later, and a label hit
 * over a keyword hit. The totals order the matches highest-first, and an
 * empty or blank query hands the registry order back untouched — empty asks
 * never re-order.
 *
 * Scoring is integer arithmetic all the way down, and the registry order is
 * the one deliberate tiebreaker, so equal scores land in declaration order
 * on every engine, not by an accidental sort stability.
 */

/** What the matcher scores: a label plus optional extra vocabulary. */
export interface MatchableCommand {
  /** The row's primary text. */
  label: string;
  /** Extra lowercase words worth reaching through (never rendered, only scored). */
  keywords?: readonly string[];
}

/** Base a boundary-position hit carries over a mid-word one. */
const BOUNDARY_BASE = 20;
/** Base a mid-word hit carries. */
const MIDWORD_BASE = 10;
/** Bonus a label hit carries over the same hit in a keyword. */
const LABEL_BONUS = 2;
/** Penalty per leading-position unit, capped (earlier hits score higher). */
const MAX_POSITION_PENALTY = 8;

/** One token's score against one field: null when absent. */
function tokenScore(token: string, text: string): number | null {
  const at = text.indexOf(token);
  if (at === -1) return null;
  // A boundary is the string's own start, or a position after a character
  // that is neither a letter, a digit, nor an underscore.
  const before = at > 0 ? text[at - 1] : undefined;
  const atBoundary = before === undefined || !/[\p{L}\p{N}_]/u.test(before);
  const base = atBoundary ? BOUNDARY_BASE : MIDWORD_BASE;
  return base - Math.min(at, MAX_POSITION_PENALTY);
}

/**
 * One token's best score across a row's fields: the label outranks the
 * keywords ({@link LABEL_BONUS}), keywords break their own ties by
 * declaration order.
 *
 * @returns The winning score, or null when the token matches nowhere.
 */
function tokenBest(token: string, row: MatchableCommand): number | null {
  const labelScore = tokenScore(token, row.label.toLowerCase());
  let best: number | null = labelScore === null ? null : labelScore + LABEL_BONUS;
  row.keywords?.forEach((keyword) => {
    const score = tokenScore(token, keyword.toLowerCase());
    if (score !== null) best = best === null ? score : Math.max(best, score);
  });
  return best;
}

/**
 * Rank the rows for one query.
 *
 * @param rows The candidate rows, in registry order (the rank's tiebreaker).
 * @param query The raw input value (tokens split on whitespace).
 * @returns The matching rows, best first — or the input order for an empty ask.
 */
export function rankCommands<T extends MatchableCommand>(rows: readonly T[], query: string): T[] {
  const tokens = query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return [...rows];

  const scored: Array<{ row: T; score: number; order: number }> = [];
  for (const [order, row] of rows.entries()) {
    let total = 0;
    let allMatched = true;
    for (const token of tokens) {
      const best = tokenBest(token, row);
      if (best === null) {
        allMatched = false;
        break;
      }
      total += best;
    }
    if (allMatched) scored.push({ row, score: total, order });
  }
  return scored
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((entry) => entry.row);
}
