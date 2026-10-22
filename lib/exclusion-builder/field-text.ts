/**
 * Exclusion rows in the form WP Rocket's settings store them — the single
 * declaring site of that normalization. "Save Changes" runs each field's
 * rows through, in order:
 *
 * 1. split on LF, PHP `trim` each line, drop `''` and `"0"`;
 * 2. WordPress `sanitize_text_field` (`./wordpress/sanitize-text-field`),
 *    then drop `''`/`"0"` again;
 * 3. Delay JS only: `rocket_clean_wildcards` (every `*` spelling becomes
 *    `(.*)`), then drop `''`/`"0"` again;
 * 4. keep the first occurrence of each row;
 * 5. Delay JS only, when "Safe Mode for jQuery" is on: remove its three
 *    patterns;
 * 6. Delay JS and Defer JS: remove rows PCRE rejects (the form-submit check
 *    `@preg_match('#row#', …) === false`, `#` escaped).
 *
 * Image Lazyload has no wildcard step and no pattern check. Automatic Lazy
 * Rendering has no field: its rows reach WP Rocket only through a PHP
 * filter, as written (identity here).
 *
 * The editor keeps what was typed; the per-row diff says what WP Rocket
 * stores instead, and the session applies the stored rows.
 */
import { saveOutcome, type SaveOutcome } from './pcre/translate';
import type { ExclusionFeatureId } from './set';
import type { StoredRowDropReason } from './stored-row-drops';
import { phpTrim } from './wordpress/php-trim';
import { sanitizeTextField, submittedText } from './wordpress/sanitize-text-field';

/** A typed row: text, or the raw bytes of a submitted line (which may not be UTF-8). */
export type SubmittedRow = string | Uint8Array;

/** What the save is told beyond the rows. */
export interface SaveOptions {
  /**
   * Delay JS "Safe Mode for jQuery": `true` removes its three patterns,
   * `false` keeps them; unknown (the extension cannot read the setting)
   * keeps them and flags them ({@link KeptRowDiff.dropsInSafeMode}).
   */
  readonly safeMode?: boolean;
}

/** What a kept row's diff always carries. */
interface KeptRowDiff {
  /** The row's position among the stored rows. */
  readonly index: number;
  /** Delay JS, safe mode unknown: WP Rocket drops this row when Safe Mode for jQuery is on. */
  readonly dropsInSafeMode?: true;
}

/** What the save does with one typed row. */
export type StoredRowDiff =
  /** Stored exactly as typed. */
  | ({ readonly state: 'unchanged' } & KeptRowDiff)
  /** Stored, but as `text`. */
  | ({ readonly state: 'stored-as'; readonly text: string } & KeptRowDiff)
  /**
   * Kept here as `text` (equal to the typed row or not), but whether WP
   * Rocket's pattern check keeps it is not modeled — PCRE syntax `construct`
   * ("can't verify WP Rocket keeps this").
   */
  | ({
      readonly state: 'unverified';
      readonly text: string;
      readonly construct: string;
      readonly detail: string;
    } & KeptRowDiff)
  /** Not stored; an `invalid-pattern` drop names the construct PCRE rejects. */
  | {
      readonly state: 'dropped';
      readonly reason: StoredRowDropReason;
      readonly construct?: string;
      readonly detail?: string;
    };

/** A field's rows as stored, plus what happened to each typed row. */
export interface SavedRows {
  /** The stored rows, in order. */
  readonly rows: readonly string[];
  /** One diff per typed row, in typed order. */
  readonly diffs: readonly StoredRowDiff[];
}

/** The features whose save runs the form-submit pattern check. */
const PATTERN_CHECKED: ReadonlySet<ExclusionFeatureId> = new Set(['delay_js', 'defer_all_js']);

/**
 * The three Delay JS patterns "Safe Mode for jQuery" removes from the
 * stored rows (WP Rocket's own safe-mode exclusions, as stored).
 */
export const SAFE_MODE_DELAY_ROWS: readonly string[] = [
  '\\/jquery(-migrate)?-?([0-9.]+)?(.min|.slim|.slim.min)?.js(\\?(.*))?( |\'|"|>)',
  'js-(before|after)',
  '(?:/wp-content/|/wp-includes/)(.*)'
];

/** The wildcard spellings `rocket_clean_wildcards` rewrites, longest first. */
const WILDCARDS = ['(.*)', '(*)', '.*', '*'] as const;

/** What every wildcard spelling becomes. */
const WILDCARD_FORM = '(.*)';

/**
 * WP Rocket's `rocket_clean_wildcards`: `.*`, `*`, `(*)` and `(.*)` all
 * become `(.*)`, left to right, the longest spelling first, without
 * re-scanning — so every `*` is rewritten, a quantifier or not (`\d*` →
 * `\d(.*)`, `\*` → `\(.*)`). It splits on `/` first, but no spelling holds
 * one, so the whole row is rewritten at once. `''` and `"0"` (PHP-falsy)
 * become `''`.
 *
 * @param row The sanitized row.
 */
export function cleanWildcards(row: string): string {
  if (row === '0') return '';
  let out = '';
  let index = 0;
  while (index < row.length) {
    const spelling = WILDCARDS.find((candidate) => row.startsWith(candidate, index));
    if (spelling === undefined) {
      out += row.charAt(index);
      index++;
    } else {
      out += WILDCARD_FORM;
      index += spelling.length;
    }
  }
  return out;
}

/** Why a row never got a form: emptied (`''`) or `"0"` — PHP's `array_filter`. */
function emptiedReason(text: string): 'empty' | 'zero' | null {
  if (text === '') return 'empty';
  return text === '0' ? 'zero' : null;
}

/** One row's per-row stages: its stored form, or why it is dropped first. */
type RowForm =
  { readonly form: string; readonly typed: string } | { readonly reason: 'empty' | 'zero' };

/**
 * One row through the per-row stages (trim, sanitize, Delay wildcards).
 *
 * @param feature The field's feature.
 * @param row The typed row.
 */
function rowForm(feature: ExclusionFeatureId, row: SubmittedRow): RowForm {
  if (feature === 'automatic_lazy_rendering') {
    // Rows reach it through a PHP filter, as written.
    const written = typeof row === 'string' ? row : new TextDecoder().decode(row);
    return { form: written, typed: written };
  }
  const typed = submittedText(row);
  // Not UTF-8: a non-empty row that sanitizes to ''.
  if (typed === null) return { reason: 'empty' };
  const steps: readonly ((text: string) => string)[] =
    feature === 'delay_js'
      ? [phpTrim, sanitizeTextField, cleanWildcards]
      : [phpTrim, sanitizeTextField];
  let form = typed;
  for (const step of steps) {
    form = step(form);
    const reason = emptiedReason(form);
    if (reason !== null) return { reason };
  }
  return { form, typed };
}

/**
 * A row's stored form before the set-level steps (dedupe, safe mode, the
 * pattern check): the text WP Rocket compares rows by, or `null` when the
 * row is dropped as empty or `"0"`. Two typed rows with the same key are
 * one row once stored.
 *
 * @param feature The field's feature.
 * @param row The typed row.
 */
export function storedRowKey(feature: ExclusionFeatureId, row: SubmittedRow): string | null {
  const result = rowForm(feature, row);
  return 'form' in result ? result.form : null;
}

/** Pattern-check verdicts kept before the memo restarts. */
const OUTCOME_MEMO_CAPACITY = 4_096;

/** Pattern-check verdicts by stored row (the parse is the costly step; rows recur per edit). */
const outcomeMemo = new Map<string, SaveOutcome>();

/** {@link saveOutcome}, memoized. */
function patternCheck(row: string): SaveOutcome {
  const cached = outcomeMemo.get(row);
  if (cached !== undefined) return cached;
  const outcome = saveOutcome(row);
  if (outcomeMemo.size >= OUTCOME_MEMO_CAPACITY) outcomeMemo.clear();
  outcomeMemo.set(row, outcome);
  return outcome;
}

/**
 * The set-level verdict on a deduplicated form: dropped, or kept with its
 * flags.
 */
function setLevelVerdict(
  feature: ExclusionFeatureId,
  form: string,
  options: SaveOptions
):
  | { readonly dropped: StoredRowDiff & { readonly state: 'dropped' } }
  | { readonly dropsInSafeMode: boolean; readonly unverified: SaveOutcome | null } {
  let dropsInSafeMode = false;
  if (feature === 'delay_js' && SAFE_MODE_DELAY_ROWS.includes(form)) {
    if (options.safeMode === true) return { dropped: { state: 'dropped', reason: 'safe-mode' } };
    dropsInSafeMode = options.safeMode === undefined;
  }
  if (!PATTERN_CHECKED.has(feature)) return { dropsInSafeMode, unverified: null };
  const outcome = patternCheck(form);
  if (outcome.outcome === 'dropped') {
    const { construct, detail } = outcome;
    return { dropped: { state: 'dropped', reason: 'invalid-pattern', construct, detail } };
  }
  return { dropsInSafeMode, unverified: outcome.outcome === 'unknown' ? outcome : null };
}

/**
 * The kept row's diff.
 *
 * @param typed The typed row as text.
 * @param form Its stored form.
 * @param index Its position among the stored rows.
 * @param dropsInSafeMode Whether to flag it as a safe-mode pattern.
 * @param unverified The pattern check's `unknown` verdict, when it is one.
 */
function keptDiff(
  typed: string,
  form: string,
  index: number,
  dropsInSafeMode: boolean,
  unverified: SaveOutcome | null
): StoredRowDiff {
  const flag = dropsInSafeMode ? { dropsInSafeMode: true as const } : {};
  if (unverified !== null && unverified.outcome !== 'kept') {
    const { construct, detail } = unverified;
    return { state: 'unverified', text: form, construct, detail, index, ...flag };
  }
  return typed === form
    ? { state: 'unchanged', index, ...flag }
    : { state: 'stored-as', text: form, index, ...flag };
}

/**
 * A field's typed rows through WP Rocket's settings save: the rows it
 * stores and, per typed row, what became of it — the one function every
 * consumer of the stored form reads.
 *
 * @param feature The field's feature.
 * @param typed The rows as typed (one per line), in order.
 * @param options What the save is told beyond the rows (safe mode).
 */
export function saveExclusionRows(
  feature: ExclusionFeatureId,
  typed: readonly SubmittedRow[],
  options: SaveOptions = {}
): SavedRows {
  const rows: string[] = [];
  const seen = new Set<string>();
  const diffs = typed.map((row): StoredRowDiff => {
    const result = rowForm(feature, row);
    if (!('form' in result)) return { state: 'dropped', reason: result.reason };
    if (feature === 'automatic_lazy_rendering') {
      rows.push(result.form);
      return { state: 'unchanged', index: rows.length - 1 };
    }
    if (seen.has(result.form)) return { state: 'dropped', reason: 'duplicate' };
    seen.add(result.form);
    const verdict = setLevelVerdict(feature, result.form, options);
    if ('dropped' in verdict) return verdict.dropped;
    rows.push(result.form);
    return keptDiff(
      result.typed,
      result.form,
      rows.length - 1,
      verdict.dropsInSafeMode,
      verdict.unverified
    );
  });
  return { rows, diffs };
}

/**
 * The rows WP Rocket stores for a field's typed rows (see
 * {@link saveExclusionRows}).
 *
 * @param feature The field's feature.
 * @param typed The rows as typed.
 * @param options Safe mode, when known.
 */
export function storedExclusionRows(
  feature: ExclusionFeatureId,
  typed: readonly SubmittedRow[],
  options: SaveOptions = {}
): readonly string[] {
  return saveExclusionRows(feature, typed, options).rows;
}

/** The separator between rows in the settings field (one row per line). */
const FIELD_LINE_SEPARATOR = '\n';

/**
 * Stored rows as text to paste into the settings field: one per line
 * (`\n`, no trailing newline — the form the settings page itself renders
 * the list in), so pasting and saving it stores the same rows again.
 *
 * @param stored Rows as WP Rocket stores them ({@link storedExclusionRows}).
 * @returns The field text (empty for no rows).
 */
export function exclusionFieldText(stored: readonly string[]): string {
  return stored.join(FIELD_LINE_SEPARATOR);
}

/**
 * One row as the save's first step leaves it: PHP-`trim`med (space, tab,
 * LF, CR, NUL and vertical tab — wider Unicode spaces such as the no-break
 * space are kept, as the save keeps them). The editor commits a row this
 * way when it is left, and a row empty once trimmed is a blank edit.
 *
 * @param row The row as typed.
 * @returns The trimmed row (empty when the row was whitespace only).
 */
export function trimExclusionRow(row: string): string {
  return phpTrim(row);
}

/**
 * The rows the editor commits: each trimmed ({@link trimExclusionRow}),
 * blank ones dropped, order and duplicates kept — typed text, not the
 * stored form (that is {@link saveExclusionRows}).
 *
 * @param rows The rows as typed.
 */
export function committedFieldRows(rows: readonly string[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    const line = trimExclusionRow(row);
    if (line !== '') lines.push(line);
  }
  return lines;
}

/**
 * Characters a stored row keeps that a reader cannot tell apart from a
 * plain space or from nothing: every non-ASCII whitespace (no-break,
 * narrow, ideographic, line-separator spaces, BOM…) and the zero-width
 * marks (zero-width space/joiners, word joiner, next line, soft hyphen).
 */
const INVISIBLE_KEPT = /[^\S \t\n\r\v\f]|[​-‍⁠\u0085­]/;

/**
 * Whether a row carries characters the save keeps but the editor cannot
 * show for what they are — so a row that looks right silently fails to
 * match (a no-break space never matches a typed space).
 *
 * @param row The row as typed.
 */
export function hasInvisibleKeptCharacters(row: string): boolean {
  return INVISIBLE_KEPT.test(trimExclusionRow(row));
}

/**
 * Split field text into lines the way the settings field reads it: a
 * textarea's value normalizes every CRLF and lone CR to LF (HTML's API
 * value), and the save splits on LF — so a lone CR breaks a line too.
 *
 * @param text Text bound for the field (a paste, the row around it).
 * @returns The lines, untrimmed (empty ones kept).
 */
export function splitFieldText(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}
