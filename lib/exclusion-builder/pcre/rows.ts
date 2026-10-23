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
import { createBoundedMemo, detachedString, stringBytes } from '../../../utils/bounded-memo';
import { capText } from '../../../utils/cap-text';
import type { InvalidExclusionRow } from '../errors';
import { ROW_REASONS } from '../row-reasons';
import type { ProblemId } from './problems';
import {
  analyzeRow,
  emitRow,
  uncheckedRow,
  isEmitted,
  PCRE_LIMITS,
  toByteString,
  type PcreConstruct,
  type RegexFeatureId,
  type RowAnalysis,
  type SaveOutcome
} from './translate';

/**
 * A JS matcher for one row: its source matches the subject's byte string
 * (see {@link compileFirstMatch}, which does the encoding). Case folding is in
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

/** The matcher of a row that matches every subject: the empty pattern. */
const MATCH_EVERYTHING: PcreMatcher = { source: '', flags: '' };

/** One row's translation. */
export interface TranslatedRow {
  readonly row: string;
  /**
   * The exact JS equivalent of the row's runtime pattern, when one exists and
   * is safe to run — kept with a page-off problem. A `match-all` row gets
   * the empty pattern, which matches every subject as the row does (even
   * where its own syntax has no JS equivalent, e.g. `(?a)`). `null` when the
   * row has no proven translation, its save fate is not modeled
   * (unverified), is a backtracking risk, or matches differently joined
   * (`joined-changes-matching`).
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
 * The translation memos' bounds, declared once, in retained bytes (not only
 * entries): every realm that validates keeps them — the overlay inside host
 * pages included — so the worst case stays under half a mebibyte whatever
 * rows come. The weights are upper bounds of what Chromium retains after GC
 * (heap measured per shape: short, long, two-byte, class-heavy rows).
 */
export const TRANSLATION_CACHE_LIMITS = {
  /** Row analyses kept at most (a set of up to this many short rows translates from the memo). */
  analysisEntries: 256,
  /** Estimated bytes the analysis memo keeps. */
  analysisBytes: 256 * 1024,
  /** Compiled regexes kept at most. */
  regexEntries: 256,
  /** Estimated bytes the compiled-regex memo keeps. */
  regexBytes: 192 * 1024,
  /**
   * Save checks kept at most: every row of two full lanes (Delay and Defer,
   * 500 each), so committing an unchanged lane (each Apply commits every
   * row) never re-analyses its rows.
   */
  saveEntries: 1024,
  /** Bytes the save-check memo keeps. */
  saveBytes: 384 * 1024
} as const;

/**
 * Fixed bytes of one kept analysis (its record, arrays and entry): measured
 * 1.4–2.4 KiB for short rows.
 */
const ANALYSIS_ENTRY_BYTES = 2560;
/**
 * Bytes per byte of an analysis's key and source: the strings plus what is
 * derived from them (constructs, names) — measured up to about twice.
 */
const ANALYSIS_BYTES_PER_STRING_BYTE = 2;
/** Fixed bytes of one kept regex (its record and entry). */
const REGEX_ENTRY_BYTES = 1024;
/**
 * Compiled bytes per source character of a regex once it has run: measured
 * 3 (literal two-byte text) to 80 (byte classes) on V8's native code.
 */
export const REGEX_BYTES_PER_CHAR = 80;

/** Compiled sources (a source already carries its feature's escapes, so it is the whole key). */
const regexMemo = createBoundedMemo<RegExp>({
  maxEntries: TRANSLATION_CACHE_LIMITS.regexEntries,
  maxWeight: TRANSLATION_CACHE_LIMITS.regexBytes,
  weigh: (source) => REGEX_ENTRY_BYTES + stringBytes(source) + REGEX_BYTES_PER_CHAR * source.length
});

/**
 * A compiled matcher over a subject already encoded with `toByteString` —
 * for callers testing one subject against many rows, which encode it once.
 * The compiled regex is memoized by source and stateless (no `g`/`y`).
 *
 * @param matcher A row's matcher.
 * @returns A test over the subject's byte string.
 */
export function compileByteMatcher(matcher: PcreMatcher): (bytes: string) => boolean {
  const regex = regexMemo.get(matcher.source, () => new RegExp(matcher.source, matcher.flags));
  return (bytes) => regex.test(bytes);
}

/** Row analyses by feature + row: the same text translates differently per feature (escapes). */
const analysisMemo = createBoundedMemo<RowAnalysis>({
  maxEntries: TRANSLATION_CACHE_LIMITS.analysisEntries,
  maxWeight: TRANSLATION_CACHE_LIMITS.analysisBytes,
  weigh: (key, analysis) =>
    ANALYSIS_ENTRY_BYTES +
    ANALYSIS_BYTES_PER_STRING_BYTE *
      (stringBytes(key) + (analysis.source === null ? 0 : stringBytes(analysis.source)))
});

/**
 * {@link analyzeRow}, memoized: validation and matching translate the same
 * rows on every apply, and analysis (parse, save check, risk guard) is the
 * costly part.
 *
 * @param feature The row's feature (part of the key).
 * @param row The stored row.
 */
function cachedAnalysis(feature: RegexFeatureId, row: string): RowAnalysis {
  // The analysis keeps strings cut from the row: never from a larger text it was cut from.
  return analysisMemo.get(`${feature}\u0000${row}`, () => analyzeRow(feature, detachedString(row)));
}

/** Fixed bytes of one kept save check (its entry and record; measured ≈ 100 for a kept row). */
const SAVE_ENTRY_BYTES = 192;

/**
 * Save checks by feature + row, apart from the analyses: a check is small
 * (an outcome, and for a dropped or unverified row the construct and why),
 * so a whole lane's checks stay cached where its analyses (kilobytes each)
 * cannot.
 */
const saveMemo = createBoundedMemo<SaveOutcome>({
  maxEntries: TRANSLATION_CACHE_LIMITS.saveEntries,
  maxWeight: TRANSLATION_CACHE_LIMITS.saveBytes,
  weigh: (key, save) =>
    SAVE_ENTRY_BYTES +
    stringBytes(key) +
    // Its strings may be cut from the (detached) row: counted as the whole row.
    (save.outcome === 'kept' ? 0 : stringBytes(key) + stringBytes(save.detail))
});

/**
 * WP Rocket's settings-save check on a stored row, from the analysis
 * validation and matching share (one parse), memoized on its own.
 *
 * @param feature The row's feature (`delay_js` or `defer_all_js`).
 * @param row The row in its stored form.
 */
export function rowSaveOutcome(feature: RegexFeatureId, row: string): SaveOutcome {
  return saveMemo.get(`${feature}\u0000${row}`, () => cachedAnalysis(feature, row).save);
}

/** What the save-check memo keeps now (entries, bytes by its weights): its bound is pinned by tests. */
export function saveCheckCacheUsage(): { readonly entries: number; readonly bytes: number } {
  return { entries: saveMemo.size, bytes: saveMemo.weight };
}

/**
 * Compiled matchers tested as one ordered set — WP Rocket's "first row that
 * matches" reading: the subject is encoded once, then each row's matcher
 * runs in list order (rows without one are skipped).
 *
 * @param matchers The rows' matchers, in list order (`null` = no matcher).
 * @returns A stateless lookup of the first matching row's index, or `-1`.
 */
export function compileFirstMatch(
  matchers: readonly (PcreMatcher | null)[]
): (subject: string) => number {
  const tests = matchers.map((matcher) => (matcher === null ? null : compileByteMatcher(matcher)));
  if (tests.every((test) => test === null)) return () => -1;
  return (subject) => {
    const bytes = toByteString(subject);
    return tests.findIndex((test) => test !== null && test(bytes));
  };
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
  /** The fewest bytes a match spans (`NaN` = not measured). */
  readonly minLength: number;
}

/**
 * The replay's compiled rows. A row is compiled once, unless `\G` or `\K`
 * make its source depend on the scan offset; the non-empty retry adds an
 * end bound per offset. All memoized.
 */
class ReplayRows {
  private readonly cache = new Map<string, ReplayRegex | null>();
  /**
   * Per offset-independent row, its last search: a match found from `from`
   * is still the first one from any later offset up to its start, and no
   * match from `from` means none from later — so most searches are reused.
   */
  private readonly last = new Map<number, { from: number; match: ReplayMatch | null }>();
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
    // A row needing more bytes than are left cannot match: no regex needed.
    const minLength = this.rows[index]?.minLength ?? NaN;
    if (minLength > PRECHECK_SUBJECT.length - from) return null;
    const reusable = !nonEmpty && this.rows[index]?.searchDependent === false;
    if (reusable) {
      const last = this.last.get(index);
      if (last !== undefined && last.from <= from && (last.match?.start ?? Infinity) >= from) {
        return last.match;
      }
    }
    const match = this.search(index, from, nonEmpty);
    if (reusable) this.last.set(index, { from, match });
    return match;
  }

  /** One regex execution of {@link matchFrom}, charged to the budget. */
  private search(index: number, from: number, nonEmpty: boolean): ReplayMatch | null {
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
 * Whether the rows' parentheses, joined as `(r1|r2|…)`, balance out: the
 * depth never drops below zero and ends at zero. `null` when a row's
 * balance is unknown.
 */
function joinedParensBalance(analyses: readonly RowAnalysis[]): boolean | null {
  let depth = 1;
  for (const { parens } of analyses) {
    if (parens === null) return null;
    if (depth + parens.min < 0) return false;
    depth += parens.net;
  }
  return depth === 1;
}

/**
 * What the stored rows WP Rocket's save would drop do to the joined
 * pattern (a stored set holds them only through a PHP filter). A proven
 * error that no join repairs breaks it: `off`. Errors a join can repair —
 * a group reference (the wrapper is group 1 and other rows add groups and
 * names), a construct running to the row's end with a row after it,
 * a repeated name after an earlier row's `J`, a parenthesis imbalance the
 * other rows balance — or a row after one that may merge into it:
 * `unknown`. `null` when no row is dropped.
 */
function droppedRowsPage(analyses: readonly RowAnalysis[]): PageState | null {
  const verdicts = new Set<PageState | 'parens'>();
  let mergeBefore = false;
  let duplicatesBefore = false;
  for (const analysis of analyses) {
    if (analysis.save.outcome === 'dropped') {
      verdicts.add(dropVerdict(analysis, mergeBefore, duplicatesBefore));
      mergeBefore ||= analysis.dropRepairs.includes('open-end') || analysis.breaksJoin;
    }
    duplicatesBefore ||= analysis.duplicatesAllowedAtEnd === true;
  }
  if (verdicts.has('off')) return 'off';
  if (verdicts.has('unknown')) return 'unknown';
  if (!verdicts.has('parens')) return null;
  return joinedParensBalance(analyses) === false ? 'off' : 'unknown';
}

/**
 * One dropped row's effect on the joined pattern (see {@link droppedRowsPage});
 * `parens` when only the set's parenthesis balance can tell.
 *
 * @param analysis The dropped row.
 * @param mergeBefore An earlier dropped row may run into this one.
 * @param duplicatesBefore An earlier row leaves `J` on.
 */
function dropVerdict(
  analysis: RowAnalysis,
  mergeBefore: boolean,
  duplicatesBefore: boolean
): PageState | 'parens' {
  const repairs = analysis.dropRepairs;
  // An open `\Q` quotes the rest of the join, wrapper `)` included.
  if (mergeBefore || analysis.breaksJoin) return 'unknown';
  if (repairs.includes('fixed')) return 'off';
  if (repairs.includes('open-end') || repairs.includes('reference')) return 'unknown';
  if (repairs.includes('names')) return duplicatesBefore ? 'unknown' : 'off';
  return 'parens';
}

/**
 * Defer JS's page state and the rows behind a page-off. Rows the save
 * would drop are judged first ({@link droppedRowsPage}); the rows it keeps
 * are then checked for an open `\Q`, clashing group names, and — when every
 * row replays exactly — the `dummy-string` replay.
 *
 * @param rows The stored rows.
 * @param analyses Their analyses.
 */
function deferPage(
  rows: readonly string[],
  analyses: readonly RowAnalysis[]
): { readonly page: PageState; readonly offRows: ReadonlySet<number> } {
  const droppedPage = droppedRowsPage(analyses);
  // A row a join may repair can also rebalance or license the others: no claim.
  if (droppedPage === 'unknown') return { page: 'unknown', offRows: new Set() };
  // Off already; the kept rows are still checked to flag the rows behind it.
  const kept = analyses
    .map((analysis, index) => [index, analysis] as const)
    .filter(([, analysis]) => analysis.save.outcome !== 'dropped');
  const breakers = new Set(kept.filter(([, analysis]) => analysis.breaksJoin).map(([i]) => i));
  if (breakers.size > 0) {
    // A later row's `\E` ends the quote, and the rest may compile (observed):
    // only a quote nothing closes is proven to break the joined pattern.
    const first = Math.min(...breakers);
    const closed = rows.slice(first + 1).some((row) => row.includes('\\E'));
    return closed ? { page: 'unknown', offRows: new Set() } : { page: 'off', offRows: breakers };
  }
  const clashes = nameClashRows(kept);
  if (clashes.size > 0) return { page: 'off', offRows: clashes };
  const leaks = kept.some(([, analysis], position) => {
    return analysis.topLevelOption !== null && position < kept.length - 1;
  });
  const off = droppedPage === 'off';
  if (leaks || !kept.every(([, analysis]) => replayable(analysis))) {
    return { page: off ? 'off' : 'unknown', offRows: new Set() };
  }
  let consumers: ReadonlySet<number> | null;
  try {
    consumers = precheckConsumers(
      kept.map(([index, analysis]) => ({
        row: rows[index] ?? '',
        source: analysis.source ?? '',
        searchDependent: analysis.searchDependent,
        minLength: analysis.minLength
      }))
    );
  } catch (error) {
    if (!(error instanceof ReplayBudgetExceeded)) throw error;
    return { page: off ? 'off' : 'unknown', offRows: new Set() };
  }
  const offRows = new Set([...(consumers ?? [])].map((position) => kept[position]?.[0] ?? -1));
  return { page: consumers !== null || off ? 'off' : 'on', offRows };
}

/**
 * Code points of a construct a reason echoes: the row travels beside the
 * reason, so a long construct (an unclosed group spans the rest of the row)
 * is cut, keeping every reason short.
 */
export const REASON_CONSTRUCT_MAX = 48;

/** Backticked construct text for a reason (long constructs cut, see {@link REASON_CONSTRUCT_MAX}). */
function quoted(construct: PcreConstruct): string {
  return `\`${capText(construct.construct, REASON_CONSTRUCT_MAX)}\` (${construct.detail})`;
}

/** What the set says about one row. */
interface JoinedFacts {
  readonly pageOff: boolean;
  readonly last: boolean;
}

/**
 * A row's most decisive problem, or `null`. Order: what the save does
 * first (a dropped row), then the page-wide Defer failure (an unverified
 * row included: the page state is read from the rows as given), then — a
 * row whose save fate is not modeled has no other problem: it matches
 * nothing and never blocks — `match-all`, the runtime translation, the
 * joined effects, the backtracking guard.
 */
function rowProblem(
  feature: RegexFeatureId,
  analysis: RowAnalysis,
  joined: JoinedFacts
): RowProblem | null {
  const { save } = analysis;
  if (save.outcome === 'dropped') {
    return {
      problem: 'pcre-invalid',
      construct: save.construct,
      reason: ROW_REASONS.droppedAtSave(feature, quoted(save))
    };
  }
  if (analysis.unchecked) {
    return {
      problem: 'pcre-only',
      construct: null,
      reason: ROW_REASONS.unchecked(save.outcome === 'kept' ? 'not analyzed' : save.detail)
    };
  }
  // Behind a page-off even when its save is not modeled: the page state is
  // read from the rows as given, so the row that breaks it must be named.
  if (joined.pageOff) {
    return {
      problem: 'joined-page-off',
      construct: null,
      reason: ROW_REASONS.joinedPageOff
    };
  }
  // Whether WP Rocket's save keeps the row is not modeled: no claim, and no
  // matcher either (see `translateRegexRows`) — it never blocks the set.
  if (save.outcome === 'unknown') return null;
  if (analysis.matchesAll) {
    return {
      problem: 'match-all',
      construct: null,
      reason: ROW_REASONS.matchAll
    };
  }
  // An option leaking into later rows changes them: that outranks the row's own syntax.
  const leak = feature === 'defer_all_js' && !joined.last ? analysis.topLevelOption : null;
  if (analysis.pcreOnly !== null && leak === null) {
    return {
      problem: 'pcre-only',
      construct: analysis.pcreOnly.construct,
      reason: ROW_REASONS.pcreOnly(quoted(analysis.pcreOnly))
    };
  }
  const shift = feature === 'defer_all_js' ? analysis.absoluteBackreference : null;
  const changes = leak ?? shift;
  if (changes !== null) {
    return {
      problem: 'joined-changes-matching',
      construct: changes.construct,
      reason: ROW_REASONS.joinedChangesMatching(quoted(changes))
    };
  }
  if (analysis.risk !== null) {
    return {
      problem: 'backtracking-risk',
      construct: null,
      reason: ROW_REASONS.backtracking(feature, analysis.risk)
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
  // Work budget: once the set has cost `setBytes`, later rows are not checked.
  let spent = 0;
  const analyses = rows.map((row) => {
    if (spent > PCRE_LIMITS.setBytes) {
      return uncheckedRow(row, 0, `past the ${String(PCRE_LIMITS.setBytes)}-byte set budget`);
    }
    const analysis = cachedAnalysis(feature, row);
    spent += analysis.bytes;
    return analysis;
  });
  const { page, offRows } =
    feature === 'defer_all_js'
      ? deferPage(rows, analyses)
      : { page: 'on' as const, offRows: new Set<number>() };
  const translated = rows.map((row, index): TranslatedRow => {
    const analysis = analyses[index] as RowAnalysis;
    const { source, risk } = analysis;
    const problem = rowProblem(feature, analysis, {
      pageOff: offRows.has(index),
      last: index === rows.length - 1
    });
    // Joined, the row matches differently from its own pattern: no exact
    // matcher; an unverified row (save fate not modeled) matches nothing.
    const joinedDiffers = problem?.problem === 'joined-changes-matching';
    const unverified = analysis.save.outcome === 'unknown';
    return {
      row,
      matcher:
        problem?.problem === 'match-all'
          ? MATCH_EVERYTHING
          : source !== null && risk === null && !joinedDiffers && !unverified
            ? { source, flags: '' }
            : null,
      problem
    };
  });
  return { rows: translated, page };
}

/**
 * A translation's row problems as validation entries carrying their problem
 * id — for callers that already hold the translation.
 *
 * @param feature `delay_js` or `defer_all_js`.
 * @param translation The feature's rows, translated.
 * @returns One entry per row with a problem, in row order.
 */
export function translationRowProblems(
  feature: RegexFeatureId,
  translation: RegexRowsTranslation
): InvalidExclusionRow[] {
  return translation.rows.flatMap((translated, index) =>
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
  return translationRowProblems(feature, translateRegexRows(feature, rows));
}
