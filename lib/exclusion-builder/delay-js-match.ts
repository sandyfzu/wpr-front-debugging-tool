/**
 * Delay JS row matching as WP Rocket's runtime does it: each stored row is
 * tested on its own (first hit wins) against the script element WP Rocket
 * saw before delaying it, case-insensitively for ASCII only, with its `+`,
 * `?ver` and `#` escapes applied — the PCRE translator owns those
 * semantics; this module rebuilds the subject and runs the rows.
 */
import { DELAY_JS_SRC, isDelayJSType } from '../wp-rocket/constants';
import { ExclusionValidationError } from './errors';
import { parseTagAt } from './html-scan';
import { compileFirstMatch, translateRegexRows } from './pcre/rows';
import { featureRowProblems } from './validate';

/** Where a delayed script parks its original `type` value. */
export const DELAY_TYPE_ATTRIBUTE = 'data-rocket-type';

/**
 * WP Rocket's in-place renames of a delayed script's attributes, served →
 * original. It rewrote the first `type\s*=\s*` / `src\s*=\s*` of each line
 * of the attribute text (anywhere: `data-src=` became `data-data-rocket-src=`),
 * so the served text renamed back reads as the original wherever the
 * original had no whitespace around `=`.
 */
const SERVED_RENAMES: readonly (readonly [served: string, original: string])[] = [
  [`${DELAY_TYPE_ATTRIBUTE}=`, 'type='],
  [`${DELAY_JS_SRC}=`, 'src=']
];

/**
 * The script element as WP Rocket matched it before delaying it, rebuilt
 * from the served markup: its injected delay `type` dropped — with the space
 * after it (`<script type="…" src…>` → `<script src…>`, `<script type="…" >`
 * → `<script >`), or the one before it when nothing follows
 * (`<script type="…">` → `<script>`) — and its parked `type`/`src` renamed
 * back in place inside the attribute text (up to the first `>`, where WP
 * Rocket's own pattern ends it). The body, the end tag and the defer stamp
 * (`data-rocket-defer defer`, written before Delay JS runs) are kept.
 *
 * Lossy where WP Rocket's rewrite is (not rebuilt): whitespace it trimmed
 * inside the opening tag and around `=` in `type`/`src`; a valueless `type`
 * it removed (with any ` type ` inside other values); the `<script` and end
 * tag spellings it normalized.
 *
 * @param region The served script element, `<script` through its end tag.
 * @returns The pre-delay element text.
 */
export function preDelayElement(region: string): string {
  let text = region;
  const type = parseTagAt(region, 0).attrs.find(
    (attr) => attr.name === 'type' && isDelayJSType(attr.value)
  );
  if (type !== undefined) {
    const spaceAfter = text.charAt(type.attrEnd) === ' ';
    const spaceBefore = text.charAt(type.attrStart - 1) === ' ';
    const start = !spaceAfter && spaceBefore ? type.attrStart - 1 : type.attrStart;
    const end = spaceAfter ? type.attrEnd + 1 : type.attrEnd;
    text = text.slice(0, start) + text.slice(end);
  }
  return undoDelayRenames(text);
}

/**
 * Delay JS's in-place renames undone: `data-rocket-type=` → `type=` and
 * `data-rocket-src=` → `src=` inside the attribute text — up to the first
 * `>`, where WP Rocket's own pattern ends a tag's attributes; the rest
 * (body, end tag) is kept as is.
 *
 * @param text Served markup starting at a delayed script's `<script`.
 * @returns The text with the renames undone.
 */
export function undoDelayRenames(text: string): string {
  const attributesEnd = text.indexOf('>');
  if (attributesEnd === -1) return text;
  let attributes = text.slice(0, attributesEnd);
  for (const [served, original] of SERVED_RENAMES) {
    attributes = attributes.replaceAll(served, original);
  }
  return attributes + text.slice(attributesEnd);
}

/** A compiled Delay JS row set: the index of the first row matching a script, or -1. */
export type DelayRowMatch = (region: string) => number;

/**
 * Compile Delay JS rows for matching, after validating them all (every
 * problem named at once: rows with no exact translation, rows matching
 * every script, backtracking risks — see `featureRowProblems`).
 *
 * @param rows The stored rows, in order.
 * @returns A matcher over a served script element (see {@link preDelayElement}).
 * @throws {@link ExclusionValidationError} naming every row with a problem.
 */
export function compileDelayRows(rows: readonly string[]): DelayRowMatch {
  const problems = featureRowProblems('delay_js', 'pattern', rows);
  if (problems.length > 0) throw new ExclusionValidationError(problems);
  const first = compileFirstMatch(
    translateRegexRows('delay_js', rows).rows.map((row) => row.matcher)
  );
  return (region) => first(preDelayElement(region));
}
