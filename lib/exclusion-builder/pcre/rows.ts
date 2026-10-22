/**
 * A regex feature's stored rows → per-row JS matchers and row problems, the
 * entry point the Delay/Defer matchers and the validator use. Delay JS tests
 * each row alone; Defer JS joins every row into one `#(r1|r2|…)#i` and runs
 * a pre-check on it, so a Defer set has outcomes no single row has:
 *
 * - `joined-page-off` — the pre-check `preg_replace(joined, '', 'dummy-string')`
 *   returns a falsy string (the joined pattern does not compile — a group
 *   name repeated across rows, a row's open `\Q` quoting the wrapper's `)` —
 *   or it consumes all of `dummy-string`): WP Rocket then defers nothing on
 *   the page;
 * - `joined-changes-matching` — the set compiles but a row behaves
 *   differently joined: an unscoped option setting leaks into the rows after
 *   it, and a numbered back-reference counts the wrapper group.
 *
 * Each row reports its most decisive problem only ({@link PROBLEM_IDS} order).
 */
import type { InvalidExclusionRow } from '../errors';
import { BACKTRACKING_RISK_REASONS } from '../regex-risk';
import { PROBLEM_IDS, type ProblemId } from './problems';
import {
  analyzeRow,
  emitRow,
  isEmitted,
  type PcreConstruct,
  type RegexFeatureId,
  type RowAnalysis
} from './translate';

/** A JS matcher for one row: compile `new RegExp(source, flags)`, test the subject's byte string. */
export interface PcreMatcher {
  readonly source: string;
  /** Always `''`: case folding is in the source, never JS's `i`. */
  readonly flags: string;
}

/** Why a row does not match here as it does on the live site. */
export interface RowProblem {
  readonly problem: ProblemId;
  /** The offending construct as WP Rocket's runtime sees it, when one is named. */
  readonly construct: string | null;
  /** Actionable text for the row note. */
  readonly reason: string;
}

/** One row's translation. */
export interface TranslatedRow {
  readonly row: string;
  /**
   * The exact JS equivalent, when one exists and is safe to run (absent for
   * `pcre-invalid`, `pcre-only` and `backtracking-risk` rows). Rows with
   * another problem keep it: a `match-all` row really matches everything,
   * and a joined problem concerns the set, not the row's own pattern.
   */
  readonly matcher: PcreMatcher | null;
  readonly problem: RowProblem | null;
}

/** A feature's rows translated together. */
export interface RegexRowsTranslation {
  readonly rows: readonly TranslatedRow[];
  /** Defer JS: WP Rocket's joined pre-check fails and nothing is deferred on the page. */
  readonly pageOff: boolean;
}

/** The fixed subject of WP Rocket's Defer JS pre-check. */
const PRECHECK_SUBJECT = 'dummy-string';

/** One match found by the pre-check replay. */
interface ReplayMatch {
  readonly row: number;
  readonly start: number;
  /** Where the replaced text starts (`\K` moves it right). */
  readonly replaceStart: number;
  readonly end: number;
}

/** A row compiled for the replay: sticky, with match indices for the `\K` markers. */
interface ReplayRegex {
  readonly regex: RegExp;
  readonly keepGroups: readonly number[];
}

/**
 * The replay's compiled rows, memoized per (row, search offset, non-empty):
 * `\G` depends on the offset, and the non-empty retry adds an end bound.
 */
class ReplayRows {
  private readonly cache = new Map<string, ReplayRegex | null>();

  /** @param rows The stored rows, all translatable. */
  constructor(readonly rows: readonly string[]) {}

  /**
   * Match row `index` at exactly `at`, as one alternative of the joined pattern.
   *
   * @param index The row's index.
   * @param at The position to match at.
   * @param searchStart The scan's current offset (what `\G` asserts).
   * @param nonEmpty Require a non-empty match (PCRE's retry after an empty
   *   one, which always happens at the scan offset).
   */
  matchAt(index: number, at: number, searchStart: number, nonEmpty: boolean): ReplayMatch | null {
    const compiled = this.compiled(index, searchStart, nonEmpty);
    if (compiled === null) return null;
    compiled.regex.lastIndex = at;
    const match = compiled.regex.exec(PRECHECK_SUBJECT);
    if (match === null) return null;
    const keeps = compiled.keepGroups
      .map((group) => match.indices?.[group]?.[0])
      .filter((start): start is number => start !== undefined);
    return {
      row: index,
      start: match.index,
      replaceStart: Math.max(match.index, ...keeps),
      end: match.index + match[0].length
    };
  }

  /** Row `index` compiled for one offset (memoized). */
  private compiled(index: number, searchStart: number, nonEmpty: boolean): ReplayRegex | null {
    const key = `${String(index)}:${String(searchStart)}:${String(nonEmpty)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const emitted = emitRow('defer_all_js', this.rows[index] ?? '', { searchStart });
    // Ends past `searchStart`: the lookbehind counts at least one more unit.
    const tail = nonEmpty ? `(?<=^[\\s\\S]{${String(searchStart + 1)},})` : '';
    const compiled = isEmitted(emitted)
      ? { regex: new RegExp(`(?:${emitted.source})${tail}`, 'yd'), keepGroups: emitted.keepGroups }
      : null;
    this.cache.set(key, compiled);
    return compiled;
  }

  /** The first row (in order) matching at the leftmost position from `from`. */
  leftmost(from: number): ReplayMatch | null {
    for (let at = from; at <= PRECHECK_SUBJECT.length; at++) {
      for (const index of this.rows.keys()) {
        const match = this.matchAt(index, at, from, false);
        if (match !== null) return match;
      }
    }
    return null;
  }

  /** The first row matching non-empty at exactly `at` (the retry after an empty match). */
  nonEmptyAt(at: number): ReplayMatch | null {
    for (const index of this.rows.keys()) {
      const match = this.matchAt(index, at, at, true);
      if (match !== null) return match;
    }
    return null;
  }
}

/**
 * Replay `preg_replace(joined, '', 'dummy-string')` with the rows' JS
 * equivalents: PCRE's global scan, where an empty match is followed by a
 * non-empty anchored retry at the same position before one byte is copied.
 * Exact when every row translates and none leaks into another (leaking rows
 * are reported on their own).
 *
 * @param rows The stored rows, all translatable.
 * @returns The rows whose matches consumed text, when what remains is falsy
 *   in PHP (`''` or `'0'`); `null` when the pre-check passes.
 */
function precheckConsumers(rows: readonly string[]): ReadonlySet<number> | null {
  const replay = new ReplayRows(rows);
  let kept = '';
  let pos = 0;
  let afterEmpty = false;
  const consumers = new Set<number>();
  while (pos <= PRECHECK_SUBJECT.length) {
    const match: ReplayMatch | null = afterEmpty ? replay.nonEmptyAt(pos) : replay.leftmost(pos);
    if (match === null) {
      if (!afterEmpty) {
        kept += PRECHECK_SUBJECT.slice(pos);
        break;
      }
      kept += PRECHECK_SUBJECT.charAt(pos);
      pos++;
      afterEmpty = false;
      continue;
    }
    kept += PRECHECK_SUBJECT.slice(pos, match.replaceStart);
    if (match.end > match.start) consumers.add(match.row);
    afterEmpty = match.end === match.start;
    pos = match.end;
  }
  return kept === '' || kept === '0' ? consumers : null;
}

/** Rows declaring a group name another row also declares (joined, PCRE rejects the duplicate). */
function duplicateNameRows(analyses: readonly RowAnalysis[]): ReadonlySet<number> {
  const rows = new Set<number>();
  if (analyses.some((analysis) => analysis.allowsDuplicateNames)) return rows;
  analyses.forEach((analysis, index) => {
    analyses.forEach((other, otherIndex) => {
      if (otherIndex !== index && analysis.names.some((name) => other.names.includes(name))) {
        rows.add(index);
      }
    });
  });
  return rows;
}

/**
 * Rows behind a Defer page-off: rows that break the joined pattern's syntax
 * (an open `\Q`), else rows sharing a group name, else — when every row
 * translates and is safe to run — the rows that consume `dummy-string`.
 * Rows WP Rocket drops at save are left out: their own problem says so.
 */
function pageOffRows(
  rows: readonly string[],
  analyses: readonly RowAnalysis[]
): ReadonlySet<number> {
  if (analyses.some((analysis) => analysis.invalidAtSave !== null)) return new Set();
  const breakers = new Set(
    analyses.flatMap((analysis, index) => (analysis.breaksJoin ? [index] : []))
  );
  if (breakers.size > 0) return breakers;
  const named = duplicateNameRows(analyses);
  if (named.size > 0) return named;
  const replayable = analyses.every(
    (analysis) => analysis.source !== null && analysis.risk === null
  );
  return replayable ? (precheckConsumers(rows) ?? new Set()) : new Set();
}

/** Backticked construct text for a reason. */
function quoted(construct: PcreConstruct): string {
  return `\`${construct.construct}\` (${construct.detail})`;
}

/** Each problem a row has, keyed by id (the caller keeps the most decisive). */
function rowProblems(
  feature: RegexFeatureId,
  analysis: RowAnalysis,
  joined: { readonly pageOff: boolean; readonly last: boolean }
): Partial<Record<ProblemId, RowProblem>> {
  const problems: Partial<Record<ProblemId, RowProblem>> = {};
  if (analysis.invalidAtSave !== null) {
    problems['pcre-invalid'] = {
      problem: 'pcre-invalid',
      construct: analysis.invalidAtSave.construct,
      reason: `WP Rocket drops this row when saving: PCRE rejects ${quoted(analysis.invalidAtSave)}`
    };
  }
  if (joined.pageOff) {
    problems['joined-page-off'] = {
      problem: 'joined-page-off',
      construct: null,
      reason:
        'Joined with the other rows, WP Rocket’s Defer JS check fails on this row: it would defer no script on the page'
    };
  }
  if (analysis.matchesAll) {
    problems['match-all'] = {
      problem: 'match-all',
      construct: null,
      reason: 'WP Rocket stores this and it excludes every script'
    };
  }
  // An option leaking into later rows changes them: that outranks the row's own syntax.
  const leak = feature === 'defer_all_js' && !joined.last ? analysis.topLevelOption : null;
  if (analysis.pcreOnly !== null && leak === null) {
    problems['pcre-only'] = {
      problem: 'pcre-only',
      construct: analysis.pcreOnly.construct,
      reason: `PCRE-only syntax: ${quoted(analysis.pcreOnly)} — not checked here`
    };
  }
  const shift = feature === 'defer_all_js' ? analysis.absoluteBackreference : null;
  const changes = leak ?? shift;
  if (changes !== null) {
    problems['joined-changes-matching'] = {
      problem: 'joined-changes-matching',
      construct: changes.construct,
      reason: `Joined with the other Defer JS rows, ${quoted(changes)} matches differently on WP Rocket`
    };
  }
  if (analysis.risk !== null) {
    problems['backtracking-risk'] = {
      problem: 'backtracking-risk',
      construct: null,
      reason: BACKTRACKING_RISK_REASONS[analysis.risk]
    };
  }
  return problems;
}

/**
 * Translate a regex feature's stored rows: each row's JS matcher and its
 * most decisive problem, plus Defer JS's page-wide state.
 *
 * @param feature `delay_js` or `defer_all_js`.
 * @param rows The stored rows, in order.
 */
export function translateRegexRows(
  feature: RegexFeatureId,
  rows: readonly string[]
): RegexRowsTranslation {
  const analyses = rows.map((row) => analyzeRow(feature, row));
  const pageOff = feature === 'defer_all_js' ? pageOffRows(rows, analyses) : new Set<number>();
  const translated = rows.map((row, index): TranslatedRow => {
    const analysis = analyses[index] as RowAnalysis;
    const problems = rowProblems(feature, analysis, {
      pageOff: pageOff.has(index),
      last: index === rows.length - 1
    });
    const decisive = PROBLEM_IDS.find((id) => problems[id] !== undefined);
    const { source, risk } = analysis;
    return {
      row,
      matcher: source !== null && risk === null ? { source, flags: '' } : null,
      problem: decisive === undefined ? null : (problems[decisive] as RowProblem)
    };
  });
  return { rows: translated, pageOff: pageOff.size > 0 };
}

/**
 * The rows of a regex feature that do not match here as on the live site, as
 * validation entries carrying their problem id.
 *
 * @param feature `delay_js` or `defer_all_js`.
 * @param rows The stored rows, in order.
 * @returns One entry per row with a problem, in row order.
 */
export function regexRowProblems(
  feature: RegexFeatureId,
  rows: readonly string[]
): InvalidExclusionRow[] {
  return translateRegexRows(feature, rows).rows.flatMap((translated, index) =>
    translated.problem === null
      ? []
      : [
          {
            feature,
            index,
            row: translated.row,
            reason: translated.problem.reason,
            problem: translated.problem.problem
          }
        ]
  );
}
