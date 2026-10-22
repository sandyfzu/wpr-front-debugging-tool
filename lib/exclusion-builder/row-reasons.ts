/**
 * Every reason a row is flagged with — the one declaring site of the words
 * the validator (literal rows), the PCRE reading (regex rows) and the
 * non-blocking warnings show. Producers pick an entry; none types its own
 * sentence. Entries that name a construct take it already quoted (the PCRE
 * reading caps and backticks it).
 */
import { REGEX_ANALYSIS_LIMITS, type BacktrackingRisk } from './regex-risk';
import type { RegexFeatureId } from './pcre/translate';

/**
 * Example patterns for each backtracking shape, written in the feature's
 * own syntax: Delay JS reads every `+` as a literal and turns every `*`
 * into `(.*)` when it saves, so its examples use `{1,}` instead.
 */
const RISK_EXAMPLES: Readonly<
  Record<RegexFeatureId, Readonly<Record<'nested-repetition' | 'overlapping-alternation', string>>>
> = {
  delay_js: { 'nested-repetition': '(a{1,}){1,}', 'overlapping-alternation': '(a|ab){1,}' },
  // `(a|ab)*` alone can match empty text — a match-all row, not this risk.
  defer_all_js: { 'nested-repetition': '(a+)+', 'overlapping-alternation': '(a|ab)*c' }
};

/** The row reasons. */
export const ROW_REASONS = {
  /** A row empty once trimmed (where the feature reads it as matching everything). */
  empty: 'Row is empty — it would match every element',
  /** An empty Automatic Lazy Rendering row next to other rows. */
  emptyJoined:
    'Row is empty — next to other rows it matches every element (WP Rocket joins the rows into one pattern)',
  /** A whitespace-only Automatic Lazy Rendering row (a warning: WP Rocket accepts it). */
  whitespaceOnly:
    'Row is only whitespace — it matches nearly every element (any opening tag holding it)',
  /** A set row that is not WP Rocket's stored form (the session refuses the set). */
  notStored:
    'Row is not in the form WP Rocket stores — edit it again so it is saved as WP Rocket would',
  /** `match-all`: stored, and it matches every subject. */
  matchAll: 'WP Rocket stores this and it excludes every script',
  /** `joined-page-off`: Defer JS's joined pre-check fails on this row. */
  joinedPageOff:
    'Joined with the other rows, WP Rocket’s Defer JS check fails on this row: it would defer no script on the page',
  /**
   * `pcre-invalid`: the save drops the row; what it would do anyway when
   * added through a filter.
   *
   * @param feature The row's feature.
   * @param construct The rejected construct, quoted.
   */
  droppedAtSave: (feature: RegexFeatureId, construct: string): string =>
    `WP Rocket drops this row when saving: PCRE rejects ${construct}; ${
      feature === 'delay_js'
        ? 'added through a filter, it never matches'
        : 'added through a filter, it turns Defer JS off on the page'
    }`,
  /**
   * `pcre-only`, unanalyzed: the row is past a checking bound.
   *
   * @param detail Which bound.
   */
  unchecked: (detail: string): string => `This row is not checked here (${detail})`,
  /**
   * `pcre-only`: syntax with no proven equivalent here.
   *
   * @param construct The construct, quoted.
   */
  pcreOnly: (construct: string): string => `PCRE-only syntax: ${construct} — not checked here`,
  /**
   * `joined-changes-matching`: joined, the row changes what is matched.
   *
   * @param construct The construct, quoted.
   */
  joinedChangesMatching: (construct: string): string =>
    `Joined with the other Defer JS rows, ${construct} matches differently on WP Rocket`,
  /**
   * `backtracking-risk`, with an example in the feature's own syntax.
   *
   * @param feature The row's feature.
   * @param risk The risk found.
   */
  backtracking: (feature: RegexFeatureId, risk: BacktrackingRisk): string => {
    switch (risk) {
      case 'nested-repetition':
        return `Risky regular expression: a repeated group repeats something that can match the same text again (like \`${RISK_EXAMPLES[feature]['nested-repetition']}\`) — it can take exponential time; make the repetition unambiguous`;
      case 'overlapping-alternation':
        return `Risky regular expression: inside a repetition, one alternative can match the start of another (like \`${RISK_EXAMPLES[feature]['overlapping-alternation']}\`) — it can take exponential time`;
      case 'repeated-backreference':
        return 'Risky regular expression: a back-reference inside a repeated group can take exponential time';
      case 'too-complex':
        return `This row is too long, too deeply nested or too intricate to check for slow matching (over ${String(REGEX_ANALYSIS_LIMITS.chars)} characters, ${String(REGEX_ANALYSIS_LIMITS.groupDepth)} nested groups, or more work than the check allows) — simplify it`;
    }
  }
} as const;
