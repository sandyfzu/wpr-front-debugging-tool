/**
 * Exclusion rows in the form WP Rocket's settings store them — the single
 * declaring site of that normalization. On "Save Changes" every textarea
 * line is trimmed of surrounding whitespace and lines left empty are
 * dropped, so a row's surrounding whitespace never takes part in matching;
 * the settings page shows the stored list one row per line. The editor,
 * the set it sends, and the copy-to-settings text all go through here, so
 * what is applied, saved and copied is what WP Rocket would store.
 */

/**
 * The whitespace stripped from both ends of a row: space, tab, line feed,
 * carriage return, NUL and vertical tab — exactly that set. Wider Unicode
 * spaces (no-break space, line separator, BOM…) are kept, as the save keeps
 * them, so a row never matches differently here than once saved.
 */
const SURROUNDING_WHITESPACE = /^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g;

/** The separator between rows in the settings field (one row per line). */
const FIELD_LINE_SEPARATOR = '\n';

/**
 * One row as the settings would store it: surrounding whitespace removed,
 * inner text untouched.
 *
 * @param row The row as typed.
 * @returns The trimmed row (empty when the row was whitespace only).
 */
export function trimExclusionRow(row: string): string {
  return row.replace(SURROUNDING_WHITESPACE, '');
}

/**
 * A row list as the settings would store it: each row trimmed, rows left
 * empty dropped, list order kept (duplicates included — only whitespace is
 * normalized).
 *
 * @param rows The rows as typed.
 * @returns The stored-form rows.
 */
export function exclusionFieldLines(rows: readonly string[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    const line = trimExclusionRow(row);
    if (line !== '') lines.push(line);
  }
  return lines;
}

/**
 * A row list as text to paste into the settings field: the stored-form rows
 * joined one per line (`\n`, no trailing newline — the form the settings
 * page itself renders the list in).
 *
 * @param rows The rows as typed.
 * @returns The field text (empty when no row is left).
 */
export function exclusionFieldText(rows: readonly string[]): string {
  return exclusionFieldLines(rows).join(FIELD_LINE_SEPARATOR);
}

/**
 * Characters that render as nothing yet stay in a stored row wherever they
 * are: zero-width space/joiners, word joiner, BOM, next line, soft hyphen.
 */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u0085\u00AD]/;

/**
 * Whether a row carries invisible characters the save keeps — no-break or
 * other Unicode spaces at its ends (a row of only those looks blank), or
 * zero-width characters anywhere — so it must match them too, while the
 * editor shows nothing there.
 *
 * @param row The row as typed.
 */
export function hasInvisibleKeptCharacters(row: string): boolean {
  const stored = trimExclusionRow(row);
  return stored !== stored.trim() || ZERO_WIDTH.test(stored);
}
