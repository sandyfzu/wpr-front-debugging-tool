/**
 * The Defer JS transform: undoes WP Rocket's script deferral. Candidacy is
 * the served `data-rocket-defer` marker (the plugin always stamps it; a
 * bare native `defer` the plugin never stamped is not this feature's
 * work); rows match the `src` value WP Rocket captured — raw, as served
 * (whitespace and entities kept) — with WP Rocket's joined-row semantics
 * (`./defer-js-rows`), and the rewrite strips both defer markers. When the
 * set certainly turns WP Rocket's inline-jQuery pass off, its wrapping of
 * inline scripts is undone too (`./defer-inline-js`).
 */
import { WPR_DEFER_ATTRIBUTE } from '../wp-rocket/constants';
import { scanTags, parseTagAt } from './html-scan';
import { PCRE_SPACE_CHARS } from './pcre/byte-set';
import { deferRowSet } from './defer-js-rows';
import { replayInlinePass, type InlinePassReplay } from './defer-inline-js';
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
import { pcreFeatureProblems } from './validate';
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

/**
 * The tag texts WP Rocket's Defer JS may have captured from, rebuilt from
 * the served tag by undoing the two later rewrites by their text, not by
 * attribute (neither is bound to where an HTML parser sees attributes):
 *
 * - on a tag Delay JS rewrote (it runs later), its renames — through the
 *   shared rename-back helper, which keeps only the originals Delay JS's
 *   rewrite turns back into this text (several when the text cannot tell);
 *   a delay type in another spelling is left as served;
 * - then Defer JS's own stamp, back to `>`. Exact: it never stamps a tag
 *   already holding whitespace + `defer`, which the stamp itself contains.
 *
 * @param tagText The served opening tag (plus any stamped lead of its body).
 * @returns Each possible defer-time tag text; none when no original fits.
 */
function deferTimeTags(tagText: string): readonly string[] {
  const reading = undoDelayRenames(tagText);
  const texts = reading.kind === 'rebuilt' ? reading.texts : [tagText];
  return texts.map((text) => text.replaceAll(DEFER_STAMP, '>'));
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
 * The subject WP Rocket's rows are tested against, read from one
 * defer-time tag text: the captured `src` value, raw. `null` when the text
 * yields none — WP Rocket stamped the script, so it did capture one: this
 * text no longer shows it (e.g. a later rewrite this rebuild does not
 * undo), and the outcome is undetermined.
 *
 * @param tagText A defer-time tag text (see {@link deferTimeTags}).
 */
export function deferSubject(tagText: string): string | null {
  return SRC_CAPTURE.exec(tagText)?.[1] ?? null;
}

/**
 * One script's Defer JS verdict: the first matching row (`-1` for none),
 * or `null` when undetermined — no subject can be read back, or the
 * possible defer-time tags' subjects disagree.
 *
 * @param tagText The served opening tag (plus any stamped lead of its body).
 * @param firstMatch The row set's first-match lookup.
 */
function deferVerdict(tagText: string, firstMatch: (subject: string) => number): number | null {
  // WP Rocket stamped the script, so it captured a subject from the true
  // tag: a possible tag yielding none cannot be it.
  const subjects = deferTimeTags(tagText)
    .map(deferSubject)
    .filter((subject) => subject !== null);
  const rows = subjects.map((subject) => firstMatch(subject));
  const [row] = rows;
  if (row === undefined) return null;
  return rows.every((other) => (other !== -1) === (row !== -1)) ? row : null;
}

/**
 * The Defer JS transform: `servedHtml` + the exclusion set → the html with
 * matched WP Rocket-deferred scripts stripped of both defer markers, plus
 * the transform's report. The rewrite stamps the exclusion marker as CSV.
 * When WP Rocket's page state cannot be replayed, the matches are applied
 * as if it defers and the report says so; a script whose subject cannot be
 * read back is left as served and counted undetermined. Inline scripts
 * WP Rocket wrapped (its inline-jQuery pass) count as candidates: when the
 * set certainly turns that pass off they get their original body back,
 * when the outcome depends on the live rows they stay as served and count
 * undetermined (`./defer-inline-js`). Wrapping is never added: the served
 * page already reflects the live rows, which a set only adds to.
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Defer JS rows + toggle slice). No document
 *   URL is taken: WP Rocket matches the raw `src` value, never a resolved one.
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when any Defer JS row has a
 *   problem — the page-wide `joined-page-off` included.
 */
export function deferJsTransform(servedHtml: string, set: ExclusionSet): TransformResult {
  return deferWithInlinePass(servedHtml, set, null);
}

/**
 * The Defer JS transform over a page whose inline pass was already replayed
 * (the pipeline replays it before Delay JS, whose restores would otherwise
 * split identical wrapped copies): the replay's counts join the report.
 *
 * @param html The page after the replay (and any earlier step).
 * @param set The exclusion set.
 * @param inline The replay's result.
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} as {@link deferJsTransform}.
 */
export function deferJsTransformAfterInlinePass(
  html: string,
  set: ExclusionSet,
  inline: InlinePassReplay
): TransformResult {
  return deferWithInlinePass(html, set, inline);
}

/**
 * The Defer JS transform's body (see {@link deferJsTransform}).
 *
 * @param servedHtml The page.
 * @param set The exclusion set.
 * @param replayed The inline pass's replay when already done on `servedHtml`,
 *   else `null` (replayed here, after the deferral rewrites).
 * @returns The rewritten html and the report.
 */
function deferWithInlinePass(
  servedHtml: string,
  set: ExclusionSet,
  replayed: InlinePassReplay | null
): TransformResult {
  const rows = set.rows.deferJs;
  // One translation serves validation and matching (a heavy set is not memoized).
  const rowSet = deferRowSet(rows);
  const problems = pcreFeatureProblems(FEATURE, rows, rowSet.problems);
  if (problems.length > 0) throw new ExclusionValidationError(problems);
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
      const rowIndex = deferVerdict(tagText + stampedLead(body), rowSet.firstMatch);
      // WP Rocket captured a subject here, but it cannot be read back: left as served.
      if (rowIndex === null) {
        undetermined++;
        continue;
      }
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
  // Wrapped inline scripts are Defer JS's work too: candidates, rewritten
  // when unwrapped, undetermined when the pass's outcome is unknown.
  const deferred = applyPatches(servedHtml, patches);
  const inline = replayed ?? replayInlinePass(deferred, set);
  return {
    html: replayed === null ? inline.html : deferred,
    report: transformReport({
      feature: FEATURE,
      rowKind: 'pattern',
      rows,
      matchCounts,
      candidates: candidates + inline.wrapped,
      rewritten: rewritten + inline.unwrapped,
      regionRemovals: 0,
      featureWide,
      undetermined: undetermined + inline.undetermined,
      inlineUnwrapped: inline.unwrapped,
      ...(rowSet.page === 'unknown' ? { pageState: 'unknown' as const } : {}),
      rowCountsBestEffort: rows.length > 1
    })
  };
}
