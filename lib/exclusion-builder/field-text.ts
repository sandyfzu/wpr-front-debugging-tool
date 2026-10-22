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
 * The editor and the set hold rows in this stored form: a row turns into it
 * when committed, and the per-row diff (which carries the typed text) says
 * what changed, so the change can be shown and undone.
 */
import type { InvalidExclusionRow } from './errors';
import { rowSaveOutcome } from './pcre/rows';
import type { SaveOutcome } from './pcre/translate';
import { phpTrim } from './php/trim';
import { EXCLUSION_FEATURES, type ExclusionFeatureId, type ExclusionSet } from './set';
import type { StoredRowDropReason } from './stored-row-drops';
import { sanitizeTextField, submittedText } from './wordpress/sanitize-text-field';

/** A typed row: text, or the raw bytes of a submitted line (which may not be UTF-8). */
export type SubmittedRow = string | Uint8Array;

/** What the save is told beyond the rows. */
export interface SaveOptions {
  /**
   * Delay JS "Safe Mode for jQuery": `true` removes its three patterns,
   * `false` keeps them; unknown (the extension cannot read the setting)
   * keeps them and flags them (`dropsInSafeMode`).
   */
  readonly safeMode?: boolean;
}

/** What every diff carries: the row as typed (for the note, and to undo). */
interface TypedRowDiff {
  readonly typed: string;
}

/** What a kept row's diff carries beyond the typed text. */
interface KeptRowDiff extends TypedRowDiff {
  /** Delay JS, safe mode unknown: WP Rocket drops this row when Safe Mode for jQuery is on. */
  readonly dropsInSafeMode?: true;
}

/** What the save does with one typed row. */
export type StoredRowDiff =
  /** Stored exactly as typed. */
  | ({ readonly state: 'unchanged' } & KeptRowDiff)
  /** Stored, as `stored`. */
  | ({ readonly state: 'stored-as'; readonly stored: string } & KeptRowDiff)
  /**
   * Kept here as `stored` (its trim, sanitize and wildcard stages are
   * verified), but whether WP Rocket's pattern check keeps it is not
   * modeled — PCRE syntax `construct` ("can't verify WP Rocket keeps this"):
   * the engine matches nothing with it, and it never blocks the set.
   */
  | ({
      readonly state: 'unverified';
      readonly stored: string;
      readonly construct: string;
      readonly detail: string;
    } & KeptRowDiff)
  /** Not stored; an `invalid-pattern` drop names the construct PCRE rejects. */
  | ({
      readonly state: 'dropped';
      readonly reason: StoredRowDropReason;
      readonly construct?: string;
      readonly detail?: string;
    } & TypedRowDiff);

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
const SAFE_MODE_DELAY_ROWS: readonly string[] = [
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
function cleanWildcards(row: string): string {
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

/** Reads bytes the identity path receives (never fails: as written, U+FFFD for bad bytes). */
const LENIENT_UTF8 = new TextDecoder();

/** One row's per-row stages: its stored form, or why it is dropped first. */
type RowForm =
  | { readonly form: string; readonly typed: string }
  | { readonly reason: 'empty' | 'zero'; readonly typed: string };

/**
 * One row through the per-row stages (trim, sanitize, Delay wildcards).
 *
 * @param feature The field's feature.
 * @param row The typed row.
 */
function rowForm(feature: ExclusionFeatureId, row: SubmittedRow): RowForm {
  if (feature === 'automatic_lazy_rendering') {
    // Rows reach it through a PHP filter, as written.
    const written = typeof row === 'string' ? row : LENIENT_UTF8.decode(row);
    return { form: written, typed: written };
  }
  const text = submittedText(row);
  // The typed text as given (undo restores it); bytes read leniently.
  const typed = typeof row === 'string' ? row : (text ?? LENIENT_UTF8.decode(row));
  // Not UTF-8: a non-empty row that sanitizes to ''.
  if (text === null) return { reason: 'empty', typed };
  const steps: readonly ((value: string) => string)[] =
    feature === 'delay_js'
      ? [phpTrim, sanitizeTextField, cleanWildcards]
      : [phpTrim, sanitizeTextField];
  let form = text;
  for (const step of steps) {
    form = step(form);
    const reason = emptiedReason(form);
    if (reason !== null) return { reason, typed };
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

/**
 * The pattern check's verdict, when the feature has one (shared memo with
 * validation and matching).
 */
function patternCheck(feature: ExclusionFeatureId, form: string): SaveOutcome {
  if (feature !== 'delay_js' && feature !== 'defer_all_js') return { outcome: 'kept' };
  return rowSaveOutcome(feature, form);
}

/** One row's save: its diff, and its form (the dedupe key) when it got one. */
interface RowSave {
  readonly diff: StoredRowDiff;
  readonly form: string | null;
}

/**
 * WP Rocket's save of one typed row (see {@link saveExclusionRow}), with
 * the row's form: the dedupe runs before safe mode and the pattern check,
 * so a row those drop still makes a later copy of it a duplicate.
 */
function saveRow(
  feature: ExclusionFeatureId,
  row: SubmittedRow,
  ahead: ReadonlySet<string>,
  options: SaveOptions
): RowSave {
  const result = rowForm(feature, row);
  if (!('form' in result)) {
    return { diff: { state: 'dropped', reason: result.reason, typed: result.typed }, form: null };
  }
  return { diff: formDiff(feature, result.form, result.typed, ahead, options), form: result.form };
}

/**
 * WP Rocket's save of one typed row, given the forms of the rows ahead of
 * it (its dedupe): the row's diff, with its stored text when kept.
 *
 * @param feature The field's feature.
 * @param row The typed row.
 * @param ahead The forms ({@link storedRowKey}) of the rows ahead of it, or
 *   of the lane's other rows (the rows already there win).
 * @param options Safe mode, when known.
 */
export function saveExclusionRow(
  feature: ExclusionFeatureId,
  row: SubmittedRow,
  ahead: ReadonlySet<string>,
  options: SaveOptions = {}
): StoredRowDiff {
  return saveRow(feature, row, ahead, options).diff;
}

/**
 * The set-level steps on a row's form: dedupe, safe mode, the pattern check.
 *
 * @param feature The field's feature.
 * @param form The row's form after the per-row stages.
 * @param typed The row as typed.
 * @param ahead The forms ahead of it.
 * @param options Safe mode, when known.
 */
function formDiff(
  feature: ExclusionFeatureId,
  form: string,
  typed: string,
  ahead: ReadonlySet<string>,
  options: SaveOptions
): StoredRowDiff {
  if (feature === 'automatic_lazy_rendering') return { state: 'unchanged', typed };
  if (ahead.has(form)) return { state: 'dropped', reason: 'duplicate', typed };
  let flag = {};
  if (feature === 'delay_js' && SAFE_MODE_DELAY_ROWS.includes(form)) {
    if (options.safeMode === true) return { state: 'dropped', reason: 'safe-mode', typed };
    if (options.safeMode === undefined) flag = { dropsInSafeMode: true as const };
  }
  if (PATTERN_CHECKED.has(feature)) {
    const outcome = patternCheck(feature, form);
    if (outcome.outcome === 'dropped') {
      const { construct, detail } = outcome;
      return { state: 'dropped', reason: 'invalid-pattern', construct, detail, typed };
    }
    if (outcome.outcome === 'unknown') {
      const { construct, detail } = outcome;
      return { state: 'unverified', stored: form, construct, detail, typed, ...flag };
    }
  }
  return typed === form
    ? { state: 'unchanged', typed, ...flag }
    : { state: 'stored-as', stored: form, typed, ...flag };
}

/**
 * The text a kept diff stores, or `null` for a dropped row.
 *
 * @param diff A row's diff.
 */
export function storedText(diff: StoredRowDiff): string | null {
  switch (diff.state) {
    case 'unchanged':
      return diff.typed;
    case 'dropped':
      return null;
    default:
      return diff.stored;
  }
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
  const ahead = new Set<string>();
  const diffs = typed.map((row) => {
    const { diff, form } = saveRow(feature, row, ahead, options);
    if (form !== null) ahead.add(form);
    const stored = storedText(diff);
    if (stored !== null) rows.push(stored);
    return diff;
  });
  return { rows, diffs };
}

/**
 * The rows WP Rocket stores for a field's typed rows (see
 * {@link saveExclusionRows}).
 *
 * @param feature The field's feature.
 * @param typed The rows as typed.
 */
export function storedExclusionRows(
  feature: ExclusionFeatureId,
  typed: readonly SubmittedRow[]
): readonly string[] {
  return saveExclusionRows(feature, typed).rows;
}

/** The reason for a set row that is not in WP Rocket's stored form. */
const NOT_STORED_REASON =
  'Row is not in the form WP Rocket stores — edit it again so it is saved as WP Rocket would';

/**
 * Rows of a set that are not WP Rocket's stored form (saving the field
 * again would change or drop them): every set the editor sends is already
 * stored, so any entry here is a refused, out-of-contract set.
 *
 * @param set The set as sent.
 * @returns One entry per offending row, feature by feature, in row order.
 */
export function notStoredRows(set: ExclusionSet): readonly InvalidExclusionRow[] {
  return EXCLUSION_FEATURES.flatMap((feature) =>
    saveExclusionRows(feature.id, set.rows[feature.rowsKey]).diffs.flatMap(
      (diff, index): InvalidExclusionRow[] =>
        storedText(diff) === diff.typed
          ? []
          : [{ feature: feature.id, index, row: diff.typed, reason: NOT_STORED_REASON }]
    )
  );
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
 * space are kept, as the save keeps them). A row empty once trimmed is a
 * blank (unfinished) edit.
 *
 * @param row The row as typed.
 * @returns The trimmed row (empty when the row was whitespace only).
 */
export function trimExclusionRow(row: string): string {
  return phpTrim(row);
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
