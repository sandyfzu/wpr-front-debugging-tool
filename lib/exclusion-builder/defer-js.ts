/**
 * The Defer JS transform: undoes WP Rocket's script deferral. Candidacy is
 * the served `data-rocket-defer` marker (the plugin always stamps it; a
 * bare native `defer` the plugin never stamped is not this feature's
 * work); rows match the `src` value WP Rocket captured — raw, as served
 * (whitespace and entities kept) — with WP Rocket's joined-row semantics
 * (`./defer-js-rows`), and the rewrite strips both defer markers.
 */
import { DELAY_JS_TYPES, WPR_DEFER_ATTRIBUTE } from '../wp-rocket/constants';
import { scanTags, parseTagAt } from './html-scan';
import { PCRE_SPACE_CHARS } from './pcre/byte-set';
import { deferRowSet } from './defer-js-rows';
import { undoDelayRenames } from './delay-js-match';
import { ExclusionValidationError } from './errors';
import { transformReport, type TransformResult } from './report';
import {
  applyPatches,
  findAttribute,
  removeAttribute,
  stampExclusionMarker,
  type TextPatch
} from './tag-edit';
import { featureRowProblems } from './validate';
import type { ExclusionFeatureId, ExclusionSet } from './set';

const FEATURE: ExclusionFeatureId = 'defer_all_js';
/** The native defer attribute the plugin pairs with its marker. */
const DEFER_ATTRIBUTE = 'defer';

/** PCRE's `\s` (no UTF) as a JS class. */
const SPACE = `[${PCRE_SPACE_CHARS}]`;

/**
 * WP Rocket's capture of a script's URL (`DeferJS::defer_js`), anchored at
 * one opening tag: PCRE's `\s` and its ASCII-only caseless `script`/`src`,
 * written out so no JS Unicode whitespace or case folding creeps in. The
 * greedy prefix takes the last `src=` that fits; the lazy `\s*?` leaves
 * surrounding whitespace in the value; a quote ends it.
 */
const SRC_CAPTURE = new RegExp(
  `^<[Ss][Cc][Rr][Ii][Pp][Tt]${SPACE}+(?:[^>]+[${PCRE_SPACE_CHARS}'"])?[Ss][Rr][Cc]${SPACE}*=${SPACE}*['"]${SPACE}*?([^'"]+)${SPACE}*?['"](?:[^>]+)?\\/?>`
);

/**
 * What WP Rocket's Defer JS writes into a script it defers: every `>` of the
 * tag it matched becomes this — a `>` inside a quoted value included.
 */
const DEFER_STAMP = ' data-rocket-defer defer>';

/** How Delay JS opens every tag it rewrites with attributes (verbatim, either version). */
const DELAYED_PREFIXES = DELAY_JS_TYPES.map((type) => `<script type="${type}" `);

/**
 * The tag text WP Rocket's Defer JS captured from, rebuilt from the served
 * tag by undoing the two later rewrites by their text, not by attribute
 * (neither is bound to where an HTML parser sees attributes):
 *
 * - its own stamp, back to `>`. Exact: it never stamps a tag already
 *   holding whitespace + `defer`, which the stamp itself contains;
 * - on a tag Delay JS rewrote (it runs later, and opens the tag with its
 *   own `type`), its rename: the first quoted `src=` text it finds — even
 *   inside another attribute's value, or after a separator no HTML parser
 *   reads — becomes `data-rocket-src=`, whitespace around `=` dropped (the
 *   capture ignores it). Only a delayed source tag already spelling
 *   `data-rocket-src=` would be misread.
 *
 * @param tagText The served opening tag.
 */
function deferTimeTag(tagText: string): string {
  // Delay JS ran last: its renames are undone first, on its own tag only.
  const delayed = DELAYED_PREFIXES.some((prefix) => tagText.startsWith(prefix));
  return (delayed ? undoDelayRenames(tagText) : tagText).replaceAll(DEFER_STAMP, '>');
}

/**
 * The part of a script's body that still belongs to the tag WP Rocket
 * matched. Its match ends at the first `>` after the quoted `src` value,
 * where an HTML parser may end the tag earlier (a `>` inside a value it
 * reads as unquoted, e.g. after a vertical tab). Every `>` of that match is
 * stamped, so the body's leading run of text whose every `>` closes a stamp
 * is the rest of it; empty otherwise.
 *
 * @param body The script's body as served.
 */
function stampedLead(body: string): string {
  let end = 0;
  for (let gt = body.indexOf('>'); gt !== -1; gt = body.indexOf('>', gt + 1)) {
    const stampStart = gt + 1 - DEFER_STAMP.length;
    if (stampStart < end || body.slice(stampStart, gt + 1) !== DEFER_STAMP) break;
    end = gt + 1;
  }
  return body.slice(0, end);
}

/**
 * The subject WP Rocket's rows are tested against for one script: the
 * captured `src` value, raw. `null` when the rebuilt tag yields none —
 * WP Rocket stamped the script, so it did capture one: this tag's served
 * text no longer shows it (e.g. a later rewrite this rebuild does not
 * undo), and the outcome is undetermined.
 *
 * @param tagText The served opening tag (plus any stamped lead of its body).
 */
export function deferSubject(tagText: string): string | null {
  return SRC_CAPTURE.exec(deferTimeTag(tagText))?.[1] ?? null;
}

/**
 * The Defer JS transform: `servedHtml` + the exclusion set → the html with
 * matched WP Rocket-deferred scripts stripped of both defer markers, plus
 * the transform's report. The rewrite stamps the exclusion marker as CSV.
 * When WP Rocket's page state cannot be replayed, the matches are applied
 * as if it defers and the report says so; a script whose subject cannot be
 * read back is left as served and counted undetermined.
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Defer JS rows + toggle slice). No document
 *   URL is taken: WP Rocket matches the raw `src` value, never a resolved one.
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when any Defer JS row has a
 *   problem — the page-wide `joined-page-off` included.
 */
export function deferJsTransform(servedHtml: string, set: ExclusionSet): TransformResult {
  const rows = set.rows.deferJs;
  const problems = featureRowProblems(FEATURE, 'pattern', rows);
  if (problems.length > 0) throw new ExclusionValidationError(problems);
  const rowSet = deferRowSet(rows);
  const featureWide = set.disable.deferJs;
  const matchCounts = rows.map(() => 0);
  const patches: TextPatch[] = [];
  let candidates = 0;
  let rewritten = 0;
  let undetermined = 0;
  for (const tag of scanTags(servedHtml)) {
    if (tag.name !== 'script') continue;
    // Candidacy is the plugin's marker — a bare native `defer` is not ours.
    const tagText = servedHtml.slice(tag.start, tag.openingEnd);
    if (findAttribute(parseTagAt(tagText, 0), WPR_DEFER_ATTRIBUTE) === null) continue;
    candidates++;
    if (!featureWide) {
      const body = servedHtml.slice(tag.openingEnd, tag.contentEnd);
      const subject = deferSubject(tagText + stampedLead(body));
      // WP Rocket captured a subject here, but it cannot be read back: left as served.
      if (subject === null) {
        undetermined++;
        continue;
      }
      const rowIndex = rowSet.firstMatch(subject);
      if (rowIndex === -1) continue;
      matchCounts[rowIndex] = (matchCounts[rowIndex] ?? 0) + 1;
    }
    let restored = removeAttribute(tagText, WPR_DEFER_ATTRIBUTE);
    restored = removeAttribute(restored, DEFER_ATTRIBUTE);
    rewritten++;
    patches.push({
      start: tag.start,
      end: tag.openingEnd,
      text: stampExclusionMarker(restored, FEATURE)
    });
  }
  return {
    html: applyPatches(servedHtml, patches),
    report: transformReport({
      feature: FEATURE,
      rowKind: 'pattern',
      rows,
      matchCounts,
      candidates,
      rewritten,
      regionRemovals: 0,
      featureWide,
      undetermined,
      ...(rowSet.page === 'unknown' ? { pageState: 'unknown' as const } : {}),
      rowCountsBestEffort: rows.length > 1
    })
  };
}
