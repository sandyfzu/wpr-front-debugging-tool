/**
 * Delay JS row matching as WP Rocket's runtime does it: each stored row is
 * tested on its own (first hit wins) against the script element WP Rocket
 * saw before delaying it, case-insensitively for ASCII only, with its `+`,
 * `?ver` and `#` escapes applied — the PCRE translator owns those
 * semantics; this module rebuilds the subject and runs the rows.
 */
import { DELAY_JS_SRC, DELAY_JS_TYPES, isDelayJSType } from '../wp-rocket/constants';
import { delayAttributeRewrite } from './delay-js-rewrite';
import { matchAllRows, throwIfBlocking } from './errors';
import { parseTagAt } from './html-scan';
import { compileFirstMatch, translateRegexRows, translationRowProblems } from './pcre/rows';
import { pcreFeatureProblems } from './validate';
import { escapeRegex } from '../../utils/regex';

/** Where a delayed script parks its original `type` value. */
export const DELAY_TYPE_ATTRIBUTE = 'data-rocket-type';

/**
 * WP Rocket's in-place renames of a delayed script's attributes, served →
 * original (it writes the served spelling lowercase, `=` with no spaces).
 */
const SERVED_RENAMES: readonly (readonly [served: string, original: string])[] = [
  [`${DELAY_TYPE_ATTRIBUTE}=`, 'type='],
  [`${DELAY_JS_SRC}=`, 'src=']
];

/** Matches any served rename (the alternation of {@link SERVED_RENAMES}' served side). */
const SERVED_RENAME = new RegExp(SERVED_RENAMES.map(([served]) => served).join('|'), 'g');

/**
 * Most renames an opening tag may hold and still be rebuilt (each kept or
 * undone, and an undone one checked with and without a line feed: at most
 * 3^n forward checks); past it the script is undetermined.
 */
export const MAX_RENAME_CHOICES = 6;

/** How Delay JS opens a tag it rewrote: its type, then `>` (no attributes) or a space. */
const DELAY_OPENING = new RegExp(
  `^<script type="(?:${DELAY_JS_TYPES.map(escapeRegex).join('|')})"([ >])`
);

/**
 * What a served script's text was before Delay JS rewrote it:
 * - `rebuilt` — Delay JS's own spelling: every original it could have been
 *   rewritten from (a rename undone or kept, each choice checked by
 *   rewriting it forward — see `./delay-js-rewrite`); several when the
 *   served text cannot tell, none when no choice reproduces it;
 * - `approximate` — a delay type in another spelling (the page was
 *   rewritten again after WP Rocket): the type dropped and every rename
 *   undone, unchecked;
 * - `not-delayed` — no delay type: the text as is.
 */
export type PreDelayReading =
  | { readonly kind: 'rebuilt'; readonly texts: readonly string[] }
  | { readonly kind: 'approximate'; readonly text: string }
  | { readonly kind: 'not-delayed' };

/**
 * One way the renames in a served attribute text may read in the original.
 *
 * @param served The served attribute text.
 * @param spots The renames found in it.
 * @param undone Which renames are undone (the rest kept as served).
 * @param lineFeeds Which undone renames get a line feed after their `=`.
 */
function undoChoice(
  served: string,
  spots: readonly RegExpMatchArray[],
  undone: readonly boolean[],
  lineFeeds: readonly boolean[]
): string {
  let text = '';
  let from = 0;
  spots.forEach((spot, at) => {
    const name = spot[0];
    const original = SERVED_RENAMES.find(([served]) => served === name)?.[1] ?? name;
    const written = undone[at] === true ? `${original}${lineFeeds[at] === true ? '\n' : ''}` : name;
    text += served.slice(from, spot.index) + written;
    from = (spot.index ?? 0) + name.length;
  });
  return text + served.slice(from);
}

/**
 * The bits of `mask`, one per rename.
 *
 * @param mask The bit mask.
 * @param count How many renames.
 */
function bits(mask: number, count: number): boolean[] {
  return Array.from({ length: count }, (_, at) => ((mask >> at) & 1) === 1);
}

/**
 * Every way the renames in a served attribute text may read in the
 * original — each kept or undone, every rename undone first — that WP
 * Rocket's rewrite turns back into the served text. The whitespace it
 * dropped around a renamed `=` is not rebuilt (a named residual), but a
 * line feed there changes how its later renames fell (they stop at line
 * ends), so a choice is checked with every line-feed placement too.
 *
 * @param served The served attribute text.
 * @returns Each fitting original attribute text (distinct), or `null` past
 *   {@link MAX_RENAME_CHOICES}.
 */
function fittingUndoChoices(served: string): string[] | null {
  const spots = [...served.matchAll(SERVED_RENAME)];
  if (spots.length > MAX_RENAME_CHOICES) return null;
  const fitting: string[] = [];
  const all = 2 ** spots.length;
  for (let mask = all - 1; mask >= 0; mask--) {
    const undone = bits(mask, spots.length);
    // Line feeds only where a rename is undone; the text itself keeps none.
    const fits = Array.from({ length: all }, (_, feeds) => feeds)
      .filter((feeds) => (feeds & ~mask) === 0)
      .some(
        (feeds) =>
          delayAttributeRewrite(
            ` ${undoChoice(served, spots, undone, bits(feeds, spots.length))}`
          ) === served
      );
    if (fits) fitting.push(undoChoice(served, spots, undone, []));
  }
  return fitting;
}

/**
 * Undo every rename up to the first `>`, unchecked (the `approximate` reading).
 *
 * @param text Markup starting at `<script`.
 */
function undoAllRenames(text: string): string {
  const end = text.indexOf('>');
  if (end === -1) return text;
  let attributes = text.slice(0, end);
  for (const [served, original] of SERVED_RENAMES) {
    attributes = attributes.replaceAll(served, original);
  }
  return attributes + text.slice(end);
}

/**
 * Read a served script's text back to what Delay JS rewrote — the one
 * rename-back helper (Delay JS's subject, and Defer JS's defer-time tag:
 * Defer JS ran before Delay JS). Only the attribute text WP Rocket captured
 * changes: up to the first `>`, where its own pattern ends it; the rest
 * (body, end tag, any later text) is kept.
 *
 * Lossy where WP Rocket's rewrite is (not rebuilt, so a checked choice can
 * still differ from the true original): whitespace it trimmed inside the
 * opening tag and around `=` in `type`/`src`; a valueless `type` it removed
 * (with any ` type ` inside other values); the `<script` and end-tag
 * spellings it normalized.
 *
 * @param text Served markup starting at a script's `<script`.
 */
export function undoDelayRenames(text: string): PreDelayReading {
  const opening = DELAY_OPENING.exec(text);
  if (opening === null) {
    const type = parseTagAt(text, 0).attrs.find(
      (attr) => attr.name === 'type' && isDelayJSType(attr.value)
    );
    if (type === undefined) return { kind: 'not-delayed' };
    return { kind: 'approximate', text: undoAllRenames(withoutAttribute(text, type)) };
  }
  // `<script type="…">`: WP Rocket's spelling of a script without attributes.
  if (opening[1] === '>')
    return { kind: 'rebuilt', texts: [`<script${text.slice(opening[0].length - 1)}`] };
  const rest = text.slice(opening[0].length);
  const end = rest.indexOf('>');
  if (end === -1) return { kind: 'rebuilt', texts: [] };
  const served = rest.slice(0, end);
  // The original had at least one attribute character (WP Rocket trimmed it): a space.
  const texts = (fittingUndoChoices(served) ?? []).map(
    (choice) => `<script ${choice}${rest.slice(end)}`
  );
  return { kind: 'rebuilt', texts };
}

/**
 * An attribute removed from a tag's text with one adjacent space (the one
 * after it, else the one before it).
 *
 * @param text The tag text.
 * @param attr The attribute's span.
 * @param attr.attrStart Where it starts.
 * @param attr.attrEnd Where it ends.
 */
function withoutAttribute(text: string, attr: { attrStart: number; attrEnd: number }): string {
  const spaceAfter = text.charAt(attr.attrEnd) === ' ';
  const spaceBefore = text.charAt(attr.attrStart - 1) === ' ';
  const start = !spaceAfter && spaceBefore ? attr.attrStart - 1 : attr.attrStart;
  return text.slice(0, start) + text.slice(spaceAfter ? attr.attrEnd + 1 : attr.attrEnd);
}

/**
 * Delay JS's verdict on one script: the first matching row (`row`, `-1`
 * for none), whether it was read from an `approximate` rebuild — or `null`
 * when undetermined (the possible originals disagree, or none fits).
 */
export type DelayVerdict = { readonly row: number; readonly approximate: boolean } | null;

/** A compiled Delay JS row set over a served script element. */
export type DelayRowMatch = (region: string) => DelayVerdict;

/** Delay JS rows read for matching. */
export interface DelayRowSet {
  /** The matcher over a served script element (`<script` through its end tag). */
  readonly match: DelayRowMatch;
  /** Rows that match every script (WP Rocket stores and applies them), in row order. */
  readonly matchAllRows: readonly string[];
}

/**
 * Read Delay JS rows for matching, after validating them all (every
 * blocking problem named at once: rows with no exact translation,
 * backtracking risks — see `featureRowReading`). Rows matching every
 * script only warn: their matcher matches every script, as on WP Rocket.
 *
 * @param rows The stored rows, in order.
 * @returns The matcher and the rows matching every script.
 * @throws {@link ExclusionValidationError} naming every blocking row.
 */
export function readDelayRows(rows: readonly string[]): DelayRowSet {
  // One translation serves validation and matching.
  const translation = translateRegexRows('delay_js', rows);
  const entries = pcreFeatureProblems(
    'delay_js',
    rows,
    translationRowProblems('delay_js', translation)
  );
  throwIfBlocking(entries);
  const first = compileFirstMatch(translation.rows.map((row) => row.matcher));
  const match: DelayRowMatch = (region) => {
    const reading = undoDelayRenames(region);
    if (reading.kind === 'not-delayed') return { row: first(region), approximate: true };
    if (reading.kind === 'approximate') return { row: first(reading.text), approximate: true };
    return agreedVerdict(reading.texts.map(first));
  };
  return { match, matchAllRows: matchAllRows(entries) };
}

/**
 * Compile Delay JS rows for matching (see {@link readDelayRows}).
 *
 * @param rows The stored rows, in order.
 * @returns A matcher over a served script element (`<script` through its end tag).
 * @throws {@link ExclusionValidationError} naming every blocking row.
 */
export function compileDelayRows(rows: readonly string[]): DelayRowMatch {
  return readDelayRows(rows).match;
}

/**
 * One verdict from every possible original's: their shared verdict
 * (crediting the first original's row), else undetermined.
 *
 * @param rows Each possible original's first matching row (`-1` = none).
 */
export function agreedVerdict(rows: readonly number[]): DelayVerdict {
  const [row] = rows;
  if (row === undefined) return null;
  const matched = row !== -1;
  return rows.every((other) => (other !== -1) === matched) ? { row, approximate: false } : null;
}
