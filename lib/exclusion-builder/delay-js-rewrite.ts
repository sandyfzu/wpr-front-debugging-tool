/**
 * A forward model of WP Rocket's Delay JS attribute rewrite (pure): what it
 * makes of a script's attribute text before serving it delayed. Used to
 * check a rebuilt original — only an original this rewrite turns back into
 * the served text can be the one WP Rocket matched.
 *
 * PCRE's semantics are written out: `\s` is PCRE's (no UTF), `.` stops at
 * a line feed, `$` also matches before a final line feed, and case folds
 * for ASCII only (JS's `i` without `u` never folds a non-ASCII character
 * onto an ASCII one). Every delimiter is ASCII, so reading decoded text
 * gives the same matches as PCRE reading its UTF-8 bytes.
 */
import { PCRE_SPACE_CHARS } from './pcre/byte-set';

/** PCRE's `\s` (no UTF) as a JS class. */
const SPACE = `[${PCRE_SPACE_CHARS}]`;

/**
 * The `type` values WP Rocket delays (`DelayJS\HTML::$allowed_types`); a
 * script carrying another non-empty `type` is served as is.
 */
export const DELAY_JS_ALLOWED_TYPES: readonly string[] = [
  'text/javascript',
  'module',
  'application/javascript',
  'application/ecmascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript'
];

/** The `type` check (`preg_match` with `U`: every quantifier lazy). */
const TYPE_VALUE = new RegExp(`type${SPACE}*?=${SPACE}*?(["'])([^\\n]*?)\\1`, 'i');
/** The `type` rename (greedy, every match: one per line at most). */
const TYPE_RENAME = new RegExp(`type${SPACE}*=${SPACE}*(["'])([^\\n]*)\\1`, 'gi');
/** The valueless-`type` removal (PCRE `$` also before a final line feed). */
const VALUELESS_TYPE = new RegExp(
  `(${SPACE}+type${SPACE}+)|(^type${SPACE}+)|(${SPACE}+type(?=\\n?$))`,
  'gi'
);
/** The `src` rename (greedy, every match). */
const SRC_RENAME = new RegExp(`src${SPACE}*=${SPACE}*(["'])([^\\n]*)\\1`, 'gi');
/** PHP `trim`'s default characters at either end. */
const PHP_TRIM = /^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g;

/**
 * PHP's `trim` with its default character list.
 *
 * @param text The text.
 */
export function phpTrim(text: string): string {
  return text.replace(PHP_TRIM, '');
}

/**
 * WP Rocket's Delay JS rewrite of a script's attribute text
 * (`DelayJS\HTML::replace_scripts`), as served after `<script type="…" `:
 * `type=` → `data-rocket-type=`, a valueless `type` removed, `src=` →
 * `data-rocket-src=`, then trimmed.
 *
 * @param attributes The attribute text WP Rocket captured (after `<script`,
 *   up to the tag's first `>`); must be non-empty — WP Rocket writes an
 *   attribute-less script without any.
 * @returns The served attribute text, or `null` when WP Rocket leaves the
 *   script undelayed (a non-empty `type` outside {@link DELAY_JS_ALLOWED_TYPES}).
 */
export function delayAttributeRewrite(attributes: string): string | null {
  const declared = TYPE_VALUE.exec(attributes)?.[2];
  if (declared !== undefined) {
    const type = phpTrim(declared);
    // PHP's `empty()`: '' and '0' count as no type.
    if (type !== '' && type !== '0' && !DELAY_JS_ALLOWED_TYPES.includes(type)) return null;
  }
  const renamed = attributes
    .replace(TYPE_RENAME, 'data-rocket-type=$1$2$1')
    .replace(VALUELESS_TYPE, '')
    .replace(SRC_RENAME, 'data-rocket-src=$1$2$1');
  return phpTrim(renamed);
}
