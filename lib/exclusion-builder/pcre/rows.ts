/**
 * A regex feature's stored rows → per-row JS matchers and row problems, the
 * entry point the Delay/Defer matchers and the validator use. Delay JS tests
 * each row alone; Defer JS joins every row into one `#(r1|r2|…)#i` and runs
 * a pre-check on it, so a Defer set has outcomes no single row has:
 *
 * - `joined-page-off` — the pre-check `preg_replace(joined, '', 'dummy-string')`
 *   returns a falsy string: the joined pattern does not compile (a row PCRE
 *   rejects, a group name repeated across rows, a row's open `\Q` quoting
 *   the wrapper's `)`) or it consumes all of `dummy-string`. WP Rocket then
 *   defers nothing on the page;
 * - `joined-changes-matching` — the set compiles but a row behaves
 *   differently joined: an unscoped option setting leaks into the rows after
 *   it, and a numbered back-reference counts the wrapper group.
 *
 * Each row reports its most decisive problem only (see {@link rowProblem}).
 */
import type { InvalidExclusionRow } from '../errors';
import { BACKTRACKING_RISK_REASONS } from '../regex-risk';
import type { ProblemId } from './problems';
import {
  analyzeRow,
  emitRow,
  isEmitted,
  PCRE_LIMITS,
  toByteString,
  type PcreConstruct,
  type RegexFeatureId,
  type RowAnalysis
} from './translate';

/**
 * A JS matcher for one row: its source matches the subject's byte string
 * (see {@link compileMatcher}, which does the encoding). Case folding is in
 * the source; JS's `i` is never used.
 */
export interface PcreMatcher {
  readonly source: string;
  readonly flags: '';
}

/** Why a row does not match here as it does on the live site. */
export interface RowProblem {
  readonly problem: ProblemId;
  /** The offending construct as WP Rocket sees it, when one is named. */
  readonly construct: string | null;
  /** Actionable text for the row note. */
  readonly reason: string;
}

/** One row's translation. */
export interface TranslatedRow {
  readonly row: string;
  /**
   * The exact JS equivalent of the row's runtime pattern, when one exists and
   * is safe to run — whatever the row's problem (a `match-all` row's matcher
   * really matches everything). `null` when the row has no proven
   * translation or is a backtracking risk.
   */
  readonly matcher: PcreMatcher | null;
  readonly problem: RowProblem | null;
}

/**
 * Defer JS's page state under the rows: `on` (WP Rocket defers), `off` (its
 * pre-check fails: nothing deferred), or `unknown` (a row's semantics are
 * not modeled well enough to replay the pre-check exactly). Delay JS: `on`.
 */
export type PageState = 'on' | 'off' | 'unknown';

/** A feature's rows translated together. */
export interface RegexRowsTranslation {
  readonly rows: readonly TranslatedRow[];
  readonly page: PageState;
}

/**
 * A compiled matcher: tests a subject (page text) by encoding it to the
 * byte string the source is written for.
 *
 * @param matcher A row's matcher.
 * @returns A stateless test.
 */
export function compileMatcher(matcher: PcreMatcher): (subject: string) => boolean {
  const regex = new RegExp(matcher.source, matcher.flags);
  return (subject) => regex.test(toByteString(subject));
}

/** The fixed subject of WP Rocket's Defer JS pre-check. */
const PRECHECK_SUBJECT = 'dummy-string';

/** One match found by the pre-check replay. */
interface ReplayMatch {
  /** Index into the replayed rows. */
  readonly row: number;
  readonly start: number;
  /** Where the replaced text starts (`\K` moves it right). */
  readonly replaceStart: number;
  readonly end: number;
}

/** Thrown when a replay passes {@link PCRE_LIMITS}`.replayExecs` (caught by {@link deferPage}). */
class ReplayBudgetExceeded extends Error {}

/** A row compiled for the replay, with the JS groups of its `\K` markers. */
interface ReplayRegex {
  readonly regex: RegExp;
  readonly keepGroups: readonly number[];
}

/** One replayed row: its plain source, and whether `\G`/`\K` make it depend on the scan. */
interface ReplayRow {
  readonly row: string;
  readonly source: string;
  readonly searchDependent: boolean;
}

/**
 * The replay's compiled rows. A row is compiled once, unless `\G` or `\K`
 * make its source depend on the scan offset; the non-empty retry adds an
 * end bound per offset. All memoized.
 */
class ReplayRows {
  private readonly cache = new Map<string, ReplayRegex | null>();
  private execs = 0;

  /** @param rows The replayed rows, all translatable. */
  constructor(readonly rows: readonly ReplayRow[]) {}

  /**
   * Row `index`'s first match from `from` (`sticky`: only at `from`).
   *
   * @param index The row's index.
   * @param from Where to search; also the scan offset `\G` asserts.
   * @param nonEmpty Require a non-empty match at exactly `from` (PCRE's
   *   retry after an empty match).
   */
  matchFrom(index: number, from: number, nonEmpty: boolean): ReplayMatch | null {
    // Charged before compiling, so the budget bounds compilation too.
    if (++this.execs > PCRE_LIMITS.replayExecs) throw new ReplayBudgetExceeded();
    const compiled = this.compiled(index, from, nonEmpty);
    if (compiled === null) return null;
    compiled.regex.lastIndex = from;
    const match = compiled.regex.exec(PRECHECK_SUBJECT);
    if (match === null) return null;
    let replaceStart = match.index;
    for (const group of compiled.keepGroups) {
      const keep = match.indices?.[group]?.[0];
      if (keep !== undefined && keep > replaceStart) replaceStart = keep;
    }
    return { row: index, start: match.index, replaceStart, end: match.index + match[0].length };
  }

  /** Row `index` compiled for one search (memoized). */
  private compiled(index: number, from: number, nonEmpty: boolean): ReplayRegex | null {
    const row = this.rows[index];
    if (row === undefined) return null;
    const offset = row.searchDependent || nonEmpty ? from : -1;
    const key = `${String(index)}:${String(offset)}:${String(nonEmpty)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    let source = row.source;
    let keepGroups: readonly number[] = [];
    if (row.searchDependent) {
      const emitted = emitRow('defer_all_js', row.row, { searchStart: from });
      // Unreachable failure: the row translated in matching mode.
      source = isEmitted(emitted) ? emitted.source : '[^\\s\\S]';
      keepGroups = isEmitted(emitted) ? emitted.keepGroups : [];
    }
    // The match must end past `from`: the lookbehind counts at least one more unit.
    const tail = nonEmpty ? `(?<=^[\\s\\S]{${String(from + 1)},})` : '';
    const compiled = {
      regex: new RegExp(`(?:${source})${tail}`, nonEmpty ? 'yd' : 'gd'),
      keepGroups
    };
    this.cache.set(key, compiled);
    return compiled;
  }

  /** The leftmost match from `from`; at equal starts, the first row (joined alternation order). */
  leftmost(from: number): ReplayMatch | null {
    let best: ReplayMatch | null = null;
    for (const index of this.rows.keys()) {
      const match = this.matchFrom(index, from, false);
      if (match !== null && (best === null || match.start < best.start)) best = match;
      if (best?.start === from) break;
    }
    return best;
  }

  /** The first row matching non-empty at exactly `at` (the retry after an empty match). */
  nonEmptyAt(at: number): ReplayMatch | null {
    for (const index of this.rows.keys()) {
      const match = this.matchFrom(index, at, true);
      if (match !== null) return match;
    }
    return null;
  }
}

/**
 * Replay `preg_replace(joined, '', 'dummy-string')` with the rows' JS
 * equivalents: PCRE's global scan, where an empty match is followed by a
 * non-empty anchored retry at the same position before one byte is copied.
 * Exact when every row translates and none behaves differently joined.
 *
 * @param rows The rows, all translatable.
 * @returns The rows (indexes into `rows`) whose matches consumed text when
 *   what remains is falsy in PHP (`''` or `'0'`); `null` when the pre-check passes.
 */
function precheckConsumers(rows: readonly ReplayRow[]): ReadonlySet<number> | null {
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

/**
 * Rows declaring a group name an earlier row declared, where joined PCRE
 * rejects the duplicate: unless the `J` option is in force at the second
 * declaration — set in that row, or left on at the top level of an earlier
 * one (it leaks forward through the wrapper group). A branch reset never
 * licenses a name across rows. Both rows of a clash are returned.
 *
 * @param rows Indexes and analyses of the rows joined, in order.
 */
function nameClashRows(rows: readonly (readonly [number, RowAnalysis])[]): ReadonlySet<number> {
  const clashes = new Set<number>();
  const declaredIn = new Map<string, number[]>();
  let carried = false;
  for (const [index, analysis] of rows) {
    for (const { name, duplicatesAllowed } of analysis.names) {
      const earlier = declaredIn.get(name) ?? [];
      if (earlier.length > 0 && !(duplicatesAllowed ?? carried)) {
        clashes.add(index);
        for (const other of earlier) clashes.add(other);
      }
    }
    for (const { name } of analysis.names) {
      const list = declaredIn.get(name) ?? [];
      if (!list.includes(index)) list.push(index);
      declaredIn.set(name, list);
    }
    carried = analysis.duplicatesAllowedAtEnd ?? carried;
  }
  return clashes;
}

/** Whether a row can be replayed exactly: kept by the save, translated, safe, unaffected by the join. */
function replayable(analysis: RowAnalysis): boolean {
  return (
    analysis.save.outcome === 'kept' &&
    analysis.source !== null &&
    analysis.risk === null &&
    analysis.absoluteBackreference === null
  );
}

/**
 * Defer JS's page state and the rows behind a page-off. A row PCRE rejects
 * turns the page off by itself (stored, it breaks the joined pattern); the
 * rows the save keeps are then checked for an open `\Q`, clashing group
 * names, and — when every one replays exactly — the `dummy-string` replay.
 *
 * @param rows The stored rows.
 * @param analyses Their analyses.
 */
function deferPage(
  rows: readonly string[],
  analyses: readonly RowAnalysis[]
): { readonly page: PageState; readonly offRows: ReadonlySet<number> } {
  const dropped = analyses.some((analysis) => analysis.save.outcome === 'dropped');
  const kept = analyses
    .map((analysis, index) => [index, analysis] as const)
    .filter(([, analysis]) => analysis.save.outcome !== 'dropped');
  const breakers = new Set(kept.filter(([, analysis]) => analysis.breaksJoin).map(([i]) => i));
  if (breakers.size > 0) return { page: 'off', offRows: breakers };
  const clashes = nameClashRows(kept);
  if (clashes.size > 0) return { page: 'off', offRows: clashes };
  const leaks = kept.some(([, analysis], position) => {
    return analysis.topLevelOption !== null && position < kept.length - 1;
  });
  if (leaks || !kept.every(([, analysis]) => replayable(analysis))) {
    return { page: dropped ? 'off' : 'unknown', offRows: new Set() };
  }
  let consumers: ReadonlySet<number> | null;
  try {
    consumers = precheckConsumers(
      kept.map(([index, analysis]) => ({
        row: rows[index] ?? '',
        source: analysis.source ?? '',
        searchDependent: analysis.searchDependent
      }))
    );
  } catch (error) {
    if (!(error instanceof ReplayBudgetExceeded)) throw error;
    return { page: dropped ? 'off' : 'unknown', offRows: new Set() };
  }
  const offRows = new Set([...(consumers ?? [])].map((position) => kept[position]?.[0] ?? -1));
  return { page: consumers !== null || dropped ? 'off' : 'on', offRows };
}

/** Backticked construct text for a reason. */
function quoted(construct: PcreConstruct): string {
  return `\`${construct.construct}\` (${construct.detail})`;
}

/** What the set says about one row. */
interface JoinedFacts {
  readonly pageOff: boolean;
  readonly last: boolean;
}

/**
 * A row's most decisive problem, or `null`. Order: what the save does
 * first (a dropped row, or one whose fate is not modeled — then nothing is
 * claimed about what WP Rocket stores), then the page-wide Defer failure,
 * `match-all`, the runtime translation, the joined effects, the
 * backtracking guard.
 */
function rowProblem(
  feature: RegexFeatureId,
  analysis: RowAnalysis,
  joined: JoinedFacts
): RowProblem | null {
  const { save } = analysis;
  if (save.outcome === 'dropped') {
    const live =
      feature === 'delay_js'
        ? 'added through a filter, it never matches'
        : 'added through a filter, it turns Defer JS off on the page';
    return {
      problem: 'pcre-invalid',
      construct: save.construct,
      reason: `WP Rocket drops this row when saving: PCRE rejects ${quoted(save)}; ${live}`
    };
  }
  if (analysis.tooLong) {
    return {
      problem: 'pcre-only',
      construct: null,
      reason: `This row is too long to check here (over ${String(PCRE_LIMITS.rowBytes)} bytes)`
    };
  }
  if (save.outcome === 'unknown') {
    return {
      problem: 'pcre-only',
      construct: save.construct,
      reason: `PCRE-only syntax: ${quoted(save)} — not checked here, and WP Rocket may drop this row when saving`
    };
  }
  if (joined.pageOff) {
    return {
      problem: 'joined-page-off',
      construct: null,
      reason:
        'Joined with the other rows, WP Rocket’s Defer JS check fails on this row: it would defer no script on the page'
    };
  }
  if (analysis.matchesAll) {
    return {
      problem: 'match-all',
      construct: null,
      reason: 'WP Rocket stores this and it excludes every script'
    };
  }
  // An option leaking into later rows changes them: that outranks the row's own syntax.
  const leak = feature === 'defer_all_js' && !joined.last ? analysis.topLevelOption : null;
  if (analysis.pcreOnly !== null && leak === null) {
    return {
      problem: 'pcre-only',
      construct: analysis.pcreOnly.construct,
      reason: `PCRE-only syntax: ${quoted(analysis.pcreOnly)} — not checked here`
    };
  }
  const shift = feature === 'defer_all_js' ? analysis.absoluteBackreference : null;
  const changes = leak ?? shift;
  if (changes !== null) {
    return {
      problem: 'joined-changes-matching',
      construct: changes.construct,
      reason: `Joined with the other Defer JS rows, ${quoted(changes)} matches differently on WP Rocket`
    };
  }
  if (analysis.risk !== null) {
    return {
      problem: 'backtracking-risk',
      construct: null,
      reason:
        analysis.risk === 'too-complex'
          ? 'This row is too long or too deeply nested to check for slow matching — shorten it'
          : BACKTRACKING_RISK_REASONS[analysis.risk]
    };
  }
  return null;
}

/**
 * Translate a regex feature's stored rows: each row's JS matcher and its
 * most decisive problem, plus Defer JS's page state.
 *
 * @param feature `delay_js` or `defer_all_js`.
 * @param rows The stored rows, in order.
 */
export function translateRegexRows(
  feature: RegexFeatureId,
  rows: readonly string[]
): RegexRowsTranslation {
  const analyses = rows.map((row) => analyzeRow(feature, row));
  const { page, offRows } =
    feature === 'defer_all_js'
      ? deferPage(rows, analyses)
      : { page: 'on' as const, offRows: new Set<number>() };
  const translated = rows.map((row, index): TranslatedRow => {
    const analysis = analyses[index] as RowAnalysis;
    const { source, risk } = analysis;
    return {
      row,
      matcher: source !== null && risk === null ? { source, flags: '' } : null,
      problem: rowProblem(feature, analysis, {
        pageOff: offRows.has(index),
        last: index === rows.length - 1
      })
    };
  });
  return { rows: translated, page };
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
