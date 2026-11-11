/**
 * WP Rocket's inline LazyLoad options script, recognized in a script's text.
 *
 * The plugin builds `window.lazyLoadOptions = {` (or `= [{` with the CSS
 * background arm), a line break, then the indented `elements_selector: "…"`
 * naming `img[data-lazy-src]` / `iframe[data-lazy-src]`, and minifies the
 * whole script onto one line (`window.lazyLoadOptions=[{elements_selector:…`)
 * unless `SCRIPT_DEBUG` is on. One rule reads both: the global, optional
 * whitespace, `=`, then the value's leading run of whitespace and `[`/`{`
 * (which may cross line breaks), and the selector on the line that run ends
 * on. Without the opener skip the readable form's selector sits a line below
 * the assignment and is never seen.
 */

import { LAZYLOAD_OPTIONS_GLOBAL } from './constants';

/** A line break as JS's (and PCRE's) `.` refuses it: the selector must sit before one. */
const LINE_BREAK = /[\n\r\u2028\u2029]/g;
/** Whitespace between the global and its `=` (sticky: read from an exact offset). */
const ASSIGNMENT_GAP = /\s*/y;
/** The value's leading openers: whitespace, `[` and `{` (sticky). */
const VALUE_OPENERS = /[\s[{]*/y;

/**
 * The offset right after a sticky run matched at `from`.
 *
 * @param run A sticky regex that always matches (possibly empty).
 * @param text The text.
 * @param from Where the run starts.
 * @returns The run's end (`from` when it is empty).
 */
function runEnd(run: RegExp, text: string, from: number): number {
  run.lastIndex = from;
  run.exec(text);
  return run.lastIndex;
}

/**
 * Where an assignment's value starts after its openers, or -1 when the
 * global at `at` is not assigned (`window.lazyLoadOptionsX=`,
 * `window.lazyLoadOptions.img =`, a bare mention).
 *
 * @param text The script text.
 * @param at The offset of an occurrence of the global.
 */
function valueStart(text: string, at: number): number {
  const equals = runEnd(ASSIGNMENT_GAP, text, at + LAZYLOAD_OPTIONS_GLOBAL.length);
  if (text[equals] !== '=') return -1;
  return runEnd(VALUE_OPENERS, text, equals + 1);
}

/**
 * Whether a script's text holds WP Rocket's LazyLoad options naming one of
 * `selectors`, minified or readable (see the module doc). Linear in the
 * text: occurrences are found left to right, their gap and opener runs are
 * disjoint, and each line is searched for the selectors at most once — a
 * later value starting on an already-searched line can only see a suffix
 * of it.
 *
 * Substring semantics otherwise, on purpose: no left boundary before
 * `window`, and a mention inside a string or comment counts like code.
 *
 * @param text The script's text content.
 * @param selectors The selectors to look for (any one suffices).
 * @returns `true` when an assignment's line names a selector.
 */
export function hasLazyloadOptions(text: string, selectors: readonly string[]): boolean {
  let searchedUntil = 0;
  for (
    let at = text.indexOf(LAZYLOAD_OPTIONS_GLOBAL);
    at >= 0;
    at = text.indexOf(LAZYLOAD_OPTIONS_GLOBAL, at + LAZYLOAD_OPTIONS_GLOBAL.length)
  ) {
    const start = valueStart(text, at);
    // Not an assignment, or its line's rest was already searched.
    if (start < 0 || start < searchedUntil) continue;
    LINE_BREAK.lastIndex = start;
    const lineEnd = LINE_BREAK.exec(text)?.index ?? text.length;
    const line = text.slice(start, lineEnd);
    if (selectors.some((selector) => line.includes(selector))) return true;
    searchedUntil = lineEnd;
  }
  return false;
}
