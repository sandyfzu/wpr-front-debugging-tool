/**
 * WP Rocket's Defer JS inline-jQuery pass, as the served page shows it. Right
 * after deferring scripts, WP Rocket wraps the body of every inline script
 * whose code calls jQuery in a `DOMContentLoaded` listener, so it runs after
 * the deferred jQuery. It skips the whole pass when Defer JS is off, or when
 * its joined exclusion text names a jQuery file — a row like `jquery.min.js`,
 * or `jquery` followed, in any later row, by `.js`.
 *
 * The served page carries the live site's wrapping. When a set would make
 * WP Rocket skip the pass, this module undoes the wrapping it finds; it never
 * adds one (a draft only adds exclusions on top of what the site serves).
 */
import { applyPatches, type TextPatch } from './tag-edit';
import type { ExclusionSet } from './set';

/** The opening WP Rocket puts before a wrapped inline script's body. */
export const INLINE_WRAP_OPEN = "window.addEventListener('DOMContentLoaded', function() {";

/** The closing WP Rocket puts after a wrapped inline script's body. */
export const INLINE_WRAP_CLOSE = '});';

/**
 * WP Rocket's jQuery-code test on a body, `jQuery|\$\.\(|\$\(` under PCRE's
 * ASCII-only `i` — case written out, so no JS case folding creeps in.
 */
const JQUERY_CODE = /[jJ][qQ][uU][eE][rR][yY]|\$\.?\(/;

/**
 * WP Rocket's structured-data test on the whole element (tag and body):
 * `application/ld+json`, ASCII case-insensitive. Such a script is never wrapped.
 */
const LD_JSON = /[aA][pP][pP][lL][iI][cC][aA][tT][iI][oO][nN]\/[lL][dD]\+[jJ][sS][oO][nN]/;

/** `jquery`, ASCII case-insensitive. */
const JQUERY_WORD = /[jJ][qQ][uU][eE][rR][yY]/;

/** `.js`, ASCII case-insensitive. */
const JS_EXTENSION = /\.[jJ][sS]/;

/**
 * WP Rocket's script match (`<script[^>]*>` up to the first `</script>`, both
 * ASCII case-insensitive; its opening tag ends at the first `>`, quoted or
 * not), with comments skipped the way its comment-stripped scan skips them.
 * Group 1 is the body; a comment match has none.
 */
const SCRIPT_OR_COMMENT =
  /<!--[\s\S]*?-->|<[Ss][Cc][Rr][Ii][Pp][Tt][^>]*>([\s\S]*?)<\/[Ss][Cc][Rr][Ii][Pp][Tt]>/g;

/**
 * Whether WP Rocket's joined Defer JS exclusion text names a jQuery file —
 * its `/(jquery(?:.*)?\.js)/i` test, which turns the inline pass off. The
 * text is the rows deduplicated (first occurrence kept), `#` escaped, joined
 * with `|`, exactly as WP Rocket builds it, so the test spans rows: `jquery`
 * in one row and `.js` in any later one match. PCRE's `.` stops at `\n`
 * only, so a match is a line holding `jquery` with `.js` after it; checking
 * the first `jquery` per line is enough and keeps the test linear.
 *
 * WP Rocket also joins its remote `defer_js_external_exclusions` list in
 * front of the rows. This tool cannot read it; the published list names no
 * jQuery file, and coming first, its `.js` entries cannot complete a
 * `jquery` that only appears in a later row.
 *
 * @param rows The stored Defer JS rows, in order.
 */
export function namesJqueryFile(rows: readonly string[]): boolean {
  const joined = [...new Set(rows)].map((row) => row.replaceAll('#', '\\#')).join('|');
  for (const line of joined.split('\n')) {
    const word = JQUERY_WORD.exec(line);
    if (word !== null && JS_EXTENSION.test(line.slice(word.index + word[0].length))) return true;
  }
  return false;
}

/**
 * Whether WP Rocket runs its inline-jQuery pass under a set: Defer JS is on
 * and its joined exclusion text names no jQuery file.
 *
 * @param set The exclusion set (Defer JS rows + toggle).
 */
export function inlineWrapRuns(set: ExclusionSet): boolean {
  return !set.disable.deferJs && !namesJqueryFile(set.rows.deferJs);
}

/**
 * The element WP Rocket wrapped into `element`, or `null` when it did not
 * wrap it. WP Rocket replaces every copy of the body in the element (one in
 * an attribute included) with the wrapped body; the original is that
 * replacement undone, kept only when WP Rocket would wrap it (jQuery code,
 * no `application/ld+json`) and its own replacement leads back to `element`.
 *
 * @param element One script element as WP Rocket matches it.
 * @param body Its body as WP Rocket matches it.
 */
function wrappedOriginal(element: string, body: string): string | null {
  if (body.length < INLINE_WRAP_OPEN.length + INLINE_WRAP_CLOSE.length) return null;
  if (!body.startsWith(INLINE_WRAP_OPEN) || !body.endsWith(INLINE_WRAP_CLOSE)) return null;
  const inner = body.slice(INLINE_WRAP_OPEN.length, body.length - INLINE_WRAP_CLOSE.length);
  if (!JQUERY_CODE.test(inner)) return null;
  // Function replacers: the code may hold `$'`/`$&`, which a string replacement expands.
  const original = element.replaceAll(body, () => inner);
  if (LD_JSON.test(original)) return null;
  return original.replaceAll(inner, () => body) === element ? original : null;
}

/** A page with WP Rocket's inline wrapping undone. */
export interface InlineUnwrap {
  readonly html: string;
  /** Script elements whose wrapping was undone. */
  readonly unwrapped: number;
}

/**
 * A comment with every wrapped element copy put back. WP Rocket replaces
 * each wrapped element's text throughout the page, so an identical copy
 * inside a comment was wrapped with it.
 *
 * @param comment The comment text.
 * @param restored Wrapped element text → original, from the page's live scripts.
 */
function restoreCommentCopies(comment: string, restored: ReadonlyMap<string, string>): string {
  let text = comment;
  for (const [wrapped, original] of restored) {
    if (text.includes(wrapped)) text = text.replaceAll(wrapped, () => original);
  }
  return text;
}

/**
 * Undo WP Rocket's inline-jQuery wrapping on a page: every script whose
 * body is exactly a wrapped jQuery body gets its original back, byte for
 * byte, and so does each identical copy inside a comment. A script whose
 * source already reads exactly like WP Rocket's wrapper around jQuery code
 * is indistinguishable from its output and is unwrapped too.
 *
 * @param html The page (or one script element).
 * @returns The page without the wrapping, and how many scripts changed
 *   (comment copies not counted).
 */
export function unwrapInlineScripts(html: string): InlineUnwrap {
  if (!html.includes(INLINE_WRAP_OPEN)) return { html, unwrapped: 0 };
  const patches: TextPatch[] = [];
  const comments: RegExpExecArray[] = [];
  const restored = new Map<string, string>();
  for (const match of html.matchAll(SCRIPT_OR_COMMENT)) {
    const body = match[1];
    if (body === undefined) {
      if (match[0].includes(INLINE_WRAP_OPEN)) comments.push(match);
      continue;
    }
    const original = wrappedOriginal(match[0], body);
    if (original === null) continue;
    restored.set(match[0], original);
    patches.push({ start: match.index, end: match.index + match[0].length, text: original });
  }
  const unwrapped = patches.length;
  for (const comment of comments) {
    const text = restoreCommentCopies(comment[0], restored);
    if (text !== comment[0]) {
      patches.push({ start: comment.index, end: comment.index + comment[0].length, text });
    }
  }
  return { html: applyPatches(html, patches), unwrapped };
}
