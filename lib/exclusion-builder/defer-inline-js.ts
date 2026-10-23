/**
 * WP Rocket's Defer JS inline-jQuery pass, as the served page shows it. Right
 * after deferring scripts, WP Rocket wraps the body of every inline script
 * whose code calls jQuery in a `DOMContentLoaded` listener, so it runs after
 * the deferred jQuery. It skips the whole pass when Defer JS is off, or when
 * its joined exclusion text names a jQuery file.
 *
 * The served page carries the live site's wrapping, made under rows this
 * tool cannot read; a set adds its rows to those. This module decides what
 * the pass does under a set — when that is certain — and undoes the served
 * wrapping when the pass would not run. It never adds a wrapping, and never
 * guesses the bodies of a wrapper that may span scripts.
 */
import { INLINE_WRAP_CLOSE, INLINE_WRAP_OPEN, WPR_DEFER_ATTRIBUTE } from '../wp-rocket/constants';
import { parseTagAt, scanTags } from './html-scan';
import { findAttribute } from './tag-edit';
import type { ExclusionSet } from './set';

/** `jquery`, ASCII case-insensitive (PCRE `i` folds ASCII only). */
const JQUERY_WORD = /[jJ][qQ][uU][eE][rR][yY]/;

/** `.js`, ASCII case-insensitive. */
const JS_EXTENSION = /\.[jJ][sS]/;

/**
 * WP Rocket's jQuery-code test on a body: its default pattern
 * `jQuery|\$\.\(|\$\(`, ASCII case-insensitive.
 */
const JQUERY_CODE = new RegExp(`${JQUERY_WORD.source}|\\$\\.?\\(`);

/**
 * WP Rocket's structured-data test on the whole element (tag and body):
 * `application/ld+json`, ASCII case-insensitive. Such a script is never wrapped.
 */
const LD_JSON = /[aA][pP][pP][lL][iI][cC][aA][tT][iI][oO][nN]\/[lL][dD]\+[jJ][sS][oO][nN]/;

/**
 * WP Rocket's script match (`<script[^>]*>` up to the first `</script>`, both
 * ASCII case-insensitive; its opening tag ends at the first `>`, quoted or
 * not), with comments skipped the way its comment-stripped scan skips them.
 * Group 1 is the body; a comment match has none.
 */
const SCRIPT_OR_COMMENT =
  /<!--[\s\S]*?-->|<[Ss][Cc][Rr][Ii][Pp][Tt][^>]*>([\s\S]*?)<\/[Ss][Cc][Rr][Ii][Pp][Tt]>/g;

/**
 * WP Rocket's skip test, `/(jquery(?:.*)?\.js)/i`, over rows joined as it
 * joins them: deduplicated (first occurrence kept), `#` escaped, `|`
 * between rows — so a match can span rows (`jquery` in one, `.js` in a later
 * one). PCRE's `.` stops at `\n` only, so a match is a line holding `jquery`
 * with `.js` after it; checking the first `jquery` per line keeps it linear.
 *
 * @param rows Exclusion rows, in WP Rocket's order.
 * @returns Whether the joined text matches (the pass is skipped).
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
 * What WP Rocket's inline-jQuery pass does under a set, for a served page
 * it wrapped: `skipped` and `runs` are certain, `unknown` is not.
 */
export type InlinePass = 'runs' | 'skipped' | 'unknown';

/**
 * Whether WP Rocket's inline pass runs under a set, for a page whose served
 * markup shows its wrapping. WP Rocket tests its remote external list, the
 * live rows and the set's rows (deduplicated) as one text; only the set's
 * rows are known here — nor where they land among the live ones in the
 * field — but a wrapped served page proves the list plus the live rows
 * alone do not match. Hence, wherever the set's rows sit:
 *
 * - `skipped` — Defer JS is off, or one row of the set matches on its own:
 *   deduplication cannot drop it (a twin would match alone, and the served
 *   page would not be wrapped), so the joined text matches.
 * - `runs` — no row of the set holds `.js` or `jquery`: a new match would
 *   need one of them from the set, as the other text has none that pair up
 *   (rows hold no line break — the settings field splits on it).
 * - `unknown` — otherwise: a match may span rows, a set row may complete a
 *   live `jquery` or `.js` (or be dropped as a duplicate of a live row), so
 *   the outcome depends on rows this tool cannot read.
 *
 * Filters (`rocket_exclude_defer_js`, `rocket_defer_jquery_patterns`,
 * `rocket_defer_inline_exclusions`) are assumed unregistered.
 *
 * @param set The exclusion set (Defer JS rows + toggle).
 * @returns The pass's outcome under the set.
 */
export function inlinePassUnder(set: ExclusionSet): InlinePass {
  const rows = set.rows.deferJs;
  if (set.disable.deferJs || rows.some((row) => namesJqueryFile([row]))) return 'skipped';
  const couldPair = rows.some((row) => JS_EXTENSION.test(row) || JQUERY_WORD.test(row));
  return couldPair ? 'unknown' : 'runs';
}

/**
 * The body WP Rocket wrapped into one script, or `null` when it did not: the
 * body is exactly the wrapper around jQuery code, and the element names no
 * structured data.
 *
 * @param element One script element as WP Rocket matches it.
 * @param body Its body as WP Rocket matches it.
 * @returns The original body, or `null`.
 */
function wrappedInner(element: string, body: string): string | null {
  if (body.length < INLINE_WRAP_OPEN.length + INLINE_WRAP_CLOSE.length) return null;
  if (!body.startsWith(INLINE_WRAP_OPEN) || !body.endsWith(INLINE_WRAP_CLOSE)) return null;
  const inner = body.slice(INLINE_WRAP_OPEN.length, body.length - INLINE_WRAP_CLOSE.length);
  if (!JQUERY_CODE.test(inner) || LD_JSON.test(element)) return null;
  return inner;
}

/**
 * An HTML end tag inside WP Rocket's script match (`</script` and then
 * whitespace, `/` or `>`): its match then takes in more than one script.
 */
const HTML_SCRIPT_END = /<\/[Ss][Cc][Rr][Ii][Pp][Tt][\t\n\f\r />]/;

/** One script match whose body opens with WP Rocket's wrapper, as served. */
interface OpenedScript {
  /** Its original body when the body is exactly one wrapper ({@link wrappedInner}), else `null`. */
  readonly inner: string | null;
  /**
   * The HTML scripts the match takes in (its own, and those after an end
   * tag WP Rocket's match reads past: `</script/>`, `</script x>`), and of
   * those the undeferred ones (Defer JS counts the deferred ones already).
   */
  readonly scripts: { readonly all: number; readonly undeferred: number };
  /** Whether its wrapper may run past its own end tag (see {@link wrappedScripts}). */
  spanned: boolean;
  /**
   * The later script taken to hold a spanning wrapper's closing (left as
   * served too): whether Defer JS deferred it (it counts there already), or
   * `null` when none was found.
   */
  closer: 'deferred' | 'inline' | null;
}

/** The scripts of a page WP Rocket wrapped. */
interface WrappedScripts {
  /** The original bodies that can be read back, distinct. */
  readonly inners: ReadonlySet<string>;
  /**
   * How many script elements (outside comments) show the wrapping: those
   * opening it, and the undeferred ones holding a spanning wrapper's closing.
   */
  readonly count: number;
  /** Of the openings, the ones whose original body is read back. */
  readonly readable: number;
  /** The HTML scripts those take in. */
  readonly readableScripts: number;
  /**
   * The scripts left as served because a wrapper may span them, their
   * original bodies unread: the openings, and the scripts holding their
   * closings (deferred ones included).
   */
  readonly spanned: number;
}

/**
 * Find the scripts WP Rocket wrapped on a page.
 *
 * WP Rocket's script match ends at the first `</script>`, so a script whose
 * end tag is spelled otherwise (`</script >`) is wrapped together with the
 * scripts after it: the opening lands in it, the closing in the script whose
 * end tag ends the match. Delay JS then rewrites every end tag to
 * `</script>`, after which the page no longer shows which script holds the
 * closing — two sources can serve the same page yet differ once unwrapped.
 * So a script opening the wrapper may span scripts when its body is not one
 * whole wrapper, or when a later script's body is the closing alone (an
 * empty script it spanned to); neither is read back. Nor is a whole wrapper
 * whose body also stands in one that may span (bodies are undone by text,
 * page-wide). A whole wrapper spanning to a script with a body of its own
 * reads exactly like one wrapper followed by a script ending in `});`, which
 * pages commonly hold: it is read back as one wrapper. The closing of a
 * wrapper that may span is taken to sit in the first script after it whose
 * body ends like it (an empty one's for a whole wrapper): that script is
 * left as served too.
 *
 * @param html The page (or one script element).
 * @returns The original bodies that can be read back, and the counts.
 */
function wrappedScripts(html: string): WrappedScripts {
  if (!html.includes(INLINE_WRAP_OPEN)) {
    return { inners: new Set(), count: 0, readable: 0, readableScripts: 0, spanned: 0 };
  }
  const opened: OpenedScript[] = [];
  for (const match of html.matchAll(SCRIPT_OR_COMMENT)) {
    const body = match[1];
    if (body === undefined) continue; // A comment.
    if (body.startsWith(INLINE_WRAP_OPEN)) {
      const inner = wrappedInner(match[0], body);
      opened.push({
        inner,
        spanned: inner === null && !body.endsWith(INLINE_WRAP_CLOSE),
        closer: null,
        scripts: matchScripts(match[0], body)
      });
    } else if (body.endsWith(INLINE_WRAP_CLOSE)) {
      // Only the last opening may span to it: the script opening after an
      // earlier one would sit inside that one's span.
      const last = opened.at(-1);
      if (last === undefined) continue;
      // The closing alone: an empty script the last opening may span to.
      if (body === INLINE_WRAP_CLOSE) last.spanned = true;
      if (last.spanned && last.closer === null)
        last.closer = isDeferred(match[0]) ? 'deferred' : 'inline';
    }
  }
  return readableWraps(opened);
}

/**
 * The counts, and the bodies that can be read back, of the scripts opening
 * the wrapper. One that is neither a whole wrapper nor possibly spanning is
 * not WP Rocket's wrapping (e.g. no jQuery code, or structured data).
 *
 * @param opened The scripts whose body opens with the wrapper, in page order.
 * @returns As {@link wrappedScripts}.
 */
function readableWraps(opened: readonly OpenedScript[]): WrappedScripts {
  const unreadable = new Set<string>();
  for (const script of opened) {
    if (script.spanned && script.inner !== null) unreadable.add(script.inner);
  }
  const inners = new Set<string>();
  let count = 0;
  let readable = 0;
  let readableScripts = 0;
  let spanned = 0;
  for (const script of opened) {
    if (script.inner === null && !script.spanned) continue;
    count += script.scripts.undeferred + (script.closer === 'inline' ? 1 : 0);
    if (script.spanned || script.inner === null || unreadable.has(script.inner)) {
      spanned += script.scripts.all + (script.closer === null ? 0 : 1);
      continue;
    }
    inners.add(script.inner);
    readable++;
    readableScripts += script.scripts.all;
  }
  return { inners, count, readable, readableScripts, spanned };
}

/**
 * The HTML scripts one script match takes in (see {@link OpenedScript.scripts}).
 *
 * @param element The match (`<script…>` through its `</script>`).
 * @param body Its body.
 */
function matchScripts(
  element: string,
  body: string
): { readonly all: number; readonly undeferred: number } {
  if (!HTML_SCRIPT_END.test(body)) return { all: 1, undeferred: isDeferred(element) ? 0 : 1 };
  const scripts = scanTags(element).filter((tag) => tag.name === 'script');
  const undeferred = scripts.filter(
    (tag) => findAttribute(parseTagAt(element, tag.start), WPR_DEFER_ATTRIBUTE) === null
  ).length;
  return { all: scripts.length, undeferred };
}

/**
 * Whether a script carries Defer JS's marker (it is deferred).
 *
 * @param element The script element as WP Rocket's script match reads it.
 */
function isDeferred(element: string): boolean {
  return findAttribute(parseTagAt(element, 0), WPR_DEFER_ATTRIBUTE) !== null;
}

/**
 * Whether a served page holds a wrapper that may span scripts, whose
 * original bodies cannot be read back (see {@link wrappedScripts}).
 *
 * @param html The page.
 */
export function hasSpanningWrapper(html: string): boolean {
  return wrappedScripts(html).spanned > 0;
}

/**
 * The other body a served script may have held before a wrapper spanning
 * scripts (see {@link wrappedScripts}): without the wrapper's opening when
 * it starts with it; else, after a script that opens one, without the
 * closing when it ends with it.
 *
 * @param body The script's body as served.
 * @param afterOpening Whether an earlier script's body opens with the wrapper.
 * @returns That body, or `null` when neither applies.
 */
export function spanningWrapperReading(body: string, afterOpening: boolean): string | null {
  if (body.startsWith(INLINE_WRAP_OPEN)) return body.slice(INLINE_WRAP_OPEN.length);
  if (afterOpening && body.endsWith(INLINE_WRAP_CLOSE)) {
    return body.slice(0, body.length - INLINE_WRAP_CLOSE.length);
  }
  return null;
}

/**
 * Put every wrapped copy of the given bodies back, page-wide, in one
 * left-to-right pass (the longest body first where several fit). WP Rocket
 * replaces each wrapped element's text page-wide with PHP's `str_replace`
 * (in attributes, in comments, across a comment's end), so the wrapping is
 * undone wherever it stands, independent of later rewrites of the tag.
 *
 * @param html The page.
 * @param inners The original bodies.
 * @returns The page with each `OPEN + body + CLOSE` replaced by the body.
 */
function replaceWrapped(html: string, inners: ReadonlySet<string>): string {
  const byLength = new Map<number, Set<string>>();
  for (const inner of inners) {
    const bucket = byLength.get(inner.length) ?? new Set<string>();
    bucket.add(inner);
    byLength.set(inner.length, bucket);
  }
  const lengths = [...byLength.keys()].sort((left, right) => right - left);
  const pieces: string[] = [];
  let cursor = 0;
  let open = html.indexOf(INLINE_WRAP_OPEN);
  while (open !== -1) {
    const at = open + INLINE_WRAP_OPEN.length;
    const length = lengths.find(
      (candidate) =>
        html.startsWith(INLINE_WRAP_CLOSE, at + candidate) &&
        byLength.get(candidate)?.has(html.slice(at, at + candidate)) === true
    );
    if (length === undefined) {
      open = html.indexOf(INLINE_WRAP_OPEN, open + 1);
      continue;
    }
    pieces.push(html.slice(cursor, open), html.slice(at, at + length));
    cursor = at + length + INLINE_WRAP_CLOSE.length;
    open = html.indexOf(INLINE_WRAP_OPEN, cursor);
  }
  pieces.push(html.slice(cursor));
  return pieces.join('');
}

/** A page with WP Rocket's inline wrapping undone. */
export interface InlineUnwrap {
  readonly html: string;
  /** Script elements (outside comments) whose wrapping was undone. */
  readonly unwrapped: number;
}

/**
 * Undo WP Rocket's inline-jQuery wrapping on a page: every script whose
 * body is exactly a wrapped jQuery body gets its original back, byte for
 * byte, and so does every other copy of that wrapped body on the page. A
 * script whose source already reads exactly like WP Rocket's wrapper around
 * jQuery code is indistinguishable from its output and is unwrapped too. A
 * wrapper that may span scripts stays as served (see {@link wrappedScripts}).
 *
 * @param html The page (or one script element).
 * @returns The page without the wrapping, and how many scripts changed.
 */
export function unwrapInlineScripts(html: string): InlineUnwrap {
  const { inners, readable: unwrapped } = wrappedScripts(html);
  return unwrapped === 0 ? { html, unwrapped } : { html: replaceWrapped(html, inners), unwrapped };
}

/** The inline pass replayed on a page under a set. */
export interface InlinePassReplay {
  readonly html: string;
  /**
   * Scripts the served page shows wrapped (outside comments): the openings,
   * and the undeferred scripts holding a spanning wrapper's closing.
   */
  readonly wrapped: number;
  /** Of the openings, the ones given their original body back (the pass is skipped). */
  readonly unwrapped: number;
  /**
   * The scripts left as served because what WP Rocket would serve is
   * unknown (a deferred script holding a spanning wrapper's closing included).
   */
  readonly undetermined: number;
  /**
   * Of the undetermined, the ones whose wrapper may span scripts — their
   * original body cannot be read back; the rest wait on the live rows.
   */
  readonly spanned: number;
}

/**
 * Replay the inline pass under a set on a served page: undo the wrapping
 * when the pass is certainly skipped, keep it when it certainly runs, and
 * leave it as served — counted undetermined — otherwise. A wrapper that may
 * span scripts is kept when the pass runs; else it stays as served,
 * undetermined, as its original bodies cannot be read back.
 *
 * @param html The served page (any later rewrite of opening tags is fine).
 * @param set The exclusion set (Defer JS rows + toggle).
 * @returns The page and the counts.
 */
export function replayInlinePass(html: string, set: ExclusionSet): InlinePassReplay {
  const { inners, count, readable, readableScripts, spanned } = wrappedScripts(html);
  const pass = count === 0 ? 'runs' : inlinePassUnder(set);
  if (pass === 'runs') return { html, wrapped: count, unwrapped: 0, undetermined: 0, spanned: 0 };
  if (pass === 'unknown') {
    // Every script it leaves as served: the openings, and the closings they hold.
    return { html, wrapped: count, unwrapped: 0, undetermined: readableScripts + spanned, spanned };
  }
  return {
    html: readable === 0 ? html : replaceWrapped(html, inners),
    wrapped: count,
    unwrapped: readable,
    undetermined: spanned,
    spanned
  };
}
