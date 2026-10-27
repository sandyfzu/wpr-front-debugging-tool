/**
 * WordPress's `sanitize_text_field` (core `_sanitize_text_fields($str,
 * false)`, unfiltered, `blog_charset` UTF-8), ported step for step — WP
 * Rocket runs it on every row of its exclusion fields before storing them:
 *
 * 1. invalid UTF-8 → the whole row becomes `''` (`submittedText` reads the row: `null`);
 * 2. only when the row holds a `<`: each `<…` run with no `>` before the
 *    next `<` or the end is HTML-escaped (`esc_html`, never double-encoding
 *    an entity), then `<script>`/`<style>` blocks are removed with their
 *    content, tags are stripped (PHP `strip_tags`), the row is trimmed and
 *    `<` + LF becomes `&lt;` + LF;
 * 3. every run of CR, LF, tab and space becomes one space; the row is trimmed;
 * 4. every `%xx` octet is removed, repeatedly until none is left; when any
 *    was, runs of spaces collapse and the row is trimmed again.
 */
import { libxmlEntityCodePoint } from '../libxml/entities';
import { phpTrim } from '../php/trim';
import { stripTags } from '../php/strip-tags';

/** UTF-8 validation (`mb_check_encoding`): fatal, and a leading BOM is content, not stripped. */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * A submitted row as text, or `null` when it is not valid UTF-8. Text
 * reaches the server the way a browser submits a form: as UTF-8 of its
 * Unicode scalar values (a lone surrogate is sent as U+FFFD), which is
 * always valid; raw bytes are checked.
 *
 * @param row Text, or the raw bytes of a submitted line.
 */
export function submittedText(row: string | Uint8Array): string | null {
  if (typeof row === 'string') return row.toWellFormed();
  try {
    return UTF8.decode(row);
  } catch {
    // Not UTF-8: WordPress empties the row (`wp_check_invalid_utf8`).
    return null;
  }
}

/**
 * An `<…` run with no `>` before the next `<` or the end (it is escaped) or
 * with one (left for `strip_tags`) — `wp_pre_kses_less_than`'s pattern.
 * PCRE's `$` also matches before a final LF, which only moves that LF out
 * of the run; escaping leaves an LF unchanged, so the outcome is the same.
 */
const LESS_THAN_RUN = /<[^>]*?(?:(?=<)|>|$)/g;

/** A decimal reference with its `&` already disarmed (`wp_kses_normalize_entities`). */
const DISARMED_DECIMAL = /&amp;#(0*[1-9][0-9]{0,6});/g;

/** A hexadecimal reference with its `&` already disarmed. */
const DISARMED_HEX = /&amp;#[Xx](0*[1-9A-Fa-f][0-9A-Fa-f]{0,5});/g;

/** A named reference with its `&` already disarmed. */
const DISARMED_NAMED = /&amp;([A-Za-z]{2,8}[0-9]{0,2});/g;

/**
 * Whether a code point is one `valid_unicode` accepts (XML's `Char`).
 *
 * @param code The code point.
 */
function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/**
 * Whether `esc_html` keeps `&name;` as an entity: KSES's allowed names
 * (the HTML 4.01 entities plus `apos` — exactly libxml's table) that PHP's
 * `htmlspecialchars` also recognizes, which drops `apos` (not HTML 4.01).
 *
 * @param name The reference name.
 */
function isKeptEntityName(name: string): boolean {
  return name !== 'apos' && libxmlEntityCodePoint(name) !== undefined;
}

/**
 * `esc_html` on one run: every `&` not starting a reference KSES accepts
 * becomes `&amp;` (accepted numeric references are re-spelled: decimal
 * padded to three digits, hex without leading zeros, lowercase `x`), then
 * `<`, `>`, `"` and `'` are encoded (`&lt;`, `&gt;`, `&quot;`, `&#039;`).
 *
 * @param run The text to escape.
 */
function escHtml(run: string): string {
  const normalized = run
    .replaceAll('&', '&amp;')
    .replace(DISARMED_DECIMAL, (whole, digits: string) => {
      if (!isXmlChar(Number.parseInt(digits, 10))) return whole;
      return `&#${digits.replace(/^0+/, '').padStart(3, '0')};`;
    })
    .replace(DISARMED_HEX, (_whole, hex: string) =>
      isXmlChar(Number.parseInt(hex, 16)) ? `&#x${hex.replace(/^0+/, '')};` : `&amp;#x${hex};`
    )
    .replace(DISARMED_NAMED, (whole, name: string) =>
      isKeptEntityName(name) ? `&${name};` : whole
    );
  return normalized
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** `<script>`/`<style>` blocks with their content (`wp_strip_all_tags`). */
const SCRIPT_STYLE_BLOCK = /<(script|style)[^>]*?>[\s\S]*?<\/\1>/gi;

/**
 * The tag handling of a row holding a `<`: unclosed runs escaped, script
 * and style blocks removed, tags stripped, trimmed, `<` + LF escaped.
 *
 * @param text The row.
 */
function stripMarkup(text: string): string {
  const escaped = text.replace(LESS_THAN_RUN, (run) => (run.includes('>') ? run : escHtml(run)));
  const stripped = phpTrim(stripTags(escaped.replace(SCRIPT_STYLE_BLOCK, '')));
  return stripped.replaceAll('<\n', '&lt;\n');
}

/** One `%xx` octet (ASCII hex digits, any case). */
const OCTET = /%[a-f0-9]{2}/i;

/**
 * Remove `%xx` octets the way WordPress does: take the first one, remove
 * every occurrence of exactly that text, and repeat until none is left
 * (removals can join new octets: `%2541` → `41`).
 *
 * @param text The row.
 * @returns The row without octets, and whether any was removed.
 */
function removeOctets(text: string): { readonly text: string; readonly found: boolean } {
  let current = text;
  let found = false;
  for (let match = OCTET.exec(current); match !== null; match = OCTET.exec(current)) {
    current = current.replaceAll(match[0], '');
    found = true;
  }
  return { text: current, found };
}

/**
 * WordPress's `sanitize_text_field` on one row already read as text
 * ({@link submittedText}: a JS string is valid UTF-8 once submitted, so
 * step 1 has nothing left to empty).
 *
 * @param text The row as submitted text.
 * @returns The sanitized row.
 */
export function sanitizeTextField(text: string): string {
  const unmarked = text.includes('<') ? stripMarkup(text) : text;
  const collapsed = phpTrim(unmarked.replace(/[\r\n\t ]+/g, ' '));
  const octets = removeOctets(collapsed);
  return octets.found ? phpTrim(octets.text.replace(/ +/g, ' ')) : octets.text;
}
