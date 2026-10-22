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
 * Characters a stored row keeps that a reader cannot tell apart from a
 * plain space or from nothing: every non-ASCII whitespace (no-break,
 * narrow, ideographic, line-separator spaces, BOM…) and the zero-width
 * marks (zero-width space/joiners, word joiner, next line, soft hyphen).
 */
const INVISIBLE_KEPT = /[^\S \t\n\r\v\f]|[\u200B-\u200D\u2060\u0085\u00AD]/;

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
